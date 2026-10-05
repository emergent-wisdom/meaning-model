import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import * as z from 'zod/v4';
import { absoluteHistoryPath } from './construction-files.mjs';
import { MAX_DOCUMENT_BYTES, readDocumentText, segmentDocumentText } from './document-segmentation.mjs';

const id = z.string().trim().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });

export const documentImportSchema = z.object({
  requestId: id,
  documentId: id.describe('A fresh stable ID for this imported source document.'),
  title: z.string().trim().min(1).max(2_000),
  text: z.string().min(1).max(MAX_DOCUMENT_BYTES).optional(),
  sourcePath: absoluteHistoryPath.optional().describe('Explicit absolute path to a regular UTF-8 plain-text or Markdown file on the MCP computer. At most 4 MiB. No network fetch or PDF/EPUB conversion.'),
  sourceLabel: z.string().trim().min(1).max(2_000).optional().describe('Public-safe source name or citation. Defaults to the filename or title; the absolute local path is not stored in the graph.'),
  modelHash: hash.optional().describe('Bind a new document graph to this stored model, or provide graphHash and parentNodeId to add to an existing graph.'),
  graphHash: hash.optional(),
  parentNodeId: id.optional().describe('Visible container in the exact existing graph. Required with graphHash.'),
  accessScopes: z.array(id).max(64).default([]),
  recordedBy: id.default('calling_agent'),
  targetBytes: z.number().int().min(256).max(65_536).default(4_000).describe('Approximate segment size in UTF-8 bytes. Prefer paragraph boundaries; split long passages at words, then code points.'),
}).strict().refine((input) => (input.text !== undefined) !== (input.sourcePath !== undefined), 'Supply exactly one of text or sourcePath.')
  .refine((input) => Boolean(input.modelHash) !== Boolean(input.graphHash), 'Supply exactly one of modelHash or graphHash.')
  .refine((input) => Boolean(input.graphHash) === Boolean(input.parentNodeId), 'graphHash and parentNodeId must be supplied together.');

