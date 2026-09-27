// A retrospective import of the accepted artifact, not a replay of its authorship.
// No story text or psychological weight is generated here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildNarrativeGraph } from './rust-narrative.mjs';

export const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../..');
const releaseEngine = path.join(repo, 'rust-engine/target/release/life-sim-engine');
export const defaultEngine = process.env.LIFE_SIM_ENGINE_BIN
  || (fs.existsSync(releaseEngine) ? releaseEngine : path.join(repo, 'rust-engine/target/debug/life-sim-engine'));
const commandSchema = 'life-sim-rust-command/v1';
const dayMs = 86400000;
export const civilDay = s => Date.parse(`${s}T00:00:00Z`) / dayMs;
const interval = (start, exclusiveEnd) => ({ start: civilDay(start), end: civilDay(exclusiveEnd) });
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plain = s => s.replace(/[*`]/g, '').trim();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
const personSlugs = { Babbage: 'charles-babbage', Lovelace: 'ada-lovelace', Halden: 'edward-halden' };
const history = 'event.book.07r2.history';
const construction = 'event.book.07r2.construction-understanding';
const nativeEvent = id => `event.book.07r2.${id}`;
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function tables(text) {
  const groups = [];
  let group = [];
  for (const line of [...text.split('\n'), '']) {
    if (line.startsWith('|')) group.push(line.split('|').slice(1, -1).map(s => s.trim()));
    else if (group.length) { groups.push({ headers: group[0], rows: group.slice(2) }); group = []; }
  }
  return groups;
}

function section(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l === title);
  assert(start >= 0, `Missing source section: ${title}`);
  const depth = title.match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length && !new RegExp(`^#{1,${depth}} `).test(lines[end])) end++;
  return lines.slice(start + 1, end).join('\n');
}

function key(header) {
  if (/rem|unresolved/i.test(header)) return 'remainder';
  return slug(header).replaceAll('-', '_');
}

export function sourceCuts() {
  const scene = read('SCENE-PROFILE-CUTS.md');
  const people = read('PERSON-MODELS.md');
  const cuts = [];
  const addRows = (text, title, family, question, unit) => {
    const table = tables(section(text, title))[0];
    assert(table, `Missing ${title} table`);
    for (const row of table.rows) cuts.push({ family, label: row[0], question, unit,
      answers: row.slice(1).map((v, i) => ({ key: key(table.headers[i + 1]), weight: Number(v) })) });
  };
  addRows(scene, '## WHAT: motivational attention', 'what', 'Which wanted region receives motivational attention?', 'motivational attention');
  addRows(scene, '## Local fulfillment outlook', 'outlook', 'How is fulfillment of the active wants anticipated?', 'represented fulfillment outlook');
  addRows(scene, '## FEELS: emotional attention', 'feels', 'Which emotional appraisals occupy this moment?', 'emotional attention');
  const how = tables(section(scene, '## HOW: problem-solving attention'))[0];
  for (const row of how.rows) for (let col = 1; col <= 3; col++) {
    const keys = [['framing', 'deciding', 'remainder'], ['concrete', 'abstract', 'remainder'], ['impartial', 'personal', 'remainder']][col - 1];
    cuts.push({ family: ['how', 'framing', 'deciding'][col - 1], label: row[0],
      question: ['How is problem-solving attention organized?', 'How is framing attention divided?', 'How is deciding attention divided?'][col - 1],
      unit: ['problem-solving attention', 'framing attention', 'deciding attention'][col - 1],
      answers: row[col].split('/').map((v, i) => ({ key: keys[i], weight: Number(v.trim()) })) });
  }
  const outlookTable = tables(people).find(t => t.headers.includes('Assured fulfillment'));
  assert(outlookTable, 'Missing slow outlook source');
  for (const row of outlookTable.rows) cuts.push({ family: 'slow-outlook', label: row[0],
    question: 'How is fulfillment anticipated over this coarse period?', unit: 'represented fulfillment outlook',
    answers: row.slice(1).map((v, i) => ({ key: ['assured_fulfillment', 'threatened_fulfillment', 'remainder'][i], weight: Number(v) })) });
  addRows(people, '## Threat character within each period', 'threat', 'Which wanted region is at risk, conditional on represented threat?', 'threatened fulfillment');
  addRows(read('HEALTH-PROCESSES.md'), '## Coarse health-condition Cuts', 'health', 'How is the represented bodily condition divided?', 'represented health condition');
  const world = read('WORLD-MODEL.md');
  const decisions = section(world, '## Cuts that decide the world');
  for (const match of decisions.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)) {
    const [, label, block] = match;
    const table = tables(block)[0];
    assert(table, `Missing decision table ${label}`);
    const question = block.match(/Question: ([\s\S]*?)\n\n/)[1].replaceAll('\n', ' ');
    for (let col = 1; col < table.headers.length; col++) cuts.push({ family: 'direction',
      label: table.headers.length === 2 ? label : `${table.headers[col]}, 1852 office decision`, question,
      unit: label.startsWith('Trial forecast') ? 'uncalibrated forecast allocation' : 'decision allocation',
      answers: table.rows.map(row => ({ key: key(row[0]), weight: Number(row[col]) })) });
  }
  const concept = tables(section(world, '## One concept model: a valid computational claim')).find(t => /key/i.test(t.headers[0]));
  assert(concept, 'Concept must expose its explicit component Cut');
  cuts.push({ family: 'concept', label: 'valid computational claim', question: 'Which components constitute this canonical claim procedure?',
    unit: 'canonical claim composition', answers: concept.rows.map(row => ({ key: plain(row[0]), weight: Number(row.at(-1)) })) });
  assert.equal(cuts.length, 107, 'Source inventory changed: inspect rather than silently omit rows');
  for (const cut of cuts) {
    assert(cut.answers.every(a => Number.isFinite(a.weight) && a.weight >= 0), cut.label);
    assert.equal(new Set(cut.answers.map(a => a.key)).size, cut.answers.length, cut.label);
    assert(cut.answers.some(a => a.key === 'remainder'), cut.label);
    assert(Math.abs(cut.answers.reduce((n, a) => n + a.weight, 0) - 1) < 1e-9, cut.label);
  }
  assert.equal(cuts.reduce((n, c) => n + c.answers.length, 0), 472);
  return cuts;
}

