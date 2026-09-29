// What the novel run of 2026-09-24 showed the tool must do: questions of one kind must not hide the world's missing
// laws and places, a decision drawn in the story graph must not be asked about as undrawn, principals must choose, the
// estimator must read the model and say when its options or its laws are missing, and a world changed by later draws
// must be asked about again.
import assert from 'node:assert/strict';
import test from 'node:test';
import { modelQuestions, unplacedEvents, indexModel, VISIBLE_QUESTIONS } from '../src/model-questions.mjs';
import { modeledStateText, proposeCutShares } from '../src/cut-shares.mjs';
import { drawnSinceQuestions, partsWithoutChoiceQuestion } from '../src/storytelling-world.mjs';
import { storyInterest, interestInstructions } from '../src/storytelling-interest.mjs';
import { voiceReviewInstructions } from '../src/storytelling-author-model.mjs';
import { directorPrinciples } from '../src/storytelling-director.mjs';
import { withLives } from './storytelling-life-fixture.mjs';
import { spatialDiagnostics } from '../src/spatial-diagnostics.mjs';
import { constructionRecordInstructions } from '../src/construction-principles.mjs';

// Fear or love, whole lives and drawn decisions belong to the storytelling profile, which these tests adopt.
process.env.MEANING_MODEL_ADDONS = 'storytelling';

const cut = (id, parent, question, unit, answers) => ({ id, parent_event_id: parent, question, unit, answers: Object.entries(answers).map(([key, weight]) => ({ key, weight })), provenance: ['authored'] });
const event = (id, start, end, extra = {}) => ({ id, boundary: id, description: `What happens in ${id}.`, interval: { start, end }, ...extra });

function lived({ decisions = 1 } = {}) {
  const model = withLives({ id: 'm', meaning_model: {} }, ['leo']);
  const mm = model.meaning_model;
  mm.events.push(event('ev.early', -10, -9, { participants: { subject: 'leo' } }), event('ev.late', 10, 11, { participants: { subject: 'leo' } }));
  mm.normalized_cuts.push(
    cut('cut.early', 'ev.early', 'How is fulfillment anticipated?', 'represented fulfillment outlook', { assured: 0.8, threatened: 0.15, remainder: 0.05 }),
    cut('cut.late', 'ev.late', 'How is fulfillment anticipated?', 'represented fulfillment outlook', { assured: 0.2, threatened: 0.75, remainder: 0.05 }));
  for (let index = 0; index < decisions; index += 1) {
    mm.events.push(event(`ev.choice.${index}`, 20 + index, 21 + index, { participants: { subject: 'leo' } }));
    mm.normalized_cuts.push(cut(`cut.choice.${index}`, `ev.choice.${index}`, `Which continuation follows at moment ${index}?`, 'decision allocation', { stay: 0.45, leave: 0.4, remainder: 0.15 }));
  }
  for (let index = 0; index < 8; index += 1) mm.events.push(event(`ev.world.${index}`, index, index + 1));
  return model;
}
const leo = [{ id: 'leo', name: 'Leo', principal: true }];

test('nine undrawn decisions do not hide a world with no laws and no places', () => {
  const open = modelQuestions(lived({ decisions: 9 }), { people: leo, draws: [], limit: VISIBLE_QUESTIONS });
  const shown = open.questions.map((item) => item.kind);
  assert.equal(open.counts['decision-undrawn'], 9);
  assert.equal(shown.filter((kind) => kind === 'decision-undrawn').length, 1, 'one of a kind, while others wait');
  assert.ok(shown.includes('laws-missing') && shown.includes('place-missing'), `the world's questions are shown: ${shown.join(', ')}`);
  assert.equal(new Set(shown).size, shown.length, 'as many kinds as questions shown');
  assert.ok(open.questions.filter((item) => item.principal).length <= VISIBLE_QUESTIONS / 2, 'the principal takes at most half');
});

test('without the story graph, decisions are named together rather than each claimed undrawn', () => {
  const unknown = modelQuestions(lived({ decisions: 3 }), { people: leo, limit: 100 });
  const decisions = unknown.questions.filter((item) => item.kind === 'decision-undrawn');
  assert.equal(decisions.length, 1);
  assert.match(decisions[0].question, /The model holds 3 decision Cuts .*draw history is unknown without the story graph/);
  assert.match(decisions[0].question, /Preserve accepted or retrospective outcomes/);
  const known = modelQuestions(lived({ decisions: 3 }), { people: leo, draws: [{ cutId: 'cut.choice.0', realized: 'stay' }], limit: 100 });
  assert.deepEqual(known.questions.filter((item) => item.kind === 'decision-undrawn').map((item) => item.cuts[0]), ['cut.choice.1', 'cut.choice.2']);
});

