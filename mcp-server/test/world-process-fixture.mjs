// The thinking loop the storytelling add-on requires before a scene, recorded through the add-on itself: the
// author's voice, the six world stages and a world direction. Real-engine tests call it after their own model and
// graph exist. The model must hold the author as a referent (the author's life may be the story's own model, as for
// a memoir) and the route Event with a description.
import { fictionalAuthorModel } from './storytelling-author-model-fixture.mjs';
import { directorPrinciples } from '../src/storytelling-director.mjs';
import { storyInterest } from '../src/storytelling-interest.mjs';

const long = (text) => `${text} ${'It is modeled in the world before any scene is written, and its consequences are followed through.'.repeat(2)}`;

export function worldStagesFor({ authorReaderNodeId = 'world.author', routeEventId, authorModelNodeId, lifeModelHash, authorPersonId }) {
  const principals = [{ name: 'Leo', wants: 'To keep what he checked and still trust someone.', interest: 'His care for evidence is also his way of keeping people out.', readingOfShock: 'Leo reads the silence as proof he is alone.' },
    { name: 'Neighbor', wants: 'To be relied on without being asked.', interest: 'Her help arrives only when nobody has asked for it.', readingOfShock: 'She reads the same silence as an invitation.' }];
  const candidate = (id, title) => ({ id, title, world: 'A rainy town street and one house with a stiff door.', account: long(`${title}: Leo comes home to a house he checks each night, and the question of whether anyone is still there decides what he can trust.`),
    premise: 'A man who checks everything returns to a house that may not be empty.', emotionalCore: 'Checking everything can be a way of trusting no one.', question: 'Can care that checks evidence also trust?',
    presses: [{ buttonId: 'button.trust', how: 'The reader recognizes their own checking as distance.' }], authorStake: 'The author spent a working life checking other people\'s work and is asking what it cost.',
    longTermProcesses: ['Leo\'s long habit of checking locks and records.', 'The street\'s slow emptying as neighbors move away.'], centralShock: 'Nobody answers.', principals, costs: 'Every check costs Leo a chance to be surprised.', outcome: 'The question stays open.' });
  const candidates = [candidate('c.door', 'The door'), candidate('c.key', 'The key'), candidate('c.letter', 'The letter')];
  const pressure = candidates.map((item, index) => ({ candidateId: item.id, choicesCost: 'Checking costs trust.', divergentReadings: 'Leo and the neighbor read the silence differently.', shockChanges: 'Leo stops checking once.',
    removableEpisode: 'None.', principalsPartlyRight: 'Both are partly right.', premiseInterest: 'A reader who checks would want it.', readerPull: 'They would keep reading to learn whether he trusts.', verdict: index === 0 ? 'strong' : 'workable' }));
  return [
    { stage: 'author_reader', author: { personId: authorPersonId, name: 'The station archivist', mode: 'invented', lifeModelHash, authorModelNodeId,
      whyThisStory: 'After leaving maintenance work the archivist is writing about the habit of checking that shaped his working life.', teach: 'Nothing settled.',
      figuringOut: 'Whether a life spent checking other people\'s work left room to trust anyone.', lifeRecords: [`referent:${authorPersonId}`, `event:${routeEventId}`] },
      reader: null, buttons: [{ id: 'button.trust', button: 'The fear that checking everything means trusting no one.', presses: 'A careful man meets a silence he cannot check.', learns: 'That their own care may be a way of keeping people out.' }] },
    { stage: 'candidates', authorReaderNodeId, form: { targetWords: 1200, parts: 1 }, candidates, pressure,
      selection: { chosenId: 'c.door', reasons: 'The door makes the checking habit physical and gives the silence a place.', rejected: [{ candidateId: 'c.key', reason: 'The key repeats the door without its place.' }, { candidateId: 'c.letter', reason: 'The letter moves the shock out of the house.' }] } },
  ];
}

