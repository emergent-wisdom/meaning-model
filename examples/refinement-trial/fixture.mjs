// Authored conformance data, not historical evidence or a Rust export.
import { createHash } from 'node:crypto';

export const grounding = {
  id: 'bounded-trial',
  description: 'A fixed-configuration trial with independently compared cases.',
  anchors: ['Record the tested configuration and the number of compared cases.'],
};
export const groundingDigest = createHash('sha256')
  .update(JSON.stringify(grounding)).digest('hex');
const provenance = { author: 'fixture-author', status: 'authored', clock: 'local minutes' };
const record = (id, form, fields) => ({ id, form, ...fields, provenance });
const event = (id, fields) => record(id, 'Event', { interval: [0, 20], ...fields });
const cut = (id, parent, weights, labels = ['hopeful', 'cautious', 'remainder']) =>
  record(id, 'Cut', {
    parent, profile: 'allocation', question: 'How is the depicted outlook composed?',
    unit: 'one outlook composition',
    answers: labels.map((key, i) => ({ key, weight: weights[i], remainder: key === 'remainder' })),
  });

export const coarseRecords = [
  record('universe', 'Thing', { lifecycle: 'history' }),
  event('history', { kind: 'lifecycle', context: 'world' }),
  record('ada', 'Thing', { lifecycle: 'ada-life' }),
  event('ada-life', { kind: 'lifecycle', authorityParent: 'history' }),
  record('engine', 'Thing', { lifecycle: 'engine-life' }),
  event('engine-life', { kind: 'lifecycle', authorityParent: 'history' }),
  ...[['universe', 'history'], ['ada', 'ada-life'], ['engine', 'engine-life']]
    .map(([thing, parent]) => record(`${thing}-subject`, 'Binding', {
      event: parent, thing, role: 'subject', interval: [0, 20],
    })),
  event('trial@0', {
    kind: 'trial', interval: [0, 10], authorityParent: 'history',
    data: { configuration: 'A', cases: 12, matches: 12 },
    description: 'Twelve cases match on configuration A in a ten-minute trial.',
  }),
  record('trial-engine', 'Binding', {
    event: 'trial@0', thing: 'engine', role: 'tested-apparatus', interval: [0, 10],
  }),
  event('ada-inner', { kind: 'perspective-root', context: 'ada', authorityParent: 'ada-life' }),
  event('ada-outlook', {
    kind: 'assessment', authorityParent: 'ada-inner', interval: [0, 10], about: 'trial@0',
  }),
  cut('outlook@0', 'ada-outlook', [0.58, 0.32, 0.10]),
  event('ada-observation', {
    kind: 'observation', authorityParent: 'ada-inner', interval: [3, 4],
    availableAt: 3, source: 'trial@0',
    // Access is to this observed content, not all facts on the source Event.
    content: { configuration: 'A' },
    description: 'Ada sees the configuration label, not the concealed result sheets.',
  }),
  event('constructor', { kind: 'perspective-root', context: 'constructor', authorityParent: 'history' }),
  event('constructor-belief', {
    kind: 'assessment', authorityParent: 'constructor', about: 'ada-inner',
    data: { hypothesis: 'Ada will ask for another comparison.' },
  }),
  record('bounded-trial', 'Concept', { grounding: groundingDigest }),
  record('trial-realization', 'Realization', {
    parent: 'history', target: 'trial@0', concept: 'bounded-trial',
    purpose: 'describe', grounding: groundingDigest,
  }),
];

export const phases = [
  { id: 'setup', interval: [0, 2], outlook: [0.8, 0.1, 0.06, 0.04] },
  { id: 'execution', interval: [2, 7], outlook: [0.6, 0.3, 0.06, 0.04] },
  { id: 'comparison', interval: [7, 10], outlook: [0.4, 0.5, 0.06, 0.04] },
];
export const fineRecords = phases.flatMap(({ id, interval, outlook }) => [
  event(id, {
    kind: 'phase', interval, authorityParent: 'history', occursWithin: 'trial@0',
    data: { configuration: 'A', ...(id === 'execution' ? { cases: 12 } : {}),
      ...(id === 'comparison' ? { matches: 12 } : {}) },
    description: `${id} phase of the fixed-configuration trial.`,
  }),
  event(`${id}-assessment`, {
    kind: 'assessment', interval, authorityParent: 'ada-inner', about: id,
  }),
  cut(`${id}-outlook`, `${id}-assessment`, outlook,
    ['hopeful', 'cautious', 'fatigue', 'remainder']),
]);
fineRecords.push(record('trial-periods', 'Cut', {
  parent: 'trial@0', profile: 'sequential', question: 'Which phase occupies the trial time?',
  unit: 'ten local minutes',
  answers: [
    ...phases.map(({ id, interval }) => ({ key: id, target: id, weight: (interval[1] - interval[0]) / 10 })),
    { key: 'remainder', weight: 0, remainder: true },
  ],
}));

export const witness = {
  base: 's0', parent: 'trial@0', horizon: [0, 10],
  protectedFacts: { configuration: 'A', cases: 12, matches: 12 },
  coarseCut: 'outlook@0', fineCuts: phases.map(p => `${p.id}-outlook`),
  slotMap: { hopeful: 'hopeful', cautious: 'cautious', fatigue: 'remainder', remainder: 'remainder' },
  tolerance: 1e-12,
};

export const passage = 'The trial began at local minute zero. Preparation took two minutes; running the cards took the next five; comparison occupied the final three. At minute ten all twelve cases agreed with the independent sheets. The apparatus had remained in configuration A throughout. Ada had seen its label at minute three, while the result sheets were still covered.';
export const surfaces = [
  record('reason', 'UnderstandingNode', {
    type: 'decision-summary', text: 'Keep the configuration and result fixed while opening the trial into phases.',
    about: ['trial@0', 'trial-periods'],
  }),
  record('passage', 'DocumentNode', {
    role: 'story-passage', text: passage,
    route: { source: 's1', events: phases.map(p => p.id), frontier: 10,
      viewpoint: 'world', cutoff: 10, disclosure: 'completed-trial', status: 'authored' },
  }),
];

// Explicit replacement, not a purported conservative expansion.
export const revisedTrial = {
  ...coarseRecords.find(r => r.id === 'trial@0'), id: 'trial@1',
  data: { configuration: 'B', cases: 12, matches: 12 },
  supersedes: 'trial@0', description: 'An explicitly revised trial uses configuration B.',
};
