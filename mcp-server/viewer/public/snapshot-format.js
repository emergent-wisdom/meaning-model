// A viewer snapshot is one JSON file, schema meaning-model-viewer/2. The optional compact form, meaning-model-viewer/3,
// holds exactly the same data in less space:
// - each dated series' points are written as columns (packRows), so a holder, a mode or an evidence type that every
//   point of a series shares is written once;
// - the graph's full records (inspection.graph) are in a file of their own, fetched when a view first needs them:
//   Graph, Structure, Space, search, or a selection's record.
// openSnapshot reads either form into the same object, so no view knows which it was given. A compact snapshot says
// what it changed in `compact`: the schema it was made from, the paths written as columns, and its parts, each with
// the sha256 of its text, which its file repeats, so a part from another snapshot is refused rather than shown.
export const COMPACT_SCHEMA = 'meaning-model-viewer/3';
const PART_SCHEMA = 'meaning-model-viewer-part/1';
const PACKED_PATHS = ['typedScalarSeries/*/points'];
// The parts a view waits for when it needs them. Any other part a snapshot names is fetched before the views open.
const LATER = new Set(['inspection/graph']);

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => Object.is(a, b) || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
// A JSON value copied, so that rows read from one written value never share an object.
const copy = (value) => (Array.isArray(value) ? value.map(copy) : plain(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value);

// ---- rows as columns --------------------------------------------------------------------------------------------------------
// Rows (plain objects) become one column per key, in the order keys first appear. Each row keeps its own keys in its
// own order (`shapes`, and `shape` for each row when they differ). A column is a constant `c`, nested rows `o`, strings
// after a shared prefix `p` and `v`, or the values `v`, each listed for the rows that have the key.
export function packRows(rows) {
  const shapes = [], shapeIndex = new Map(), shape = [];
  for (const row of rows) {
    const keys = Object.keys(row), key = keys.join('\u0000');
    if (!shapeIndex.has(key)) { shapeIndex.set(key, shapes.length); shapes.push(keys); }
    shape.push(shapeIndex.get(key));
  }
  const columns = {};
  for (const key of new Set(shapes.flat())) {
    const values = rows.filter((row) => Object.hasOwn(row, key)).map((row) => row[key]);
    if (values.every((value) => same(value, values[0]))) columns[key] = { c: values[0] };
    else if (values.every(plain)) columns[key] = { o: packRows(values) };
    else if (values.every((value) => typeof value === 'string')) {
      let prefix = values[0];
      for (const value of values) while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
      columns[key] = prefix.length >= 4 ? { p: prefix, v: values.map((value) => value.slice(prefix.length)) } : { v: values };
    } else columns[key] = { v: values };
  }
  return { n: rows.length, shapes, ...(shapes.length > 1 ? { shape } : {}), columns };
}

export function unpackRows(table) {
  const readers = {};
  for (const [key, column] of Object.entries(table.columns)) {
    if (Object.hasOwn(column, 'c')) { const value = column.c; readers[key] = plain(value) || Array.isArray(value) ? () => copy(value) : () => value; continue; }
    const values = column.o ? unpackRows(column.o) : column.v, prefix = column.p ?? null;
    let next = 0;
    readers[key] = prefix === null ? () => values[next++] : () => prefix + values[next++];
  }
  const rows = new Array(table.n);
  for (let i = 0; i < table.n; i += 1) {
    const row = {};
    for (const key of table.shapes[table.shape ? table.shape[i] : 0]) row[key] = readers[key]();
    rows[i] = row;
  }
  return rows;
}

// ---- paths ------------------------------------------------------------------------------------------------------------------
// A path names a value by its keys, separated by "/"; "*" stands for every item of an array.
function visit(value, steps, at) {
  if (!steps.length) return;
  const [step, ...rest] = steps;
  if (step === '*') { if (Array.isArray(value)) for (const item of value) visit(item, rest, at); return; }
  if (!plain(value) || !Object.hasOwn(value, step)) return;
  if (rest.length) visit(value[step], rest, at); else at(value, step);
}
const parentOf = (data, path) => { const steps = path.split('/'), last = steps.pop(); let value = data; for (const step of steps) value = plain(value) ? value[step] : undefined; return { value, last }; };

// ---- writing ----------------------------------------------------------------------------------------------------------------
// The compact form of a /2 snapshot, and the files of its parts. `name` names the part files beside the snapshot
// (<name>.<part>.json); `sha256(text)` returns the hex digest of a text. The snapshot itself is not changed.
export function packSnapshot(data, { name, sha256, defer = [...LATER] }) {
  if (data?.schema !== 'meaning-model-viewer/2') throw new Error(`Only a meaning-model-viewer/2 snapshot can be made compact (this one is ${data?.schema ?? 'unmarked'}).`);
  if (!/^[\w.-]+$/u.test(String(name ?? ''))) throw new Error('The snapshot needs a plain file name for its parts.');
  const snapshot = structuredClone(data), parts = {}, files = [];
  for (const path of defer) {
    const { value: holder, last } = parentOf(snapshot, path);
    if (!plain(holder) || !Object.hasOwn(holder, last)) continue;
    const text = JSON.stringify(holder[last]), digest = sha256(text), file = `${name}.${path.replaceAll('/', '-')}.json`;
    delete holder[last];
    parts[path] = { file, sha256: digest, bytes: text.length };
    files.push({ path, file, text: `{"schema":"${PART_SCHEMA}","path":${JSON.stringify(path)},"sha256":"${digest}","value":${text}}` });
  }
  const packed = [];
  for (const path of PACKED_PATHS) {
    let found = false;
    visit(snapshot, path.split('/'), (holder, key) => { if (Array.isArray(holder[key]) && holder[key].every(plain)) { holder[key] = packRows(holder[key]); found = true; } else throw new Error(`${path} holds something other than rows.`); });
    if (found) packed.push(path);
  }
  snapshot.schema = COMPACT_SCHEMA;
  snapshot.compact = { from: data.schema, packed, parts };
  return { snapshot, parts: files };
}

// ---- reading ----------------------------------------------------------------------------------------------------------------
const pending = new WeakMap();

// The snapshot as the views read it. A /2 snapshot is returned as it is. A compact one is unpacked in place, the parts
// the views read when they open are fetched now (relative to `url`, the snapshot's own address), and the rest when a
// view asks for them (whenPart).
export async function openSnapshot(data, { url = null, fetch = globalThis.fetch } = {}) {
  if (data?.schema !== COMPACT_SCHEMA) return data;
  const { from, packed = [], parts = {} } = data.compact ?? {};
  for (const path of packed) visit(data, path.split('/'), (holder, key) => { holder[key] = unpackRows(holder[key]); });
  data.schema = from; delete data.compact;
  const waiting = new Map();
  for (const [path, part] of Object.entries(parts)) {
    let loading = null;
    // The part's address carries its digest, so a cache can keep it and never hand back another snapshot's. A failed
    // fetch can be tried again; a file of another snapshot is refused.
    const address = new URL(part.file, url ?? globalThis.location?.href); address.searchParams.set('sha256', part.sha256);
    waiting.set(path, () => (loading ??= (async () => {
      const response = await fetch(address.href);
      if (!response.ok) throw new Error(`The snapshot's part ${path} is unavailable (${response.status}).`);
      const envelope = await response.json();
      if (envelope?.schema !== PART_SCHEMA || envelope.path !== path || envelope.sha256 !== part.sha256) throw new Error(`The file for the snapshot's part ${path} belongs to another snapshot.`);
      const { value: holder, last } = parentOf(data, path);
      if (plain(holder)) holder[last] = envelope.value;
      waiting.delete(path);
    })().catch((error) => { loading = null; throw error; })));
  }
  pending.set(data, waiting);
  await Promise.all([...waiting].filter(([path]) => !LATER.has(path)).map(([, load]) => load()));
  return data;
}

// Whether a part of the snapshot is still to be fetched, and a promise for it (resolved at once when it is in place).
export const partPending = (data, path) => Boolean(data && pending.get(data)?.has(path));
export const whenPart = (data, path) => (partPending(data, path) ? pending.get(data).get(path)() : Promise.resolve());
export const whenAllParts = (data) => Promise.all([...(pending.get(data)?.keys() ?? [])].map((path) => whenPart(data, path)));
