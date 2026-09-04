import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { defaultEngine } from "./import-rust.mjs";
import {
  AUTHORING_SCOPE, DOCUMENT_ROOT_ID, UNDERSTANDING_ROOT_ID, buildNarrativeGraph,
} from "./rust-narrative.mjs";

const sourceIds = [
  ...Array.from({ length: 30 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`),
  "E03a", "E03b", "E03c", "E14a", "E14b", "E14c", "E20a",
].sort();
const events = sourceIds.map((sourceId) => ({ sourceId, id: `event.book.07r2.${sourceId}` }));
const modelDefinition = {
  schema: "life-sim-rust-model/v1", id: "book-07r2-narrative-test", time_unit: "hour",
  revision: { number: 0, reason: "In-memory native narrative validation fixture.", provenance: ["rust-narrative.test.mjs"] },
  processes: [{
    id: "test.coordinate", value_type: { kind: "scalar", bounds: { minimum: 0, maximum: 1 } },
    initial_value: { kind: "scalar", value: 0 }, provenance: ["test fixture"],
    support: ["fixture coordinate, not the Book model"], access_scopes: [],
  }],
  decomposition: [], dependencies: [], laws: [], initial_claims: [],
  meaning_model: {
    schema: "life-sim-rust-meaning-model/v1",
    events: events.map(({ id, sourceId }) => ({
      id, boundary: `Test anchor for ${sourceId}; not a historical assertion.`,
      process_ids: ["test.coordinate"], provenance: ["test fixture"],
    })),
  },
};
const build = (overrides = {}) => buildNarrativeGraph({
  modelHash: "test-model-hash", sourceDigest: "test-source-digest", events, modelDefinition, ...overrides,
});
const chapterId = (number) => `${DOCUMENT_ROOT_ID}.chapter.${String(number).padStart(2, "0")}`;
const understandingSource = readFileSync(new URL("UNDERSTANDING-NOTES.md", import.meta.url), "utf8");
const expectedNoteIds = [...understandingSource.matchAll(/^## (U\d{2})\s+[—–-]\s+.+$/gmu)]
  .map((match) => `${UNDERSTANDING_ROOT_ID}.${match[1]}`);
const chapterEvents = (graph, number) => graph.edges.filter((edge) =>
  edge.source.node_id === chapterId(number) && edge.relation === "expresses"
).map((edge) => edge.target.anchor_id.replace("event.book.07r2.", ""));

test("preserves twelve Roman chapters and every separate source-authored note", () => {
  const graph = build();
  assert.equal(graph.schema, "life-sim-rust-narrative-graph/v1");
  assert.deepEqual(graph.roots, [DOCUMENT_ROOT_ID, UNDERSTANDING_ROOT_ID]);
  assert.equal(graph.nodes.length, 14 + expectedNoteIds.length);
  assert.equal(graph.nodes.filter((node) => node.role === "story_passage").length, 12);
  const notes = graph.nodes.filter((node) => node.role === "externalized_reflection");
  assert.deepEqual(notes.map((note) => note.id), expectedNoteIds);
  assert.equal([
    graph.nodes.find((node) => node.id === UNDERSTANDING_ROOT_ID).text,
    ...notes.map((note) => note.text),
  ].join("\n\n"), understandingSource.trim());
  for (const note of notes) {
    assert.equal(note.epistemic_status, "authored");
    assert.equal(note.evidence_type, "creative_hypothesis");
    assert.equal(note.render, "exclude");
    assert.equal(note.training, "exclude");
    assert.deepEqual(note.access_scopes, [AUTHORING_SCOPE]);
    assert.equal(note.holder, "author.book.07r2");
    assert(note.provenance.some((entry) => entry.includes("not an original action log")));
    assert(note.provenance.some((entry) => entry.includes("UNDERSTANDING-NOTES.md;sha256:")));
  }
  assert(graph.nodes.filter((node) => node.role !== "externalized_reflection").every((node) => !("holder" in node)));
  const story = graph.nodes.filter((node) => node.render === "include").map((node) => node.text).join("\n\n");
  assert.equal(story, readFileSync(new URL("BOOK-DRAFT.md", import.meta.url), "utf8").trim());
  assert(graph.revision.provenance.some((entry) => entry.includes("STORY-ROUTE.md;sha256:")));
});

test("resolves route ranges, opened Events, and the E30/1900 ending", () => {
  const graph = build();
  assert.deepEqual(chapterEvents(graph, 1), ["E23", "E24", "E25"]);
  assert.deepEqual(chapterEvents(graph, 3), ["E02", "E03", "E03a", "E03b", "E03c"]);
  assert.deepEqual(chapterEvents(graph, 8), ["E12", "E13", "E14", "E14a", "E14b", "E14c", "E15"]);
  assert.deepEqual(chapterEvents(graph, 10), ["E20", "E20a", "E21", "E22"]);
  assert.deepEqual(chapterEvents(graph, 12), ["E28", "E29", "E30"]);
  assert.match(graph.nodes.find((node) => node.id === chapterId(12)).text, /In 1900, Henry opened the packet again\./u);
  const u13Passages = graph.edges.filter((edge) =>
    edge.relation === "shaped_by" && edge.target.node_id === `${UNDERSTANDING_ROOT_ID}.U13`
  ).map((edge) => edge.source.node_id);
  assert.deepEqual(u13Passages, [3, 6, 8, 9, 10].map(chapterId));
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, graph.edges.length);
});

test("rejects missing or mismatched native Event anchors", () => {
  assert.throws(() => build({ events: events.filter((event) => event.sourceId !== "E30") }), /Unresolved source Event E30/u);
  assert.throws(() => build({ events: [{ id: "absent", sourceId: "E01" }] }), /absent from the source model/u);
  assert.throws(() => build({ events: [...events, events[0]] }), /Duplicate Event/u);
});

const binary = defaultEngine;
const command = (operation, fields) => ({ schema: "life-sim-rust-command/v1", operation, ...fields });
const registerModel = command("register_model", { model: modelDefinition });
function execute(commands) {
  // Never inherit a user's persistence target: all validation runs are in-memory.
  const env = { ...process.env };
  delete env.LIFE_SIM_STATE_FILE;
  const run = spawnSync(binary, ["--ndjson"], {
    input: commands.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env,
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr);
  const responses = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(responses.length, commands.length);
  return responses.map((response) => {
    assert.equal(response.ok, true, JSON.stringify(response.error));
    return response.result;
  });
}

test("existing Rust runtime registers, scopes, queries, and exactly renders the graph", () => {
  const [registeredModel] = execute([registerModel]);
  const modelHash = registeredModel.summary.model_hash;
  assert.equal(typeof modelHash, "string");
  const graph = build({ modelHash });
  const registerGraph = command("register_narrative_graph", { narrative_graph: graph });
  const [, registeredGraph] = execute([registerModel, registerGraph]);
  const graphHash = registeredGraph.summary.graph_hash;
  assert.equal(typeof graphHash, "string");
  const query = (scopes) => command("query_narrative_graph", {
    narrative_graph_hash: graphHash,
    narrative_query: { mode: "full", include_content: true, access_scopes: scopes, expected_graph_hash: graphHash },
  });
  const [, , full, publicView, rendered] = execute([
    registerModel, registerGraph, query([AUTHORING_SCOPE]), query([]),
    command("render_narrative_graph", {
      narrative_graph_hash: graphHash,
      narrative_render: { root_ids: [DOCUMENT_ROOT_ID], access_scopes: [], expected_graph_hash: graphHash },
    }),
  ]);
  assert.equal(full.schema, "life-sim-rust-narrative-graph-view/v1");
  assert.equal(full.returned_node_count, 14 + expectedNoteIds.length);
  assert.equal(full.returned_edge_count, graph.edges.length);
  assert.equal(publicView.returned_node_count, 13);
  assert(publicView.nodes.every((node) => node.role !== "externalized_reflection"));
  assert.equal(rendered.schema, "life-sim-rust-narrative-render/v1");
  assert.equal(rendered.text, readFileSync(new URL("BOOK-DRAFT.md", import.meta.url), "utf8").trim());
  assert.equal(rendered.world_authority, "unchanged");
  assert.equal(rendered.canonical_artifact_source, "narrative_graph_nodes");
});
