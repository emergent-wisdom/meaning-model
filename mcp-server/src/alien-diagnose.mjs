import { hierarchy, instanceCounts } from './alien-ontology.mjs';
import { digest } from './alien-search.mjs';
import { verificationSummary } from './alien-verify.mjs';

// Population diagnostics for one search, computed from its stored records. They locate
// crowded and thin branches, saturation, redirect chains, world coverage and yield;
// which gap matters, and what to commission, stays the caller's judgment.

export function ontologyGaps(state) {
  const { children, roots } = hierarchy(state);
  const { direct, subtree } = instanceCounts(state);
  const active = state.concepts.filter((concept) => concept.status === 'active').map((concept) => concept.id);
  const nonzero = active.map((conceptId) => direct.get(conceptId).instances).filter((count) => count > 0).sort((a, b) => a - b);
  const median = nonzero.length ? nonzero[Math.floor((nonzero.length - 1) / 2)] : 0;
  const crowdedAt = Math.max(3, 2 * median);
  return {
    active: active.length,
    leaves: active.filter((conceptId) => (children.get(conceptId)?.size ?? 0) === 0).sort(),
    thin: active.filter((conceptId) => subtree.get(conceptId) <= 1).sort(),
    // Kinds no candidate realizes yet: a curator carved them under a lens, and nothing has landed in them.
    empty: active.filter((conceptId) => subtree.get(conceptId) === 0).sort(),
    crowded: active.filter((conceptId) => direct.get(conceptId).instances >= crowdedAt).sort(),
    crowdedThreshold: crowdedAt,
    roots: roots.map((conceptId) => ({ conceptId, subtree: subtree.get(conceptId) })),
    thinRoots: roots.filter((conceptId) => subtree.get(conceptId) <= 1),
  };
}

// Family and claimed-outcome combinations that no candidate realizes yet, among families and outcome
// classes that each have at least one instance: the paper's uncombined mechanism-outcome pairs.
export function uncombinedPairs(search) {
  const families = search.ontologyState('mechanisms');
  const outcomes = search.ontologyState('outcomes');
  const occupied = (state) => state.concepts.filter((concept) => concept.status === 'active'
    && state.instances.some((item) => item.conceptId === concept.id && item.relation !== 'alias')).map((concept) => concept.id);
  const of = (state, subjectNodeId) => state.instances.filter((item) => item.subjectNodeId === subjectNodeId && item.relation !== 'alias').map((item) => item.conceptId);
  const realized = new Set();
  for (const mechanism of search.mechanisms) for (const family of of(families, mechanism.nodeId)) for (const outcome of of(outcomes, mechanism.nodeId)) realized.add(`${family}\u0000${outcome}`);
  const pairs = [];
  for (const familyId of occupied(families)) for (const outcomeId of occupied(outcomes)) if (!realized.has(`${familyId}\u0000${outcomeId}`)) pairs.push({ familyId, outcomeId });
  return pairs.slice(0, 50);
}

// Records made before conditions were recorded: an open compile is F and an explorer saw the map (B).
export const mechanismCondition = (record) => record.data.condition ?? (record.data.source.kind === 'world' ? 'F' : 'B');

