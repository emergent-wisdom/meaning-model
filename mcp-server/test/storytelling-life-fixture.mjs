import { modelDepthBasis } from '../src/storytelling-depth.mjs';

// Existing scene/lifetime unit tests isolate their own contracts. Their fake
// service supplies a matching depth assessment; stale-depth behavior has its
// own tests and a real MCP round trip.
export function refreshDepthFixture(view, preparation) {
  if (!view.withoutWorld) addWorldProcess(view, 'book', { scopes: [] });
  if (preparation.scene && preparation.scene.routePartId === undefined) preparation.scene.routePartId = 'part.1';
  const life = view.nodes.find((node) => node.id === preparation.lifeTrendsNodeId);
  if (!life) return;
  let dossier;
  try { dossier = JSON.parse(life.text); } catch { return; }
  const storyRootId = dossier.storyRootId;
  view.graph.source_snapshot.model_hash ??= 'f'.repeat(64);
  const focus = { id: 'depth.focus', node_type: 'plan', role: 'metadata', render: 'exclude',
    text: 'The planned scene continues the established lives and uses only the selected explanatory context.', access_scopes: [] };
  const root = { id: 'depth.process', node_type: 'understanding_process_root', role: 'metadata', subject: storyRootId,
    access_scopes: [], render: 'exclude', training: 'exclude' };
  for (const node of [focus, root]) if (!view.nodes.some((item) => item.id === node.id)) view.nodes.push(node);
  const locator = { storyRootId, lifeTrendsNodeId: life.id, focusNodeId: focus.id,
    contextNodeIds: preparation.scene.context.map((item) => item.nodeId) };
  let basis;
  try { basis = modelDepthBasis(view, locator); } catch { return; }
  // Record the basis version as life_story_model_depth_record does; an unversioned record reads as version 1.
  const data = { schema: 'meaning-model-story-model-depth-assessment/v1', locator,
    basisVersion: basis.basis.basisVersion, basisHash: basis.basisHash, sourceSnapshotHash: view.source_snapshot_hash,
    modelHash: view.graph.source_snapshot.model_hash, reviewedGraphHash: view.graph_hash, taskHash: 'e'.repeat(64),
    coverage: 'Fixture review of the declared choices and their model context.',
    findings: [{ subject: 'Scene explanatory basis', status: 'sufficient', explanation: 'Fixture supplied assessment.',
      evidence: [{ kind: 'model', path: '' }], smallestRepair: null }], semanticVerification: false };
  const node = { id: 'depth.review', node_type: 'storytelling.assessment', role: 'externalized_reflection',
    subject: storyRootId, holder: 'fixture-author', render: 'exclude', training: 'exclude',
    access_scopes: view.nodes.find((item) => item.id === 'depth.review')?.access_scopes ?? [],
    text: JSON.stringify({ data }) };
  const index = view.nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) view.nodes[index] = node; else view.nodes.push(node);
  if (!view.edges.some((edge) => edge.id === 'depth.placement')) view.edges.push({ id: 'depth.placement',
    source: { kind: 'node', node_id: root.id }, target: { kind: 'node', node_id: node.id },
    family: 'structural', relation: 'contains', order: 0, access_scopes: [] });
}

export function lifeTrendsDossier(storyRootId = 'book', characterId = 'Leo') {
  return {
    schema: 'meaning-model-story-life-trends/v1',
    storyRootId,
    storyInterval: { start: 0, end: 10 },
    characters: [{
      characterId,
      name: characterId,
      lifeTimeUnit: 'years_since_birth',
      lifeBeginning: 0,
      storyEntry: 40,
      phases: [
        { id: 'origins', at: 0, label: 'Origins', situation: 'A childhood among practical, reliable neighbors.' },
        { id: 'adult', at: 20, label: 'Early adulthood', situation: 'Work creates room for independent choices and sustained friendships.' },
        { id: 'entry', at: 40, label: 'Story entry', situation: 'Years of steady work have built trust and a habit of checking evidence.' },
      ],
      trends: [{
        id: 'agency', dimension: 'Ways of exercising agency',
        states: [
          { phaseId: 'origins', state: 'Relies on others to choose safe options.' },
          { phaseId: 'adult', state: 'Learns to make independent decisions.' },
          { phaseId: 'entry', state: 'Acts independently but checks uncertain information.' },
        ],
        developments: [
          { fromPhaseId: 'origins', toPhaseId: 'adult', explanation: 'Work brings repeated chances to make consequential choices.' },
          { fromPhaseId: 'adult', toPhaseId: 'entry', explanation: 'Experience with incomplete evidence tempers quick decisions.' },
        ],
      }, {
        id: 'belonging', dimension: 'Relationships and belonging',
        states: [
          { phaseId: 'origins', state: 'Belongs to a close community.' },
          { phaseId: 'adult', state: 'Builds a smaller chosen circle.' },
          { phaseId: 'entry', state: 'Maintains a steady circle through everyday practical care.' },
        ],
        developments: [
          { fromPhaseId: 'origins', toPhaseId: 'adult', explanation: 'Moving for work changes the available relationships.' },
          { fromPhaseId: 'adult', toPhaseId: 'entry', explanation: 'Repeated acts of mutual help sustain these bonds without dramatic change.' },
        ],
      }],
      future: { status: 'open', outlook: 'Future choices and outcomes remain undecided.' },
    }],
  };
}

export function lifeTrendsNode(dossier = lifeTrendsDossier(), id = 'life.trends') {
  return {
    id, node_type: 'storytelling.life_trends', role: 'metadata',
    text: JSON.stringify(dossier), render: 'exclude', training: 'exclude',
    epistemic_status: 'author_model', evidence_type: 'fictional_canon',
    access_scopes: [],
  };
}

