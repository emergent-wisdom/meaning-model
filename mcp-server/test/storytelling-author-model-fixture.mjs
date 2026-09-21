export function fictionalAuthorModel() {
  return {
    schema: 'meaning-model-story-author-model/v1',
    modeledAuthorId: 'imagined-author', mode: 'fictional_author', label: 'The station archivist',
    basis: [{ id: 'invented-history', kind: 'invented',
      description: 'Earlier maintenance reports favored exhaustive explanation; later sketches of station life taught this invented writer to trust small observable acts.' }, {
      id: 'invented-composition', kind: 'invented',
      description: 'Writes this work at age 58, shortly after leaving station maintenance, drawing only on experience up to that point.' }, {
      id: 'invented-reasons', kind: 'invented',
      description: 'Wants to remember overlooked coworkers and enjoy experimenting with short fiction, while questioning the impulse to idealize the people remembered.' }],
    dispositions: [{
      id: 'restraint', basisIds: ['invented-history', 'invented-composition', 'invented-reasons'],
      outlookOrHabit: 'Trusts a concrete gesture to carry an emotional implication.',
      writingConsequences: ['Begin with what someone actually does.', 'Leave some emotional interpretation to the reader.', 'Let ordinary mistakes coexist with care so remembrance does not turn into idealization.'],
      usefulContexts: 'Quiet exchanges and practiced work.',
      risksOrCounterweights: 'State necessary causal facts clearly when omission would confuse the reader.',
      dimensionIds: [],
    }],
    dimensions: [],
  };
}

export function realAuthorModel() {
  const model = fictionalAuthorModel();
  model.modeledAuthorId = 'writer.alex';
  model.mode = 'real_author';
  model.label = 'Alex’s writing preferences';
  model.basis = [{ id: 'stated-preference', kind: 'author_statement',
    description: 'Alex explicitly prefers a concrete gesture to an explanation of emotion.' }, {
    id: 'sample', kind: 'writing_sample',
    description: 'A supplied writing sample illustrates the preference in one passage.',
    sourceNodeId: 'source.sample', excerpt: 'She left one cup on the sill.',
  }, {
    id: 'interpretation', kind: 'interpretation',
    description: 'The recorder tentatively interprets the sample as emotional restraint, not evidence of Alex’s personal psychology.',
  }];
  model.dispositions[0].basisIds = ['stated-preference', 'sample', 'interpretation'];
  model.dispositions[0].writingConsequences = [
    'Begin with what someone actually does.', 'Leave some emotional interpretation to the reader.',
  ];
  return model;
}

export function authorApplication() {
  return {
    dispositionIds: ['restraint'],
    intendedEffect: 'Make the quiet gauge reading convey practiced attention.',
    restraint: 'Keep the actual temperature explicit; do not omit causal facts for atmosphere.',
    narratorRelation: 'Use a close third-person narrator through Mira; the modeled author remains distinct from that narrator and from Mira.',
  };
}
