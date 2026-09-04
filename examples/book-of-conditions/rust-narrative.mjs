import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const NARRATIVE_GRAPH_ID = "narrative.book.07r2";
export const DOCUMENT_ROOT_ID = "document.book.07r2";
export const UNDERSTANDING_ROOT_ID = "understanding.book.07r2";
export const AUTHORING_SCOPE = "book.07r2.authoring";
const AUTHOR = "author.book.07r2";
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const SOURCE_DIRECTORY = "examples/book-of-conditions";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const nodeEndpoint = (nodeId) => ({ kind: "node", node_id: nodeId });
const anchorEndpoint = (kind, id) => ({ kind: "anchor", anchor_kind: kind, anchor_id: id });
const chapterId = (number) => `${DOCUMENT_ROOT_ID}.chapter.${String(number).padStart(2, "0")}`;

function readSource(name) {
  const text = readFileSync(new URL(name, import.meta.url), "utf8");
  return { name, text, provenance: `source:${SOURCE_DIRECTORY}/${name};sha256:${sha256(text)}` };
}

function sections(source, pattern) {
  const headings = [...source.text.matchAll(pattern)];
  return headings.map((heading, index) => ({
    key: heading[1],
    title: heading[2].trim(),
    text: source.text.slice(heading.index, headings[index + 1]?.index ?? source.text.length).trim(),
  }));
}

function declaredTargets(text, label) {
  const match = text.match(new RegExp(`(?:^|\\n)${label}:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*\\n|$)`));
  if (!match) throw new Error(`Missing ${label} declaration in ${text.split("\n")[0]}`);
  return match[1];
}

function eventReferences(text, eventsBySource) {
  const selected = new Set();
  for (const match of text.matchAll(/\b(E\d{2}[a-z]?)(?:\s*(?:--|–|—|-)\s*(E\d{2}[a-z]?))?\b/gu)) {
    const [, first, last] = match;
    if (last) {
      if (!/^E\d{2}$/u.test(first) || !/^E\d{2}$/u.test(last) || first > last) {
        throw new Error(`Unsupported Event range ${match[0]}`);
      }
      for (let number = Number(first.slice(1)); number <= Number(last.slice(1)); number += 1) {
        selected.add(`E${String(number).padStart(2, "0")}`);
      }
    } else selected.add(first);
  }
  for (const sourceId of selected) {
    if (!eventsBySource.has(sourceId)) throw new Error(`Unresolved source Event ${sourceId}`);
  }
  // WORLD-MODEL.md declares E03a-c, E14a-c, and E20a as openings of
  // their numbered parents. These associations are retrospective, not claims
  // that the earlier route explicitly listed the later-opened child IDs.
  return [...eventsBySource.keys()].filter((sourceId) =>
    selected.has(sourceId) || (/[a-z]$/u.test(sourceId) && selected.has(sourceId.slice(0, -1)))
  ).sort();
}

function passageReferences(targets) {
  const text = targets.match(/\bpassages?\s+([^;\n.]+)/iu)?.[1];
  if (!text) return [];
  const selected = new Set();
  for (const match of text.matchAll(/\b([IVX]+)(?:\s*(?:--|–|—|-)\s*([IVX]+))?\b/gu)) {
    const start = ROMAN.indexOf(match[1]);
    const end = match[2] ? ROMAN.indexOf(match[2]) : start;
    if (start < 0 || end < start) throw new Error(`Unsupported passage reference ${match[0]}`);
    for (let index = start; index <= end; index += 1) selected.add(index + 1);
  }
  return [...selected].sort((a, b) => a - b);
}

/**
 * Retrospectively bind the existing manuscript and authored understanding notes
 * to one exact, already registered Rust model. This does not reconstruct the
 * original authoring transactions or establish that prose was generated from
 * that native model. It creates only existing native narrative record types.
 */
