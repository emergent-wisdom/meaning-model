import * as z from 'zod/v4';
import { renderOntologyTree } from './alien-ontology.mjs';
import { digest, drawSeed, findTargetLeaks, readSearch, requireProblem, targetTerms } from './alien-search.mjs';
import { ontologyGaps, uncombinedPairs } from './alien-diagnose.mjs';

// Role tasks with information partitioned by construction, following Ontology of the
// Alien: a target-blind Builder, a purpose-blind but target-aware Solver, a compiler
// that sees world, solve and target, and curators that own the ontologies. The server
// writes every task text and stores it in the graph; the caller executes it, ideally in
// a fresh context, and records which isolation it actually used.

const id = z.string().trim().min(1).max(256);
export const WORLD_OPERATOR_KINDS = Object.freeze(['stipulated_constraint', 'ecological_history', 'technological_path', 'historical_branch',
  'institutional_inversion', 'capability_removal', 'capability_substitution', 'oracle_premise']);
export const worldOperatorSchema = z.object({
  kind: z.enum(WORLD_OPERATOR_KINDS),
  statement: z.string().trim().min(1).max(1_000),
}).strict();
export const SIGNATURE_AXES = Object.freeze(['temporality', 'conservation', 'agency', 'identity', 'scarcity', 'information_flow',
  'boundary_structure', 'permitted_transformations', 'enforcement']);

// The population state a proposal sees, as in the paper's design matrix: none, a flat Semantic
// Tabu archive of earlier candidates, or the curated map.
export const POPULATION_STATES = Object.freeze(['none', 'tabu', 'map']);
const populationState = (fallback) => z.enum(POPULATION_STATES).default(fallback);

export const taskInputSchemas = {
  builder: z.object({ slot: z.number().int().min(0).max(100_000).nullable().default(null), seedWord: id.nullable().default(null), seedSalt: id.nullable().default(null),
    operators: z.array(worldOperatorSchema).max(6).default([]), commissionNodeId: id.nullable().default(null) }).strict(),
  solver: z.object({ worldNodeId: id }).strict(),
  compiler: z.object({ worldNodeId: id, solutionNodeId: id, commissionNodeId: id.nullable().default(null), populationState: populationState('none') }).strict(),
  explorer: z.object({ commissionNodeId: id.nullable().default(null), populationState: populationState('map'),
    cueWord: id.nullable().default(null), drawCue: z.boolean().default(false) }).strict(),
  curator: z.object({ subjectNodeId: id, ontology: z.enum(['mechanisms', 'outcomes']).default('mechanisms') }).strict(),
  world_curator: z.object({ subjectNodeId: id }).strict(),
  transfer: z.object({ mechanismNodeId: id }).strict(),
};
export const TASK_ROLES = Object.freeze(Object.keys(taskInputSchemas));

// The paper's workflow cells: the source frame (target only, target plus a random cue, or a world
// and its in-world solve) crossed with the population state. The target-only cell without state
// was not run in the paper.
export function conditionLabel(role, inputs, cued) {
  if (role === 'compiler') return { none: 'F', tabu: 'G', map: 'H' }[inputs.populationState];
  if (role !== 'explorer') return null;
  return cued ? { none: 'C', tabu: 'D', map: 'E' }[inputs.populationState] : { none: 'target_only', tabu: 'A', map: 'B' }[inputs.populationState];
}

const operatorText = {
  stipulated_constraint: 'Stipulate this constraint as a law of the world',
  ecological_history: 'Give the world this ecological or evolutionary history',
  technological_path: 'Let the world\'s technology have followed this path',
  historical_branch: 'Let the world\'s history have branched here',
  institutional_inversion: 'Invert this institution or custom',
  capability_removal: 'Remove this capability from the world entirely',
  capability_substitution: 'Replace this capability with a different one',
  oracle_premise: 'Treat this as already and simply true, as a law',
};

export const CANDIDATE_LIMITS = Object.freeze({ label: 40, design_principles: 200, core_mechanism: 200, how_it_works: 500, what_is_new: 200,
  why_it_works: 300, why_it_fails: 300, medium_term: 200, long_term_vision: 300 });
