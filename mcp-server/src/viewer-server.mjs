// A viewer belongs to this MCP process and opens selected immutable revisions
// and the author/reader lives explicitly declared by their current story records.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { exportConstructionHistory } from './construction-record.mjs';
import { buildViewerData } from './viewer-data.mjs';
import { readWorldState } from './storytelling-world.mjs';
import { followedGraphHead } from './viewer-live.mjs';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const selectionFields = {
  graphHash: hash.optional().describe('The exact model-bound graph revision, including its prose and construction history.'),
  modelHash: hash.optional().describe('An exact model revision to inspect without a narrative graph.'),
  accessScopes: z.array(z.string().trim().min(1).max(256)).max(64).default([]),
  title: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(['snapshot', 'live']).default('snapshot').describe('Use live while authoring: follow saved descendants of graphHash without reopening. Pauses at a fork or insufficient scopes. snapshot keeps the exact revision; modelHash-only views require snapshot.'),
};
const oneRevision = (input) => Boolean(input.graphHash) !== Boolean(input.modelHash);
const revisionMessage = { message: 'Supply exactly one graphHash or modelHash.' };
const liveGraph = (input) => input.mode !== 'live' || Boolean(input.graphHash);
const liveMessage = { message: 'Live mode requires graphHash; modelHash alone is an exact snapshot.' };
const additionalModelSchema = z.object(selectionFields).strict().refine(oneRevision, revisionMessage).refine(liveGraph, liveMessage);
export const modelViewerSchema = z.object({
  ...selectionFields,
  additionalModels: z.array(additionalModelSchema).max(15).optional().describe('Other exact model or graph revisions to offer in this viewer’s model chooser. Every entry needs its own complete accessScopes. Current declared author/reader life models are added automatically using the declaring graph’s scopes. The complete group is limited to 16 views.'),
}).strict().refine(oneRevision, {
  message: 'Supply exactly one graphHash or modelHash.',
}).refine(liveGraph, liveMessage);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const defaultPublicDirectory = fileURLToPath(new URL('../viewer/public/', import.meta.url));
const maximumSnapshots = 16;
const maximumSnapshotBytes = 32 * 1024 * 1024;

// inspectModel and construction history contain administrative model definitions. This is a
// complete author view, not a scoped projection: refuse incomplete scope access before serving it.
function requireModelScopes(value, allowed) {
  if (Array.isArray(value)) { for (const item of value) requireModelScopes(item, allowed); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'access_scopes' && Array.isArray(item)) {
      if (item.some((scope) => !allowed.has(scope))) throw new Error('The complete model viewer requires access to every scoped record. The supplied accessScopes are insufficient.');
    } else requireModelScopes(item, allowed);
  }
}

// The builder retains the complete, authorized head graph in inspection. Use
// the same current-stage selection as the story tools, never hashes found in
// prose, arbitrary JSON, model references or earlier revisions.
function declaredLives(data, accessScopes) {
  const graph = data.inspection?.graph;
  if (!graph) return [];
  const nodes = (graph.nodes ?? []).filter((node) => {
    if (node.node_type !== 'storytelling.world' || typeof node.subject !== 'string') return false;
    let payload; try { payload = JSON.parse(node.text); } catch { return false; }
    return payload?.schema === 'meaning-model-story-author-record/v1' && payload.kind === 'world'
      && payload.data?.schema === 'meaning-model-story-world/v1' && payload.data.stage === 'author_reader';
  });
  const result = [], view = { nodes, edges: graph.edges ?? [] };
  for (const storyRootId of new Set(nodes.map((node) => node.subject))) {
    const current = readWorldState(view, storyRootId).authorReader;
    if (!current) continue;
    for (const role of ['author', 'reader']) {
      const life = current.data[role]; if (role === 'reader' && life == null) continue;
      if (!hash.safeParse(life?.lifeModelHash).success) throw new Error('A current author/reader declaration has an invalid life model reference. Repair that declaration before opening its viewer.');
      const name = typeof life.name === 'string' && life.name.trim() ? life.name.trim() : role;
      result.push({ modelHash: life.lifeModelHash, accessScopes: [...accessScopes], title: `${role === 'author' ? 'Author' : 'Reader'} life · ${name}`.slice(0, 200) });
    }
  }
  return result;
}