test('a principal with no recognized decision Cut is asked to inspect their recorded choices', () => {
  const open = modelQuestions(lived({ decisions: 0 }), { people: leo, draws: [], limit: 100 });
  const question = open.questions.find((item) => item.kind === 'choices-missing');
  assert.match(question.question, /No decision Cut was recognized for Leo; their choices may already be recorded/);
  assert.match(question.question, /Read and preserve accepted outcomes/);
  assert.ok(!modelQuestions(lived({ decisions: 1 }), { people: leo, draws: [], limit: 100 }).questions.some((item) => item.kind === 'choices-missing'));
});

test('the estimator reads the model, and says when the options or the laws are missing', async () => {
  const model = lived({ decisions: 1 });
  const choice = model.meaning_model.events.find((item) => item.id === 'ev.choice.0');
  assert.match(modeledStateText(model, choice), /^What the model holds at this moment: Leo.*How is fulfillment anticipated\?: threatened 0\.75, assured 0\.20/);
  const seen = [];
  const estimator = { backend: 'typesafe', model: 'jev-test', label: 'typesafe:jev-test', async estimate(state) {
    seen.push(state);
    return { model: 'jev-test', usage: { input_tokens: 10, output_tokens: 1 }, answers: { shares: { type: 'choice', choice: 'stay', confidence: 0.5, probabilities: { stay: 0.35, leave: 0.2, remainder: 0.45 } } } };
  } };
  const service = { inspectModel: async () => ({ model }) };
  const result = await proposeCutShares({ question: 'What does Leo do?', unit: 'decision allocation', answers: [{ key: 'stay', meaning: 'He stays.' }, { key: 'leave', meaning: 'He leaves.' }],
    modelHash: 'a'.repeat(64), events: [{ eventId: 'ev.choice.0' }] }, estimator, service);
  assert.match(seen[0].modeledState, /Leo/);
  assert.ok(result.warnings.some((item) => /puts 0\.45 on none of your answers\. The options miss what this person would most plausibly do/.test(item)));
  assert.ok(result.warnings.some((item) => /The model holds no laws, claims or abstract relations/.test(item)));
});

test('a world changed by later draws is asked about again, and so is the director', () => {
  const nodes = [
    { node_type: 'storytelling.direction', text: JSON.stringify({ data: { stage: 'world' } }), value_time: 8 },
    ...[6, 9, 10].map((time) => ({ node_type: 'direction_draw', value_time: time })),
  ];
  const questions = drawnSinceQuestions({ nodes }, { authorReader: { node: { value_time: 5 } } });
  assert.deepEqual(questions.map((item) => item.kind), ['world-after-draws', 'direction-after-draws']);
  assert.match(questions[0].question, /^3 decisions were drawn after the author and the buttons were recorded/);
  assert.match(questions[1].question, /^2 decisions were drawn after the director last held the world/);
  assert.deepEqual(drawnSinceQuestions({ nodes: [] }, { authorReader: { node: { value_time: 5 } } }), []);
});

