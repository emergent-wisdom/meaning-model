// A model revision as its change: records added or replaced by id, and ids removed, per collection,
// applied to the stored predecessor. The engine still receives and validates the complete successor;
// the caller no longer has to fetch, edit and resend a definition of hundreds of kilobytes.

// Every collection whose records carry an id, and where it lives in the definition.
export const modelChangeCollections = Object.freeze({
  processes: [], laws: [], initial_claims: [], decomposition: [], dependencies: [],
  concepts: ['meaning_model'], abstract_relations: ['meaning_model'], abstract_cuts: ['meaning_model'],
  referents: ['meaning_model'], encapsulation_cuts: ['meaning_model'], events: ['meaning_model'],
  event_relations: ['meaning_model'], event_referent_bindings: ['meaning_model'], physical_cuts: ['meaning_model'],
  realizations: ['meaning_model'], normalized_cuts: ['meaning_model'],
});

const MAX_REASON = 4_000;

function holderOf(definition, collection) {
  const path = modelChangeCollections[collection];
  if (!path) throw new Error(`Unknown model collection ${collection}; use one of ${Object.keys(modelChangeCollections).join(', ')}.`);
  if (!path.length) return definition;
  if (!definition.meaning_model) throw new Error(`The predecessor has no meaning_model, so ${collection} cannot be changed; send the complete model instead.`);
  return definition.meaning_model;
}

export function validateModelChange(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('change must be an object.');
  const unknown = Object.keys(change).filter((key) => !['reason', 'provenance', 'upsert', 'remove'].includes(key));
  if (unknown.length) throw new Error(`Unknown change field ${unknown[0]}; a change has reason, provenance, upsert and remove.`);
  if (typeof change.reason !== 'string' || !change.reason.trim() || change.reason.length > MAX_REASON) throw new Error(`change.reason must be nonblank text of at most ${MAX_REASON} characters.`);
  if (change.provenance !== undefined && (!Array.isArray(change.provenance) || !change.provenance.length || change.provenance.some((item) => typeof item !== 'string' || !item.trim()))) {
    throw new Error('change.provenance, when given, must be a nonempty list of nonblank strings.');
  }
  const upsert = change.upsert ?? {}; const remove = change.remove ?? {};
  for (const [label, part] of [['upsert', upsert], ['remove', remove]]) {
    if (typeof part !== 'object' || Array.isArray(part)) throw new Error(`change.${label} maps collection names to lists.`);
    for (const [collection, list] of Object.entries(part)) {
      if (!modelChangeCollections[collection]) throw new Error(`Unknown model collection ${collection} in change.${label}; use one of ${Object.keys(modelChangeCollections).join(', ')}.`);
      if (!Array.isArray(list)) throw new Error(`change.${label}.${collection} must be a list.`);
    }
  }
  let count = 0;
  for (const [collection, records] of Object.entries(upsert)) {
    const ids = new Set();
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id) throw new Error(`Every record in change.upsert.${collection} needs a string id.`);
      if (ids.has(record.id)) throw new Error(`change.upsert.${collection} names ${record.id} twice.`);
      ids.add(record.id); count += 1;
    }
    for (const recordId of remove[collection] ?? []) if (ids.has(recordId)) throw new Error(`${collection} ${recordId} is both upserted and removed.`);
  }
  for (const [collection, ids] of Object.entries(remove)) {
    if (ids.some((recordId) => typeof recordId !== 'string' || !recordId)) throw new Error(`change.remove.${collection} lists string ids.`);
    if (new Set(ids).size !== ids.length) throw new Error(`change.remove.${collection} names an id twice.`);
    count += ids.length;
  }
  if (!count) throw new Error('The change upserts and removes nothing.');
  return { upsert, remove };
}

// The successor definition: the predecessor with each upsert replacing the record of the same id in place
// (or appended) and each removal dropped, under the next revision number.
export function applyModelChange(previous, previousModelHash, change) {
  const { upsert, remove } = validateModelChange(change);
  const successor = structuredClone(previous);
  const summary = {};
  for (const collection of new Set([...Object.keys(upsert), ...Object.keys(remove)])) {
    const holder = holderOf(successor, collection);
    const records = Array.isArray(holder[collection]) ? holder[collection] : [];
    const byId = new Map(records.map((record, index) => [record.id, index]));
    const removed = new Set(remove[collection] ?? []);
    for (const recordId of removed) if (!byId.has(recordId)) throw new Error(`Cannot remove ${collection} ${recordId}: the predecessor has no such record.`);
    let added = 0; let replaced = 0;
    const next = records.filter((record) => !removed.has(record.id));
    const position = new Map(next.map((record, index) => [record.id, index]));
    for (const record of upsert[collection] ?? []) {
      if (position.has(record.id)) { next[position.get(record.id)] = structuredClone(record); replaced += 1; }
      else { position.set(record.id, next.length); next.push(structuredClone(record)); added += 1; }
    }
    holder[collection] = next;
    summary[collection] = { added, replaced, removed: removed.size };
  }
  const number = previous.revision?.number;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('The predecessor has no valid revision number.');
  successor.revision = { number: number + 1, previous_model_hash: previousModelHash, reason: change.reason.trim(),
    provenance: change.provenance ?? ['life_model_revise change'] };
  return { successor, summary };
}
