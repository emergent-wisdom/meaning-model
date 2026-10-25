// Something on the page early: a seed an agent can register as its first write, before the grammar, so the first few
// writes make a rough model of the whole. The seed holds one root process, the whole the work covers, and the world it
// happens in; everything beneath it is opened with life_values_record, life_series_record and life_carve_record, whose
// descriptions and refusals carry what they need. Writing records by hand (life_model_revise, or a register beyond the
// seed) waits for the grammar.

const SEED = Object.freeze({
  schema: 'life-sim-rust-model/v1',
  id: 'my-world',
  time_unit: 'year',
  revision: { number: 0, previous_model_hash: null, provenance: ['sketch: the seed of a first rough model'], reason: 'The seed: the whole the work covers, as one process, and the world it happens in.' },
  decomposition: [], dependencies: [], laws: [], initial_claims: [],
  processes: [{
    id: 'world', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 10 } }, initial_value: { kind: 'scalar', value: 5 },
    unit: '0 to 10', update_mode: 'observed', reference_frame: 'the whole the work covers',
    scale: { label: 'The whole', semantic_role: 'The whole the work covers: rename it, and say what its numbers mean.' },
    support: ['sketch: a first guess'], uncertainty: { kind: 'unknown' }, axes: [], access_scopes: [], provenance: ['sketch: a first guess'],
  }],
  meaning_model: {
    schema: 'life-sim-rust-meaning-model/v1', referents: [],
    events: [{ id: 'event.world', boundary: 'The world the work covers, from its start to its end: rename it and set its interval.', interval: { start: 2000, end: 2025 },
      participants: {}, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['sketch: the span of the work'] }],
    event_referent_bindings: [], event_relations: [], normalized_cuts: [],
    context_roots: [{ event_id: 'event.world', kind: 'accepted_world', provenance: ['sketch: the accepted world'] }],
    concepts: [], abstract_cuts: [], abstract_relations: [], encapsulation_cuts: [], physical_cuts: [], realizations: [],
  },
});

// A fresh copy each time, so a caller that fills it in never changes the next one.
export function firstWrite() {
  return {
    tool: 'life_model_register',
    note: 'Your first write can be this seed, before any further reading: give the model an id, its unit of time, the world Event\'s name and interval (the span the work covers), and the root process\'s label, measure and first value, then register it. Your next few writes make a rough model of the whole beneath it, before depth: open its top processes with life_values_record (process {label, unit or scale, parent: "world"}) with guessed values across the whole span, tagged sketch. Read the grammar before you write records by hand.',
    arguments: { requestId: 'seed', model: structuredClone(SEED) },
  };
}
