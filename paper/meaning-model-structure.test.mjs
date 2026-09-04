import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const here = import.meta.url;
const read = (path) => readFileSync(new URL(path, here), 'utf8');
const source = read('./meaning-model.tex');
const grammarSource = read('./meaning-model-grammar.tex');
const interfaceSource = read('./includes/interface-blocks.tex');
const bookFiguresSource = read('./includes/book-trajectory-figures.tex');
const bibliography = read('./references.bib');
const argumentMapSource = read('./MEANING-MODEL-STRUCTURE.md');
const readmeSource = read('../README.md');
const implementationSource = read('../docs/IMPLEMENTATION.md');

const normalize = (value) => value.replace(/\s+/g, ' ').trim();
const grammar = normalize(grammarSource);
const interfaceBlocks = normalize(interfaceSource);
const bookFigures = normalize(bookFiguresSource);
const argumentMap = normalize(argumentMapSource);
const readme = normalize(readmeSource);
const implementation = normalize(implementationSource);
const zone = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0, `missing zone start: ${start}`);
  assert.ok(b > a, `missing zone end: ${end}`);
  return normalize(source.slice(a, b));
};
const inOrder = (text, needles) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, cursor + 1);
    assert.ok(next > cursor, `missing or out of order: ${needle}`);
    cursor = next;
  }
};

const abstract = zone('\\begin{abstract}', '\\end{abstract}');
const core = zone(
  '\\section{Grammar and Progressive Construction}',
  '\\subsection{Optional construction profile}',
);
const profile = zone(
  '\\subsection{Optional construction profile}',
  '\\subsection{Progressive world construction}',
);
const world = zone(
  '\\subsection{Progressive world construction}',
  '\\section{Concepts and Examples}',
);
const concepts = zone(
  '\\section{Concepts and Examples}',
  '\\section{World, Understanding, and Story}',
);
const surfaces = zone(
  '\\section{World, Understanding, and Story}',
  '\\section{Closure and Sufficiency}',
);
const book = zone(
  '\\section{\\emph{The Book of Conditions}: Completed Book, Partial Witness}',
  '\\section{Related Work}',
);
const bookProfile = zone(
  '\\subsection{A Book-specific profile}',
  '\\subsection{How the construction proceeded}',
);
const bookConstruction = zone(
  '\\subsection{How the construction proceeded}',
  '\\subsection{Construction artifact, Rust host, and validation boundary}',
);
const bookWitness = zone(
  '\\subsection{Construction artifact, Rust host, and validation boundary}',
  '\\subsection{Descriptive numerical portrait}',
);
const bookResults = zone(
  '\\subsection{Descriptive numerical portrait}',
  '\\subsection{Prospective comparative evaluation}',
);
const bookComparison = zone(
  '\\subsection{Prospective comparative evaluation}',
  '\\section{Related Work}',
);
const lifeSimulation = zone(
  '\\subsection{Bridge to Life Simulation}',
  '\\section{Conclusion}',
);
const appendices = normalize(source.slice(source.indexOf('\\appendix')));

test('the manuscript reports a completed construction but no comparative result', () => {
  assert.match(
    source,
    /\\title\{The Meaning Model:\\\\Constructing Worlds and Stories at Progressive Resolution\}/,
  );
  assert.match(abstract, /constructing a world.*coherent at a coarse resolution/s);
  assert.match(abstract, /Abstract meaning uses the same world machinery/);
  assert.match(abstract, /modeled world, rooted Understanding Graphs, and document\s+nodes share one address space/s);
  assert.match(abstract, /completed manuscript.*partial descriptive witness.*not an end-to-end implementation/s);
  assert.match(source, /\\ewpublicationdate\{\\today\}/);
  assert.doesNotMatch(source, /Status of this manuscript|Working draft/);
  assert.match(bookComparison, /completed Book does not satisfy the still-prospective comparison/);
  assert.match(source, /No\s+discarded earlier Book supplies evidence, accepted records, counts, or prose/s);
  assert.doesNotMatch(source, /\bV20\b|dog[-\s]?food/i);
  assert.doesNotMatch(source, /Book (construction )?(has|have) not (yet )?been run|first prospective construction/i);
});

