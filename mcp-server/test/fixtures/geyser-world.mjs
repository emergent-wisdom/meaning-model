// The geyser world ("The Interval Law") as processes and laws. A confined channel fills from its supply, discharges
// almost completely when it crosses its threshold (R1), and stays shut for a quiet proportional to what it
// discharged (R2).
export const C = (value) => ({ op: 'constant', value });
export const P = (process) => ({ op: 'process', process });
export const add = (...terms) => ({ op: 'add', terms });
export const mul = (...factors) => ({ op: 'multiply', factors });
export const sub = (left, right) => ({ op: 'subtract', left, right });
const clamp = (value, minimum, maximum) => ({ op: 'clamp', value, minimum, maximum });
export const quietOn = (quiet) => clamp(mul(P(quiet), C(1000)), 0, 1);
export const isOpen = (quiet) => sub(C(1), quietOn(quiet));

export const proc = (id, unit, initial, { fixed = false } = {}) => ({
  id, unit, value_type: { kind: 'scalar', bounds: { minimum: -1, maximum: 1e6 } }, initial_value: { kind: 'scalar', value: initial },
  provenance: ['geyser world'], support: [fixed ? 'declared input' : 'computed by the laws'], ...(fixed ? { update_mode: 'static' } : {}),
});

export function channel(name, { threshold = 10, supply = C(1), kQuiet = 0.5, seep = 0.01, initial = 0 } = {}) {
  const stored = `${name}.stored`; const quiet = `${name}.quiet`; const eruptions = `${name}.eruptions`;
  return {
    processes: [proc(stored, 'charge', initial), proc(quiet, 'time units of quiet left', 0), proc(eruptions, 'eruptions so far', 0)],
    laws: [
      { id: `${name}-fill`, operator: { role: 'evolution', target: stored, derivative: sub(mul(supply, isOpen(quiet)), mul(C(seep), P(stored))) }, provenance: ['R1'] },
      { id: `${name}-calm`, operator: { role: 'evolution', target: quiet, derivative: mul(C(-1), quietOn(quiet)) }, provenance: ['R2'] },
      { id: `${name}-erupt`, operator: { role: 'occurrence',
        trigger: { kind: 'threshold', expression: P(stored), comparison: 'greater_or_equal', threshold, firing: 'on_enter' },
        effects: [{ target: quiet, mode: 'set', value: mul(C(kQuiet), P(stored)) }, { target: eruptions, mode: 'add', value: C(1) },
          { target: stored, mode: 'set', value: C(0.02 * threshold) }] }, provenance: ['R1', 'R2'] },
    ],
  };
}

// The modeller's answer for the geyser world: one vent on a steady supply.
export function geyserWorldModel(worldNodeId) {
  const vent = channel('vent');
  return { worldNodeId, timeUnit: 'day', processes: vent.processes, laws: vent.laws, observables: ['vent.stored', 'vent.quiet', 'vent.eruptions'],
    run: { horizon: 90, stepSize: 0.05 },
    ruleMap: [{ ruleId: 'R1', lawIds: ['vent-fill', 'vent-erupt'], how: 'charge fills and discharges at the threshold' },
      { ruleId: 'R2', lawIds: ['vent-calm', 'vent-erupt'], how: 'the quiet after a discharge is proportional to it' }],
    simplifications: ['Preplay (R3), throat width (R4) and shared reservoirs (R5) are left out.'], decline: null,
    isolation: { modeller: 'fresh_context' } };
}

// The geyser world's record, as a builder would write it (shortened).
export const geyserWorld = {
  title: 'The Interval Law', principle: 'No quantity moves continuously through a constriction: it accumulates and discharges all at once.',
  text: '# The Interval Law\n\nNo quantity moves continuously through a constriction. It accumulates, and when the stored amount crosses the channel\'s threshold it discharges all at once. The pressure of living bodies behaves the same way.\n\nR1 Threshold release: below the threshold nothing leaves except minor seepage; at it, the store discharges almost completely.\nR2 Proportional silence: the quiet after a discharge is proportional to the amount discharged.\nR3 Preplay: small warning bursts come before a full discharge.\nR4 Throat governs violence: a narrower throat gives a higher threshold.\nR5 Shared reservoirs compete: channels fed from one reservoir drain each other.',
  rules: [{ id: 'R1', statement: 'Below the threshold nothing leaves except minor seepage; at it, the store discharges almost completely.' },
    { id: 'R2', statement: 'The quiet after a discharge is proportional to the amount discharged.' },
    { id: 'R3', statement: 'Small warning bursts come before a full discharge.' },
    { id: 'R4', statement: 'A narrower throat gives a higher threshold.' },
    { id: 'R5', statement: 'Channels fed from one reservoir drain each other.' }],
  society: 'Time is read from vents.', easy: ['Keeping time'], hard: ['Steady flow'], isolation: { builder: 'fresh_context' },
};

// The solver's scenario: six people as channels with slightly different rhythms, measured by how often a burst has
// company, and a sealed table in two parts (pooled pledges, and a supper that discharges everyone), each in its own laws.
export const RATES = [0.95, 1.0, 1.05, 1.1, 0.9, 1.02];
export function lonelinessScenario(worldModelNodeId) {
  const people = RATES.map((rate, index) => channel(`p${index}`, { supply: C(rate), initial: index * 0.3 }));
  const threshold = (expression, value) => ({ kind: 'threshold', expression, comparison: 'greater_or_equal', threshold: value, firing: 'on_enter' });
  return {
    worldModelNodeId, description: 'Each person is a channel: the urge for company builds up and bursts, then a quiet follows. A burst is lonely when nobody else bursts within a day.',
    processes: people.flatMap((person) => person.processes), laws: people.flatMap((person) => person.laws), overrides: [], observables: [],
    measure: { kind: 'cooccurrence', counters: RATES.map((_, index) => `p${index}.eruptions`), window: 1, after: 100, better: 'higher', meaning: 'the share of bursts that have company' },
    run: { horizon: 400, stepSize: 0.05 },
    interventions: [{ id: 'table', label: 'a sealed table', parts: [
      { id: 'pool', label: 'pooled pledges open a table at quorum', processes: [proc('table.stored', 'pledges', 0), proc('table.quiet', 'days of quiet left', 0), proc('table.suppers', 'suppers held', 0)],
        laws: [{ id: 'table-fill', operator: { role: 'evolution', target: 'table.stored', derivative: mul(isOpen('table.quiet'), C(1.8)) }, provenance: ['pledges'] },
          { id: 'table-calm', operator: { role: 'evolution', target: 'table.quiet', derivative: mul(C(-1), quietOn('table.quiet')) }, provenance: ['R2'] },
          { id: 'table-supper', operator: { role: 'occurrence', trigger: threshold(P('table.stored'), 16),
            effects: [{ target: 'table.quiet', mode: 'set', value: mul(C(0.5), P('table.stored')) }, { target: 'table.suppers', mode: 'add', value: C(1) }, { target: 'table.stored', mode: 'set', value: C(0.3) }] }, provenance: ['quorum'] }] },
      { id: 'discharge', label: 'the supper discharges everyone together',
        laws: [{ id: 'table-discharge', operator: { role: 'occurrence', trigger: threshold(P('table.stored'), 16),
          effects: RATES.flatMap((_, index) => [{ target: `p${index}.quiet`, mode: 'set', value: add(mul(C(0.5), P(`p${index}.stored`)), C(0.5)) }, { target: `p${index}.stored`, mode: 'set', value: C(0.2) }]) }, provenance: ['the supper spends the charge'] }] }] }],
    isolation: { solver: 'fresh_context' },
  };
}
