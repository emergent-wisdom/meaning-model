// A model revision written as its changes from the revision it was made from, in the engine's model delta format
// (life-sim-rust-model-delta/v1). A delta lists each place where a revision differs from its base: a value set there,
// a key removed, or, in a collection whose records each carry a unique string id, the records added or changed (each
// whole) and the ids removed. computeModelDelta proves that applying the delta rebuilds the revision exactly before it
// returns one, so a delta that would rebuild anything else is never written.
import { isDeepStrictEqual } from 'node:util';

export const MODEL_DELTA_SCHEMA = 'life-sim-rust-model-delta/v1';

// Ids compare by code point, as the engine compares them.
const byCodePoint = (a, b) => {
  const left = [...a], right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (difference) return difference;
  }
  return left.length - right.length;
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);

export function computeModelDelta(base, target) {
  const changes = [];
  diff(base, target, [], changes);
  const delta = { schema: MODEL_DELTA_SCHEMA, changes };
  try {
    return isDeepStrictEqual(applyModelDelta(base, delta), target) ? delta : null;
  } catch {
    return null;
  }
}

// Returns the rebuilt revision; the base is not changed. A delta that does not fit its base is an error, never a guess.
export function applyModelDelta(base, delta) {
  if (delta?.schema !== MODEL_DELTA_SCHEMA) throw new Error(`Unsupported model delta schema ${delta?.schema}.`);
  let value = clone(base);
  for (const change of delta.changes ?? []) {
    const path = change.path ?? [];
    if (change.op === 'set') {
      if (!path.length) { value = clone(change.value); continue; }
      objectAt(value, path.slice(0, -1))[path.at(-1)] = clone(change.value);
    } else if (change.op === 'unset') {
      if (!path.length) throw new Error('A model delta cannot remove the whole model.');
      const parent = objectAt(value, path.slice(0, -1));
      if (!Object.hasOwn(parent, path.at(-1))) throw new Error(`A model delta removes ${path.join('.')}, which its base does not have.`);
      delete parent[path.at(-1)];
    } else if (change.op === 'records') {
      const records = path.length ? objectAt(value, path.slice(0, -1))[path.at(-1)] : value;
      if (!Array.isArray(records)) throw new Error(`A model delta changes records at ${path.join('.')} where its base has none.`);
      const rebuilt = applyRecords(records, change.upsert ?? [], change.remove ?? [], change.sorted ?? false);
      if (path.length) objectAt(value, path.slice(0, -1))[path.at(-1)] = rebuilt; else value = rebuilt;
    } else {
      throw new Error(`Unknown model delta change ${change.op}.`);
    }
  }
  return value;
}

function diff(base, target, path, out) {
  if (isDeepStrictEqual(base, target)) return;
  if (isObject(base) && isObject(target)) {
    for (const key of Object.keys(base)) if (!Object.hasOwn(target, key)) out.push({ op: 'unset', path: [...path, key] });
    for (const [key, value] of Object.entries(target)) {
      if (Object.hasOwn(base, key)) diff(base[key], value, [...path, key], out);
      else out.push({ op: 'set', path: [...path, key], value: clone(value) });
    }
    return;
  }
  if (Array.isArray(base) && Array.isArray(target)) {
    const records = recordsChange(base, target);
    if (records) { out.push({ op: 'records', path: [...path], ...records }); return; }
  }
  out.push({ op: 'set', path: [...path], value: clone(target) });
}

function recordIds(records) {
  const seen = new Set();
  for (const record of records) {
    const id = isObject(record) && typeof record.id === 'string' ? record.id : null;
    if (id === null || seen.has(id)) return null;
    seen.add(id);
  }
  return [...seen];
}

function recordsChange(base, target) {
  const before = recordIds(base), after = recordIds(target);
  if (!before || !after) return null;
  const old = new Map(base.map((record) => [record.id, record]));
  const kept = new Set(after);
  const upsert = target.filter((record) => !old.has(record.id) || !isDeepStrictEqual(old.get(record.id), record)).map(clone);
  const remove = before.filter((id) => !kept.has(id));
  const sorted = after.every((id, i) => i === 0 || byCodePoint(after[i - 1], id) < 0);
  try {
    if (!isDeepStrictEqual(applyRecords(base, upsert, remove, sorted), target)) return null;
  } catch {
    return null;
  }
  const change = {};
  if (upsert.length) change.upsert = upsert;
  if (remove.length) change.remove = remove;
  change.sorted = sorted;
  return change;
}

function applyRecords(records, upsert, remove, sorted) {
  const removed = new Set(remove), replacements = new Map();
  for (const record of upsert) {
    if (typeof record?.id !== 'string') throw new Error('A model delta adds a record without an id.');
    if (removed.has(record.id) || replacements.has(record.id)) throw new Error(`A model delta changes record ${record.id} twice.`);
    replacements.set(record.id, record);
  }
  const found = new Set(), rebuilt = [];
  for (const record of records) {
    if (typeof record?.id !== 'string') throw new Error('A model delta changes a collection without record ids.');
    if (found.has(record.id)) throw new Error(`A model delta's base repeats record ${record.id}.`);
    found.add(record.id);
    if (removed.has(record.id)) continue;
    if (replacements.has(record.id)) { rebuilt.push(clone(replacements.get(record.id))); replacements.delete(record.id); } else rebuilt.push(record);
  }
  for (const id of removed) if (!found.has(id)) throw new Error(`A model delta removes record ${id}, which its base does not have.`);
  // What is left was added; it follows in the order given.
  for (const record of upsert) if (replacements.has(record.id)) { rebuilt.push(clone(record)); replacements.delete(record.id); }
  if (sorted) rebuilt.sort((a, b) => byCodePoint(a.id, b.id));
  return rebuilt;
}

function objectAt(value, path) {
  let current = value;
  for (const key of path) {
    current = isObject(current) && Object.hasOwn(current, key) ? current[key] : undefined;
    if (current === undefined) throw new Error(`A model delta reaches ${path.join('.')}, which its base does not have.`);
  }
  if (!isObject(current)) throw new Error(`A model delta expects an object at ${path.join('.')}.`);
  return current;
}