export async function importDocument(service, raw) {
  const input = documentImportSchema.parse(raw);
  const text = input.sourcePath ? (await readDocumentText(input.sourcePath)).text : input.text;
  const segments = segmentDocumentText(text, { targetBytes: input.targetBytes });
  const sourceSha256 = sha256(text);
  const sourceBytes = Buffer.byteLength(text, 'utf8');
  const sourceLabel = input.sourceLabel ?? (input.sourcePath ? basename(input.sourcePath) : input.title);
  const scopes = [...new Set(input.accessScopes)].sort();
  let documentScopes = scopes;
  if (input.graphHash) {
    const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash,
      mode: 'neighborhood', centerNodeId: input.parentNodeId, depth: 0, includeContent: false, accessScopes: scopes });
    const parent = view.nodes.find((node) => node.id === input.parentNodeId);
    if (!parent) throw new Error('The document parent is unknown or not visible in this graph.');
    // Scopes are alternative audiences. An imported child must not broaden a
    // restricted parent's audience simply because the caller can read others.
    if (parent.access_scopes?.length) {
      documentScopes = scopes.filter((scope) => parent.access_scopes.includes(scope));
      if (!documentScopes.length) throw new Error('The document needs an access scope shared with its parent.');
    }
  }
  // Graph revision metadata is visible independently of node/edge scopes.
  // Keep source identities and caller attribution on the scoped records only.
  const revisionProvenance = ['Meaning Model automatic source-document segmentation v1'];
  const provenance = [...revisionProvenance,
    `source:${sourceLabel}`, `recorded-by:${input.recordedBy}`, `source-sha256:${sourceSha256}`];
  const common = { epistemic_status: 'imported_source_text', evidence_type: 'report',
    authority: { source: input.recordedBy, weight: 1 }, uncertainty: { kind: 'unknown' },
    access_scopes: documentScopes, render: 'exclude', training: 'exclude', provenance };
  const segmentId = (index) => `${input.documentId}.segment.${String(index + 1).padStart(6, '0')}`;
  const nodes = [{ ...common, id: input.documentId, node_type: 'document.source', role: 'metadata', title: input.title,
    text: JSON.stringify({ schema: 'meaning-model-source-document/v1', sourceLabel, sourceSha256, sourceBytes,
      encoding: 'utf-8', segmentCount: segments.length, targetBytes: input.targetBytes,
      segmentation: 'paragraphs_then_words_v1', segmentIdPrefix: `${input.documentId}.segment.`,
      reconstruction: 'Concatenate original segment texts in contains order with no separator. Source positions describe this import, not later edits.' }) },
  ...segments.map((segment, index) => ({ ...common, id: segmentId(index), node_type: 'document.segment', role: 'metadata',
    title: `${input.title} — ${index + 1}`, text: segment.text,
    provenance: [...provenance, 'meaning-model:document-segment/v1:' + JSON.stringify({ documentId: input.documentId,
      sourceSha256, originalSegmentId: segmentId(index), positions: 'original_import_utf8_bytes',
      startByte: segment.startByte, endByte: segment.endByte, textSha256: sha256(segment.text) })] }))];
  const contains = (from, to, order, edgeId) => ({ id: edgeId, source: endpoint(from), target: endpoint(to),
    family: 'structural', relation: 'contains', order, access_scopes: documentScopes, provenance });
  const edges = segments.map((_, index) => contains(input.documentId, segmentId(index), index,
    `${input.documentId}.contains.${String(index + 1).padStart(6, '0')}`));
  const reason = 'Import and automatically segment source document';
  let stored;
  if (input.graphHash) {
    // A semantic attachment avoids changing or guessing the existing parent's
    // child order; ordered contains edges belong to the new document alone.
    edges.push({ id: `${input.documentId}.source-for`, source: endpoint(input.documentId), target: endpoint(input.parentNodeId),
      family: 'semantic', relation: 'source_for', access_scopes: documentScopes, provenance });
    stored = await service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash,
      narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash,
        reason, provenance: revisionProvenance, add_roots: [input.documentId], add_nodes: nodes, add_edges: edges } });
  } else {
    stored = await service.registerNarrativeGraph({ requestId: input.requestId, narrativeGraph: {
      schema: 'life-sim-rust-narrative-graph/v1', id: `document.${sha256(input.documentId)}`,
      revision: { number: 0, reason, provenance: revisionProvenance }, source: { kind: 'model', model_hash: input.modelHash },
      roots: [input.documentId], nodes, edges } });
  }
  // A distributor's name ties its license to the text: Project Gutenberg's applies while its name is attached.
  const distributor = /project\s+gutenberg/iu.test(`${text}\n${sourceLabel}\n${input.title}`);
  return { ...stored, schema: 'meaning-model-document-import/v1', documentId: input.documentId,
    sourceLabel, sourceSha256, sourceBytes, segmentCount: segments.length,
    ...(distributor ? { notices: ['This text or its label names Project Gutenberg, whose license applies while its name is attached. To use the public-domain text freely, import it again without their header, footer and name, describing the source by author, title and first publication; otherwise keep their license with the text wherever it is shown.'] } : {}),
    firstSegmentId: segmentId(0), lastSegmentId: segmentId(segments.length - 1),
    accessScopes: documentScopes, worldMutation: false,
    read: { tool: 'life_narrative_query', arguments: { graphHash: stored.graphHash, mode: 'neighborhood',
      centerNodeId: segmentId(0), depth: 0, includeContent: true, accessScopes: documentScopes } },
    nextStep: 'Read source segments with life_narrative_query and link interpretations or modeled processes to their IDs. Source text is excluded from manuscript rendering and training; it is not accepted world state. Preserve this import graphHash for exact reconstruction. Existing narrative edits can split segments further at blank-line boundaries while retaining their original parent text.' };
}

export function registerDocumentImportTools(server, service, { toolResult }) {
  server.registerTool('life_document_import', {
    description: 'Load a whole UTF-8 book or document and automatically split it into ordered, typed source nodes in one atomic graph write. Supply text or an explicit local sourcePath, a documentId and title, and either modelHash or graphHash plus parentNodeId. Paragraph grouping and long-passage splitting are deterministic and preserve every byte; no AI or estimator is used. The document.source root and document.segment nodes carry source hashes and byte positions, keep access scopes, and are excluded from manuscript rendering and training. Imported words are source material, not accepted facts or world Events. Read them with life_narrative_query; ordinary graph links and immutable narrative edits remain available.',
    inputSchema: documentImportSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await importDocument(service, input)));
}