export function buildNarrativeGraph({ modelHash, sourceDigest, events, modelDefinition }) {
  if (typeof modelHash !== "string" || !modelHash.trim()) throw new Error("modelHash is required");
  if (typeof sourceDigest !== "string" || !sourceDigest.trim()) throw new Error("sourceDigest is required");
  if (!Array.isArray(events) || !Array.isArray(modelDefinition?.meaning_model?.events)) {
    throw new Error("events and modelDefinition.meaning_model.events are required");
  }
  const nativeIds = new Set(modelDefinition.meaning_model.events.map((event) => event.id));
  const eventsBySource = new Map();
  const importedIds = new Set();
  for (const event of events) {
    if (!/^E\d{2}[a-z]?$/u.test(event.sourceId)) throw new Error(`Invalid source Event ${event.sourceId}`);
    if (eventsBySource.has(event.sourceId) || importedIds.has(event.id)) throw new Error(`Duplicate Event ${event.sourceId}`);
    if (!nativeIds.has(event.id)) throw new Error(`Event ${event.sourceId} is absent from the source model: ${event.id}`);
    eventsBySource.set(event.sourceId, event.id);
    importedIds.add(event.id);
  }
  const book = readSource("BOOK-DRAFT.md");
  const route = readSource("STORY-ROUTE.md");
  const understanding = readSource("UNDERSTANDING-NOTES.md");
  const chapters = sections(book, /^## ([IVX]+)\. (.+)$/gmu);
  // Limit the route to its twelve numbered sections; the subsequent route
  // revision is provenance commentary, not part of chapter XII's event list.
  const routeChapters = sections(route, /^## (\d+)\. (.+)$/gmu);
  const notes = sections(understanding, /^## (U\d{2})\s+[—–-]\s+(.+)$/gmu);
  if (chapters.length !== 12 || chapters.some((chapter, index) => chapter.key !== ROMAN[index])) {
    throw new Error("BOOK-DRAFT.md must contain chapters I through XII in order");
  }
  if (routeChapters.length !== 12 || routeChapters.some((chapter, index) => Number(chapter.key) !== index + 1)) {
    throw new Error("STORY-ROUTE.md must contain chapters 1 through 12 in order");
  }
  if (!notes.length || notes.some((note, index) => note.key !== `U${String(index + 1).padStart(2, "0")}`)) {
    throw new Error("UNDERSTANDING-NOTES.md must contain contiguous U notes in source order");
  }
  const provenance = [
    "retrospective-import:07r2; source associations are imported after authoring, not an original action log or chronology proof",
    "legacy-native-holder:externalized reflections use authoring-context host metadata only, not a holder field or claim about world Events",
    `source-bundle-digest:${sourceDigest}`,
    `source-model-hash:${modelHash}`,
  ];
  const makeNode = (source, data) => ({
    epistemic_status: "authored",
    evidence_type: "creative_hypothesis",
    authority: { source: AUTHOR, weight: 1 },
    render: "exclude",
    training: "exclude",
    provenance: [...provenance, source.provenance, `imported-section-sha256:${sha256(data.text)}`],
    ...data,
  });
  const bookPreamble = book.text.slice(0, book.text.indexOf("## I.")).trim();
  if (bookPreamble !== "# The Book of Conditions") throw new Error("Unexpected manuscript preamble");
  const nodes = [
    makeNode(book, {
      id: DOCUMENT_ROOT_ID, node_type: "book_document", role: "document_root",
      title: "The Book of Conditions", text: bookPreamble,
      epistemic_status: "authored_fiction", evidence_type: "fictional_canon", render: "include",
    }),
    makeNode(understanding, {
      id: UNDERSTANDING_ROOT_ID, node_type: "understanding_root", role: "metadata",
      title: "07r2 authored construction understanding",
      text: understanding.text.slice(0, understanding.text.indexOf("## U01")).trim(),
      access_scopes: [AUTHORING_SCOPE],
    }),
  ];
  const edges = [];
  function addEdge(sourceId, target, relation, { order, explanation, scopes = [], source } = {}) {
    const targetId = target.node_id ?? target.anchor_id;
    edges.push({
      id: `${sourceId}.${relation}.${targetId}`,
      source: nodeEndpoint(sourceId), target,
      family: ["contains", "next"].includes(relation) ? "structural" : relation === "shaped_by" ? "semantic" : "grounding",
      relation, ...(order === undefined ? {} : { order }),
      ...(explanation ? { explanation } : {}), access_scopes: scopes,
      provenance: [...provenance, ...(source ? [source.provenance] : [])],
    });
  }
  addEdge(DOCUMENT_ROOT_ID, anchorEndpoint("model", modelHash), "expresses", { source: book });
  addEdge(UNDERSTANDING_ROOT_ID, anchorEndpoint("model", modelHash), "about", {
    source: understanding, scopes: [AUTHORING_SCOPE],
    explanation: "Retrospective association with the imported model; source note order is not verified original construction chronology.",
  });
  for (const [index, chapter] of chapters.entries()) {
    const id = chapterId(index + 1);
    nodes.push(makeNode(book, {
      id, node_type: "chapter", role: "story_passage", title: `${chapter.key}. ${chapter.title}`,
      text: chapter.text, epistemic_status: "authored_fiction", evidence_type: "fictional_canon", render: "include",
    }));
    addEdge(DOCUMENT_ROOT_ID, nodeEndpoint(id), "contains", { order: index, source: book });
    if (index) addEdge(chapterId(index), nodeEndpoint(id), "next", { source: book, explanation: "Manuscript discourse order, not Event chronology." });
    const targets = declaredTargets(routeChapters[index].text, "Events").split(/\.\s*Focal route/u)[0];
    const sourceIds = eventReferences(targets, eventsBySource);
    if (!sourceIds.length) throw new Error(`Chapter ${chapter.key} has no resolved route Events`);
    for (const sourceId of sourceIds) {
      addEdge(id, anchorEndpoint("event", eventsBySource.get(sourceId)), "expresses", {
        source: route,
        explanation: `Retrospective source route association with ${sourceId}${/[a-z]$/u.test(sourceId) ? " through its explicitly opened parent Event" : ""}; does not certify every sentence or historical fact.`,
      });
    }
  }
  for (const [index, note] of notes.entries()) {
    const id = `${UNDERSTANDING_ROOT_ID}.${note.key}`;
    nodes.push(makeNode(understanding, {
      id, node_type: "construction_rationale", role: "externalized_reflection",
      title: `${note.key} — ${note.title}`, text: note.text,
      // Required legacy narrative metadata, not a holder field on world Events.
      holder: AUTHOR, access_scopes: [AUTHORING_SCOPE],
    }));
    addEdge(UNDERSTANDING_ROOT_ID, nodeEndpoint(id), "contains", { order: index, source: understanding, scopes: [AUTHORING_SCOPE] });
    if (index) addEdge(`${UNDERSTANDING_ROOT_ID}.${notes[index - 1].key}`, nodeEndpoint(id), "next", {
      source: understanding, scopes: [AUTHORING_SCOPE], explanation: "Source note order only; not an original action log.",
    });
    const targets = declaredTargets(note.text, "Targets");
    const sourceIds = eventReferences(targets, eventsBySource);
    for (const sourceId of sourceIds) addEdge(id, anchorEndpoint("event", eventsBySource.get(sourceId)), "about", {
      source: understanding, scopes: [AUTHORING_SCOPE], explanation: `Authored rationale addressing ${sourceId}; not a world-state assertion.`,
    });
    if (!sourceIds.length) addEdge(id, anchorEndpoint("model", modelHash), "about", {
      source: understanding, scopes: [AUTHORING_SCOPE], explanation: "The note declares a construction-wide or profile-level target rather than a particular Event.",
    });
    for (const passage of passageReferences(targets)) addEdge(chapterId(passage), nodeEndpoint(id), "shaped_by", {
      source: understanding, scopes: [AUTHORING_SCOPE], explanation: "This passage is explicitly named in the authored note's Targets; association imported retrospectively.",
    });
  }
  return {
    schema: "life-sim-rust-narrative-graph/v1", id: NARRATIVE_GRAPH_ID,
    revision: {
      number: 0, reason: "Retrospective native import of the completed 07r2 manuscript, route associations, and authored understanding notes.",
      provenance: [...provenance, book.provenance, route.provenance, understanding.provenance],
    },
    source: { kind: "model", model_hash: modelHash },
    roots: [DOCUMENT_ROOT_ID, UNDERSTANDING_ROOT_ID], nodes, edges,
  };
}
