// The tree of processes, read whole: every process under the one it was carved from, with its measure and how far its
// values reach, and the review that asks, now and then, what the whole is missing.
//
// The deepen check asks of one process whether it has parts worth following, and the breadth check asks of the
// Events whether something changes that no process follows. Neither reads the tree as a whole. The whole-tree review
// does: once the tree is large enough to read, and again when it has grown by a quarter or fifty revisions have passed,
// the values report asks the modeler to read the whole tree and say where more could be added. The answer is recorded
// with life_breadth_record under the candidate tree:whole, with the size of the tree it read, so the question returns
// only when the tree or the construction has moved on.
import { breadthAnswers } from './breadth.mjs';

export const TREE_CANDIDATE = 'tree:whole';
// A tree smaller than this is read whole by every outline anyway.
const SMALLEST = 8;
const GROWTH = 1.25;
const AT_LEAST = 3;
const REVISIONS = 50;

// The tree from the model's decomposition: roots in the order the model lists them, each process's parts in the order
// they were filed. A process filed under two parents is expanded under the first, and each further parent lists it as a
// shared part (shared), so every process's parts and the count of processes without parts stay true. A cycle cannot hide
// a process, since whatever the walk does not reach is listed after it at the top level. The walk keeps its own stack,
// so a tree of any depth is read.
export function processTree(model) {
  const processes = model?.processes ?? [];
  const ids = new Set(processes.map((process) => process.id));
  const children = new Map(); const parentOf = new Map(); const parts = new Map(); const shared = new Map();
  // Each list keeps the order edges were filed in; beside each map, a set of the values already filed under each key
  // drops a repeated edge in constant time, whatever characters the ids hold.
  const seen = new Map();
  const add = (map, key, value) => {
    let byKey = seen.get(map); if (!byKey) { byKey = new Map(); seen.set(map, byKey); }
    let filed = byKey.get(key); if (!filed) { filed = new Set(); byKey.set(key, filed); }
    if (filed.has(value)) return;
    filed.add(value); const list = map.get(key) ?? []; list.push(value); map.set(key, list);
  };
  for (const edge of model?.decomposition ?? []) {
    if (!ids.has(edge.parent) || !ids.has(edge.child) || edge.parent === edge.child) continue;
    add(parts, edge.parent, edge.child);
    if (parentOf.has(edge.child)) { if (parentOf.get(edge.child) !== edge.parent) add(shared, edge.parent, edge.child); continue; }
    parentOf.set(edge.child, edge.parent);
    add(children, edge.parent, edge.child);
  }
  const order = []; const depth = new Map();
  const walk = (start) => {
    const stack = [[start, 0]];
    while (stack.length) {
      const [id, level] = stack.pop();
      if (depth.has(id)) continue;
      depth.set(id, level); order.push(id);
      const kids = children.get(id) ?? [];
      for (let index = kids.length - 1; index >= 0; index -= 1) if (!depth.has(kids[index])) stack.push([kids[index], level + 1]);
    }
  };
  for (const process of processes) if (!parentOf.has(process.id)) walk(process.id);
  for (const process of processes) walk(process.id);
  const levels = [];
  for (const level of depth.values()) levels[level] = (levels[level] ?? 0) + 1;
  const undivided = order.filter((id) => !(parts.get(id) ?? []).length).length;
  return { order, depth, children, parts, shared, parentOf, levels: [...levels].map((count) => count ?? 0), undivided, roots: order.filter((id) => depth.get(id) === 0) };
}

// How many processes without parts a recorded decision keeps whole. Only processes in the tree count, so a decision
// about a process removed since adds nothing.
export const keptWholeLeaves = (tree, kept) => [...kept.keys()].filter((processId) => tree.depth.has(processId) && !(tree.parts.get(processId) ?? []).length).length;

// How many dated values each process holds, across holders, and the first and last date they reach.
export function valueReach(model) {
  const reach = new Map();
  for (const series of model?.value_series ?? []) {
    const item = reach.get(series.process_id) ?? { values: 0, from: Infinity, to: -Infinity };
    for (const point of series.points ?? []) {
      item.values += 1;
      if (Number.isFinite(point.time)) { item.from = Math.min(item.from, point.time); item.to = Math.max(item.to, point.time); }
    }
    reach.set(series.process_id, item);
  }
  return reach;
}

// The line above the tree: its size, level by level from the top, and how many processes have no parts yet.
export function treeHeadline(tree, keptWhole = 0) {
  const count = tree.order.length;
  if (!count) return null;
  const levels = tree.levels.length;
  return `${count} process${count === 1 ? '' : 'es'} in ${levels} level${levels === 1 ? '' : 's'} (${tree.levels.join(', ')} from the top); `
    + `${tree.undivided} ha${tree.undivided === 1 ? 's' : 've'} no parts${keptWhole ? `, ${keptWhole} of them kept whole by a recorded decision` : ''}.`;
}

// The size of the tree as the review records it, read from the answers already in the model.
export function treeReview(model) {
  const tree = processTree(model);
  const processes = tree.order.length;
  const revision = model?.revision?.number ?? 0;
  const answer = breadthAnswers(model).get(TREE_CANDIDATE) ?? null;
  const last = answer ? { processes: answer.signals.processes ?? 0, revision: answer.signals.revision ?? 0, answer: answer.answer, concept: answer.concept } : null;
  let why = null;
  if (processes >= SMALLEST) {
    if (!last) why = 'unread';
    else if (processes >= Math.max(last.processes * GROWTH, last.processes + AT_LEAST)) why = 'grown';
    else if (revision - last.revision >= REVISIONS) why = 'revisions';
  }
  return { due: Boolean(why), why, processes, levels: tree.levels, revision, last };
}

// The candidate's signals, as the breadth record keeps them: the size of the tree read, at which revision.
export const treeSignals = (model) => ({ kind: 'tree', processes: processTree(model).order.length, revision: model?.revision?.number ?? 0 });

// The report's one line when the review is due.
export function treeReviewLine(review) {
  if (!review?.due) return null;
  const size = `${review.processes} processes in ${review.levels.length} levels`;
  const since = review.why === 'unread' ? `The tree of processes, ${size}, has not been read whole yet.`
    : review.why === 'grown' ? `The tree of processes has grown from ${review.last.processes} to ${review.processes} since it was last read whole.`
      : `${review.revision - review.last.revision} revisions have passed since the tree of processes, now ${size}, was last read whole.`;
  return `Whole-tree review: ${since} Read it whole (life_model_outline with sections ["processes"] and detail "skeleton") and ask, `
    + 'from the whole, where more could be added: a part one branch has that its siblings lack, a place, group or period the rest of '
    + 'the tree covers that one branch leaves out, a measure the whole implies that no process follows. Open what is worth following, '
    + `with a measure and values over time, then record the review with life_breadth_record (candidate "${TREE_CANDIDATE}"): modeled, `
    + 'naming a process you opened, or not_modeled, with why nothing more is worth following now.';
}
