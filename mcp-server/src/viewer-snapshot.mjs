import { readWorldState } from './storytelling-world.mjs';

// The complete render remains the reader's manuscript. Document coordinates
// require their own exact native render when unrelated Understanding roots exist.
export async function renderViewerDocument(service, selection, rendered) {
  if (rendered?.join_policy !== 'blank_line' || !rendered.roots?.length) return null;
  if (rendered.roots.length === 1) return rendered;
  const { graphHash, accessScopes = [] } = selection;
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash,
    mode: 'full', includeContent: true, accessScopes });
  if (view.graph_hash !== graphHash || view.content_included !== true) {
    throw new Error('Document projection requires the exact visible graph.');
  }
  const roots = new Set(rendered.roots);
  const documents = view.nodes.filter((node) => roots.has(node.id) && node.role === 'document_root'
    && !node.boundary && node.content_included !== false);
  if (documents.length !== 1) return null;
  const result = await service.renderNarrativeGraph({ graphHash, expectedGraphHash: graphHash,
    rootIds: [documents[0].id], accessScopes });
  if (result.graph_hash !== graphHash) throw new Error('Document render has a different graph revision.');
  return result;
}

// The inspection graph has already passed its caller's access checks. Reuse the
// story tools' current-stage selection; never find author links in prose or names.
export function declaredViewerLives(data, accessScopes = []) {
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
      if (typeof life?.lifeModelHash !== 'string' || !/^[a-f0-9]{64}$/u.test(life.lifeModelHash)) {
        throw new Error('A current author/reader declaration has an invalid life model reference. Repair that declaration before opening its viewer.');
      }
      const name = typeof life.name === 'string' && life.name.trim() ? life.name.trim() : role;
      result.push({ role, modelHash: life.lifeModelHash, accessScopes: [...accessScopes],
        title: `${role === 'author' ? 'Author' : 'Reader'} life · ${name}`.slice(0, 200) });
    }
  }
  return result;
}
