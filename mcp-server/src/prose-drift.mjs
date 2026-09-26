// After prose changes, find the records that still quote text the prose no longer has: notes, plans, reviews
// and the bound model's Event descriptions. Found by the 2026-09-23 instruction test, where Events and writer's
// notes kept quoting sentences that later revisions had cut, and no tool said so. This is a mechanical text
// match: it finds quoted or copied sentences, not paraphrases, and says nothing about whether a record is wrong.

const MIN_WORDS = 4;
const normalize = (text) => String(text ?? '').replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/[–—]/gu, '-')
  .replace(/\s+/gu, ' ').trim().toLowerCase();
// Match the literal normalized phrase at word boundaries: "he" inside "she" is not a quotation.
const fragmentPattern = (fragment) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{M}\\p{N}_])`, 'u');

// Sentences, and quoted phrases inside them, long enough to be distinctive.
export function distinctiveFragments(text) {
  const plain = String(text ?? '').replace(/\s+/gu, ' ');
  const sentences = plain.split(/(?<=[.!?…])\s+|\n+/u).map((item) => item.replace(/^["'“‘(]+|["'”’)]+$/gu, '').trim());
  const quoted = [...plain.matchAll(/["“]([^"”]{8,400})["”]/gu)].map((match) => match[1].trim());
  // Trim quotation marks and end punctuation, so a quoted line matches however a note punctuates it.
  const trimmed = (item) => normalize(item).replace(/^[\s"'(\[]+|[\s"',.;:!?…)\]-]+$/gu, '');
  return [...new Set([...sentences, ...quoted].map(trimmed).filter((item) => item.split(/\s+/u).filter(Boolean).length >= MIN_WORDS))];
}

// Fragments of the old prose that are gone from the new prose.
export function removedFragments(beforeTexts, afterTexts) {
  const after = normalize(afterTexts.join(' \n '));
  return distinctiveFragments(beforeTexts.join('\n')).filter((fragment) => !fragmentPattern(fragment).test(after));
}

// Records whose text still contains a removed fragment. Records are {kind, id, text, holder?}.
export function recordsQuoting(records, fragments, { limit = 40 } = {}) {
  if (!fragments.length) return [];
  const patterns = fragments.map((fragment) => ({ fragment, pattern: fragmentPattern(fragment) }));
  const found = [];
  for (const record of records) {
    const text = normalize(record.text);
    if (!text) continue;
    const quotes = patterns.filter(({ pattern }) => pattern.test(text)).map(({ fragment }) => fragment);
    if (quotes.length) found.push({ kind: record.kind, id: record.id, ...(record.holder ? { holder: record.holder } : {}), quotes: quotes.slice(0, 3).map((quote) => quote.slice(0, 160)) });
    if (found.length >= limit) break;
  }
  return found;
}

// Records that describe the present story: plans, disclosure and context records, writer's notes and the
// model's Events. Reviews, drafts, candidates, assessments and revision notes quote old text on purpose, as
// history, and a record already superseded by another is history too.
const historical = /(^|[._])(review|draft|candidate|assessment|revision|audit|direction_draw|cut_question_definition|estimator_situation_text|understanding_process_root)$/u;
export function textRecords(view, model = null, { excludeNodeIds = new Set() } = {}) {
  const superseded = new Set((view.edges ?? []).filter((edge) => edge.relation === 'supersedes' && edge.target?.kind === 'node').map((edge) => edge.target.node_id));
  const records = [];
  for (const node of view.nodes ?? []) {
    if (node.role === 'story_passage' || node.role === 'document_root' || excludeNodeIds.has(node.id) || superseded.has(node.id)
      || typeof node.text !== 'string' || historical.test(String(node.node_type ?? ''))) continue;
    records.push({ kind: `node:${node.node_type}`, id: node.id, text: `${node.title ?? ''} ${node.text}`, holder: node.holder ?? null });
  }
  for (const event of model?.meaning_model?.events ?? []) records.push({ kind: 'event', id: event.id, text: `${event.boundary ?? ''} ${event.description ?? ''}` });
  return records;
}