test('the argument follows the approved asymmetric split', () => {
  inOrder(source, [
    '\\section{Introduction}',
    '\\section{Grammar and Progressive Construction}',
    '\\subsection{Optional construction profile}',
    '\\subsection{Progressive world construction}',
    '\\section{Concepts and Examples}',
    '\\section{World, Understanding, and Story}',
    '\\section{Closure and Sufficiency}',
    '\\section{\\emph{The Book of Conditions}: Completed Book, Partial Witness}',
    '\\section{Related Work}',
    '\\section{Limitations and Research Boundary}',
    '\\subsection{Bridge to Life Simulation}',
    '\\section{Conclusion}',
    '\\appendix',
  ]);
  inOrder(book, [
    '\\subsection{A Book-specific profile}',
    '\\subsection{How the construction proceeded}',
    '\\subsection{Construction artifact, Rust host, and validation boundary}',
    '\\subsection{Descriptive numerical portrait}',
    '\\subsection{Prospective comparative evaluation}',
  ]);
  assert.match(source, /paper also owns the construction discipline/);
  assert.match(source, /frozen-parent whole candidates.*direction rolls.*atomic\s+commit or rejection.*rendering routes.*read-back/s);
  assert.match(lifeSimulation, /Life Simulation uses completed or ongoing worlds/);
  assert.match(lifeSimulation, /no compact dynamical law is required/);
  assert.match(lifeSimulation, /continuous, discrete, or hybrid laws/);
  assert.match(lifeSimulation, /not a one-way handoff/);
  assert.match(lifeSimulation, /construction rules still govern.*acceptance/s);
  assert.match(lifeSimulation, /process-aware models.*games.*Ontology of the Alien.*Fractal Intelligence.*alignment-facing curricula/s);
  assert.doesNotMatch(source, /Meaning Model stops after|learning or running temporal laws over it/);
  assert.doesNotMatch(source, /Life Simulation (adds|defines|places).*transaction|Life Simulation construction should expose/s);
});