// These are date *windows*, transcribed from the named Event table, not exact
// event instants. Undated child phases remain undated, not invented minutes.
const eventWindows = [
  ['1843-08-18', '1843-08-19'], ['1843-09-01', '1843-10-01'], ['1843-09-01', '1843-11-01'],
  ['1843-11-01', '1844-03-01'], ['1844-01-01', '1844-04-01'], ['1844-04-01', '1844-05-01'],
  ['1844-05-01', '1844-09-01'], ['1844-09-01', '1846-07-01'], ['1846-07-01', '1846-08-01'],
  ['1846-08-01', '1846-12-01'], ['1847-10-01', '1848-07-01'], ['1848-07-01', '1851-01-01'],
  ['1851-02-01', '1851-03-01'], ['1851-05-01', '1851-06-01'], ['1851-07-01', '1851-08-01'],
  ['1851-05-01', '1852-01-01'], ['1852-01-01', '1852-02-01'], ['1852-02-01', '1852-03-01'],
  ['1852-04-01', '1852-05-01'], ['1852-08-01', '1852-09-01'], ['1852-11-27', '1852-11-28'],
  ['1853-01-01', '1854-05-01'], ['1854-04-06', '1854-04-07'], ['1854-04-07', '1854-04-08'],
  ['1854-05-03', '1854-05-04'], ['1854-05-01', '1855-01-01'], ['1855-03-31', '1855-04-01'],
  ['1855-04-01', '1871-01-01'], ['1871-10-01', '1871-10-19'], ['1900-01-01', '1901-01-01'],
];
const periodBounds = ['1843-08-18', '1844-05-01', '1851-01-01', '1852-01-01', '1853-01-01', '1855-04-01', '1871-10-19'];
const sourceNames = ['MODEL-SCAFFOLDS-COMPILE.json', 'PERSON-TEMPLATE.json', 'PERSON-INSTANCES.json', 'PERSON-MODELS.md',
  'HEALTH-PROCESSES.md', 'SCENE-PROFILE-CUTS.md', 'WORLD-MODEL.md', 'WORLD-DATA.md', 'MACRO-PROCESSES.json',
  'BOOK-DRAFT.md', 'STORY-ROUTE.md', 'UNDERSTANDING-NOTES.md', 'import-rust.mjs', 'rust-narrative.mjs'];

function personInterval(label) {
  const [start, end] = label.split('/');
  return { start: civilDay(start.length === 4 ? `${start}-01-01` : start),
    end: end.length === 4 ? civilDay(`${Number(end) + 1}-01-01`) : civilDay(end) + 1 };
}

const coarseIntervalNote = 'Source precision envelope, clipped to the known lifecycle: adjacent envelopes may overlap. This does not assert an exact transition, disjoint partition, or constant state throughout the envelope; no scene-to-period mixture is asserted.';

