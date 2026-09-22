import { modelDepthBasis } from '../src/storytelling-depth.mjs';

// Existing scene/lifetime unit tests isolate their own contracts. Their fake
// service supplies a matching depth assessment; stale-depth behavior has its
// own tests and a real MCP round trip.
export function refreshDepthFixture(view, preparation) {
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