test('the value argument connects present construction with a bounded learning hypothesis', () => {
  const introduction = zone('\\section{Introduction}', '\\section{Grammar and Progressive Construction}');
  const closure = zone('\\section{Closure and Sufficiency}', '\\section{\\emph{The Book of Conditions}: Completed Book, Partial Witness}');
  assert.match(introduction, /external semantic workspace/);
  assert.match(introduction, /Progressive resolution and a shared construction medium.*two linked architectural contributions/s);
  assert.match(introduction, /World state, abstract concept models, Event descriptions, document text, and externalized understanding/);
  assert.match(introduction, /training language.*learning to.*revise an account/s);
  assert.match(introduction, /learner need not reproduce their syntax internally/);
  assert.match(lifeSimulation, /construct a world, render observations, infer an account.*later evidence.*revise/s);
  assert.match(lifeSimulation, /decomposition, or a Concept's grounding/);
  assert.match(lifeSimulation, /own rendering alone does not validate/);
  assert.match(lifeSimulation, /recommended Reader-based training approach/);
  assert.match(lifeSimulation, /trained model's later writing, dialogue, and action/);
  assert.match(lifeSimulation, /learning from documented world and scene-construction choices/);
  assert.match(lifeSimulation, /empathy or aligned conduct remains an empirical question/);
  assert.match(closure, /connected Meaning Model of actual world history and geography/);
  assert.match(closure, /retaining separate claims, evidence, and disagreements/);
  assert.match(closure, /without equal detail everywhere/);
  assert.match(closure, /New evidence can revise earlier accounts, not merely add detail/);
  assert.match(closure, /Corrections preserve distinct event and revision times/);
  assert.match(closure, /Acceptance does not establish historical truth/);
  assert.match(closure, /fictional worlds retain separate contexts/);
  assert.match(closure, /representation and revision contract; Life Simulation develops corpus-wide construction, interpretation, and training/);
});

test('the contribution is a coordinated authoring method with prospective learning value', () => {
  const introduction = zone('\\section{Introduction}', '\\section{Grammar and Progressive Construction}');
  const related = zone('\\section{Related Work}', '\\section{Limitations and Research Boundary}');
  const conclusion = zone('\\section{Conclusion}', '\\appendix');
  assert.match(abstract, /before its finer history is constructed/);
  assert.match(abstract, /preserve declared commitments or explicitly revise them/);
  assert.match(abstract, /comparative commitments rather than freestanding scores/);
  assert.match(abstract, /share one address space without sharing authority/);
  assert.match(abstract, /candidate training language.*choose, deepen, and repair representations/s);
  assert.match(abstract, /Life Simulation develops the construction-to-learning loop/);
  for (const change of [
    'Construct detail under commitments',
    'Revise the account across surfaces',
    'Construct meanings as well as instances',
    'Give semantic numbers their comparison context',
  ]) {
    assert.ok(introduction.includes(change), `missing contribution: ${change}`);
  }
  assert.match(related, /relevant comparison unit is that complete operation/);
  assert.match(related, /neither does their combination establish priority by itself/);
  assert.match(conclusion, /recognize a poor decomposition, and revise its concepts/);
  assert.match(conclusion, /without establishing its predictive, transfer, or alignment claims/);
});

test('the explanatory paper uses a compact nine-section spine', () => {
  const beforeAppendix = source.slice(0, source.indexOf('\\appendix'));
  const sectionCount = [...beforeAppendix.matchAll(/^\\section\{/gm)].length;
  assert.equal(sectionCount, 9);
  assert.doesNotMatch(beforeAppendix, /\\section\{Examples\}/);
  assert.doesNotMatch(beforeAppendix, /\\section\{Bridge to Life Simulation\}/);
});

test('the papers use the shared house template without local layout overrides', () => {
  for (const [name, paper] of [
    ['theory paper', source],
    ['minimized grammar', grammarSource],
  ]) {
    assert.match(paper, /\\documentclass\[11pt,a4paper\]\{article\}/, `${name} document class`);
    assert.match(paper, /\\usepackage\[utf8\]\{inputenc\}/, `${name} input encoding`);
    assert.match(
      paper,
      /\\usepackage(?:\[longtitle\])?\{emergentwisdom-preprint\}/,
      `${name} house style`,
    );
    assert.match(paper, /\\usepackage\{microtype\}/, `${name} microtype`);
    assert.doesNotMatch(
      paper,
      /\\(?:newgeometry|linespread|raggedbottom)|\\renewcommand\{\\(?:headeright|undertitle)\}/,
      `${name} contains a local layout override`,
    );
    assert.match(
      paper,
      /\\author\{Henrik Westerberg\\\\Emergent Wisdom\\\\\s*\\texttt\{henrik\.westerberg@emergentwisdom\.org\}\}/,
      `${name} author block`,
    );
  }
  assert.match(source, /\\bibliographystyle\{unsrt\}\s*\\bibliography\{references\}/s);
  assert.doesNotMatch(source, /\\(?:clearpage|newpage)\s*\\bibliographystyle/);
  assert.match(source, /\\usepackage\[longtitle\]\{emergentwisdom-preprint\}/);
  assert.doesNotMatch(source, /\\begin\{multicols\}|\\scriptsize\s*\\bibliographystyle/);
  assert.match(grammarSource, /\\newcommand\{\\undertitle\}\{Technical Appendix\}/);
  assert.match(grammarSource, /\\newcommand\{\\headeright\}\{Technical Appendix\}/);
  assert.match(grammarSource, /\\ewpublicationdate\{\\today\}/);
  assert.match(read('../Makefile'), /^export TZ := UTC$/m);
});

test('every section with subsections opens with explanatory prose', () => {
  const starts = [...source.matchAll(/^\\section\{[^\n]+\}/gm)];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1]?.index ?? source.length;
    const body = source.slice(start.index + start[0].length, end);
    const subsectionAt = body.search(/^\\subsection\{/m);
    if (subsectionAt < 0) continue;
    const introduction = body
      .slice(0, subsectionAt)
      .replace(/%.*$/gm, '')
      .replace(/\\label\{[^}]+\}/g, '')
      .trim();
    assert.match(
      introduction,
      /[A-Za-z]{3}/,
      `section lacks prose before its first subsection: ${start[0]}`,
    );
  }
});

test('the core keeps six validator-distinct world forms', () => {
  assert.match(source, /\\input\{includes\/interface-blocks\}/);
  assert.match(source, /\\MMCoreSummary/);
  assert.match(source, /\\MMCoreSchema/);
  for (const form of ['Concept', 'Thing', 'Event', 'Binding', 'Cut', 'Realization']) {
    assert.match(core, new RegExp(`\\b${form}\\b`));
  }
  assert.match(core, /six forms---Concept, Thing, Event, Binding, Cut, and Realization/);
  assert.match(core, /relation among several Things.*joint Event.*one Binding per role/s);
  assert.match(core, /contains.*about.*updates.*supersedes.*sibling kinds/s);
  assert.match(core, /many-to-many/);
  assert.match(core, /no independent Realization degree/);
  assert.match(core, /Every Cut is parented by an Event/);
  assert.match(core, /assessment Event linked.*about.*target/s);
  assert.match(core, /admit a new primitive only when a validator/);
});

test('the optional profile preserves the numerical boundary', () => {
  assert.match(profile, /Other profiles may choose different children and depths or omit human modeling entirely/);
  assert.match(profile, /semantic number is a Cut weight/);
  assert.match(profile, /answers plus remainder sum to one/);
  assert.match(profile, /non-summing process relation is unweighted/);
  assert.match(profile, /externally grounded observations.*typed Event data/s);
  assert.match(profile, /Realization is likewise unweighted/);
  assert.match(profile, /Three Cut families---allocation, sequential, and direction---yield five named profiles/);
  for (const operation of ['Register', 'Bind', 'Open or compose', 'Cut', 'Decide', 'Realize']) {
    assert.match(profile, new RegExp(`\\\\emph\\{${operation}\\}`));
  }
  assert.match(profile, /Five cross-record rules/);
});

test('progressive world construction distinguishes cuts, processes, and data', () => {
  assert.match(world, /Universe is a Thing.*History is its lifecycle Event/s);
  assert.match(world, /Relations among Things are Events/);
  assert.match(world, /Rosters and encapsulation are views/);
  assert.match(world, /place is a Thing and presence is an Event/);
  assert.match(world, /stopping rule.*record explicit when it must persist.*constrain a later Event.*differ across perspectives.*controllable and auditable/s);
  assert.match(world, /detail remains implicit/);
  assert.match(world, /lifecycle Event can host several concurrent, overlapping Event-processes/);
  assert.match(world, /without becoming fractions of one life-wide quantity/);
  assert.match(world, /slow.*fast.*name response time.*not importance/s);
  assert.match(world, /Ordinary links.*do not themselves explain the longer process/s);
  assert.match(world, /Cut.*Event-process.*World datum/s);
  assert.match(world, /sum_i w_i\+w_\{\\bot\}=1/);
  assert.match(world, /allocation.*sequential.*direction/s);
  assert.match(world, /Proposal weights specify how a constructor samples.*predictive weights assert probabilities/s);
  assert.match(world, /uncalibrated forecast can still be scored/);
  assert.match(world, /f_P=\\sum_i\\lambda_i f_i/);
  assert.match(world, /complete parent vector exists only if.*explicit compatible facet vector/s);
  assert.match(world, /reports the known partial contribution, coverage, and temporal remainder/s);
  assert.match(world, /two equal-duration intervals/);
  assert.match(world, /\(\.20,\.70,\.10\)/);
  assert.match(world, /episode.*may overlap other episodes or cross period boundaries/s);
});

test('concept grounding includes all four resources and exact bundle identity', () => {
  for (const resource of [
    'Relational schema',
    'Representative prototype',
    'Exemplar grounding',
    'Canonical-model grounding',
  ]) {
    assert.match(concepts, new RegExp(resource));
  }
  assert.match(concepts, /flat bundle may contain.*prototype or exemplar references/s);
  assert.match(concepts, /deep bundle may contain a canonical fragment/);
  assert.match(concepts, /Either kind may be serialized.*Sema content hash/s);
  assert.match(concepts, /concept world/);
  assert.match(concepts, /Concept-scoped projection of the Understanding Graph/);
  assert.match(concepts, /Optional deep grounding: love and the Engine/);
  assert.match(concepts, /r_C\+n_C\+u_C=1/);
  assert.match(concepts, /four named component Cuts each set.*u_j=0/s);
  assert.match(concepts, /Fit cuts and concurrent concepts/);
});

test('Understanding Graph and story are integrated without semantic collapse', () => {
  assert.match(surfaces, /complete addressed construction has three linked surfaces/);
  assert.match(surfaces, /UnderstandingNode \\{ id, type, text, created at, typed parents/);
  assert.match(surfaces, /DocumentNode \\{ id, role, text, discourse position, typed parents/);
  assert.match(surfaces, /surface records rather than seventh and eighth world forms/);
  assert.match(surfaces, /density of the understanding surface is optional and explicit/);
  assert.match(surfaces, /Every accepted world Event has a typed containment path to History/);
  assert.match(surfaces, /belief, appraisal, want, or estimate.*sits in a named inner Event process beneath the relevant person's lifecycle/s);
  assert.match(surfaces, /joint Event.*Bindings.*does not acquire one participant's perspective/s);
  assert.match(surfaces, /Event may carry an optional textual description.*neither an UnderstandingNode\s+nor a DocumentNode/s);
  assert.match(core, /ancestry-complete within the caller's authorized view/);
  assert.match(core, /Cut or component lookup.*parent Event, question, unit, keyed siblings, conditioning address, remainder, and recomposition rule together/s);
  assert.match(surfaces, /Concept-scoped projection/);
  assert.match(surfaces, /actor's operative model/);
  assert.match(surfaces, /\\mathcal M_a\^\{\*\}\(t\)/);
  assert.match(surfaces, /observer's account.*estimate Event beneath\s+the observer's inner-process root/s);
  assert.match(surfaces, /Self-report.*another character's estimate.*author's construction-time interpretation.*actor's operative state.*disagree/s);
  assert.match(surfaces, /total variation.*categorical claims by equality.*derived diagnostics/s);
  assert.match(surfaces, /accepted parent is frozen/);
  assert.match(surfaces, /whole candidate delta.*three surfaces/s);
  assert.match(surfaces, /trial assessed as successful under a particular grounding bundle/);
  assert.match(surfaces, /outcome, its meaning, the rationale, and the text through one revision history/);
  assert.match(surfaces, /storing them together alone would not establish their agreement/);
  assert.match(surfaces, /Rejection leaves the active graph unchanged.*Acceptance commits.*atomically/s);
  assert.match(surfaces, /model can materially decide the story/);
  for (const routeField of [
    'source commit and epistemic status',
    'ordered route through Events',
    'narrator and viewpoint',
    'evidence accessible',
    'disclosure policy',
    'target DocumentNode',
  ]) {
    assert.match(surfaces, new RegExp(routeField));
  }
  assert.match(surfaces, /Read-back applies the inverse operation in a fresh context/);
  const succession = zone(
    '\\subsection{The unfunded successor, 1852--54}',
    '\\section{Closure and Sufficiency}',
  );
  assert.match(succession, /Chapter X of the completed/);
  assert.match(succession, /E20.*E21.*E24.*E25/s);
  assert.match(succession, /Understanding note U05/);
  assert.match(succession, /neither inserts the wrong number nor forces Halden's decision/);
  assert.match(succession, /Chapter I is read before Chapter X/);
  assert.match(succession, /subsequently imported as native surface records/);
  assert.match(succession, /retrospective receipt does not\s+recover the original cross-surface authoring transactions/);
  assert.doesNotMatch(succession, /possible Book episode|dispossession|Second acceptance|theory-ockham/);
});

test('psychological refinement extends profiles without fixing a universal tree', () => {
  const closure = zone('\\section{Closure and Sufficiency}', '\\section{\\emph{The Book of Conditions}: Completed Book, Partial Witness}');
  assert.match(closure, /no prescribed maximum depth or universal personality tree/);
  assert.match(closure, /different question creates another view/);
  assert.match(closure, /changed account\s+requires explicit revision/);
  assert.match(closure, /Life Simulation considers how to learn which\s+refinements are useful/);
});

test('the completed Book profile remains explicitly non-universal', () => {
  assert.match(book, /completed.*Book|completed manuscript/s);
  assert.match(book, /No\s+discarded earlier Book supplies evidence/);
  assert.match(bookProfile, /profile.*not a claim that every person or story requires/s);
  for (const layer of ['IS', 'WHAT', 'HOW', 'FEELS']) {
    assert.match(bookProfile, new RegExp(`\\b${layer}\\b`));
  }
  assert.match(bookProfile, /Nine concurrent, unweighted life processes/);
  assert.match(bookProfile, /concern.*approach\/threat-avoidance.*AtomicWant/s);
  assert.match(bookProfile, /threat-belief.*fear.*action/s);
  assert.match(bookProfile, /scene and coarse period profiles are authored/);
  assert.match(bookProfile, /recompose its parent by duration and report coverage/);
  assert.match(bookProfile, /Conditional profiles/);
  assert.match(bookProfile, /derived shock profile/);
  assert.match(world, /Anticipation, shocks, and adaptation across scales/);
  assert.match(world, /Anticipation is optional and perspective-specific/);
  assert.match(world, /Missing prior records mean that anticipation is unknown, not zero/);
  assert.match(world, /diffusion is not a synonym for adaptation/);
  assert.match(world, /testing temporal laws or predictors.*belongs to Life Simulation/s);
  assert.match(bookProfile, /tab:book-cross-scale-change/);
  assert.match(bookProfile, /E14a.*E14b.*E14c/s);
  assert.match(bookProfile, /representational coverage, not a universal cycle theory/);
  assert.match(bookProfile, /Thirty-four bundles received content-addressed/);
  assert.match(bookProfile, /one small\s+model of a valid.*computational claim.*unscored integration example/s);
});

test('the actual Book construction account discloses pragmatic selection and revision', () => {
  assert.match(bookConstruction, /Book construction proceeded in six rounds/);
  assert.match(bookConstruction, /Five isolated whole-history candidates/);
  assert.match(bookConstruction, /All were rejected/);
  assert.match(bookConstruction, /None was admitted to History by a Direction roll/);
  assert.match(bookConstruction, /pragmatic successor.*one paragraph.*two, three, four, and five paragraphs/s);
  assert.match(bookConstruction, /Thirteen complete lives.*coarse resolution.*three\s+principals/s);
  assert.match(bookConstruction, /Twelve route units were selected and rendered/);
  assert.match(bookConstruction, /not the fully automated\s+transaction protocol/s);
  assert.match(bookConstruction, /final world was not chosen by a\s+preregistered Direction draw/s);
});

test('the implementation witness separates Rust, external checks, and authorship', () => {
  assert.match(bookWitness, /Rust\s+host compiled forty structural authoring profiles/);
  assert.match(bookWitness, /thirteen persons, nineteen\s+other Things, three relationships, one Concept, and four change arcs/s);
  assert.match(bookWitness, /31 positive and\s+negative fixture expectations, seven report checks, and three targeted Rust\s+tests/s);
  assert.match(bookWitness, /Rust host.*External validator.*Authored construction/s);
  assert.match(bookWitness, /Cut normalization,.*component addresses, nearest-root ancestry, and source-bound document rendering/s);
  assert.match(bookWitness, /retrospective import records source digests, a persisted Rust compilation\s+response/s);
  assert.match(bookWitness, /not a source-locked transaction for the original\s+construction or an independent read-back record/s);
  assert.match(bookProfile, /coarse period profiles are authored/);
});

test('descriptive construction statistics retain their semantic limits', () => {
  assert.match(bookResults, /Cut weights.*Typed world\s+data.*derived operational diagnostics/s);
  for (const value of ['34', '107', '472', '30+7', '13', '11,046', '9.69']) {
    assert.ok(bookResults.includes(value), `missing construction statistic ${value}`);
  }
  assert.match(bookResults, /eight earlier families, mean remainder ranges from \.060 to \.081/);
  assert.match(bookResults, /Four jobs\s+require.*160.*checker-hours against 80 protected hours/s);
  assert.match(bookResults, /\.64.*\.34.*\.2176/s);
  assert.match(bookResults, /10,289 days exactly.*nothing about narrative importance/s);
  assert.match(bookResults, /descriptive authored pattern, not a fitted\s+shock law or population result/s);
  assert.match(bookResults, /diagnostics establishes predictive validity, population psychology, causal\s+identification, or superiority/s);
  assert.match(bookResults, /Neither is a\s+fitted temporal function/);
  assert.match(source, /\\input\{includes\/book-trajectory-figures\}/);
  assert.match(bookFigures, /Slow fulfillment-outlook Cuts/);
  assert.match(bookFigures, /Selected scene-outlook Cuts/);
  assert.match(bookFigures, /Equal bar widths show authored period order only/);
  assert.match(bookFigures, /magnified\s+coordinate view/);
  assert.match(bookFigures, /three diagonal guides give\s+unresolved shares of \.05, \.10, and \.20/);
  assert.match(bookFigures, /Curved arrows separate reversals\s+and order the elicited scenes/);
});

test('the matched comparison remains prospective and independently falsifiable', () => {
  assert.match(bookComparison, /does not satisfy the still-prospective comparison/);
  assert.match(bookComparison, /direct-prompt baseline.*prose-bible condition/s);
  assert.match(bookComparison, /frozen elicitation procedure/);
  assert.match(bookComparison, /Brier score/);
  assert.match(bookComparison, /Total variation is used only for compatible Cut vectors/);
  assert.match(bookComparison, /dialogue or shared Event.*two different character cutoffs/s);
  assert.match(bookComparison, /appraisal and strategy checks/);
  assert.match(bookComparison, /model calls, tokens, latency, human adjudication time, storage.*maintenance work/s);
  assert.match(bookComparison, /negative findings are required/);
  assert.match(bookComparison, /No outcome is assumed/);
});

test('related work distinguishes the authoring contract from established narrative methods', () => {
  const related = zone('\\section{Related Work}', '\\section{Limitations and Research Boundary}');
  for (const name of ['Inform', 'bAbI', 'ProPara', 'EvolvingWorld', 'Narrative World Model', 'DOC', 'DOME', 'Generative Agents']) {
    assert.match(source, new RegExp(name));
  }
  for (const key of [
    'nelson2001inform',
    'weston2015babi',
    'dalvi2018propara',
    'zong2026evolvingworld',
    'saifullah2026narrativeworld',
    'yang2023doc',
    'wang2024dome',
    'park2023agents',
  ]) {
    assert.match(source, new RegExp(`\\\\cite\\{[^}]*${key}`));
  }
  assert.match(related, /fine-to-coarse checks or trigger explicit revision/);
  assert.match(related, /world commitments, concept interpretations, authoring reasons, and prose/);
  assert.match(related, /neither does their combination establish priority by itself/);
  assert.match(related, /comparative literary benefit, learning gains, and computational savings remain untested/);
});

test('the minimized grammar agrees on concepts and cross-surface construction', () => {
  assert.match(grammar, /depth relational, representative prototype, exemplar, or canonical model/);
  assert.match(grammar, /grounding version.*content hash.*bundle serialized in\s+canonical order/s);
  assert.match(grammar, /Content addressing is an identity convention/);
  assert.match(grammar, /canonical fragment may itself be opened structurally/);
  assert.match(grammar, /candidate envelope names its base commit/);
  assert.match(grammar, /immutable cross-surface snapshot.*advances its head atomically/s);
  assert.match(grammar, /\\item\[S8\] A rendering route/);
  assert.match(grammar, /\\item\[S9\] Read-back reconstructs/);
  assert.match(grammar, /\\item\[S10\] Decide under A11 applies to a whole cross-surface candidate/);
  assert.match(grammar, /Core obligations and selected-profile axioms/);
  assert.match(grammar, /A3--A5, A10, and A12 are core obligations/);
  assert.match(grammar, /A1, A2, A6--A9, A11, and A13 are axioms of the selected construction profile/);
  assert.match(grammar, /\\item\[A13 Profile---Progressive externalization\.\]/);
  assert.match(grammar, /persist across later.*constrain a later Event.*differ across perspective processes.*controllable and auditable/s);
  assert.match(grammar, /record query returns its permitted parents.*filtered by the requesting principal's access policy/s);
  assert.match(grammar, /semantic weight is never returned alone/);
  assert.match(grammar, /Universe.*U\\in\\Xset.*History.*H=\\lc\(U\)\\in\\Eset/s);
  assert.match(grammar, /Every Cut has an Event parent/);
  assert.match(grammar, /assessment Event contained by the process whose.*perspective it expresses as \$P\$.*about.*target/s);
  assert.match(grammar, /estimate of a semantic composition is instead a Cut.*on.*estimate.*Event/s);
  assert.match(grammar, /physical-part.*until a detach Event/s);
  assert.match(grammar, /Social, institutional, and documentary membership never propagates location/s);
  assert.match(grammar, /Book-specific person profile \(non-normative\)/);
  assert.match(grammar, /Book-specific constants \(non-normative\)/);
  assert.doesNotMatch(grammarSource, /\\appendix/);
});

test('the paper is self-contained and the grammar is a compact reference view', () => {
  const paper = normalize(source);
  assert.match(core, /definitions and rules.*stated in this paper/);
  assert.match(grammar, /compact restatement.*paper is self-contained/s);
  assert.doesNotMatch(paper, /Technical Appendix (specifies|gives)|Technical Appendix's record fields/);
  assert.match(core, /acyclic graph.*nearest declared context root.*same governing root/s);
  assert.match(core, /Access is checked before following an edge.*neither content nor private ancestry/s);
  assert.match(core, /Conditioning addresses must resolve and cannot form cycles/);
  assert.match(profile, /Register.*stages an addressable Concept, Thing, or Event/);
  assert.match(world, /tagged instant.*untestable.*common frame/s);
  assert.match(world, /reading cached coarse answers does not count/);
  assert.match(world, /Compatibility requires the same question, divided unit, vocabulary, remainder meaning, and governing perspective/);
  assert.match(surfaces, /changed read dependency rejects.*rebasing requires renewed validation/s);
  assert.match(surfaces, /opaque ones.*declare the records they read/s);
  assert.match(appendices, /zero denominator.*no resolved view.*remainder-only view/s);
  assert.match(argumentMap, /Substantive changes must appear in both presentations/);
});

test('the implementation map preserves process, Cut, and world-data semantics', () => {
  assert.match(implementation, /concurrent unweighted human Event-process domains/);
  assert.match(implementation, /desired condition/);
  assert.match(implementation, /assessment Events and Cuts beneath the relevant perspective process/);
  assert.doesNotMatch(implementation, /human state coordinates|psychological scale/);
  assert.match(implementation, /life-sim-rust-meaning-model\/v1/);
  assert.match(implementation, /not native conformance/);
  assert.match(implementation, /breaking schema migration/);
});

test('perspective is derived from ancestry rather than an authored holder field', () => {
  for (const [name, text] of [
    ['theory paper', source],
    ['minimized grammar', grammarSource],
    ['shared interface', interfaceSource],
    ['implementation map', implementationSource],
  ]) {
    assert.doesNotMatch(text, /\bholder\b/i, `${name} still contains holder semantics`);
  }
  assert.match(interfaceBlocks, /perspective follows declared authority ancestry/);
  assert.match(grammar, /Every path must resolve to the same nearest context root/);
  assert.match(grammar, /Every record carries.*author or generator identifier/s);
});

test('Book-specific vocabulary remains explicitly replaceable', () => {
  assert.match(appendices, /Book-Specific Profile Vocabulary/);
  assert.match(appendices, /not a universal psychology/);
  assert.match(appendices, /AtomicWant/);
  assert.match(appendices, /five concerns shared across principals.*not a universal psychology/s);
  assert.match(appendices, /\\subsection\{Freeze contract\}/);
  assert.match(appendices, /Changing any of them creates a new run/);
});

test('the public argument map and release overview protect the paper boundary', () => {
  assert.match(argumentMap, /world, abstract meanings,.*understanding, and a story together at progressive resolution/s);
  assert.match(argumentMap, /Meaning Model owns/);
  assert.match(argumentMap, /frozen-parent whole candidates/);
  assert.match(argumentMap, /Life Simulation uses completed or ongoing Meaning Model worlds/);
  assert.match(argumentMap, /completed bounded construction/);
  assert.match(argumentMap, /preregistered matched\s+comparison and independent read-back study remain prospective/s);
  assert.match(argumentMap, /No Book-level Direction roll selected the final world/);
  assert.match(argumentMap, /Rust compiled static.*external validator.*authored conventions/s);
  assert.match(argumentMap, /Cut weights, typed world data, and derived diagnostics remain distinct/s);
  assert.match(readme, /Meaning Model/);
  assert.match(readme, /rust-engine/);
  assert.match(readme, /Life Simulation/);
});

test('all citation keys resolve and substantive paragraphs are not duplicated', () => {
  const cited = new Set(
    [...source.matchAll(/\\cite\{([^}]+)\}/g)]
      .flatMap((match) => match[1].split(','))
      .map((key) => key.trim()),
  );
  for (const key of cited) {
    assert.match(bibliography, new RegExp(`@[^{]+\\{${key}[,}]`), `missing citation ${key}`);
  }

  const paragraphs = source
    .split(/\n\s*\n/)
    .map(normalize)
    .filter((paragraph) => paragraph.length > 180 && !paragraph.startsWith('\\'));
  const seen = new Set();
  for (const paragraph of paragraphs) {
    assert.ok(!seen.has(paragraph), `duplicate paragraph: ${paragraph.slice(0, 90)}`);
    seen.add(paragraph);
  }

  const wordCount = source.trim().split(/\s+/).length;
  // Includes the essential grammar rules and the requested psychological-refinement discussion.
  // Includes the explicit system-level contribution framing added September 5.
  assert.ok(wordCount <= 18000, `manuscript source exceeds compact budget: ${wordCount}`);
});

test('shared interface macros retain the core/profile boundary', () => {
  assert.match(interfaceBlocks, /\\newcommand\{\\MMCoreSummary\}/);
  assert.match(interfaceBlocks, /\\newcommand\{\\MMCoreSchema\}/);
  assert.match(interfaceBlocks, /\\newcommand\{\\MMProfileSummary\}/);
  assert.match(interfaceBlocks, /\\newcommand\{\\MMProfileSchema\}/);
  assert.match(interfaceBlocks, /Every Cut declares the\s+unit it partitions/);
  assert.match(interfaceBlocks, /Understanding and\s+Document Nodes can point into the same graph/);
  assert.match(interfaceBlocks, /perspective follows declared authority ancestry/);
});

test('refinement, addressability and perspective have explicit bounded contracts', () => {
  assert.match(core, /Cut revision and a stable local answer key/);
  assert.match(grammar, /including zero-weight slots/);
  assert.match(grammar, /Conditioning addresses must resolve, form no cycle/);
  assert.match(world, /finite preservation witness, not a theorem/);
  assert.match(world, /eq:residual-feasibility-theory/);
  assert.match(grammar, /reconstructed from the addressed fine records, not merely read from a cached coarse answer/);
  assert.match(world, /Concept specialization.*Expressive concept decomposition.*Physical encapsulation.*Temporal segmentation/s);
  assert.match(surfaces, /Accepting that Ada imagined.*accepts the imagining act, not the trial/s);
  assert.match(surfaces, /Co-presence permits an observation.*does not reveal every field/s);
  assert.match(concepts, /Fit and confidence ask different questions/);
  assert.match(grammar, /A stale base or changed read dependency rejects/);
  assert.match(grammar, /regenerated or marked stale/);
  assert.match(bookWitness, /examples\/refinement-trial/);
  assert.match(bookWitness, /eleven test families/);
  assert.match(bookWitness, /archival release identifier remains to be assigned/);
  assert.match(implementation, /No fixture result should be reported as native Rust conformance/);
});