// Retain the source's month/year precision. These are possible temporal extents,
// not invented transition dates or a partition of the person's life.
export function sourceCoarseInterval(label, life) {
  assert(Number.isFinite(life?.start) && Number.isFinite(life?.end) && life.start < life.end,
    `Missing lifecycle bounds for source period: ${label}`);
  const text = label.match(/^(?:Babbage|Lovelace|Halden), (.+)$/)?.[1];
  assert(text, `Unrecognized source period: ${label}`);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const boundary = (token, end) => {
    const match = token.match(/^(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) )?(\d{4})$/);
    assert(match, `Unrecognized source period boundary: ${label}`);
    let year = Number(match[2]);
    let month = match[1] ? months.indexOf(match[1]) + 1 : 1;
    if (end) {
      if (match[1]) month += 1;
      else year += 1;
    }
    if (month === 13) { month = 1; year += 1; }
    return civilDay(`${year}-${String(month).padStart(2, '0')}-01`);
  };
  let start; let end;
  const childhood = text.match(/^childhood through (\d{4})$/);
  const terminal = text.match(/^terminal transition in (\d{4})$/);
  if (childhood) { start = life.start; end = boundary(childhood[1], true); }
  else if (terminal) { start = boundary(terminal[1], false); end = boundary(terminal[1], true); }
  else {
    const range = text.replace(/^(?:illness and recovery|progressive illness|working adulthood|later life), /, '').split('--');
    assert.equal(range.length, 2, `Unrecognized source period: ${label}`);
    start = boundary(range[0], false); end = boundary(range[1], true);
  }
  const result = { start: Math.max(start, life.start), end: Math.min(end, life.end) };
  assert(result.start < result.end, `Source period is outside the lifecycle or reversed: ${label}`);
  return result;
}

// Only the source's explicitly labelled process statements are separated here.
// The whole-life tables combine several axes in one cell and are deliberately not split by this import.
export function sourceProcessDevelopments(text = read('PERSON-MODELS.md')) {
  const developments = [];
  const names = { Babbage: 'Charles Babbage', Lovelace: 'Ada Lovelace', Halden: 'Edward Halden' };
  const keys = new Set(['body', 'kin', 'partnership', 'work', 'place', 'means', 'knowledge', 'standing', 'meaning']);
  let periodCount = 0;
  for (const [name, personSlug] of Object.entries(personSlugs)) {
    const person = section(text, `## ${names[name]}`);
    const table = tables(section(person, '### Opened story periods'))[0];
    assert.deepEqual(table?.headers, ['Period', 'Slow changes that matter']);
    for (const [period, statements] of table.rows) {
      periodCount += 1;
      const range = period.split(':')[0];
      const matches = [...statements.matchAll(/\*\*([A-Za-z]+):\*\* ([\s\S]*?)(?= \*\*[A-Za-z]+:\*\*|$)/g)];
      assert.equal(matches.map(match => match[0]).join(' '), statements, `Unparsed process development: ${period}`);
      const seen = new Set();
      for (const [, label, description] of matches) {
        const processKey = label.toLowerCase();
        assert(keys.has(processKey) && !seen.has(processKey), `Unknown or repeated process label: ${name}: ${period}: ${label}`);
        seen.add(processKey);
        developments.push({ name, personSlug, personName: names[name], period, range, processKey, description });
      }
    }
  }
  assert.equal(periodCount, 11, 'Opened-period source inventory changed: inspect rather than silently omit rows');
  assert.equal(developments.length, 46, 'Development source inventory changed: inspect rather than silently omit statements');
  return developments;
}

