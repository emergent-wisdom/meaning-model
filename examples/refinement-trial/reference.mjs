// A deliberately bounded reference checker, not a general Meaning Model executor.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export const closeEnough = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;
const byId = records => new Map(records.map(r => [r.id, r]));

export function checkRecords(records) {
  const index = byId(records);
  assert.equal(index.size, records.length, 'duplicate record revision');
  const within = (child, parent) => child[0] >= parent[0] && child[1] <= parent[1];
  for (const r of records) {
    assert.ok(r.provenance, `missing provenance: ${r.id}`);
    if (r.form === 'Thing') {
      assert.equal(index.get(r.lifecycle)?.kind, 'lifecycle');
      assert.equal(records.filter(b => b.form === 'Binding' && b.role === 'subject' && b.thing === r.id).length, 1);
    }
    if (r.form === 'Event') {
      assert.ok(r.interval.every(Number.isFinite) && r.interval[1] > r.interval[0], 'fixture uses finite positive intervals');
      if (r.occursWithin) assert.ok(within(r.interval, index.get(r.occursWithin).interval), 'phase outside trial');
      contextOf(records, r.id); // Also rejects cycles and missing authority parents.
    }
    if (r.form === 'Binding') {
      const thing = index.get(r.thing);
      assert.equal(thing?.form, 'Thing');
      assert.equal(index.get(r.event)?.form, 'Event');
      assert.ok(within(r.interval, index.get(r.event).interval));
      assert.ok(within(r.interval, index.get(thing.lifecycle).interval));
    }
    if (r.form === 'Cut') {
      assert.equal(index.get(r.parent)?.form, 'Event');
      assert.ok(r.question && r.unit);
      assert.equal(new Set(r.answers.map(a => a.key)).size, r.answers.length, 'duplicate slot');
      assert.equal(r.answers.filter(a => a.remainder).length, 1, 'one explicit remainder');
      assert.ok(r.answers.every(a => Number.isFinite(a.weight) && a.weight >= 0));
      assert.ok(closeEnough(r.answers.reduce((s, a) => s + a.weight, 0), 1), 'Cut must sum to one');
      if (r.profile === 'sequential') {
        const parent = index.get(r.parent).interval;
        let end = parent[0];
        for (const answer of r.answers.filter(a => !a.remainder)) {
          const child = index.get(answer.target).interval;
          assert.equal(child[0], end, 'fixture phases must tile without gaps or overlaps');
          assert.ok(closeEnough(answer.weight, (child[1] - child[0]) / (parent[1] - parent[0])), 'not a duration share');
          end = child[1];
        }
        assert.equal(end, parent[1]);
        assert.equal(r.answers.find(a => a.remainder).weight, 0);
      }
    }
    if (r.form === 'Realization') {
      assert.equal(index.get(r.concept)?.form, 'Concept');
      assert.ok(index.has(r.target) && index.has(r.parent));
      assert.equal(r.grounding, index.get(r.concept).grounding);
      assert.ok(!('degree' in r), 'fit is not a Realization weight');
    }
  }
  return true;
}

export function slot(records, [revision, key]) {
  const answer = byId(records).get(revision)?.answers?.find(a => a.key === key);
  assert.ok(answer, 'unresolved Cut slot address');
  return answer;
}

export function contextOf(records, id) {
  const index = byId(records), seen = new Set();
  let r = index.get(id), governing;
  while (r) {
    assert.ok(!seen.has(r.id), 'authority cycle');
    seen.add(r.id);
    governing ??= r.context;
    const parent = r.authorityParent ?? r.parent;
    if (parent) assert.ok(index.has(parent), 'missing authority parent');
    r = index.get(parent);
  }
  if (governing) return governing;
  throw new Error('missing authority root');
}

export function visibleAncestry(records, id, permittedContexts) {
  const index = byId(records), result = [];
  let r = index.get(id);
  while (r) {
    // Check authorization before returning this record or following its parents.
    if (!permittedContexts.includes(contextOf(records, r.id))) throw new Error('not visible');
    result.push(r.id);
    r = index.get(r.authorityParent ?? r.parent);
  }
  return result;
}

export function accessibleEvidence(records, context, cutoff) {
  return records.filter(r => r.kind === 'observation' && contextOf(records, r.id) === context
    && r.availableAt <= cutoff).map(r => structuredClone(r.content));
}

export function closeRefinement(records, witness) {
  const index = byId(records), trial = index.get(witness.parent);
  assert.deepEqual(trial.interval, witness.horizon);
  // Reconstruct the protected facts from fine records, not the cached parent.
  const phases = ['setup', 'execution', 'comparison'].map(id => index.get(id));
  assert.ok(phases.every(r => r.data.configuration === phases[0].data.configuration), 'configuration changed within trial');
  const reconstructed = { configuration: phases[0].data.configuration,
    cases: index.get('execution').data.cases, matches: index.get('comparison').data.matches };
  assert.deepEqual([phases[0].interval[0], phases.at(-1).interval[1]], witness.horizon);
  for (const [key, value] of Object.entries(witness.protectedFacts)) {
    assert.deepEqual(trial.data[key], value, `protected fact changed: ${key}`);
    assert.deepEqual(reconstructed[key], value, `fine projection changed: ${key}`);
  }
  const coarse = index.get(witness.coarseCut);
  const totals = Object.fromEntries(coarse.answers.map(a => [a.key, 0]));
  const span = witness.horizon[1] - witness.horizon[0];
  for (const id of witness.fineCuts) {
    const fine = index.get(id), interval = index.get(fine.parent).interval;
    const share = (interval[1] - interval[0]) / span;
    for (const a of fine.answers) {
      const target = witness.slotMap[a.key];
      assert.ok(target in totals, 'slot has no coarse projection');
      totals[target] += share * a.weight;
    }
  }
  for (const a of coarse.answers) assert.ok(closeEnough(totals[a.key], a.weight, witness.tolerance), 'coarse mixture changed');
  return totals;
}

export function residual(coarse, weightedChildren) {
  const used = weightedChildren.reduce((s, c) => s + c.share, 0);
  assert.ok(used >= 0 && used <= 1);
  const result = coarse.map((p, i) => p - weightedChildren.reduce((s, c) => s + c.share * c.vector[i], 0));
  assert.ok(result.every(x => x >= -1e-12), 'negative residual: no possible completion');
  assert.ok(closeEnough(result.reduce((s, x) => s + x, 0), 1 - used));
  return result;
}

export function commit(snapshot, candidate, validate) {
  assert.equal(candidate.base, snapshot.id, 'stale base');
  const records = [...snapshot.records, ...structuredClone(candidate.additions)];
  assert.equal(byId(records).size, records.length, 'cannot overwrite an immutable revision');
  const heads = { ...snapshot.heads };
  const stale = new Set(snapshot.stale ?? []);
  for (const [logical, next] of Object.entries(candidate.replacements ?? {})) {
    const previous = heads[logical];
    assert.ok(previous && byId(records).get(next)?.supersedes === previous, 'invalid replacement');
    // This fixture declares the complete direct derived dependency set explicitly.
    for (const dependent of snapshot.dependencies?.[previous] ?? []) stale.add(dependent);
    heads[logical] = next;
  }
  validate(records); // Nothing in snapshot is mutated if validation fails.
  return { ...snapshot, id: candidate.id, records, heads, stale: [...stale] };
}

export function compareReadback(expected, recovered) {
  return Object.keys(expected).filter(key => !isDeepStrictEqual(expected[key], recovered[key]));
}
