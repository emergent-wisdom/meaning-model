// A result must fit in one message (tool-result.mjs) and a write's receipt in what the service keeps of it. The summary
// or receipt of a large model can list every process, record or Event id, which is more than either holds. boundLists
// keeps each list's first items within a share of the room and counts the rest, so the result still fits, says what it
// left out, and is the same every time for the same value. A value that fits already comes back unchanged.
const size = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

export function boundLists(value, maxBytes, note) {
  if (size(value) <= maxBytes) return value;
  // A list an earlier bound already cut keeps the count it had in all.
  const earlier = value.listsCut ?? {};
  // Copy the objects on the way to each list, so the caller's value is left as it was. A short list of records, such as
  // a few open questions, is looked into and the lists inside its records are cut; a long list is cut as it is.
  const lists = [];
  const isRecord = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
  const walk = (holder, path) => {
    for (const [key, item] of Object.entries(holder)) {
      const at = [...path, key];
      if (Array.isArray(item) && item.length <= 64 && item.some(isRecord)) {
        const copy = holder[key] = item.slice();
        copy.forEach((entry, index) => { if (isRecord(entry)) walk(copy[index] = { ...entry }, [...at, String(index)]); });
      } else if (Array.isArray(item)) lists.push({ holder, key, path: at.join('.'), items: item, bytes: size(item) });
      else if (isRecord(item)) walk(holder[key] = { ...item }, at);
    }
  };
  const root = { ...value };
  walk(root, []);
  const listed = lists.reduce((sum, list) => sum + list.bytes, 0);
  // Room for what each cut list says about itself, and for the note.
  let room = maxBytes - (size(root) - listed) - lists.length * 160 - size(note) - 64;
  const listsCut = {};
  // Short lists stay whole; what they leave is shared among the long ones.
  let left = lists.length;
  for (const list of [...lists].sort((a, b) => a.bytes - b.bytes || (a.path < b.path ? -1 : 1))) {
    const share = Math.max(0, Math.floor(room / left));
    left -= 1;
    if (list.bytes <= share) { room -= list.bytes; continue; }
    let used = 2; let kept = 0;
    for (const item of list.items) {
      const bytes = size(item) + 1;
      if (used + bytes > share) break;
      used += bytes; kept += 1;
    }
    list.holder[list.key] = list.items.slice(0, kept);
    listsCut[list.path] = { shown: kept, of: earlier[list.path]?.of ?? list.items.length };
    room -= used;
  }
  return { ...root, listsCut: { ...earlier, ...listsCut }, listsCutNote: note };
}

// The last resort before a result is given up: every list longer than `keep`, a short list of records included, keeps
// its first `keep` entries and says how many it had, so a list of a few very long records can still be fitted.
export function cutLists(value, keep, note) {
  const earlier = value.listsCut ?? {};
  const listsCut = {};
  const walk = (item, path) => {
    if (Array.isArray(item)) {
      const kept = item.slice(0, keep).map((entry, index) => walk(entry, [...path, String(index)]));
      if (item.length > keep) listsCut[path.join('.')] = { shown: kept.length, of: earlier[path.join('.')]?.of ?? item.length };
      return kept;
    }
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'listsCut' && key !== 'listsCutNote').map(([key, entry]) => [key, walk(entry, [...path, key])]));
    return item;
  };
  return { ...walk(value, []), listsCut: { ...earlier, ...listsCut }, listsCutNote: note };
}
