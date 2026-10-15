// Where a model's carves are, and which divisions of its processes still have none.
//
// A carve is an abstract cut from a concept to its parts. A cut recorded by life_carve_record names, in its provenance,
// the process it divides (divides-process:<id>) and the process each part is (part:<concept>=<process>), so the
// carve is found from its processes without editing a concept or a process, and a world on the parent revision can
// adopt the revision. A carve recorded by hand can declare the same two lines with life_model_revise.
import { slowKeyOf } from './people-check.mjs';

import { CARVE_MARK, DIVIDES_LINE, PART_LINE } from './carve-lines.mjs';
export { CARVE_MARK, DIVIDES_LINE, PART_LINE, KEPT_WHOLE_LINE, KEPT_SIGNALS_LINE } from './carve-lines.mjs';

// The kinds of decomposition edge that divide a whole into its parts. A membership view (regions), a subtype (kinds),
// a temporal phase or an observational partition is not a carve of the whole.
const DIVIDING = new Set(['functional_refinement', 'physical_part', 'contains']);

// Every current carve: the cut, its concept, the process it divides and the process of each part.
export function carvesOf(model) {
  const carves = [];
  for (const cut of model?.meaning_model?.abstract_cuts ?? []) {
    if (cut.withdrawn) continue;
    const lines = (cut.provenance ?? []).filter((line) => typeof line === 'string');
    const divides = lines.find((line) => line.startsWith(DIVIDES_LINE))?.slice(DIVIDES_LINE.length).trim() || null;
    const parts = lines.filter((line) => line.startsWith(PART_LINE)).map((line) => {
      const body = line.slice(PART_LINE.length); const at = body.lastIndexOf('=');
      return at > 0 ? { conceptId: body.slice(0, at), processId: body.slice(at + 1).trim() } : null;
    }).filter((part) => part?.processId);
    carves.push({ cutId: cut.id, conceptId: cut.parent_concept_id, process: divides, parts, recorded: lines.some((line) => line.includes(CARVE_MARK)) });
  }
  return carves;
}

// The divisions the values report points to. Never a refusal and never part of whether a pass is done.
// - uncarved: processes divided into two or more parts with no current carve naming them, highest first;
// - unopened: parts of a carve whose process the model does not have yet;
// - outside: parts filed under a carved process that its carve does not name, so they were never tested with it.
// A person's nine slow processes are the method's fixed top of a life, not a carve, so that division is left alone.
export function carveReport(model) {
  const byId = new Map((model?.processes ?? []).map((process) => [process.id, process]));
  const parentOf = new Map((model?.decomposition ?? []).map((edge) => [edge.child, edge.parent]));
  const depth = (id) => { let d = 0; for (let at = id; parentOf.has(at) && d < 64; at = parentOf.get(at)) d += 1; return d; };
  const label = (id) => byId.get(id)?.scale?.label ?? id;
  const children = new Map();
  for (const edge of model?.decomposition ?? []) if (DIVIDING.has(edge.kind)) children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.child]);
  const carves = carvesOf(model);
  const carved = new Map();
  for (const carve of carves) if (carve.process) carved.set(carve.process, [...(carved.get(carve.process) ?? []), carve]);
  // Recognised only when the slow processes are most of the division, so a world whose parts happen to be named work,
  // place or means is still asked for its carve.
  const personTop = (kids) => { const slow = kids.filter((kid) => byId.has(kid) && slowKeyOf(byId.get(kid))).length; return slow >= 5 && slow >= kids.length * 0.75; };
  const uncarved = [...children].filter(([parent, kids]) => kids.length >= 2 && !carved.has(parent) && !personTop(kids))
    .map(([parent, kids]) => ({ process: parent, label: label(parent), parts: kids.length, depth: depth(parent) }))
    .sort((a, b) => a.depth - b.depth || b.parts - a.parts || a.process.localeCompare(b.process));
  const unopened = carves.flatMap((carve) => carve.parts.filter((part) => !byId.has(part.processId))
    .map((part) => ({ cutId: carve.cutId, conceptId: part.conceptId, processId: part.processId, ...(carve.process ? { parent: carve.process } : {}) })));
  const outside = [...carved].flatMap(([process, list]) => {
    const named = new Set(list.flatMap((carve) => carve.parts.map((part) => part.processId)));
    return (children.get(process) ?? []).filter((child) => !named.has(child)).map((child) => ({ process, label: label(process), child, childLabel: label(child) }));
  });
  return { uncarved, unopened, outside };
}

// The report's one line about carves, or null when there is nothing to say. Kept to one line: the values report is
// read after every write.
export function carveLine(report) {
  const parts = [];
  if (report.uncarved.length) parts.push(`${report.uncarved.length} process(es) are divided without a recorded carve, beginning with ${report.uncarved.slice(0, 3).map((item) => `${item.label} (${item.parts} parts)`).join(', ')}: record why these are the parts with life_carve_record (the claim frame, the climb to the root, the four tests), so the carve can be inspected and revised`);
  if (report.unopened.length) parts.push(`${report.unopened.length} part(s) of your carves are not processes yet, such as ${report.unopened.slice(0, 3).map((item) => item.processId).join(', ')}: open each with a measure and values`);
  if (report.outside.length) parts.push(`${report.outside.length} part(s) sit under a carved process without being tested in its carve, such as ${report.outside.slice(0, 3).map((item) => `${item.childLabel} under ${item.label}`).join(', ')}: carve again with them among the candidates, or move them`);
  return parts.length ? `${parts.join('. ')}.` : null;
}