const candidateSpec = Object.entries(CANDIDATE_LIMITS).map(([field, limit]) => `${field} (at most ${limit} characters)`).join(', ');
const candidateKeys = Object.keys(CANDIDATE_LIMITS).join(', ');
const mechanismJson = (world) => `End your answer with the mechanism as one JSON object with the keys operator, roles (each with id, description${world ? ' and worldRuleIds' : ''}), ${world ? 'magicalElements (each with element and fix {kind, text}), ' : ''}strangest {element, preserved}, candidate {${candidateKeys}}${world ? ' and selfAudit {bottleneckRelief, fiat, capabilityProvenance, rationale} or null' : ''}.`;
const decisionJson = (worlds) => `End your answer with the decision as one JSON object: verdict; conceptId; nearestConceptId; equivalence {nameChanged, actorChanged, parameterChanged, inputSignalChanged, primaryOperatorChanged, explanation} or null; fit (clear, partial, borderline or null); ${worlds ? 'signature with every axis as {code, note} or null; ' : ''}newConcepts (for admit_new or restructuring, each {id, label, operator, differentia, boundary${worlds ? '' : ', roles [{id, description}]'}}, with labels up to 200 characters, operators up to 1,200, each differentia up to 800 and boundaries up to 2,000); ${worlds ? '' : 'membership {question, unit, shares [{conceptId, share}], remainder} or null; '}other operations in words; redirect {addressedTo, relationToChange, alternatives, worldAsk} or null; rationale (up to 4,000 characters).`;

function rulesIndex(world) {
  return world.data.rules.map((rule) => `${rule.id}: ${rule.statement}`).join('\n');
}

function commissionFor(search, commissionNodeId, addressedTo) {
  if (commissionNodeId === null) return null;
  const commission = search.record(commissionNodeId, 'commission');
  if (!addressedTo.includes(commission.data.addressedTo)) {
    throw new Error(`Commission ${commissionNodeId} is addressed to ${commission.data.addressedTo}, not to ${addressedTo.join(' or ')}.`);
  }
  return commission;
}

function mechanismCard(mechanism) {
  const data = mechanism.data;
  return [
    `Operator: ${data.operator}`,
    `Roles: ${data.roles.map((item) => `${item.id} (${item.description})`).join('; ')}`,
    `Strangest element: ${data.strangest.element}. Kept as: ${data.strangest.preserved}`,
    data.magicalElements?.length ? `Magical elements: ${data.magicalElements.map((item) => `${item.element} -> ${item.fix.kind}: ${item.fix.text}`).join('; ')}` : null,
    'Candidate:',
    ...Object.keys(CANDIDATE_LIMITS).map((field) => `  ${field}: ${data.candidate[field]}`),
  ].filter(Boolean).join('\n');
}

export function mechanismLabel(search) {
  const labels = new Map(search.mechanisms.map((record) => [record.nodeId, `${record.data.candidate.label} [${record.nodeId}]`]));
  for (const world of search.worlds) labels.set(world.nodeId, `${world.data.title} [${world.nodeId}]`);
  return (subjectNodeId) => labels.get(subjectNodeId) ?? subjectNodeId;
}

// The solver sees only the statement and constraints, as in the original method: background
// context can disclose why the world exists, which would end the solver's purpose blindness.
function problemText(problem, { context = true } = {}) {
  return [problem.statement, context && problem.context ? `Context: ${problem.context}` : null,
    problem.constraints?.length ? `Constraints:\n${problem.constraints.map((item) => `- ${item}`).join('\n')}` : null].filter(Boolean).join('\n\n');
}

function tabuBank(search) {
  const bank = search.mechanisms.map((item) => item.data.candidate);
  return [
    'EXISTING SOLUTIONS:',
    bank.length ? JSON.stringify(bank, null, 2) : 'None yet',
    '',
    'Before proposing your solution, first list the core mechanism of each existing solution above.',
    'Then explicitly state which structural approaches you are AVOIDING because they already exist.',
  ].join('\n');
}

