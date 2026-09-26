// A viewer belongs to this MCP process and opens only an explicitly selected, immutable revision.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { exportConstructionHistory } from './construction-record.mjs';
import { buildViewerData } from './viewer-data.mjs';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const modelViewerSchema = z.object({
  graphHash: hash.optional().describe('The exact model-bound graph revision, including its prose and construction history.'),
  modelHash: hash.optional().describe('An exact model revision to inspect without a narrative graph.'),
  accessScopes: z.array(z.string().trim().min(1).max(256)).max(64).default([]),
  title: z.string().trim().min(1).max(200).optional(),
}).strict().refine((input) => Boolean(input.graphHash) !== Boolean(input.modelHash), {
  message: 'Supply exactly one graphHash or modelHash.',
});

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

export function createModelViewer(service, { buildData = buildViewerData, publicDirectory = defaultPublicDirectory } = {}) {
  const root = resolve(publicDirectory);
  const snapshots = new Map();
  let httpServer = null;
  let starting = null;
  let origin = null;
  let closed = false;

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

  return {
    async open(raw) {
      if (closed) throw new Error('The viewer is closed.');
      const input = modelViewerSchema.parse(raw);
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
      const body = JSON.stringify(data);
      if (Buffer.byteLength(body) > maximumSnapshotBytes) throw new Error('This model is too large for the local viewer snapshot (32 MiB maximum).');
      const index = JSON.stringify({ default: 'model', runs: [{ name: 'model', title: data.title ?? input.title ?? 'Meaning Model', label: data.title ?? 'Meaning Model', generatedAt: data.generatedAt, live: false }] });
      await start();
      const token = randomBytes(24).toString('hex');
      snapshots.set(token, { body, index });
      while (snapshots.size > maximumSnapshots) snapshots.delete(snapshots.keys().next().value);
      return { schema: 'meaning-model-viewer-open/v1', url: `${origin}/${token}/`, readOnly: true, mode: 'snapshot',
        modelHash: data.modelHash ?? input.modelHash ?? null, graphHash: input.graphHash ?? null,
        instructions: 'Open this link in a browser on the same computer as the MCP server. It shows the selected revision without changing it. Ask to open the model again after making changes. Links last while this MCP process runs; the 16 most recently opened snapshots are kept.' };
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
    description: 'Open a read-only local browser viewer of an exact model or model-bound graph revision. Use when the user asks to see, explore or read their model. The viewer is bundled with this MCP; no separate download, run transcript or website account is required. This complete author view requires accessScopes for every scoped record; it refuses partial access. Return the local URL to the user. The browser must run on the MCP server computer. Reopen after changes to see the new revision.',
    inputSchema: modelViewerSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const result = await viewer.open(input);
    return { content: [{ type: 'text', text: `Open the model: ${result.url}\n\n${result.instructions}` }], structuredContent: result };
  });
  return viewer;
}