test('route parts without a choice, unplaced Events and the social life of a secret are asked about', () => {
  const question = partsWithoutChoiceQuestion(['part.01', 'part.02'], 12);
  assert.match(question, /^2 of 12 parts have no recognized decision Cut \(part\.01, part\.02\)/);
  assert.match(question, /choices may already be recorded/);
  assert.match(question, /Preserve accepted or observed outcomes/);
  assert.match(question, /A part may contain no choice/);
  assert.match(question, /still-open fictional choice.*delegated uncertainty.*recorded draw are optional/);
  const index = indexModel({ meaning_model: { events: [event('ev.town', 0, 10, { region: 'the town' }), event('ev.inside', 1, 2), event('ev.nowhere', 3, 4)],
    event_relations: [{ kind: 'contains', source_event_id: 'ev.town', target_event_id: 'ev.inside' }] } });
  assert.deepEqual(unplacedEvents(index, ['ev.town', 'ev.inside', 'ev.nowhere']).map((item) => item.id), ['ev.nowhere'], 'a place is inherited from an enclosing Event');
  assert.match(storyInterest.find((item) => item.id === 'secrets').investigate, /A secret has a social life: model a knowledge or belief process for everyone who could know or suspect it/);
  // A voice and a style change like any other process; the catalog asks for their course, not a fixed description.
  assert.match(storyInterest.find((item) => item.id === 'voice').investigate, /Model each voice as a process of its own.*how it changes across the years/);
  assert.match(storyInterest.find((item) => item.id === 'style').investigate, /Model the writing style as a process: across the author's modeled life and across the telling/);
});

test('craft tips widen existing catalog elements and leave exploration to curiosity', () => {
  // Tips from writing practice are folded into existing elements, so the aspects stage asks for no new element and
  // nothing becomes a required test. A new element would add an aspect to every story; add one only when a tip cannot
  // live in an existing element. Each element stays short enough to read as questions, not as a manual.
  assert.equal(storyInterest.length, 31);
  for (const item of storyInterest) assert.ok(item.investigate.split(/\s+/u).length <= 140, `${item.id} reads as questions, not a manual`);
  const tip = (id) => storyInterest.find((item) => item.id === id).investigate;
  assert.match(tip('wants'), /In a scene, what does each person present want there, how do they go after it, how do they see the others, what will they not say, and where does the scene leave them\?/);
  assert.match(tip('tension'), /What stands in each principal's way: something tied to the want itself, an opponent who defeats their strength, someone who shares their method\? Near a decisive moment, do time and room narrow\?/);
  assert.match(tip('place'), /Does it work against someone's aim, show who keeps it, or read differently to two people, or to one who has changed\?/);
  assert.match(tip('residue'), /what people handle when they cannot say what they feel, or as a conversation turns/);
  assert.match(tip('change'), /and what each has lost.*Does a changed understanding show in a costly choice\? If a skill comes fast, what explains it\?/);
  assert.match(tip('flaws'), /to themselves or to others.*whether they see it and who around them does/);
  assert.match(tip('shock'), /and what the shock interrupts/);
  assert.match(tip('surprise'), /and where the reader meets them, in plain sight, before the turn/);
  assert.match(tip('mystery'), /What does each scene ask, and does it answer\? In what order do questions close\? Who narrates shapes what can be known, and when/);
  assert.match(tip('reversals'), /How are the turns spaced across the reading\? A long stretch without one may be rest, or a sag/);
  assert.match(tip('causality'), /nothing happens without a modeled cause/);
  // Convenient tropes are asked about as causes, not banned.
  assert.match(tip('secrets'), /Lies and omissions belong here too: who tells them, what they protect, what finding them costs/);
  assert.match(tip('secrets'), /If a misunderstanding outlives one conversation, or someone reveals what their interests would keep, what explains it\?/);
  assert.match(tip('secrets'), /What the telling shows is true in the world unless the model holds a deception or a mistaken belief/);
  assert.match(tip('secrets'), /A secret has a social life/, 'the older account of secrets is kept');
  assert.match(tip('theme'), /where two threads echo by realizing the same concept in different lives/);
  assert.match(tip('era'), /Its everyday particulars, what people buy, eat, watch and use, also mark class and place/);
  assert.match(tip('era'), /fix a documentary cutoff/, 'the older rules for a real era are kept');
  assert.match(tip('voice'), /shape it and its images, how it changes across the years/);
  assert.match(tip('buttons'), /What does the opening promise, and how soon is it kept\?/);
  assert.match(tip('style'), /Tone, distance and person can be telling processes too, each shift with its reason, and so can the cuts between scenes/);
  // A book communicates specific ideas: the goal names them, asks for each idea's strategy, and tests what reached a
  // reader. Compression tests interest: the one-sentence account is the coarsest description the telling must fit.
  assert.match(interestInstructions, /^A book is a way of communicating specific ideas\. The goal is to use the model to create something unique that conveys them: a story only this model could produce\./);
  assert.match(interestInstructions, /Write down what ideas you want to convey, often one for a short form and several for a long one, and for each idea the strategy for conveying it: where the reader meets it, where the story tests it and where it lands\./);
  assert.match(interestInstructions, /a blind read-back shows which ideas actually reached a reader/);
  assert.match(interestInstructions, /Compress the story as you go: say it in one sentence, then in a paragraph, then in a page, and record them as an author record about the story root \(a compression is not an opening of the world\)\. If the sentence does not make it interesting, go back to the model until it does; as the story grows, check that it still fits its sentence, and revise one or the other\./);
  // If the ideas are not written down, the director names it at the world stage, and the draft stage asks whether
  // they reached a reader.
  const principle = (id) => directorPrinciples.find((item) => item.id === id)?.principle ?? '';
  assert.match(principle('world.ideas'), /The ideas the work means to convey are written down, and for each idea the strategy for conveying it/);
  assert.match(principle('world.ideas'), /If none is settled yet, the record says why/);
  assert.match(principle('draft.ideas'), /Each recorded idea reaches the reader through its strategy in this draft\. A blind read-back shows which do/);
  assert.match(interestInstructions, /The questions under each element are tips, not tests to pass\. Use your curiosity and your own knowledge of what makes a good story as well, and the unique shape of this model/);
  assert.match(interestInstructions, /its particular lives, processes, jumps and concepts show where this story's interest lies in a way no general list can/);
  assert.match(voiceReviewInstructions, /a blind attribution check is one useful test.*with the denominator\. A resemblance can be intended; the check locates it and does not grade it/);
});

test('a substrate must resolve to a placed host, not merely name a person or form a cycle', () => {
  const index = indexModel({ meaning_model: {
    events: [event('life', 0, 10), event('unplaced', 1, 2, { substrate: 'person' }),
      event('room', 0, 10, { region: 'the workshop' }), event('placed', 1, 2, { substrate: 'room' }),
      event('cycle-a', 1, 2, { substrate: 'cycle-b' }), event('cycle-b', 1, 2, { substrate: 'cycle-a' }),
      event('blank', 1, 2, { region: '  ', substrate: 'body' }),
      event('host-child', 1, 2, { substrate: 'resident' })],
    referents: [{ id: 'person', lifecycle_event_id: 'life' }, { id: 'resident', lifecycle_event_id: 'placed' }],
  } });
  assert.deepEqual(unplacedEvents(index, ['unplaced', 'placed', 'cycle-a', 'blank', 'host-child']).map((item) => item.id),
    ['unplaced', 'cycle-a', 'blank']);
});

test('declared setting bindings place Events and their contained or hosted Events without a legacy region', () => {
  const model = { meaning_model: {
    events: ['located', 'legacy-setting', 'child', 'hosted', 'dangling', 'mere-participant'].map((id) => event(id, 0, 1,
      id === 'hosted' ? { substrate: 'located' } : {})),
    referents: [{ id: 'room' }],
    event_relations: [{ kind: 'contains', source_event_id: 'located', target_event_id: 'child' }],
    event_referent_bindings: [
      ['located', 'located_in', 'room'], ['legacy-setting', 'spatial_setting', 'room'],
      ['dangling', 'located_in', 'missing-room'], ['mere-participant', 'participation', 'room'],
    ].map(([id, binding_type, referent_id]) => ({ id: `${id}.binding`, target: { kind: 'event', event_id: id },
      role: 'setting', binding_type, referent_id })),
  } };
  const index = indexModel(model);
  assert.deepEqual(unplacedEvents(index, [...index.events.keys()]).map((item) => item.id), ['dangling', 'mere-participant']);
  assert.equal(spatialDiagnostics(model).settingBindings, 2);
});

function positioned() {
  return { processes: [{ id: 'desk.position', value_type: { kind: 'vector', dimensions: 2, bounds: { minimum: -20, maximum: 20 } },
    initial_value: { kind: 'vector', value: [2, 3] }, scale: { semantic_role: 'position' },
    reference_frame: 'fictional room: southwest corner, x east, y north', unit: 'm',
    axes: [{ id: 'x', unit: 'm' }, { id: 'y', unit: 'm' }], provenance: ['authored fictional staging'], update_mode: 'static' }],
  meaning_model: { referents: [{ id: 'desk' }, { id: 'room' }], events: [event('meeting', 0, 1, { region: 'fictional room' })],
    event_referent_bindings: [{ id: 'desk.coordinate', target: { kind: 'process', process_id: 'desk.position' },
      referent_id: 'desk', binding_type: 'coordinate', role: 'position', interval: { start: 0, end: 1 } },
    { id: 'meeting.setting', target: { kind: 'event', event_id: 'meeting' }, referent_id: 'room', binding_type: 'located_in', role: 'meeting_room' }] } };
}

test('spatial diagnostics distinguish named settings from numbers that are not physical positions', () => {
  const model = positioned();
  model.processes[0].scale.semantic_role = 'financial allocation';
  model.meaning_model.event_referent_bindings[0].role = 'state';
  model.processes.push({ id: 'position.in.market', value_type: { kind: 'scalar' }, initial_value: { kind: 'scalar', value: 5 }, unit: 'm' });
  const result = modelQuestions(model, { people: [], limit: 100 });
  assert.equal(result.depth.spatial.status, 'qualitative_locations_only');
  assert.equal(result.depth.spatial.declaredPositionProcesses, 0);
  assert.equal(result.depth.spatial.namedRegionEvents, 1);
  assert.equal(result.depth.spatial.settingBindings, 1);
  const question = result.questions.find((item) => item.kind === 'spatial-resolution');
  assert.match(question.question, /Otherwise keep the qualitative account/);
  assert.match(question.question, /explicitly authored fictional local layouts/);
  model.meaning_model.event_referent_bindings[1].binding_type = 'spatial_setting';
  assert.equal(spatialDiagnostics(model).settingBindings, 1, 'existing vocabulary remains readable');
});

test('native vector, pose and scalar positions retain their declared frame, subject, units and provenance', () => {
  const model = positioned();
  const vector = model.processes[0];
  model.processes.push({ ...structuredClone(vector), id: 'desk.pose', value_type: { kind: 'object_pose', position_dimensions: 2, orientation_dimensions: 1 },
    initial_value: { kind: 'object_pose', value: { position: [2, 3], orientation: [0] } }, scale: {} },
  { ...structuredClone(vector), id: 'desk.x', value_type: { kind: 'scalar', bounds: { minimum: -20, maximum: 20 } },
    initial_value: { kind: 'scalar', value: 2 }, scale: { semantic_role: 'position', axis: 'x' }, axes: [{ id: 'x', unit: 'm' }] });
  for (const id of ['desk.pose', 'desk.x']) model.meaning_model.event_referent_bindings.push({ ...model.meaning_model.event_referent_bindings[0], id: `${id}.binding`, target: { kind: 'process', process_id: id } });
  const result = spatialDiagnostics(model);
  assert.equal(result.status, 'declared_initial_positions');
  assert.equal(result.usableInitialPositionProcesses, 3);
  assert.deepEqual(result.positions[0].subjects, [{ referentId: 'desk', bindingId: 'desk.coordinate', interval: { start: 0, end: 1 } }]);
  assert.equal(result.positions[0].frame, vector.reference_frame);
  assert.equal(result.positions[0].unit, 'm');
  assert.deepEqual(result.positions[0].provenance, ['authored fictional staging']);
  assert.equal(result.completenessVerified, false);
  assert.equal(result.physicalTruthVerified, false);
  assert.match(result.interpretation, /do not verify.*binding-time applicability, later motion/);
  assert.ok(!modelQuestions(model, { people: [], limit: 100 }).questions.some((item) => item.kind === 'spatial-resolution'));
});

test('native scalar spatial profiles identify entities through support without inventing referents', () => {
  const model = { processes: ['x', 'y'].map((axis, i) => ({
    id: `profile.harbour.spatial.entity.boat.position.${axis}`,
    value_type: { kind: 'scalar', bounds: { minimum: -100, maximum: 100 } },
    initial_value: { kind: 'scalar', value: i + 2 }, scale: { semantic_role: 'position', axis },
    reference_frame: 'harbour', unit: 'm', provenance: ['authored harbour model'],
    support: ['space:harbour', 'spatial_entity:boat'],
  })) };
  const result = modelQuestions(model, { people: [], limit: 100 });
  assert.equal(result.depth.spatial.usableInitialPositionProcesses, 2);
  assert.deepEqual(result.depth.spatial.positions[0].subjects, [{ spatialEntityId: 'boat', support: 'spatial_entity:boat' }]);
  assert.ok(!result.questions.some((item) => item.kind === 'spatial-declaration-incomplete'));
  model.processes[0].support = ['space:harbour', 'spatial_entity: '];
  assert.ok(spatialDiagnostics(model).positions[0].gaps.includes('missing-position-subject-binding'), 'empty entity identities do not qualify');
  model.processes[1].access_scopes = ['author'];
  assert.equal(spatialDiagnostics(model).declaredPositionProcesses, 1, 'support identities do not bypass process visibility');
});

test('usable scene coordinates do not conceal an empty lifetime place process', () => {
  const model = positioned();
  model.processes.push({ id: 'desk.place-history', scale: { process_key: 'place', subject_referent_id: 'desk' },
    initial_value: { kind: 'graph', value: { nodes: [], edges: [] } } });
  const open = modelQuestions(model, { people: [], limit: 100 });
  assert.equal(open.depth.spatial.status, 'declared_initial_positions');
  assert.equal(open.depth.spatial.placeHistory.withoutCoarseHistory, 1);
  assert.equal(open.depth.spatial.placeHistory.subjects[0].status, 'positions_without_recognized_coarse_history');
  const question = open.questions.find((item) => item.kind === 'spatial-history-unopened');
  assert.match(question.question, /Inspect linked Events and other conventions first/);
  assert.match(question.question, /Distinguish a base from continuous bodily presence/);
  assert.match(question.question, /Do not manufacture journeys, memories/);
  // The place marker has no ownership relationship to the desk's history.
  model.meaning_model.event_referent_bindings[0].referent_id = 'room';
  assert.equal(spatialDiagnostics(model).placeHistory.subjects[0].positionProcesses, 0);
});

test('coarse location inventory separates roles and frames without certifying life coverage', () => {
  const model = positioned();
  const first = model.processes[0];
  first.scale = { semantic_role: 'position', spatial_status: 'coarse_life_location', location_role: 'home_base' };
  const later = structuredClone(first); later.id = 'later-home';
  const workplace = structuredClone(first); workplace.id = 'work'; workplace.scale.location_role = 'workplace';
  const room = structuredClone(first); room.id = 'room-pose'; room.reference_frame = 'other-frame';
  model.processes.push(later, workplace, room,
    { id: 'place-history', scale: { process_key: 'place', subject_referent_id: 'desk' }, initial_value: { kind: 'graph', value: { nodes: [], edges: [] } } });
  for (const process of [later, workplace, room]) model.meaning_model.event_referent_bindings.push({
    id: `${process.id}.owner`, target: { kind: 'process', process_id: process.id }, referent_id: 'desk', binding_type: 'coordinate', role: 'position', interval: { start: 2, end: 4 } });
  const result = spatialDiagnostics(model, { limit: 1 });
  assert.equal(result.positionsOmitted, 3);
  const history = result.placeHistory.subjects[0];
  assert.equal(history.datedPositionProcesses, 4, 'inventory uses all records, not the truncated preview');
  assert.equal(history.coarseLocationProcesses, 4);
  assert.equal(history.sameFrameProcessGroups.length, 1, 'work and independent room frames do not join home-base process groups');
  assert.deepEqual(history.sameFrameProcessGroups[0].processIds, [first.id, later.id]);
  assert.match(result.placeHistory.interpretation, /not assembled poses, chronological sequences or evidence of movement/);
  assert.equal(history.completenessVerified, false);
  assert.equal(result.placeHistory.withoutCoarseHistory, 0, 'typed location episodes may already supply an empty index');
});

test('same-frame process groups do not combine scalar axes or incompatible axis units into a movement sequence', () => {
  const model = positioned();
  const first = model.processes[0];
  first.unit = null;
  const centimeters = structuredClone(first); centimeters.id = 'desk.centimeters';
  centimeters.axes = centimeters.axes.map((axis) => ({ ...axis, unit: 'cm' }));
  const scalar = (axis) => ({ ...structuredClone(first), id: `desk.${axis}`,
    value_type: { kind: 'scalar', bounds: { minimum: -20, maximum: 20 } },
    initial_value: { kind: 'scalar', value: 1 }, unit: 'm', axes: [],
    scale: { semantic_role: 'position', axis } });
  model.processes.push(centimeters, scalar('x'), scalar('y'),
    { id: 'place-history', scale: { process_key: 'place', subject_referent_id: 'desk' },
      initial_value: { kind: 'graph', value: { nodes: [], edges: [] } } });
  for (const id of [centimeters.id, 'desk.x', 'desk.y']) model.meaning_model.event_referent_bindings.push({
    ...model.meaning_model.event_referent_bindings[0], id: `${id}.owner`,
    target: { kind: 'process', process_id: id } });
  const history = spatialDiagnostics(model).placeHistory.subjects[0];
  assert.equal(history.datedPositionProcesses, 4, 'all four declarations are individually usable');
  assert.deepEqual(history.sameFrameProcessGroups, [], 'm/cm vectors and x/y components remain separate');
});

test('qualitative place histories and private indexes do not require a numerical life itinerary', () => {
  const model = positioned();
  const index = { id: 'qualitative-place-history', scale: { process_key: 'place', subject_referent_id: 'desk' },
    initial_value: { kind: 'graph', value: { nodes: ['event:meeting'], edges: [] } } };
  model.processes.push(index);
  assert.ok(!modelQuestions(model, { people: [], limit: 100 }).questions.some((item) => item.kind === 'spatial-history-unopened'));
  index.initial_value.value.nodes = []; index.access_scopes = ['private'];
  assert.equal(spatialDiagnostics(model).placeHistory.declaredPlaceProcesses, 0);
  assert.equal(spatialDiagnostics(model, { accessScopes: ['private'] }).placeHistory.withoutCoarseHistory, 1);
  index.scale.subject_referent_id = 'undeclared-subject';
  assert.equal(spatialDiagnostics(model, { accessScopes: ['private'] }).placeHistory.declaredPlaceProcesses, 0);
});

test('declared but unusable coordinates name the actual omissions instead of claiming drawable geometry', () => {
  const model = positioned();
  const process = model.processes[0];
  process.reference_frame = ' ';
  process.unit = null;
  process.axes = [];
  process.initial_value.value = [2, Number.NaN];
  process.provenance = [];
  model.meaning_model.event_referent_bindings[0].referent_id = 'not-a-declared-subject';
  const result = modelQuestions(model, { people: [], limit: 100 });
  assert.equal(result.depth.spatial.status, 'incomplete_position_declarations');
  assert.equal(result.depth.spatial.usableInitialPositionProcesses, 0);
  assert.deepEqual(result.depth.spatial.positions[0].gaps, ['invalid-position-value', 'missing-reference-frame', 'missing-unit', 'missing-position-subject-binding', 'missing-provenance']);
  assert.ok(result.questions.some((item) => item.kind === 'spatial-declaration-incomplete'));
  process.initial_value = { kind: 'scalar', value: 2 };
  process.value_type = { kind: 'scalar', bounds: { minimum: -20, maximum: 20 } };
  assert.ok(spatialDiagnostics(model).positions[0].gaps.includes('missing-coordinate-axis'));
});

test('spatial inspection respects process access scopes and remains in automatic post-change guidance', async () => {
  const { readOpenQuestions, withOpenQuestions } = await import('../src/model-questions.mjs');
  const model = positioned();
  model.processes[0].access_scopes = ['author'];
  model.processes[0].provenance = ['private source annotation'];
  const service = { inspectModel: async () => ({ model }) };
  const publicResult = await readOpenQuestions(service, { modelHash: 'a'.repeat(64) });
  assert.equal(publicResult.depth.spatial.declaredPositionProcesses, 0);
  assert.doesNotMatch(JSON.stringify(publicResult.depth.spatial), /private source annotation/);
  const authorized = await readOpenQuestions(service, { modelHash: 'a'.repeat(64), accessScopes: ['author'] });
  assert.equal(authorized.depth.spatial.usableInitialPositionProcesses, 1);
  assert.deepEqual(authorized.depth.spatial.positions[0].provenance, ['private source annotation']);
  const changed = await withOpenQuestions(service, { modelHash: 'a'.repeat(64) });
  assert.equal(changed.openQuestions.depth.spatial.status, 'qualitative_locations_only');
});

test('shared spatial guidance permits authored layouts without requiring them in every model', () => {
  // Every workflow is asked to discover what can be tracked, to model anything that changes as a process (a voice or a
  // style included) in the time it changes in, and to build on it once it is explicit.
  assert.match(constructionRecordInstructions, /Discover what can be tracked/);
  assert.match(constructionRecordInstructions, /Anything that changes over time can be modeled as a process, including qualities usually written as fixed descriptions/);
  assert.match(constructionRecordInstructions, /A fixed description records one moment; where the quality can change, model its course/);
  assert.match(constructionRecordInstructions, /a character's speech in world time, a narrator's manner across the reading, an author's style across the author's life/);
  assert.match(constructionRecordInstructions, /Once a structure is explicit, build on it/);
  // A person to be understood is modeled from their beginning, in every mode, without inventing unknown years.
  assert.match(constructionRecordInstructions, /A person you want to understand is the result of processes too: model how they came to be, from where their life began through what they were taught and what else they lived through, as far as the evidence reaches or the work needs, and leave unknown years unknown\./);
  // A deeper structure also tests the work built on the earlier account, where no declared dependency yet points.
  assert.match(constructionRecordInstructions, /read what was built on the earlier account against it, prose included, and revise that work where it no longer fits, or record why it stands/);
  assert.match(constructionRecordInstructions, /naming it does not make it a world fact/);
  assert.match(constructionRecordInstructions, /Distinguish qualitative places and relations, declared numerical positions, and evaluated movement/);
  assert.match(constructionRecordInstructions, /author fictional room layouts or movements when delegated/);
  assert.match(constructionRecordInstructions, /representative town point from a building/);
  assert.match(constructionRecordInstructions, /reusable convention in an open vocabulary/);
  assert.match(constructionRecordInstructions, /do not require.*coordinates.*every model/);
});

test('intentional static positions need no invented trajectory, while observed and unspecified processes still prompt review', () => {
  const model = positioned();
  const scalar = { value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0.5 } };
  model.processes.push({ id: 'waiting-observation', ...scalar, update_mode: 'observed' }, { id: 'unspecified', ...scalar });
  let result = modelQuestions(model, { people: [], limit: 100 });
  assert.deepEqual(result.questions.find((item) => item.kind === 'process-unobserved').processes, ['waiting-observation', 'unspecified']);
  model.processes[0].reference_frame = null;
  result = modelQuestions(model, { people: [], limit: 100 });
  assert.ok(result.questions.some((item) => item.kind === 'spatial-declaration-incomplete'), 'static placement still needs its frame');
  assert.equal(result.depth.spatial.positions[0].usableInitialPlacement, false);
});

test('a decision moment is its own time, not one unit of the model\'s clock', () => {
  const model = lived({ decisions: 1 });
  const questions = (m) => modelQuestions(m, { people: leo, draws: [], limit: 100 }).questions.filter((item) => item.kind === 'moment-unmodeled');
  assert.equal(questions(model).length, 1, 'the nearest motive Cut, a year and more away, does not model the moment');
  model.meaning_model.events.push(event('ev.choice.0.state', 20.2, 20.3, { participants: { subject: 'leo' } }));
  model.meaning_model.normalized_cuts.push(cut('cut.choice.0.wants', 'ev.choice.0.state', 'What does Leo want most here?', 'motivational attention over wants', { belonging: 0.6, competence: 0.3, remainder: 0.1 }));
  assert.equal(questions(model).length, 0, 'a motive Cut inside the decision Event does');
});

test('drawn remainders nobody opened, quantities nobody observes and lives with nothing inside are asked about', () => {
  const model = lived({ decisions: 2 });
  model.processes = [...(model.processes ?? []), { id: 'hand.function', initial_value: { kind: 'scalar', value: 0.45 } }];
  model.meaning_model.referents.push({ id: 'referent.gunnar', boundary: 'Gunnar, the relief skipper.', continuity_criterion: 'The same person.', lifecycle_event_id: 'ev.gunnar.life' });
  model.meaning_model.events.push(event('ev.gunnar.life', -40, 30));
  model.meaning_model.normalized_cuts.push({ ...cut('cut.choice.1.rem', 'ev.choice.1', 'Within the remainder, what follows?', 'decision allocation', { wait: 0.5, remainder: 0.5 }), conditioning: { cut_id: 'cut.choice.1', answer_key: 'remainder' } });
  const open = modelQuestions(model, { people: leo, draws: [{ cutId: 'cut.choice.0', realized: 'remainder' }, { cutId: 'cut.choice.1', realized: 'remainder' }], limit: 100 });
  assert.deepEqual(open.questions.filter((item) => item.kind === 'remainder-unopened').map((item) => item.cuts[0]), ['cut.choice.0'], 'an opened remainder is not asked about');
  assert.match(open.questions.find((item) => item.kind === 'process-unobserved').question, /hand\.function 0\.45/);
  assert.match(open.questions.find((item) => item.kind === 'life-thin').question, /^1 life is one Event with nothing inside \(Gunnar\)/);
});

test('the route is asked where its choices, its present shocks, its largest jumps and its open aspects are', async () => {
  const { routeQuestions } = await import('../src/storytelling-world.mjs');
  const model = lived({ decisions: 2 });
  model.meaning_model.normalized_cuts.push({ ...cut('cut.gone', 'ev.late', 'Which way does the old chain go?', 'decision allocation', { on: 0.5, off: 0.4, remainder: 0.1 }), withdrawn: { reason: 'The chain it rested on could not have happened.' } });
  const route = { parts: [{ id: 'part.1', eventIds: ['ev.late'] }, { id: 'part.2', eventIds: ['ev.choice.0'] }], whyNotJumps: null };
  const kinds = (items) => items.map((item) => item.kind);
  const questions = routeQuestions(model, route, { openAspects: [{ id: 'a.place' }] });
  assert.deepEqual(kinds(questions).filter((kind) => kind !== 'jumps-unrendered'), ['parts-without-choice', 'route-withdrawn', 'aspects-open'], 'Leo\'s shock at 13.3 lies inside this route\'s present');
  assert.match(questions[0].question, /^1 of 2 parts have no recognized decision Cut \(part\.1\)/);
  assert.match(questions[0].tool, /optional life_direction_draw/);
  assert.match(questions[1].question, /withdrawn \(cut\.gone: The chain it rested on could not have happened\.\)/);
  const later = routeQuestions(model, { parts: [{ id: 'part.1', eventIds: ['ev.choice.0'] }, { id: 'part.2', eventIds: ['ev.choice.1'] }], whyNotJumps: null });
  assert.match(later.find((item) => item.kind === 'story-shock-missing')?.question ?? '', /^Leo has no shock inside the story's time \(20 to 22\); the model's shocks for them are all earlier/);
  assert.ok(!later.some((item) => item.kind === 'parts-without-choice'), 'both parts hold a decision');
});