function mapText(search) {
  const state = search.ontologyState('mechanisms');
  const outcomes = search.ontologyState('outcomes');
  const gaps = ontologyGaps(state);
  const pairs = uncombinedPairs(search).slice(0, 12);
  // Ids alone do not tell a fresh context what a family or an outcome class is, so each is named.
  const named = (ontology, id) => { const concept = ontology.concepts.find((item) => item.id === id); return concept ? `${id} (${concept.label})` : id; };
  const outcomeClasses = outcomes.concepts.filter((concept) => concept.status === 'active');
  return [
    'The current map of candidate mechanisms (families, their operators and instances):',
    renderOntologyTree(state, { labelFor: mechanismLabel(search) }),
    ...(outcomeClasses.length ? ['', 'The claimed-outcome classes (what a candidate claims to achieve):',
      ...outcomeClasses.map((concept) => `- [${concept.id}] ${concept.label}: ${concept.operator}`)] : []),
    '',
    `Thin or unoccupied branches: ${gaps.thin.length ? gaps.thin.map((id) => named(state, id)).join(', ') : 'none yet'}`,
    ...(pairs.length ? [`Family and claimed-outcome combinations no candidate has yet: ${pairs.map((pair) => `${named(state, pair.familyId)} with ${named(outcomes, pair.outcomeId)}`).join('; ')}`] : []),
  ].join('\n');
}

async function modelSummary(service, modelHash) {
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  const meaning = model.meaning_model ?? {};
  const cap = (items, render) => items.slice(0, 200).map(render).join('\n') || '(none)';
  const short = (value) => (value && value.length > 240 ? `${value.slice(0, 237)}...` : value ?? '');
  return { modelId: model.id, text: [
    `Model ${model.id} (time unit ${model.time_unit}). Cite records as kind:id.`,
    `Processes:\n${cap(model.processes ?? [], (item) => `- process:${item.id}${item.unit ? ` [${item.unit}]` : ''}${item.scale?.semantic_role ? `: ${short(item.scale.semantic_role)}` : ''}`)}`,
    `Referents:\n${cap(meaning.referents ?? [], (item) => `- referent:${item.id}: ${short(item.boundary)}`)}`,
    `Events:\n${cap(meaning.events ?? [], (item) => `- event:${item.id}: ${short(item.boundary)}`)}`,
    (model.laws ?? []).length ? `Laws:\n${cap(model.laws, (item) => `- law:${item.id}`)}` : null,
    (meaning.concepts ?? []).length ? `Concepts:\n${cap(meaning.concepts, (item) => `- concept:${item.id}${item.label ? `: ${item.label}` : ''}`)}` : null,
  ].filter(Boolean).join('\n\n') };
}