export async function recordWorldProcess(addon, { graphHash, storyRootId = 'book', accessScopes, lifeModelHash, authorPersonId = 'author', routeEventId, prefix = 'world' }) {
  const author = await addon.storeAuthorRecord({ graphHash, requestId: `${prefix}.voice`, nodeId: `${prefix}.voice`, storyRootId, authorId: 'editor', accessScopes,
    kind: 'author_model', text: 'The invented archivist whose voice this story uses.', data: { ...fictionalAuthorModel(), modeledAuthorId: authorPersonId } });
  let hash = author.graphHash;
  const record = async (nodeId, summary, world) => {
    const stored = await addon.recordWorld({ graphHash: hash, requestId: nodeId, nodeId, storyRootId, authorId: 'editor', accessScopes, summary, world });
    hash = stored.graphHash;
    return stored;
  };
  const [authorReader, candidates] = worldStagesFor({ authorReaderNodeId: `${prefix}.author`, routeEventId, authorModelNodeId: `${prefix}.voice`, lifeModelHash, authorPersonId });
  await record(`${prefix}.author`, 'The author, the reader and the buttons this story presses.', authorReader);
  await record(`${prefix}.candidates`, 'Three candidate worlds and the chosen one.', candidates);
  await record(`${prefix}.opening`, 'The chosen world opened in successive accounts.', { stage: 'opening', candidatesNodeId: `${prefix}.candidates`,
    accounts: [long('Leo comes home to a house he checks every night.'), `${long('Leo comes home to a house he checks every night.')}\n\n${long('This night the door sticks, and nobody answers when he asks.')}`],
    closedQuestions: ['Leo lives alone in the house.', 'The door has stuck since the winter.', 'Nobody has a key but Leo.'] });
  await record(`${prefix}.aspects`, 'What makes this story interesting, found and investigated.', { stage: 'aspects', openingNodeId: `${prefix}.opening`, aspects: [
    ...storyInterest.map((element, index) => ({ id: `a.${element.id}`, kind: element.id, aspect: element.id === 'flaws' ? 'Leo checks everything so he never has to trust.' : `Where ${element.element.toLowerCase()} lives in this story.`,
      how: 'Model it as processes over time in the story model.', status: index === 0 ? 'modeled' : 'open', records: index === 0 ? [`event:${routeEventId}`] : [] })),
    { id: 'a.flaws.neighbor', kind: 'flaws', aspect: 'The neighbor helps only when nobody asks, so help is never owed.', how: 'Model where her help came from and what it costs.', status: 'open', records: [] },
    { id: 'a.own', kind: 'other', category: 'Unanswered knocking', why: 'The silence after a question is this story\'s own element.', aspect: 'What Leo hears when nobody answers.', how: 'Model the sounds of the house at night.', status: 'open', records: [] }] });
  await record(`${prefix}.implications`, 'What each commitment implies.', { stage: 'implications', openingNodeId: `${prefix}.opening`, commitments: [
    { id: 'c.alone', commitment: 'Leo lives alone in the house.', implications: [{ about: 'Leo', consequence: 'Nobody else can answer his question.', status: 'remainder', reason: 'Only the scene tests it.' }] },
    { id: 'c.door', commitment: 'The door has stuck since the winter.', implications: [{ about: 'the house', consequence: 'Entering takes force and makes noise.', status: 'represented', representedBy: [`event:${routeEventId}`] }] },
    { id: 'c.key', commitment: 'Nobody has a key but Leo.', implications: [{ about: 'Leo', consequence: 'A presence inside would be unexplained.', status: 'remainder', reason: 'The story leaves it open.' }] }] });
  await record(`${prefix}.route`, 'The route through the world.', { stage: 'route', implicationsNodeId: `${prefix}.implications`,
    parts: [{ id: 'part.1', title: 'The arrival', eventIds: [routeEventId], focal: 'Leo', change: 'Leo asks aloud instead of checking.', ends: 'With the question unanswered.' }],
    renderedOrder: 'One part, in order.', whyNotJumps: 'The fixture world has no modeled jumps outside its one arrival.', risks: [{ risk: 'The silence could read as a trick.', repair: 'Keep the house physical and ordinary.' }] });
  const direction = await addon.direct({ graphHash: hash, requestId: `${prefix}.direction`, storyRootId, accessScopes, stage: 'world', directorId: 'fixture-director', independent: true,
    nodeId: `${prefix}.direction`, summary: 'The world holds for this fixture.',
    findings: directorPrinciples.filter((item) => item.stage === 'world').map((item) => ({ principleId: item.principleId ?? item.id, verdict: 'holds', evidence: 'The fixture world was built to hold this principle.', modelChange: null })),
    ownFindings: [{ name: 'The house as a character', verdict: 'holds', evidence: 'The fixture house is modeled through its door.', modelChange: null }] });
  return direction.graphHash;
}