export function createModelViewer(service, { buildData = buildViewerData, publicDirectory = defaultPublicDirectory } = {}) {
  const root = resolve(publicDirectory);
  const snapshots = new Map();
  let httpServer = null;
  let starting = null;
  let origin = null;
  let closed = false;

  // One refresh per token at a time; only replace the authorized snapshot after
  // all scope checks and serialization succeed. Never broaden its original grant.
  async function liveStatus(snapshot) {
    const live = snapshot.live;
    if (!live) return { mode: 'snapshot', graphHash: snapshot.graphHash, modelHash: snapshot.modelHash };
    if (!live.pending && Date.now() - live.checkedAt >= 1_000) {
      live.pending = (async () => {
        try {
          const listing = await service.listNarrativeRevisions({ graphId: live.graphId });
          const next = followedGraphHead(listing, live.anchor);
          if (next.status !== 'following') { live.status = next.status; return; }
          if (next.graphHash !== snapshot.graphHash) {
            const prepared = await prepareSnapshot({ ...live.selection, graphHash: next.graphHash });
            if (prepared.graphId !== live.graphId) throw new Error('The graph identity changed.');
            Object.assign(snapshot, prepared);
          }
          live.status = 'following';
        } catch { live.status = 'unavailable'; }
        finally { live.checkedAt = Date.now(); live.pending = null; }
      })();
    }
    await live.pending;
    return { mode: 'live', status: live.status, graphHash: snapshot.graphHash, modelHash: snapshot.modelHash,
      pollIntervalMs: 2_000, message: live.status === 'branched'
        ? 'Live paused: this story has branched. Ask the assistant to open the branch you want.'
        : live.status === 'unavailable'
          ? 'Live paused: the next revision is unavailable with this link’s original access. Ask the assistant to check its scopes and stored history.'
          : 'Live · saved revisions' };
  }

  function groupViews(token) {
    const snapshot = snapshots.get(token);
    return snapshot.group.filter((member) => snapshots.has(member)).map((member) => {
      const item = snapshots.get(member);
      return { url: `${origin}/${member}/`, title: item.title, modelHash: item.modelHash,
        graphHash: item.graphHash, selected: member === token };
    });
  }

  async function serve(request, response) {
    const send = (status, body = '', type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!origin || request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) return send(403, 'Forbidden');
    if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Read-only viewer');
    let path;
    try { path = decodeURIComponent(new URL(request.url, origin).pathname); } catch { return send(400, 'Invalid path'); }
    const [, token, ...segments] = path.split('/');
    const snapshot = snapshots.get(token);
    if (!snapshot) return send(404, 'This viewer link is unavailable. Ask the assistant to open the model again.');
    const relative = segments.join('/') || 'index.html';
    if (relative === 'data/index.json') return send(200, snapshot.index, 'application/json; charset=utf-8');
    if (relative === 'data/model.json') return send(200, snapshot.body, 'application/json; charset=utf-8');
    if (relative === 'data/views.json') return send(200, JSON.stringify(groupViews(token)), 'application/json; charset=utf-8');
    if (relative === 'data/live.json') return send(200, JSON.stringify(await liveStatus(snapshot)), 'application/json; charset=utf-8');
    const file = resolve(root, relative);
    const type = types[extname(file)];
    if (!file.startsWith(`${root}${sep}`) || !type) return send(404, 'Not found');
    try { return send(200, await readFile(file), type); } catch { return send(404, 'Not found'); }
  }

  async function start() {
    if (closed) throw new Error('The viewer is closed.');
    if (!starting) {
      httpServer = createServer((request, response) => {
        serve(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end('Unable to serve the viewer.'); });
      });
      starting = new Promise((done, fail) => {
        httpServer.once('error', fail);
        httpServer.listen(0, '127.0.0.1', () => {
          httpServer.removeListener('error', fail);
          origin = `http://127.0.0.1:${httpServer.address().port}`;
          httpServer.unref();
          done();
        });
      });
    }
    await starting;
    if (closed) throw new Error('The viewer is closed.');
  }

  async function prepareSnapshot(input) {
    let history; let rendered = null;
    if (input.graphHash) {
      history = await exportConstructionHistory(service, { graphHash: input.graphHash, accessScopes: input.accessScopes });
      requireModelScopes(history.models, new Set(input.accessScopes));
      rendered = await service.renderNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, accessScopes: input.accessScopes });
    } else {
      const inspected = await service.inspectModel({ modelHash: input.modelHash, includeDefinition: true });
      if (!inspected.model) throw new Error('The model revision is unavailable.');
      requireModelScopes(inspected.model, new Set(input.accessScopes));
      history = { schema: 'meaning-model-construction-history/v1', headGraphHash: null,
        models: [{ modelHash: input.modelHash, definition: inspected.model }], revisions: [] };
    }
    const data = await buildData({ history, rendered, calls: [], name: 'model', title: input.title });
    const body = JSON.stringify(input.mode === 'live' ? { ...data, viewerLive: { mode: 'live', graphHash: input.graphHash } } : data);
    if (Buffer.byteLength(body) > maximumSnapshotBytes) throw new Error('This model is too large for the local viewer snapshot (32 MiB maximum).');
    const index = JSON.stringify({ default: 'model', runs: [{ name: 'model', title: data.title ?? input.title ?? 'Meaning Model', label: data.title ?? 'Meaning Model', generatedAt: data.generatedAt, live: input.mode === 'live' }] });
    return { body, index, title: data.title ?? input.title ?? 'Meaning Model',
      graphId: history.graphId ?? data.inspection?.graph?.id ?? null,
      relatedLives: input.graphHash ? declaredLives(data, input.accessScopes) : [],
      modelHash: data.modelHash ?? input.modelHash ?? null, graphHash: input.graphHash ?? null };
  }

  return {
    async open(raw) {
      if (closed) throw new Error('The viewer is closed.');
      const input = modelViewerSchema.parse(raw);
      const prepared = [], revisions = new Set();
      // Scope checks and serialization must all succeed before any token is issued or evicted.
      for (const selection of [input, ...(input.additionalModels ?? [])]) {
        const snapshot = await prepareSnapshot(selection), key = selection.graphHash ? `graph:${selection.graphHash}` : `model:${selection.modelHash}`;
        if (!revisions.has(key)) {
          if (selection.mode === 'live') {
            if (!snapshot.graphId) throw new Error('Live mode requires a stored model-bound graph identity.');
            snapshot.live = { anchor: selection.graphHash, graphId: snapshot.graphId,
              selection: { graphHash: selection.graphHash, accessScopes: [...selection.accessScopes], title: selection.title, mode: 'live' },
              checkedAt: 0, pending: null, status: 'following' };
          }
          prepared.push(snapshot); revisions.add(key);
        }
      }
      // An explicit graph of a life is richer than its model-only view. Keep it
      // (and its caller-supplied scopes/title) instead of making a duplicate.
      const selectedModels = new Set(prepared.map((snapshot) => snapshot.modelHash));
      const related = prepared.flatMap((snapshot) => snapshot.relatedLives);
      for (const selection of related) {
        if (selectedModels.has(selection.modelHash)) continue;
        if (prepared.length >= maximumSnapshots) throw new Error('The selected books and their declared author/reader lives exceed 16 viewer choices. Open fewer additionalModels in this group.');
        prepared.push(await prepareSnapshot(selection)); selectedModels.add(selection.modelHash);
      }
      await start();
      const group = Object.freeze(prepared.map(() => randomBytes(24).toString('hex')));
      prepared.forEach((snapshot, index) => snapshots.set(group[index], { ...snapshot, group }));
      while (snapshots.size > maximumSnapshots) snapshots.delete(snapshots.keys().next().value);
      const token = group[0], primary = prepared[0];
      return { schema: 'meaning-model-viewer-open/v1', url: `${origin}/${token}/`, readOnly: true, mode: input.mode,
        modelHash: primary.modelHash, graphHash: primary.graphHash,
        ...(group.length > 1 ? { views: groupViews(token) } : {}),
        instructions: `Open this link in a browser on the same computer as the MCP server. ${input.mode === 'live' ? 'It follows saved graph revisions and their bound model/prose, preserving reading context through page refreshes. Updates wait while you scroll or type. A fork pauses following; open the intended branch explicitly. Scopes never expand. Model-only life choices remain exact snapshots.' : 'It shows the exact selected revision. Reopen after changes, or use mode live with graphHash while authoring.'} The chooser includes the explicitly grouped revisions and declared author/reader lives. Links last while this MCP process runs; the 16 most recently opened views are kept.` };
    },
    async close() {
      closed = true;
      snapshots.clear();
      if (!httpServer) return;
      try { await starting; } catch { return; }
      await new Promise((done) => { httpServer.close(done); httpServer.closeAllConnections(); });
    },
  };
}

export function registerViewerTools(server, service) {
  const viewer = createModelViewer(service);
  server.registerTool('life_model_viewer_open', {
    title: 'Open the model viewer',
    description: 'Open a read-only local browser viewer. When authoring or revising a story/model, use mode live with graphHash so the user sees saved graph revisions, bound model changes and prose without reopening the link. Live follows only an unambiguous descendant lineage, pauses at forks or insufficient scopes, and preserves reading context through guarded page refreshes; this is saved-revision following, not token streaming. mode snapshot (default) preserves the exact modelHash or graphHash. ModelHash-only live following is not supported. The chooser includes current declared author/reader life snapshots and optional additionalModels; each entry has its own complete accessScopes and mode. This complete author view refuses partial access and never widens scopes. It is bundled; no download or website account is required. Return the local URL, which runs on the same computer as the MCP server.',
    inputSchema: modelViewerSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const result = await viewer.open(input);
    return { content: [{ type: 'text', text: `Open the model: ${result.url}\n\n${result.instructions}` }], structuredContent: result };
  });
  return viewer;
}