export async function buildTask(service, { role, graphHash, searchRootId, accessScopes, inputs: rawInputs = {}, search: provided = null }) {
  const schema = taskInputSchemas[role];
  if (!schema) throw new Error(`Unknown alien task role ${role}. Roles: ${TASK_ROLES.join(', ')}.`);
  const inputs = schema.parse(rawInputs);
  const search = provided ?? await readSearch(service, { graphHash, searchRootId, accessScopes });
  const problem = requireProblem(search);
  const terms = targetTerms(problem);
  let text; let material = {}; let targetBlind = false; let purposeBlind = false; let targetLeaks = [];
  let recordAs;
  if (role === 'builder') {
    const commission = commissionFor(search, inputs.commissionNodeId, ['new_world']);
    // Each world holds one draw slot, and a prepared builder task reserves its slot, so tasks
    // prepared one after another for a fan-out draw distinct words. The default is the lowest
    // slot neither held nor reserved; an explicit slot must not be held by a world.
    const used = new Map(search.worlds.map((world) => [world.data.seed.drawIndex, world.nodeId]));
    const reserved = new Set(search.tasks.filter((task) => task.data.role === 'builder').map((task) => task.data.material.seed.drawIndex));
    let slot = inputs.slot;
    if (slot === null) { slot = 0; while (used.has(slot) || reserved.has(slot)) slot += 1; }
    if (used.has(slot)) throw new Error(`Draw slot ${slot} already holds world ${used.get(slot)}; choose a free slot or omit it.`);
    const seed = inputs.seedWord ? { word: inputs.seedWord, source: 'caller', bankId: null, bankSize: null, position: null, drawIndex: slot, salt: null }
      : drawSeed(searchRootId, slot, inputs.seedSalt);
    const operators = [...(commission?.data.operators ?? []), ...inputs.operators];
    const oracle = operators.some((item) => item.kind === 'oracle_premise');
    const departures = operators.length ? `\n\nAlso build these departures into the world:\n${operators.map((item) => `- ${operatorText[item.kind]}: ${item.statement}`).join('\n')}` : '';
    const ask = commission?.data.worldAsk ? `\n\nThe world should also make this relation ordinary and easy to reason about: ${commission.data.worldAsk}` : '';
    text = `Please think deeply about this world-building task.

You are a world-builder. Describe a world where this concept is the FUNDAMENTAL LAW of physics:

SEED: ${seed.word}${departures}${ask}

Describe:
1. The core principle - how does ${seed.word} govern everything?
2. 3-5 specific rules/laws that emerge from this principle
3. How people live, work, and organize society under these rules
4. What is easy in this world? What is hard?

Be specific and internally consistent. Do NOT try to solve any problems yet.

Begin with a title of at most twelve words, and number the rules R1, R2, ... so they can be cited.`;
    targetLeaks = findTargetLeaks([seed.word, ...operators.map((item) => item.statement), commission?.data.worldAsk ?? ''].join('\n'), terms);
    targetBlind = !oracle && targetLeaks.length === 0;
    purposeBlind = true;
    material = { seed, operators, commissionNodeId: inputs.commissionNodeId, oraclePremise: oracle };
    recordAs = 'world';
  } else if (role === 'solver') {
    const world = search.record(inputs.worldNodeId, 'world');
    text = `Please think deeply about solving this problem.

You live in a world with different physics:

WORLD RULES:
${world.data.text}

Rules as recorded:
${rulesIndex(world)}

PROBLEM: ${problemText(problem, { context: false })}

How would you solve this problem?

Requirements:
- Your solution must USE the world's physics, not fight against them
- Be specific about HOW the solution leverages the world's rules, citing them as R1, R2, ...
- Do not reference our world or "normal" physics`;
    purposeBlind = true;
    material = { worldNodeId: world.nodeId };
    recordAs = 'solution';
  } else if (role === 'compiler') {
    const world = search.record(inputs.worldNodeId, 'world');
    const solution = search.record(inputs.solutionNodeId, 'solution');
    if (solution.data.worldNodeId !== world.nodeId) throw new Error(`Solution ${solution.nodeId} solves ${solution.data.worldNodeId}, not ${world.nodeId}.`);
    const commission = commissionFor(search, inputs.commissionNodeId, ['retry']);
    if (commission && !search.mechanisms.some((item) => item.nodeId === commission.data.retryOfNodeId && item.data.source.worldNodeId === world.nodeId)) {
      throw new Error(`Commission ${commission.nodeId} redirects a compilation of another world.`);
    }
    const population = inputs.populationState === 'tabu' ? `\n\n${tabuBank(search)}`
      : inputs.populationState === 'map' ? `\n\n${mapText(search)}\n\nUse the map to avoid rephrasing an occupied family while keeping this world's operative relation.` : '';
    const redirect = commission ? `\n\nA curator found an earlier compilation of this world structurally equivalent to an existing family. The retry must change this causal relation: ${commission.data.relationToChange}${commission.data.alternatives?.length ? `\nAlternatives the curator named (choosing one of them shows responsiveness, not discovery): ${commission.data.alternatives.join('; ')}` : ''}` : '';
    text = `Please think deeply about this problem.

PROBLEM:
${problemText(problem)}

WORLD:
${world.data.text}

Rules as recorded:
${rulesIndex(world)}

SOLUTION:
${solution.data.text}

Your task is to adapt this solution to our world:
1. First, imagine implementing this solution exactly as described. What would it look like?
2. Identify the "magical" elements—things that work in this world's physics but not ours.
3. For each magical element, iteratively fix it by either:
   - Inventing technology that could achieve the same effect
   - Finding existing technology/structures that approximate it
4. Preserve what's strangest—that's the leverage point. Don't sand it down to something familiar.${population}${redirect}

Then state the compiled mechanism:
- operator: the operative causal relation in one or two sentences, without the world's proper names and without the problem's domain terms
- roles: the two to eight parts the relation needs, each with the world rules (R1, ...) that supply it in this world
- magicalElements: each with its fix, as invented_technology, existing_approximation, institutional_substitute or unresolved
- strangest: the strangest element, and how the candidate keeps it
- candidate: ${candidateSpec}
- selfAudit, optional: bottleneck relief (clear, partial or none: does a world rule make a problem function automatic by assumption?), final-outcome fiat (pass, borderline or fail: does the principal operation simply assert the desired end?), and capability provenance (direct, amplified or mixed)

${mechanismJson(true)}`;
    material = { worldNodeId: world.nodeId, solutionNodeId: solution.nodeId, commissionNodeId: inputs.commissionNodeId, populationState: inputs.populationState };
    recordAs = 'mechanism';
  } else if (role === 'explorer') {
    const commission = commissionFor(search, inputs.commissionNodeId, ['explorer', 'retry']);
    const gaps = ontologyGaps(search.ontologyState('mechanisms'));
    // Cue draws have their own sequence, one per cued explorer task already prepared.
    const cueIndex = search.tasks.filter((task) => task.data.material?.cue).length;
    const cue = inputs.cueWord ? { word: inputs.cueWord, source: 'caller', drawIndex: null }
      : inputs.drawCue ? { ...drawSeed(`${searchRootId}:cue`, cueIndex), drawIndex: cueIndex } : null;
    const population = inputs.populationState === 'map' ? `\n\n${mapText(search)}` : inputs.populationState === 'tabu' ? `\n\n${tabuBank(search)}` : '';
    const cueText = cue ? `\n\nA random word for inspiration: ${cue.word}. Do not force a literal connection; it may become any metaphor, structure, process or principle.` : '';
    const direction = commission ? `\n\nDirection from the curator: ${commission.data.relationToChange ?? commission.data.rationale}` : '';
    const aim = inputs.populationState === 'map'
      ? 'Propose one candidate aimed at a thin or unoccupied branch, or at a mechanism the map lacks. Be genuinely novel: do not rephrase an existing family. First name the structures you are avoiding and why.'
      : inputs.populationState === 'tabu' ? 'Propose one new candidate outside the approaches you listed as avoided.' : 'Propose one candidate.';
    text = `Please think deeply about this problem.

PROBLEM:
${problemText(problem)}${population}${cueText}${direction}

${aim} Then state:
- operator: the operative causal relation in one or two sentences
- roles: the two to eight parts it needs
- strangest: its strangest element, and how the candidate keeps it
- candidate: ${candidateSpec}

${mechanismJson(false)}`;
    material = { commissionNodeId: inputs.commissionNodeId, thin: gaps.thin, cue, populationState: inputs.populationState };
    recordAs = 'mechanism';
  } else if (role === 'curator' || role === 'world_curator') {
    const worlds = role === 'world_curator';
    const outcomes = !worlds && inputs.ontology === 'outcomes';
    const ontology = worlds ? 'worlds' : inputs.ontology;
    const noun = worlds ? 'regime' : outcomes ? 'outcome class' : 'family';
    const nouns = worlds ? 'regimes' : outcomes ? 'outcome classes' : 'families';
    const operator = outcomes ? 'primary claimed outcome' : 'primary causal operator';
    const subject = search.record(inputs.subjectNodeId, worlds ? 'world' : 'mechanism');
    const state = search.ontologyState(ontology);
    const tree = renderOntologyTree(state, { labelFor: mechanismLabel(search) });
    // Fresh contexts do not have the server's tools, so tasks describe the decision, not the tool that records it.
    const verdicts = `Decide one verdict:
- admit_new: a new ${noun}, only when the ${operator} differs from the nearest one, not only its name, actor, parameter or input signal
- admit_instance: an instance of an existing ${noun}
- equivalent: an alias of an existing ${noun}; only name, actor, parameter or input signal changed
- reject_redirect: ${worlds ? 'a shallow restatement of a covered regime' : `an occupied ${noun}`}; name the causal relation the next ${worlds ? 'world' : 'proposal'} must change
State the equivalence test against the nearest ${noun}${outcomes ? ', recording a changed primary claimed outcome as primaryOperatorChanged' : ''}. Restructure when the ${worlds ? 'world' : 'candidate'} reveals a better distinction: add concepts, partitions (more specific kinds under a named lens), specializations, analogies or oppositions; merge aliases; split conflated ${nouns}. The ontology is a revisable hypothesis, not a neutral map. Do not prune an unusual branch because it feels unfamiliar.${worlds ? '' : ` When the ${worlds ? 'world' : 'candidate'} sits between ${nouns}, you may also give a graded membership: a question, a unit, shares over the ${nouns} it draws on and a remainder, summing to 1, beside its categorical assignment.`}`;
    if (worlds) {
      // Show the codes in use so a curator can reuse them; coverage compares codes.
      const used = {};
      for (const record of search.revisions) {
        if (record.data.ontology !== 'worlds' || !record.data.decision.signature) continue;
        for (const [axis, value] of Object.entries(record.data.decision.signature)) if (value) { used[axis] ??= {}; used[axis][value.code] = (used[axis][value.code] ?? 0) + 1; }
      }
      const codes = SIGNATURE_AXES.map((axis) => `- ${axis}: ${used[axis] ? Object.entries(used[axis]).map(([code, count]) => `${code} (${count})`).join('; ') : 'none yet'}`).join('\n');
      text = `You curate a population of invented worlds by their causal regimes. You do not know, and must not guess, what the worlds will be used for.

Current regime ontology:
${tree}

Signature codes already in use:
${codes}

World under review (${subject.nodeId}):
${subject.data.text}

Rules as recorded:
${rulesIndex(subject)}

Code its causal signature on these axes: ${SIGNATURE_AXES.join(', ')}. For each axis give a code of at most 80 characters, reusing an existing world's code when the world agrees with it, and an optional note of at most 600 characters; use null when the world does not settle the axis.

${verdicts}

${decisionJson(true)}`;
      targetBlind = true;
    } else if (outcomes) {
      text = `You curate the claimed outcomes of candidate interventions: what each claims to achieve for the people it serves, not the mechanism by which it does so.

PROBLEM:
${problemText(problem)}

Current outcome ontology (each class's operator states the outcome that defines it):
${tree}

Candidate under review (${subject.nodeId}):
${mechanismCard(subject)}

Classify its principal claimed outcome. ${verdicts}

${decisionJson(false)}`;
    } else {
      const source = subject.data.source.kind === 'world'
        ? `compiled from world ${subject.data.source.worldNodeId} (seed ${search.record(subject.data.source.worldNodeId, 'world').data.seed.word})`
        : 'proposed directly by an explorer';
      text = `You are the curator of this search's mechanism ontology. You own admission and every change to it.

PROBLEM:
${problemText(problem)}

Current mechanism ontology:
${tree}

Candidate under review (${subject.nodeId}, ${source}):
${mechanismCard(subject)}

${verdicts} A retry that picks one of your named alternatives shows responsiveness, not discovery.

${decisionJson(false)}`;
    }
    material = { subjectNodeId: subject.nodeId, ontology, headNodeId: search.heads[ontology]?.nodeId ?? null };
    recordAs = 'ontology_revision';
  } else if (role === 'transfer') {
    const mechanism = search.record(inputs.mechanismNodeId, 'mechanism');
    const state = search.ontologyState('mechanisms');
    const families = state.instances.filter((item) => item.subjectNodeId === mechanism.nodeId)
      .map((item) => state.concepts.find((concept) => concept.id === item.conceptId))
      .map((concept) => `${concept.id}: ${concept.label}. Operator: ${concept.operator}`);
    const model = await modelSummary(service, search.modelHash);
    text = `Transfer one compiled mechanism into the target domain, for ideation.

PROBLEM:
${problemText(problem)}

TARGET MODEL:
${model.text}

MECHANISM (${mechanism.nodeId}):
${mechanismCard(mechanism)}
${families.length ? `\nFamily: ${families.join('; ')}` : '\nFamily: not yet curated'}

1. Map every role: bind it to a model record (kind:id), describe the new component the domain would need, or leave it unfilled with the reason.
2. Label each magical element's proxy as portable (achievable with present means), inverse (the domain needs the opposite effect) or magical (no present means), and date the judgment.
3. List where the analogy breaks: at least one disanalogy.
4. Write the candidate in the domain's own terms: ${candidateSpec}.
5. State the evidence needed before anyone relies on it.
6. If you grade how well the role alignment fits, do it as a fit Cut: name the comparison question and unit, and divide that one unit among matches, does not match and an unresolved remainder. Otherwise leave fit unscored.
A transfer records an idea and its mapping, not a finding. Do not claim efficacy.

End your answer with one JSON object: roleMap (each {roleId, binding} where binding is {kind: model, ref, how}, {kind: new_component, description} or {kind: unfilled, reason}), proxies (each {element, label, proxy, asOf}), disanalogies, candidate {${candidateKeys}}, fitCut ({question, unit, matches, doesNotMatch, remainder} summing to 1, or null) and evidenceNeeded.`;
    material = { mechanismNodeId: mechanism.nodeId, modelId: model.modelId, families };
    recordAs = 'transfer';
  }
  const condition = conditionLabel(role, inputs, Boolean(material.cue));
  const taskHash = digest({ schema: 'meaning-model-alien-task/v1', role, graphHash, searchRootId, inputs, text });
  const isolation = role === 'builder'
    ? (targetBlind ? 'Give this task, and nothing else, to a fresh context that has never seen the problem. Record the output as a world with the returned taskNodeId, and state the isolation you used.'
      : `This builder task is not target-blind (${targetLeaks.length ? `target terms: ${targetLeaks.join(', ')}` : 'oracle premise'}); the world record will say so. For a target-blind world, rewrite the commission or operators without them.`)
    : role === 'solver' ? 'Give this task to a fresh context that has not seen the builder task or the search\'s purpose. Record its answer as a solution with the returned taskNodeId.'
      : role === 'world_curator' ? 'The world curator stays target-blind: a fresh context should see only this task.'
        : 'A fresh context is preferred; record the isolation you used.';
  return { role, graphHash, searchRootId, inputs, text, material, condition, targetBlind, purposeBlind, targetLeaks, taskHash,
    taskRef: { role, graphHash, inputs, taskHash }, recordAs, isolationGuidance: isolation };
}

