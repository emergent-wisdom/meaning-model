// The remainder is off by default. A Cut whose answers already sum to one is stored with an explicit zero remainder,
// so the record keeps the grammar's explicit remainder while the modeler names a remainder only for a share that is
// genuinely unresolved, as in real-world evidence. A Cut without a remainder whose answers do not sum to one is
// refused with an explanation; the shortfall is never moved into a remainder the modeler did not name.
const TOLERANCE = 1e-9;
const REMAINDER = 'remainder';

export function withDefaultRemainders(model) {
  const cuts = model?.meaning_model?.normalized_cuts;
  if (!Array.isArray(cuts)) return model;
  const completed = new Set();
  const normalizedCuts = cuts.map((cut) => {
    if (!cut || !Array.isArray(cut.answers) || !cut.answers.length || cut.answers.some((answer) => answer?.key === REMAINDER)) return cut;
    // Malformed weights are left to the engine's own validation.
    if (!cut.answers.every((answer) => Number.isFinite(answer?.weight))) return cut;
    const total = cut.answers.reduce((sum, answer) => sum + answer.weight, 0);
    if (Math.abs(total - 1) > TOLERANCE) {
      throw new Error(`Cut ${cut.id} names no remainder, and its answers sum to ${Number(total.toPrecision(12))}, not 1. `
        + 'The remainder is off by default: make the answers sum to one, or add {"key":"remainder","weight":...} only for a share that is genuinely unresolved.');
    }
    completed.add(cut.id);
    return { ...cut, answers: [...cut.answers, { key: REMAINDER, weight: 0 }] };
  });
  if (!completed.size) return model;
  const meaning = { ...model.meaning_model, normalized_cuts: normalizedCuts };
  // A child Cut given its remainder here also needs it mapped in an answer-map projection of a temporal recomposition.
  if (Array.isArray(model.meaning_model.temporal_cut_recompositions)) {
    meaning.temporal_cut_recompositions = model.meaning_model.temporal_cut_recompositions.map((contract) => (!Array.isArray(contract?.children) ? contract : {
      ...contract,
      children: contract.children.map((child) => (child?.projection?.kind === 'answer_map' && completed.has(child.cut_id)
        && child.projection.answers && !(REMAINDER in child.projection.answers)
        ? { ...child, projection: { ...child.projection, answers: { ...child.projection.answers, [REMAINDER]: REMAINDER } } } : child)),
    }));
  }
  return { ...model, meaning_model: meaning };
}