const tally = (values) => {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

export function diagnoseSearch(search) {
  const decisions = (ontology) => search.revisions.filter((record) => record.data.ontology === ontology && record.data.decision.verdict !== 'restructure_only');
  const mechanismDecisions = decisions('mechanisms');
  const worldDecisions = decisions('worlds');
  const latestDecision = new Map();
  for (const record of mechanismDecisions) latestDecision.set(record.data.decision.subjectNodeId, record);
  const mechanismState = search.ontologyState('mechanisms');
  const worldState = search.ontologyState('worlds');
  const avoidance = search.commissions.map((commission) => {
    const ids = commission.data.avoidConceptIds ?? [];
    const mechanismFamilyIds = ids.filter((id) => mechanismState.concepts.some((item) => item.id === id));
    const worldRegimeIds = commission.data.addressedTo === 'new_world' ? ids.filter((id) => worldState.concepts.some((item) => item.id === id)) : [];
    const worlds = search.worlds.filter((item) => item.data.commissionNodeId === commission.nodeId).map((item) => item.nodeId);
    const mechanisms = search.mechanisms.filter((item) => item.data.source.commissionNodeId === commission.nodeId || worlds.includes(item.data.source.worldNodeId)).map((item) => item.nodeId);
    const classifiedMatches = [
      ...worldState.instances.filter((item) => worlds.includes(item.subjectNodeId) && worldRegimeIds.includes(item.conceptId)).map((item) => ({ ontology: 'worlds', subjectNodeId: item.subjectNodeId, conceptId: item.conceptId })),
      ...mechanismState.instances.filter((item) => mechanisms.includes(item.subjectNodeId) && mechanismFamilyIds.includes(item.conceptId)).map((item) => ({ ontology: 'mechanisms', subjectNodeId: item.subjectNodeId, conceptId: item.conceptId })),
    ];
    return { commissionNodeId: commission.nodeId, mechanismFamilyIds, worldRegimeIds, classifiedMatches };
  }).filter((item) => item.mechanismFamilyIds.length || item.worldRegimeIds.length);

  // Forcing: a commission names kinds to fill; which records answered it, and whether a curator placed them there.
  const within = (state, conceptId) => {
    const { children } = hierarchy(state);
    const seen = new Set([conceptId]); const queue = [conceptId];
    while (queue.length) for (const child of children.get(queue.pop()) ?? []) if (!seen.has(child)) { seen.add(child); queue.push(child); }
    return seen;
  };
  const forcing = search.commissions.filter((commission) => (commission.data.targetConceptIds ?? []).length).map((commission) => {
    const ontologies = commission.data.addressedTo === 'new_world' ? ['worlds'] : ['mechanisms', 'outcomes'];
    const answers = commission.data.addressedTo === 'new_world'
      ? search.worlds.filter((item) => item.data.commissionNodeId === commission.nodeId).map((item) => item.nodeId)
      : search.mechanisms.filter((item) => item.data.source.commissionNodeId === commission.nodeId).map((item) => item.nodeId);
    // An answer counts as placed only in the ontologies that hold a target: a mechanism classified as a family has not
    // yet been judged against a claimed-outcome target.
    const landed = []; const placed = new Map(answers.map((nodeId) => [nodeId, new Set()])); const holding = new Set();
    for (const ontology of ontologies) {
      const state = search.ontologyState(ontology);
      const targets = commission.data.targetConceptIds.filter((targetId) => state.concepts.some((concept) => concept.id === targetId));
      if (!targets.length) continue;
      holding.add(ontology);
      for (const item of state.instances) if (placed.has(item.subjectNodeId) && item.relation !== 'alias') placed.get(item.subjectNodeId).add(ontology);
      for (const targetId of targets) {
        const scope = within(state, targetId);
        for (const item of state.instances) {
          if (placed.has(item.subjectNodeId) && item.relation !== 'alias' && scope.has(item.conceptId)) landed.push({ subjectNodeId: item.subjectNodeId, targetConceptId: targetId, conceptId: item.conceptId });
        }
      }
    }
    const judged = holding.size > 0 && answers.every((nodeId) => [...holding].every((ontology) => placed.get(nodeId).has(ontology)));
    const status = !answers.length ? 'open' : landed.length ? 'filled' : judged ? 'missed' : 'unclassified';
    return { commissionNodeId: commission.nodeId, addressedTo: commission.data.addressedTo, targetConceptIds: commission.data.targetConceptIds, answers, landed, status };
  });
  const verification = verificationSummary(search);

  let sinceNew = 0; let lastNew = null;
  for (const record of mechanismDecisions) {
    if (record.data.decision.verdict === 'admit_new') { sinceNew = 0; lastNew = record.data.decision.subjectNodeId; } else sinceNew += 1;
  }
  const chains = search.revisions.filter((record) => record.data.decision.verdict === 'reject_redirect' && record.data.commissionNodeId)
    .map((record) => {
      const retries = search.mechanisms.filter((item) => item.data.source.commissionNodeId === record.data.commissionNodeId);
      const outcomes = retries.map((retry) => {
        const decision = latestDecision.get(retry.nodeId)?.data.decision ?? null;
        return { retryNodeId: retry.nodeId, verdict: decision?.verdict ?? null, primaryOperatorChanged: decision?.equivalence?.primaryOperatorChanged ?? null };
      });
      return { rejectedNodeId: record.data.decision.subjectNodeId, commissionNodeId: record.data.commissionNodeId, ontology: record.data.ontology, retries: outcomes,
        complete: outcomes.some((item) => ['admit_new', 'admit_instance'].includes(item.verdict) && item.primaryOperatorChanged === true) };
    });

  const signatures = new Map();
  for (const record of worldDecisions) if (record.data.decision.signature) signatures.set(record.data.decision.subjectNodeId, record.data.decision.signature);
  // A world imported from a library brings the signature its source curator coded, unless this search recodes it.
  for (const world of search.worlds) if (world.data.imported?.signature && !signatures.has(world.nodeId)) signatures.set(world.nodeId, world.data.imported.signature);
  const axes = {};
  // Coverage counts codes; notes explain them but are never compared.
  for (const signature of signatures.values()) for (const [axis, value] of Object.entries(signature)) {
    axes[axis] ??= { coded: 0, values: {} };
    if (value !== null) { axes[axis].coded += 1; axes[axis].values[value.code] = (axes[axis].values[value.code] ?? 0) + 1; }
  }
  const coverage = Object.fromEntries(Object.entries(axes).map(([axis, value]) => [axis, { coded: value.coded,
    distinct: Object.keys(value.values).length, values: value.values, uniform: value.coded >= 3 && Object.keys(value.values).length === 1 }]));

  const familiesOf = (subjectNodeId) => mechanismState.instances.filter((item) => item.subjectNodeId === subjectNodeId && item.relation !== 'alias').map((item) => item.conceptId);
  const regimesOf = (subjectNodeId) => worldState.instances.filter((item) => item.subjectNodeId === subjectNodeId && item.relation !== 'alias').map((item) => item.conceptId);
  const yieldRows = search.worlds.map((world) => {
    const compiled = search.mechanisms.filter((item) => item.data.source.worldNodeId === world.nodeId);
    return { worldNodeId: world.nodeId, seed: world.data.seed.word, targetBlind: world.data.targetBlind, mechanisms: compiled.length,
      newFamilies: compiled.filter((item) => latestDecision.get(item.nodeId)?.data.decision.verdict === 'admit_new').length };
  });
  const pairs = {};
  for (const mechanism of search.mechanisms) {
    if (mechanism.data.source.kind !== 'world') continue;
    for (const regime of regimesOf(mechanism.data.source.worldNodeId)) for (const family of familiesOf(mechanism.nodeId)) {
      const key = `${regime}\u0000${family}`; pairs[key] = (pairs[key] ?? 0) + 1;
    }
  }
  const worldFamilies = new Set(search.mechanisms.filter((item) => item.data.source.kind === 'world').flatMap((item) => familiesOf(item.nodeId)));
  const activeFamilies = mechanismState.concepts.filter((concept) => concept.status === 'active').map((concept) => concept.id);
  const developed = new Set([
    ...search.transfers.flatMap((item) => familiesOf(item.data.mechanismNodeId)),
    ...search.assessments.flatMap((item) => item.data.subjectNodeIds.flatMap((subject) => [subject, ...familiesOf(subject)])),
  ]);
  const fulfilled = (commission) => [
    ...search.worlds.filter((item) => item.data.commissionNodeId === commission.nodeId),
    ...search.mechanisms.filter((item) => item.data.source.commissionNodeId === commission.nodeId),
  ].map((item) => item.nodeId);
  const audits = search.mechanisms.map((item) => item.data.selfAudit).filter(Boolean);

  const outcomeState = search.ontologyState('outcomes');
  const consumed = new Set(search.records.map((record) => record.task?.taskNodeId).filter(Boolean));
  const conditions = {};
  for (const mechanism of search.mechanisms) {
    const label = mechanismCondition(mechanism);
    conditions[label] ??= { mechanisms: 0, newFamilies: 0 };
    conditions[label].mechanisms += 1;
    if (latestDecision.get(mechanism.nodeId)?.data.decision.verdict === 'admit_new') conditions[label].newFamilies += 1;
  }
  const diagnosis = {
    schema: 'meaning-model-alien-diagnosis/v1',
    tasks: { prepared: search.tasks.length, byRole: tally(search.tasks.map((task) => task.data.role)),
      unused: search.tasks.filter((task) => !consumed.has(task.nodeId)).map((task) => ({ nodeId: task.nodeId, role: task.data.role })) },
    conditions,
    outcomes: { ...ontologyGaps(outcomeState), uncombinedPairs: uncombinedPairs(search),
      unclassified: search.mechanisms.filter((item) => !outcomeState.instances.some((instance) => instance.subjectNodeId === item.nodeId)).map((item) => item.nodeId) },
    population: { worlds: search.worlds.length, importedWorlds: search.worlds.filter((item) => item.data.imported).length, solutions: search.solutions.length,
      mechanisms: { total: search.mechanisms.length, fromWorlds: search.mechanisms.filter((item) => item.data.source.kind === 'world').length,
        fromExplorer: search.mechanisms.filter((item) => item.data.source.kind === 'explorer').length,
        retries: search.mechanisms.filter((item) => item.data.source.commissionNodeId).length },
      transfers: search.transfers.length, commissions: search.commissions.length, assessments: search.assessments.length },
    isolation: {
      builder: tally(search.worlds.map((item) => item.data.isolation.builder)),
      notTargetBlind: search.worlds.filter((item) => !item.data.targetBlind).map((item) => ({ worldNodeId: item.nodeId, targetLeaks: item.data.targetLeaks, oraclePremise: item.data.oraclePremise })),
      solver: tally(search.solutions.map((item) => item.data.isolation.solver)),
      compiler: tally(search.mechanisms.map((item) => item.data.isolation.compiler)),
    },
    mechanisms: { ...ontologyGaps(mechanismState),
      decisions: tally(mechanismDecisions.map((item) => item.data.decision.verdict)),
      saturation: { decisionsSinceLastNewFamily: sinceNew, lastNewFamilySubjectNodeId: lastNew },
      relabelPressure: mechanismDecisions.filter((item) => item.data.decision.equivalence?.primaryOperatorChanged === false).length,
      redirectChains: chains.filter((item) => item.ontology === 'mechanisms'),
      undecided: search.mechanisms.filter((item) => !latestDecision.has(item.nodeId)).map((item) => item.nodeId),
      undeveloped: activeFamilies.filter((conceptId) => mechanismState.instances.some((item) => item.conceptId === conceptId) && !developed.has(conceptId)).sort(),
      // Candidates whose graded membership spreads over two or more families with at least a fifth each.
      hybrids: mechanismState.memberships.filter((item) => item.shares.filter((share) => share.share >= 0.2).length >= 2)
        .map((item) => ({ subjectNodeId: item.subjectNodeId, shares: item.shares, remainder: item.remainder })) },
    worlds: { ...ontologyGaps(worldState), decisions: tally(worldDecisions.map((item) => item.data.decision.verdict)),
      signatureCoverage: coverage, uncoded: search.worlds.filter((item) => !signatures.has(item.nodeId)).map((item) => item.nodeId),
      yield: yieldRows, newFamiliesPerWorld: search.worlds.length ? yieldRows.reduce((sum, row) => sum + row.newFamilies, 0) / search.worlds.length : null },
    combinations: {
      regimeFamilyPairs: Object.entries(pairs).map(([key, count]) => { const [regimeId, familyId] = key.split('\u0000'); return { regimeId, familyId, count }; }),
      familiesWithoutWorldSource: activeFamilies.filter((conceptId) => mechanismState.instances.some((item) => item.conceptId === conceptId) && !worldFamilies.has(conceptId)).sort(),
      worldsWithoutAdmittedMechanism: yieldRows.filter((row) => row.mechanisms > 0 && !search.mechanisms.some((item) => item.data.source.worldNodeId === row.worldNodeId && familiesOf(item.nodeId).length)).map((row) => row.worldNodeId),
    },
    audits: { bottleneckRelief: tally(audits.map((item) => item.bottleneckRelief)), fiat: tally(audits.map((item) => item.fiat)),
      capabilityProvenance: tally(audits.map((item) => item.capabilityProvenance)),
      fiatFailures: search.mechanisms.filter((item) => item.data.selfAudit?.fiat === 'fail').map((item) => item.nodeId) },
    secondJudge: {
      checked: [...new Set(search.decisionChecks.map((item) => item.data.revisionNodeId))].length,
      byEvaluator: tally(search.decisionChecks.map((item) => item.data.evaluator)),
      declaredIsolation: tally(search.decisionChecks.map((item) => item.data.evaluation?.isolation ?? 'unspecified')),
      independenceVerified: false,
      decisions: search.revisions.filter((item) => item.data.decision.subjectNodeId && item.data.decision.verdict !== 'restructure_only').length,
      disagreements: search.decisionChecks.filter((item) => item.data.disagreements.length)
        .map((item) => ({ checkNodeId: item.nodeId, revisionNodeId: item.data.revisionNodeId, subjectNodeId: item.data.subjectNodeId, aspects: item.data.disagreements })),
    },
    commissions: { avoidance, open: search.commissions.filter((item) => fulfilled(item).length === 0).map((item) => ({ nodeId: item.nodeId, addressedTo: item.data.addressedTo })),
      fulfilled: search.commissions.map((item) => ({ nodeId: item.nodeId, by: fulfilled(item) })).filter((item) => item.by.length) },
    forcing,
    verification,
    transfers: { byMechanism: tally(search.transfers.map((item) => item.data.mechanismNodeId)),
      unfilledRoles: search.transfers.reduce((sum, item) => sum + item.data.roleMap.filter((role) => role.binding.kind === 'unfilled').length, 0),
      magicalProxies: search.transfers.reduce((sum, item) => sum + item.data.proxies.filter((proxy) => proxy.label === 'magical').length, 0) },
  };
  const warnings = [];
  const unisolated = search.worlds.filter((item) => item.data.isolation.builder !== 'fresh_context').length;
  if (unisolated) warnings.push(`${unisolated} of ${search.worlds.length} worlds were not built in a fresh context; context isolation is not established.`);
  if (diagnosis.isolation.notTargetBlind.length) warnings.push(`${diagnosis.isolation.notTargetBlind.length} worlds had target terms or an oracle premise in their builder task.`);
  if (sinceNew >= 3) warnings.push(`${sinceNew} curator decisions since the last new family: a saturation signal for the current source of proposals, not proof that the space is exhausted.`);
  if (diagnosis.audits.fiatFailures.length) warnings.push(`Final-outcome fiat failed for ${diagnosis.audits.fiatFailures.join(', ')}: the principal operation asserts the desired end.`);
  if (search.worlds.length && !signatures.size) warnings.push('No world has a coded causal signature yet, so world coverage cannot be diagnosed; curate worlds with the world_curator task.');
  for (const [axis, value] of Object.entries(coverage)) if (value.uniform) warnings.push(`Every coded world shares one ${axis} value (${Object.keys(value.values)[0]}).`);
  if (diagnosis.secondJudge.disagreements.length) warnings.push(`The second judge disagrees with ${diagnosis.secondJudge.disagreements.length} curator decisions (${diagnosis.secondJudge.disagreements.map((item) => `${item.revisionNodeId}: ${item.aspects.join(', ')}`).join('; ')}); reread them.`);
  if (diagnosis.commissions.open.length) warnings.push(`${diagnosis.commissions.open.length} commissions are still open.`);
  for (const item of avoidance) if (item.classifiedMatches.length) warnings.push(`Commission ${item.commissionNodeId} returned to avoided concepts: ${item.classifiedMatches.map((match) => `${match.subjectNodeId} in ${match.conceptId}`).join('; ')}. This reports the recorded classifications, not an independent novelty judgment.`);
  if (diagnosis.tasks.unused.length) warnings.push(`${diagnosis.tasks.unused.length} prepared tasks have no recorded output; they stay visible as attempts.`);
  if (diagnosis.mechanisms.undeveloped.length) warnings.push(`Families with instances but no transfer or assessment yet: ${diagnosis.mechanisms.undeveloped.join(', ')}. Develop an unusual branch before judging it on familiarity.`);
  for (const [ontology, noun] of [['mechanisms', 'mechanism families'], ['outcomes', 'claimed outcomes'], ['worlds', 'world regimes']]) {
    const empty = diagnosis[ontology].empty;
    if (empty.length) warnings.push(`${noun[0].toUpperCase()}${noun.slice(1)} no candidate realizes yet: ${empty.join(', ')}. Force one with a commission naming targetConceptIds, ${ontology === 'worlds' ? 'for a new world' : 'for an explorer'}.`);
  }
  for (const item of forcing) if (item.status === 'missed') warnings.push(`Commission ${item.commissionNodeId} asked for ${item.targetConceptIds.join(', ')}; its answers were placed elsewhere. Commission again, or carve the kind more clearly.`);
  if (verification.falsified.length) warnings.push(`PURE falsified: ${verification.falsified.join(', ')}. Every axis must hold; one that fails is not offset by the others.`);
  if (verification.unverifiedTransfers.length) warnings.push(`Transfers without a full PURE check: ${verification.unverifiedTransfers.join(', ')}. Verify each axis with a verifier task in its own context.`);
  if (verification.unverifiedSelections.length) warnings.push(`Selected without a full PURE check: ${verification.unverifiedSelections.join(', ')}.`);
  for (const item of verification.changed) warnings.push(`A deeper ${item.axis} check (${item.verificationNodeId}) found ${item.deeperStatus} where ${item.deepens} said ${item.probeStatus} at probe [${item.probePath.join(', ')}]; the axis now composes from the deeper finding.`);
  // World modelling is reported only for searches that use it, so diagnoses of earlier searches keep their hashes.
  const modelling = search.problem?.data.worldModelling === 'on';
  if (modelling || search.worldModels.length) {
    const latest = new Map(search.worldModels.map((item) => [item.data.worldNodeId, item]));
    const modelled = search.worlds.filter((world) => latest.has(world.nodeId) && !latest.get(world.nodeId).data.decline).map((world) => world.nodeId);
    const declined = search.worlds.filter((world) => latest.get(world.nodeId)?.data.decline).map((world) => world.nodeId);
    const textOnly = search.worlds.filter((world) => !latest.has(world.nodeId)).map((world) => world.nodeId);
    const framed = new Set(search.scenarios.map((item) => search.record(item.data.worldModelNodeId, 'world_model').data.worldNodeId));
    diagnosis.worldModelling = { on: modelling, modelled, declined, textOnly, scenarios: search.scenarios.length, unframed: modelled.filter((nodeId) => !framed.has(nodeId)) };
    if (modelling && textOnly.length) warnings.push(`World modelling is on, and these worlds have no model yet: ${textOnly.join(', ')}. Prepare world_modeller tasks.`);
  }
  diagnosis.warnings = warnings;
  return { diagnosis, diagnosisHash: digest({ graphHash: search.view.graph_hash, searchRootId: search.searchRootId, diagnosis }) };
}