// A deterministic, non-mutating patch when sourceText is supplied. It can repair an existing native model through
// the ordinary revision tool, as well as populate a fresh import. It never changes Cuts, processes or manuscript text.
export function processDevelopmentAdditions(model, sourceDigest, sourceText = read('PERSON-MODELS.md')) {
  const mm = model.meaning_model;
  const events = [], event_relations = [];
  const existingEvents = new Map(mm.events.map(event => [event.id, event]));
  const existingRelations = new Map(mm.event_relations.map(relation => [relation.id, relation]));
  const assertSameFields = (existing, expected, label) => {
    if (!existing) return false;
    for (const key of Object.keys(expected)) assert.deepEqual(existing[key], expected[key], `Existing ${label} conflicts with the source: ${expected.id} (${key})`);
    return true;
  };
  for (const source of sourceProcessDevelopments(sourceText)) {
    const referentId = `referent.profile.${source.personSlug}.person.${source.personSlug.replaceAll('-', '_')}`;
    const referent = mm.referents.find(item => item.id === referentId);
    const life = existingEvents.get(referent?.lifecycle_event_id);
    assert(life?.interval, `Missing source person's lifecycle: ${source.personName}`);
    const processes = model.processes.filter(process => process.scale?.semantic_role === 'person_is_process'
      && process.scale.subject_referent_id === referentId && process.scale.process_key === source.processKey);
    assert.equal(processes.length, 1, `Missing or ambiguous process: ${source.personName}: ${source.processKey}`);
    const process = processes[0];
    const parents = mm.events.filter(event => event.process_ids?.includes(process.id)
      && mm.event_relations.some(relation => relation.kind === 'contains' && relation.source_event_id === life.id && relation.target_event_id === event.id));
    assert.equal(parents.length, 1, `Missing or ambiguous lifecycle process Event: ${process.id}`);
    const suffix = `${source.personSlug}.${slug(source.range)}.${source.processKey}`;
    const id = `event.development.07r2.${suffix}`;
    const provenance = [`retrospective-source-sha256:${sourceDigest}`,
      `source:PERSON-MODELS.md:${source.personName}:Opened story periods:${source.period}:${source.processKey}`,
      `source-period-label:${source.name}, ${source.range}`,
      'Authored developmental account of this person, transcribed verbatim; not a numerical state, execution trace, or independently verified historical claim.',
      source.name === 'Halden' ? 'Source history status: authored fictional person and life compatible with the era.'
        : 'Source history status: historical person with a documentary prefix and explicit counterfactual continuation; this source interpretation does not independently verify either.',
      'Descriptions of beliefs, aims and judgments remain attributed to the person; their embedded contents are not adopted as objective claims.', coarseIntervalNote];
    const development = { id, boundary: `${source.personName} · ${source.processKey} · ${source.period}`,
      description: source.description, interval: sourceCoarseInterval(`${source.name}, ${source.range}`, life.interval),
      participants: { subject: referentId }, process_ids: [process.id], provenance };
    assert(development.boundary.length <= 200, `Development boundary too long: ${id}`);
    const relation = { id: `relation.development.07r2.${suffix}`, kind: 'contains', source_event_id: parents[0].id,
      target_event_id: id, description: 'An authored qualitative development within this ongoing process; no disjoint temporal partition or constant state is asserted.', provenance: [...provenance] };
    if (!assertSameFields(existingEvents.get(id), development, 'development')) events.push(development);
    if (!assertSameFields(existingRelations.get(relation.id), relation, 'development relation')) event_relations.push(relation);
  }
  return { events, event_relations };
}

function scaffoldRequest() {
  const request = JSON.parse(read('MODEL-SCAFFOLDS-COMPILE.json'));
  const people = JSON.parse(read('PERSON-INSTANCES.json')).instances;
  request.profile_request.model.id = 'book-of-conditions-07r2-retrospective-import';
  request.profile_request.model.time_unit = 'civil_day_since_1970_01_01';
  const lifetimes = new Map();
  const convert = x => x && interval(`${x.start}-01-01`, `${x.end}-01-01`);
  for (const { kind, profile: p } of request.profile_request.profiles) {
    if (p.interval) p.interval = convert(p.interval);
    for (const phase of ['anticipation', 'focal_change', 'adaptation']) if (p[phase]?.interval) p[phase].interval = convert(p[phase].interval);
    if (kind === 'person_scaffold') {
      assert.equal(p.level, 'processes', 'All declared person processes must be requested');
      p.interval = personInterval(people.find(person => person.person_slug === p.id).life_interval);
      lifetimes.set(`referent.profile.${p.id}.person.${p.subject_id}`, p.interval);
    } else if (kind === 'thing_scaffold' && p.interval) lifetimes.set(`referent.profile.${p.id}.thing.${p.thing_id}`, p.interval);
  }
  // A broad year window is narrowed only by the already-known life it lies in.
  for (const { kind, profile: p } of request.profile_request.profiles) {
    const ids = kind === 'relationship_scaffold' ? [p.left_referent_id, p.right_referent_id]
      : kind === 'change_arc_scaffold' ? [p.affected_referent_id] : [];
    for (const id of ids) {
      const life = lifetimes.get(id);
      if (!life || !p.interval) continue;
      p.interval = { start: Math.max(p.interval.start, life.start), end: Math.min(p.interval.end, life.end) };
    }
    for (const phase of ['anticipation', 'focal_change', 'adaptation']) if (p[phase]?.interval && p.interval) {
      p[phase].interval = { start: Math.max(p[phase].interval.start, p.interval.start), end: Math.min(p[phase].interval.end, p.interval.end) };
    }
    p.provenance.push('Retrospective civil-day adapter: date labels are precision envelopes; known lifecycle bounds constrain joint/change envelopes.');
  }
  return request;
}