// Tasks stored before task records existed were verified by recomputing them at their own graph
// revision. That survives only while the task wording is unchanged, so it is kept for such
// records and new records cite a stored task instead.
export async function verifyTaskRef(service, { taskRef, searchRootId, accessScopes, roles }) {
  if (!taskRef || !roles.includes(taskRef.role)) throw new Error(`This record needs a task from life_alien_task with role ${roles.join(' or ')}.`);
  const task = await buildTask(service, { role: taskRef.role, graphHash: taskRef.graphHash, searchRootId, accessScopes, inputs: taskRef.inputs });
  if (task.taskHash !== taskRef.taskHash) throw new Error('taskRef does not match the task the server prepared at that graph revision; cite the stored task with taskNodeId instead.');
  return task;
}

// A stored task record is the authoritative text a role saw, so provenance survives later
// changes to the task wording.
export function storedTask(search, taskNodeId, roles) {
  const record = search.record(taskNodeId, 'task');
  if (!roles.includes(record.data.role)) throw new Error(`Task ${taskNodeId} is a ${record.data.role} task; this record needs a ${roles.join(' or ')} task.`);
  if (digest({ text: record.data.text }) !== record.data.textHash) throw new Error(`Task ${taskNodeId} does not match its recorded text hash.`);
  return { ...record.data, taskNodeId, taskHash: record.data.textHash };
}
