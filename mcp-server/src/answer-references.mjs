// A Cut answer may name the record it stands for (refers_to). A tool that writes a fresh reading over a stored Cut
// keeps each answer's record by its key while the answer keeps its meaning, so a re-estimate never drops what the
// answers name; an answer whose meaning changed may stand for something else, so its record is not carried.
export function keepAnswerReferences(next, previous) {
  const before = new Map((previous?.answers ?? []).filter((answer) => answer.refers_to).map((answer) => [answer.key, answer]));
  if (!before.size) return next;
  return { ...next, answers: (next.answers ?? []).map((answer) => {
    const old = before.get(answer.key);
    const sameMeaning = old && (answer.meaning === undefined || answer.meaning === old.meaning);
    return !answer.refers_to && sameMeaning ? { ...answer, refers_to: old.refers_to } : answer;
  }) };
}