export function augmentModel(base, sourceDigest) {
  const model = structuredClone(base);
  const mm = model.meaning_model;
  const provenance = [`retrospective-source-sha256:${sourceDigest}`, 'Authored Book reconstruction; not original execution evidence.'];
  const eventMap = new Map(mm.events.map(e => [e.id, e]));
  const sources = [];
  const event = (id, boundary, date = null, parent = null, processes = []) => {
    if (eventMap.has(id)) return eventMap.get(id);
    const e = { id, boundary: boundary.slice(0, 200), description: boundary, interval: date, process_ids: processes, provenance };
    mm.events.push(e); eventMap.set(id, e);
    if (parent) relation(parent, id, 'contains');
    return e;
  };
  const relation = (from, to, kind, description = null) => mm.event_relations.push({
    id: `relation.book.07r2.${mm.event_relations.length}`, source_event_id: from, target_event_id: to,
    kind, description, provenance,
  });
  event(history, 'History: the Universe lifecycle, open outside the represented Book interval.');
  event(construction, 'Construction-time interpretations and ideal concept definitions; not story occurrences.');
  mm.referents.push({ id: 'thing.book.07r2.universe', boundary: 'The Universe at the declared resolution.',
    continuity_criterion: 'Shared root identity across this construction.', lifecycle_event_id: history, provenance });
  mm.event_referent_bindings.push({ id: 'binding.book.07r2.universe-life', target: { kind: 'event', event_id: history },
    role: 'subject', referent_id: 'thing.book.07r2.universe', binding_type: 'lifecycle_subject', provenance });
  mm.context_roots = [{ event_id: history, kind: 'accepted_world', provenance },
    { event_id: construction, kind: 'understanding', provenance }];
  event(nativeEvent('undertaking'), 'The bounded undertaking and its custody: six disjoint coarse periods.', interval(periodBounds[0], periodBounds.at(-1)), history);
  for (let i = 0; i < 6; i++) event(nativeEvent(`P${i + 1}`), `Period P${i + 1}: ${periodBounds[i]} to ${periodBounds[i + 1]} exclusive.`, interval(periodBounds[i], periodBounds[i + 1]), nativeEvent('undertaking'));
  for (const t of tables(read('WORLD-MODEL.md'))) for (const row of t.rows) if (/^E\d\d[a-z]?$/.test(row[0])) {
    const [sourceId, dateLabel, parent, description] = row;
    const date = /^E\d\d$/.test(sourceId) ? interval(...eventWindows[Number(sourceId.slice(1)) - 1]) : null;
    const e = event(nativeEvent(sourceId), `${plain(description)} [Source window: ${dateLabel}; no finer instant asserted.]`, date,
      parent === 'History' ? history : nativeEvent(parent));
    sources.push({ ...e, sourceId });
  }
  assert.equal(sources.length, 37);
  // Preserve four overlapping macro accounts as Events, not extra normalized axes.
  for (const p of JSON.parse(read('MACRO-PROCESSES.json')).processes) {
    const id = nativeEvent(p.id);
    event(id, `${p.parent_claim} ${p.why_it_changes}`, null, history);
    for (const phase of p.phases) event(nativeEvent(phase.id), `Anticipation: ${phase.anticipation} Change: ${phase.perturbation} Adaptation: ${phase.adaptation}`, null, id);
  }
  const personRoots = new Map();
  for (const [name, person] of Object.entries(personSlugs)) {
    const life = mm.referents.find(r => r.id.includes(`profile.${person}.person.`));
    const root = `event.inner.07r2.${person}`;
    event(root, `${name}'s authored inner account, kept separate from world facts.`, eventMap.get(life.lifecycle_event_id).interval, life.lifecycle_event_id);
    mm.context_roots.push({ event_id: root, kind: 'inner', provenance });
    personRoots.set(name, { root, life });
  }
  // Existing scaffold roots enter History; internal contains edges are retained.
  const hasParent = new Set(mm.event_relations.filter(r => r.kind === 'contains').map(r => r.target_event_id));
  for (const e of [...mm.events]) if (!hasParent.has(e.id) && ![history, construction].includes(e.id)) relation(history, e.id, 'contains');
  const sceneTarget = label => {
    if (/custody/i.test(label)) return 'E29';
    if (/returned table|May 1854/i.test(label)) return 'E25';
    if (/disclosure/i.test(label)) return 'E26';
    if (/succession|successor|August 1852/i.test(label)) return 'E20';
    if (/qualification/i.test(label)) return 'E19';
    if (/expansion|1852 office decision/i.test(label)) return 'E18';
    if (/May 1851|trial/i.test(label)) return 'E14';
    if (/estimate|September 1843/i.test(label)) return 'E03';
    return 'E01';
  };
  const definitions = sourceCuts();
  mm.normalized_cuts = [];
  for (const c of definitions) {
    const name = c.label.match(/^(Babbage|Lovelace|Halden)\b/)?.[1];
    const subject = personRoots.get(name);
    const slow = ['slow-outlook', 'threat', 'health'].includes(c.family);
    const stem = ['framing', 'deciding'].includes(c.family) ? 'how' : c.family === 'threat' ? 'slow-outlook' : c.family;
    const id = c.family === 'concept' ? 'cut.canonical.07r2.valid-computational-claim.components' : `cut.book.07r2.${c.family}.${slug(c.label)}`;
    let target = null;
    if (!slow && c.family !== 'concept') target = c.label.startsWith('Trial forecast') ? 'E13'
      : c.label.startsWith('Founding group') ? 'E06' : /delivery decision/.test(c.label) ? 'E24'
      : c.family === 'direction' && /after the returned table/.test(c.label) ? 'E26'
      : c.family === 'direction' && c.label === 'Halden, September 1843' ? 'E02' : sceneTarget(c.label);
    const root = c.family === 'health' ? `event.profile.${personSlugs[name]}.person.${personSlugs[name].replaceAll('-', '_')}.is.body`
      : subject?.root ?? construction;
    const parentId = c.family === 'concept' ? 'event.canonical.07r2.valid-computational-claim'
      : `event.assessment.07r2.${stem}.${slug(c.label)}`;
    let date = slow ? sourceCoarseInterval(c.label, eventMap.get(subject.life.lifecycle_event_id).interval)
      : target ? eventMap.get(nativeEvent(target)).interval : null;
    if (date && subject) {
      const life = eventMap.get(subject.life.lifecycle_event_id).interval;
      assert(date.start < life.end && date.end > life.start, `Assessment outside life: ${c.label}`);
      date = { start: Math.max(date.start, life.start), end: Math.min(date.end, life.end) };
    }
    const assessment = event(parentId, `${c.label}. ${c.question} ${slow ? `Coarse authored parent. ${coarseIntervalNote}` : 'Authored assessment, not a calibrated measurement.'}`, date, root);
    if (slow) {
      if (c.family !== 'threat') assessment.boundary = `${c.label}. ${c.question}`.slice(0, 200);
      assessment.provenance = [...provenance, `source-period-label:${c.label}`, coarseIntervalNote];
    }
    if (target) relation(parentId, nativeEvent(target), 'other', 'about: reference only, never authority or evidence access');
    const cut = { id, parent_event_id: parentId, question: c.question, unit: c.unit, answers: c.answers, provenance: [...provenance, `source-row:${c.family}:${c.label}`] };
    if (c.family === 'threat') cut.conditioning = { cut_id: `cut.book.07r2.slow-outlook.${slug(c.label)}`, answer_key: 'threatened_fulfillment' };
    if (['framing', 'deciding'].includes(c.family)) cut.conditioning = { cut_id: `cut.book.07r2.how.${slug(c.label)}`, answer_key: c.family };
    mm.normalized_cuts.push(cut);
  }
  const durations = periodBounds.slice(0, -1).map((_, i) => civilDay(periodBounds[i + 1]) - civilDay(periodBounds[i]));
  assert.equal(durations.reduce((a, b) => a + b, 0), 10289);
  mm.normalized_cuts.push({ id: 'cut.book.07r2.history-duration', parent_event_id: nativeEvent('undertaking'),
    question: 'Which disjoint period occupies this duration?', unit: 'civil days',
    answers: [...durations.map((d, i) => ({ key: `p${i + 1}`, weight: d / 10289 })), { key: 'remainder', weight: 0 }], provenance });
  mm.physical_cuts.push({ id: 'partition.book.07r2.history', parent_event_id: nativeEvent('undertaking'),
    child_event_ids: durations.map((_, i) => nativeEvent(`P${i + 1}`)), kind: 'sequential', lens: 'duration', provenance });
  const conceptId = 'valid_computational_claim';
  for (const [suffix, purpose, target] of [['definition', 'define', 'event.canonical.07r2.valid-computational-claim'], ['trial', 'describe', nativeEvent('E14')]]) {
    mm.realizations.push({ id: `realization.book.07r2.claim.${suffix}`, concept_id: conceptId, purpose,
      roles: { procedure: target }, degree: 1, viewpoint: 'retrospective constructor',
      parameters: { grounding_source_snapshot: sourceDigest,
        canonical_component_cut: 'cut.canonical.07r2.valid-computational-claim.components',
        grounding_status: 'Local unscored canonical example; no new Sema mint claimed.',
        degree_semantics: 'Legacy host applicability flag only; no graded fit score.' }, provenance });
  }
  // Ledger entries remain literal pounds, never semantic Cut weights.
  for (const [title, account] of [['### Construction account, 1844--1851', 'construction'], ['### Office account, 1851--1855', 'office']]) {
    const groups = tables(section(read('WORLD-MODEL.md'), title));
    const totals = [];
    const processIds = [];
    for (let group = 0; group < groups.length; group++) {
      const rows = groups[group].rows.filter(r => !/Total/.test(r[0]));
      const total = rows.reduce((n, r) => n + Number(r[1].replaceAll(',', '')), 0); totals.push(total);
      for (const row of rows) {
        const amount = Number(row[1].replaceAll(',', ''));
        const id = `data.book.07r2.${account}.${group === 0 ? 'receipts' : 'uses'}.${slug(row[0])}`;
        processIds.push(id);
        model.processes.push({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: total } },
          initial_value: { kind: 'scalar', value: amount }, unit: 'GBP', update_mode: 'observed',
          support: [`WORLD-MODEL.md:${title}:${row[0]}`],
          reference_frame: `${account} whole-account flow, not current cash balance`, provenance });
      }
    }
    assert.equal(totals.length, 2); assert.equal(totals[0], totals[1]);
    assert.equal(totals[0], account === 'construction' ? 3000 : 1620);
    event(nativeEvent(`ledger.${account}`), `${account} whole-account receipts and uses in pounds; authored values, not historical quotations.`, null, history, processIds);
  }
  const capacitySource = section(read('WORLD-MODEL.md'), '### Office capacity known before expansion');
  const hours = Number(capacitySource.match(/and (\d+)\s+independent checker-hours/)[1]);
  const available = Number(capacitySource.match(/promises (\d+) protected checker-hours/)[1]);
  assert.match(capacitySource, /accepts four staged contracts/);
  const packets = 4; // Literal source word "four", not a forecast or drawn choice.
  const accounting = { construction_pounds: 3000, office_pounds: 1620,
    final_packets: packets, checker_hours_per_packet: hours, protected_checker_hours: available,
    required_checker_hours: packets * hours };
  assert.equal(accounting.required_checker_hours, 160);
  assert.equal(available, 80);
  for (const [name, value, unit] of [['checker-hours-per-packet', hours, 'hours/packet'],
    ['protected-checker-hours', available, 'hours/quarter'], ['final-packets', packets, 'packets']]) {
    const id = `data.book.07r2.capacity.${name}`;
    model.processes.push({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: Math.max(value, 1) } },
      initial_value: { kind: 'scalar', value }, unit, update_mode: 'observed',
      support: ['WORLD-MODEL.md:Office capacity known before expansion'],
      reference_frame: 'Declared final-delivery quarter; no continuous capacity simulation', provenance });
    eventMap.get(nativeEvent('E17')).process_ids.push(id);
  }
  const developments = processDevelopmentAdditions(model, sourceDigest);
  mm.events.push(...developments.events); mm.event_relations.push(...developments.event_relations);
  model.revision = { number: 0, reason: 'Retrospective registration of the existing Book with addressable Cuts, source-authored process developments and declared contexts; no new story rollout.', provenance };
  return { model, events: sources, accounting, inventory: { authored_cuts: definitions.length, authored_weights: 472, derived_duration_cuts: 1,
    qualitative_process_developments: developments.events.length, is_processes: model.processes.filter(p => p.scale?.semantic_role === 'person_is_process').length } };
}