export function lifeConnections(characterId = 'Leo') {
  return [{
    characterId, trendIds: ['agency', 'belonging'],
    connection: 'The character checks the evidence with practiced care; established relationships remain implicit in this quiet scene.',
  }];
}

export function lifeTrendsEdges(storyRootId = 'book', characterId = 'Leo', nodeId = 'life.trends') {
  return [{
    id: `${nodeId}.root`, source: { kind: 'node', node_id: storyRootId },
    target: { kind: 'node', node_id: nodeId }, family: 'provenance', relation: 'life_trends',
    access_scopes: [],
  }, {
    id: `${nodeId}.character`, source: { kind: 'node', node_id: nodeId },
    target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: characterId },
    family: 'grounding', relation: 'models_life_of', access_scopes: [],
  }];
}

// The process the add-on requires before a scene, as fixture records: the five world stages, a world direction with
// no failures, and each principal's whole life in the bound model (the person template's slow processes, periods
// covering the life, and two shocks). Tests of those requirements build their own records.
const SLOW = ['body', 'kin', 'partnership', 'work', 'place', 'means', 'knowledge', 'standing', 'meaning'];
export function withLives(model, people = ['Leo'], interval = { start: -40, end: 40 }) {
  const copy = structuredClone(model ?? { id: 'fixture-model' });
  const mm = copy.meaning_model ??= {};
  for (const key of ['events', 'event_relations', 'referents', 'event_referent_bindings', 'normalized_cuts']) mm[key] ??= [];
  const middle = (interval.start + interval.end) / 2;
  for (const person of people) {
    if (mm.referents.some((referent) => referent.id === person)) continue;
    const life = `event.life.${person}`;
    const contain = (target) => mm.event_relations.push({ id: `rel.${target}`, kind: 'contains', source_event_id: life, target_event_id: target });
    mm.referents.push({ id: person, boundary: `${person}, a person`, continuity_criterion: 'One continuous life.', interval, lifecycle_event_id: life });
    mm.events.push({ id: life, boundary: `${person}'s life`, description: `${person}'s whole life.`, interval, participants: { subject: person } });
    for (const key of SLOW) { mm.events.push({ id: `${life}.is.${key}`, boundary: key, interval }); contain(`${life}.is.${key}`); }
    for (const [index, period] of [[0, { start: interval.start, end: middle }], [1, { start: middle, end: interval.end }]]) {
      mm.events.push({ id: `${life}.period.${index}`, boundary: `Period ${index + 1}`, description: `${person}'s period ${index + 1}.`, interval: period });
      contain(`${life}.period.${index}`);
    }
    for (const index of [0, 1]) {
      const arc = `event.arc.${person}.${index}`;
      const at = interval.start + (interval.end - interval.start) * (index + 1) / 3;
      mm.events.push({ id: arc, boundary: `${person}'s shock ${index + 1}`, interval: { start: at, end: at + 1 } });
      for (const phase of ['anticipation', 'focal_change', 'adaptation']) mm.events.push({ id: `${arc}.${phase}`, boundary: phase, interval: { start: at, end: at + 1 } });
      mm.event_referent_bindings.push({ id: `binding.${arc}`, target: { event_id: arc }, role: 'affected', referent_id: person, binding_type: 'change_arc_subject' });
    }
  }
  return copy;
}

const WORLD = 'meaning-model-story-world/v1';
export function worldProcessNodes(storyRootId = 'book', { routeEventIds = ['ev.route'], scopes = [] } = {}) {
  const record = (id, data, time) => ({ id, node_type: 'storytelling.world', role: 'externalized_reflection', subject: storyRootId, holder: 'fixture-author',
    render: 'exclude', training: 'exclude', access_scopes: scopes, value_time: time, text: JSON.stringify({ data: { schema: WORLD, ...data } }) });
  return [
    record('world.author', { stage: 'author_reader', author: { personId: 'author', name: 'Author', figuringOut: 'Whether care that checks evidence can also trust.' },
      reader: null, buttons: [{ id: 'button.trust', button: 'The fear that checking everything means trusting no one.' }] }, 1),
    record('world.candidates', { stage: 'candidates', form: { targetWords: 1200, parts: 1 } }, 2),
    record('world.opening', { stage: 'opening' }, 3),
    record('world.aspects', { stage: 'aspects', aspects: [{ id: 'a.choices', kind: 'choices', aspect: 'Why Leo checks the key.', how: 'Model his checking habit.', status: 'modeled', records: ['event:ev.route'] }] }, 3.5),
    record('world.implications', { stage: 'implications', commitments: [{ id: 'c.1', implications: [{ about: 'Leo', status: 'represented' }] }] }, 4),
    record('world.route', { stage: 'route', parts: [{ id: 'part.1', title: 'The key', eventIds: routeEventIds, focal: 'Leo', change: 'Leo trusts the evidence he checked.', ends: 'With the key hidden.' }] }, 5),
    { id: 'world.direction', node_type: 'storytelling.direction', role: 'externalized_reflection', subject: storyRootId, holder: 'fixture-director',
      render: 'exclude', training: 'exclude', access_scopes: scopes, value_time: 6,
      text: JSON.stringify({ data: { schema: 'meaning-model-story-direction/v1', stage: 'world', directorId: 'fixture-director', independent: true, modelHash: 'f'.repeat(64),
        findings: [{ principleId: 'world.author', verdict: 'holds', evidence: 'Fixture direction without failures.', modelChange: null }] } }) },
  ];
}
export function addWorldProcess(view, storyRootId = 'book', options = {}) {
  for (const node of worldProcessNodes(storyRootId, options)) if (!view.nodes.some((item) => item.id === node.id)) view.nodes.push(node);
}
