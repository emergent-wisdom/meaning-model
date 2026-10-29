// A fixed search flow that prepares one task of every alien role. The world-modelling test runs it with modelling off
// and compares each task text with test/fixtures/alien-tasks-0.16.0.json, captured from 0.16.0 before world modelling.
import { readFile } from 'node:fs/promises';

const scopes = ['author'];
export const baselineProblem = {
  statement: 'How can a family bakery carry a 1,650,000 NOK loan through a bad year without selling to the first buyer?',
  context: 'The owner has told nobody about the debt.',
  targetTerms: ['bakery', 'loan', 'debt'],
};
export const baselineWorld = {
  title: 'The Dusk Exchange', principle: 'Every held thing must change hands before dusk or it dissolves.',
  text: '# The Dusk Exchange\n\nPrinciple: every held thing must change hands before dusk.\n\nR1: Unexchanged goods dissolve at dusk.\nR2: An exchange binds both parties to a return within seven dusks.\nR3: Returns may be made in any good of equal weight.',
  rules: [{ id: 'R1', statement: 'Unexchanged goods dissolve at dusk.' }, { id: 'R2', statement: 'An exchange binds both parties to a return within seven dusks.' },
    { id: 'R3', statement: 'Returns may be made in any good of equal weight.' }],
  easy: ['Circulation'], hard: ['Hoarding'], isolation: { builder: 'fresh_context' },
};
const candidate = { label: 'Circulating claims', design_principles: 'Holdings must keep moving.', core_mechanism: 'Obligations circulate so no one holds a stock.',
  how_it_works: 'Each surplus is passed on at once in exchange for a dated return claim.', what_is_new: 'Security lives in claims, not in stocks.',
  why_it_works: 'Claims survive shocks that stocks do not.', why_it_fails: 'A chain of claims can default all at once.',
  medium_term: 'Claim registries appear.', long_term_vision: 'Stocks become rare and claims are the reserve.' };
const mechanism = {
  operator: 'A holding that must be passed on converts every surplus into a circulating claim on a later return.',
  roles: [{ id: 'holder', description: 'whoever has a surplus', worldRuleIds: ['R1'] }, { id: 'claim', description: 'the dated return owed', worldRuleIds: ['R2'] }],
  strangest: { element: 'holding is impossible', preserved: 'idle holding is costly' }, candidate, isolation: { compiler: 'fresh_context' },
};

export async function flow({ LifeSimulationService, AlienAddon, root, startExtra = {} }) {
  const markdown = await readFile(`${root}/../docs/examples/MINIMAL-MODEL-AND-GRAPH.md`, 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  await service.initialize();
  try {
    const { modelHash } = await service.registerModel(registerRequest);
    const addon = new AlienAddon(service);
    const started = await addon.startSearch({ requestId: 'start', modelHash, graphId: 'alien-baseline', searchId: 'search.baseline',
      title: 'Carrying the loan', problem: baselineProblem, authorId: 'tester', accessScopes: scopes, ...startExtra });
    let graphHash = started.graphHash; let n = 0;
    const base = () => ({ graphHash, searchRootId: 'search.baseline', accessScopes: scopes, authorId: 'tester' });
    const texts = {};
    const task = async (name, role, inputs = {}) => {
      n += 1;
      const prepared = await addon.task({ ...base(), requestId: `t${n}`, role, inputs });
      graphHash = prepared.graphHash; texts[name] = prepared.text;
      return prepared;
    };
    const record = async (nodeId, kind, data, taskNodeId) => {
      const stored = await addon.record({ ...base(), requestId: `r.${nodeId}`, nodeId, kind, data, taskNodeId });
      graphHash = stored.graphHash;
    };
    const builder = await task('builder', 'builder', { seedWord: 'geyser' });
    await record('world.dusk', 'world', baselineWorld, builder.taskNodeId);
    const solver = await task('solver', 'solver', { worldNodeId: 'world.dusk' });
    await record('solve.dusk', 'solution', { worldNodeId: 'world.dusk', text: 'Pass every loaf on at dusk (R1, R2).', citedRuleIds: ['R1', 'R2'], isolation: { solver: 'fresh_context' } }, solver.taskNodeId);
    await task('world_curator', 'world_curator', { subjectNodeId: 'world.dusk' });
    const compiler = await task('compiler', 'compiler', { worldNodeId: 'world.dusk', solutionNodeId: 'solve.dusk' });
    await record('mech.claims', 'mechanism', mechanism, compiler.taskNodeId);
    await task('curator', 'curator', { subjectNodeId: 'mech.claims' });
    await task('explorer', 'explorer', { cueWord: 'tide' });
    await task('transfer', 'transfer', { mechanismNodeId: 'mech.claims' });
    await task('verifier', 'verifier', { subjectNodeId: 'mech.claims', axis: 'parsimony' });
    return texts;
  } finally { service.close(); }
}