export function engine(binary, operation, fields = {}, state = null) {
  const args = state ? ['--state-file', state] : [];
  // Commands here are about a megabyte. Piping them through execFileSync's input intermittently
  // deadlocked (the engine waiting for the rest of stdin, Node waiting for the engine to exit),
  // so the command goes to a file that becomes the engine's stdin and reaches EOF deterministically.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'book-engine-command-'));
  const file = path.join(scratch, 'command.json');
  fs.writeFileSync(file, JSON.stringify({ schema: commandSchema, operation, ...fields }));
  const stdin = fs.openSync(file, 'r');
  try {
    const result = JSON.parse(execFileSync(binary, args, { stdio: [stdin, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    assert(result.ok, `${operation}: ${JSON.stringify(result.error)}`);
    return result;
  } finally {
    fs.closeSync(stdin);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function runImport(out, binary = defaultEngine) {
  assert(!fs.existsSync(out), 'Use a fresh output directory; existing construction receipts are never overwritten');
  const files = Object.fromEntries(sourceNames.map(name => [name, digest(fs.readFileSync(path.join(directory, name)))]));
  const sourceDigest = digest(JSON.stringify(files));
  const request = scaffoldRequest();
  const compilation = engine(binary, 'compile_profiles', { profile_request: request.profile_request });
  const built = augmentModel(compilation.result.model, sourceDigest);
  assert.equal(built.inventory.is_processes, 117);
  const validation = engine(binary, 'validate_model', { model: built.model });
  for (const [name, hash] of Object.entries(files)) assert.equal(digest(fs.readFileSync(path.join(directory, name))), hash, `Source changed during import: ${name}`);
  fs.mkdirSync(out, { recursive: true });
  const state = path.join(out, 'construction.sqlite');
  const registration = engine(binary, 'register_model', { model: built.model }, state);
  const modelHash = registration.result.summary.model_hash;
  const restored = engine(binary, 'get_model', { model_hash: modelHash }, state);
  assert.deepEqual(restored.result.model, registration.result.model);
  const graph = buildNarrativeGraph({ modelHash, sourceDigest, events: built.events, modelDefinition: restored.result.model });
  const narrative = engine(binary, 'register_narrative_graph', { narrative_graph: graph }, state);
  const graphHash = narrative.result.summary.graph_hash;
  const rendered = engine(binary, 'render_narrative_graph', { narrative_graph_hash: graphHash,
    narrative_render: { root_ids: ['document.book.07r2'], access_scopes: [], expected_graph_hash: graphHash } }, state);
  assert.equal(rendered.result.text.trim(), read('BOOK-DRAFT.md').trim(), 'Native document rendering changed the manuscript');
  const fullGraph = engine(binary, 'query_narrative_graph', { narrative_graph_hash: graphHash,
    narrative_query: { mode: 'full', include_content: true, access_scopes: ['book.07r2.authoring'], expected_graph_hash: graphHash } }, state);
  for (const [name, hash] of Object.entries(files)) assert.equal(digest(fs.readFileSync(path.join(directory, name))), hash, `Source changed before receipt: ${name}`);
  const outputs = { 'source-manifest.json': { schema: 'book-retrospective-source-manifest', sourceDigest, files, engine_binary_sha256: digest(fs.readFileSync(binary)) },
    'compile-request.json': request, 'compile-response.json': compilation, 'model.json': restored.result.model,
    'validation.json': validation, 'registration.json': registration, 'narrative-graph.json': graph,
    'narrative-registration.json': narrative, 'narrative-retrieval.json': fullGraph, 'document-render.json': rendered };
  for (const [name, value] of Object.entries(outputs)) fs.writeFileSync(path.join(out, name), json(value), { flag: 'wx' });
  const receipt = { schema: 'book-retrospective-rust-import', recorded_at: new Date().toISOString(), sourceDigest, modelHash,
    graphHash, inventory: built.inventory, accounting: built.accounting, model_roundtrip_equal: true, manuscript_roundtrip_equal: true,
    document_chapters: graph.nodes.filter(n => n.role === 'story_passage').length,
    understanding_notes: graph.nodes.filter(n => n.role === 'externalized_reflection').length, database: 'construction.sqlite',
    boundaries: ['Fresh reconstruction of the accepted artifact, not a recovery of earlier edit order.',
      'Slow psychological parents remain authored; selected scenes are not a complete temporal partition.',
      'Root validation is structural; no automated character evidence-cutoff assembly or independent read-back is claimed.',
      'Legacy Realization degree=1 is applicability only; semantic grading belongs in Cuts.',
      'No stochastic selection, model-versus-prose advantage, or historical price validation is claimed.'],
    outputs: Object.fromEntries(Object.keys(outputs).map(name => [name, digest(fs.readFileSync(path.join(out, name)))])) };
  fs.writeFileSync(path.join(out, 'receipt.json'), json(receipt), { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], 'Usage: node import-rust.mjs NEW_OUTPUT_DIRECTORY [ENGINE_BINARY]');
  console.log(json(runImport(path.resolve(process.argv[2]), process.argv[3])));
}
