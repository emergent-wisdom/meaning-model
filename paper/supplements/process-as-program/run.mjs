// Runs the office program in three versions and prints the dated values it computes.
// Usage: node run.mjs [path-to-life-sim-engine]   (default: ../../../rust-engine/target/release/life-sim-engine)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(process.argv[2] ?? process.env.LIFE_SIM_ENGINE ?? join(here, '../../../rust-engine/target/release/life-sim-engine'));
const base = JSON.parse(readFileSync(join(here, 'office.model.json'), 'utf8'));
const observables = base.processes.map((p) => p.id);

const versions = [
  { id: 'two-jobs', label: 'Limit the office to two jobs a month', orders: 80, successor: false },
  { id: 'four-jobs', label: 'Accept four jobs a month', orders: 160, successor: false },
  { id: 'four-jobs-successor', label: 'Accept four jobs; fund a second checker from August 1852', orders: 160, successor: true },
];

const child = spawn(engine, ['--ndjson'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const waiting = [];
lines.on('line', (line) => waiting.shift()(JSON.parse(line)));
const send = (command) => new Promise((done) => { waiting.push(done); child.stdin.write(JSON.stringify(command) + '\n'); });
const command = async (id, operation, fields) => {
  const reply = await send({ schema: 'life-sim-rust-command/v1', request_id: id, operation, ...fields });
  if (!reply.ok) throw new Error(`${operation}: ${JSON.stringify(reply).slice(0, 800)}`);
  return reply.result;
};

const results = [];
for (const v of versions) {
  const model = structuredClone(base);
  model.id = `${base.id}-${v.id}`;
  model.processes.find((p) => p.id === 'office.ordered_hours').initial_value.value = v.orders;
  model.processes.find((p) => p.id === 'office.demand_ratio').initial_value.value = v.orders / 80;
  model.laws.find((l) => l.id === 'successor-funded').enabled = v.successor;
  const registered = await command(`register-${v.id}`, 'register_model', { model });
  await command(`create-${v.id}`, 'create_world', { model_hash: registered.summary.model_hash, world_id: `office-${v.id}` });
  // The engine advances a world by at most 30 time units per roll, so the 36 months
  // are rolled and committed one year at a time.
  const samples = [];
  for (let year = 0; year < 3; year += 1) {
    const rolled = await command(`roll-${v.id}-${year}`, 'roll_world', {
      world_id: `office-${v.id}`,
      query: { schema: 'life-sim-rust-model-query/v1', delta_time: 12.0, step_size: 0.25, seed: `office-${year}`, requested_observables: observables, path: { mode: 'full' } },
    });
    const path = rolled.candidate.path.samples;
    samples.push(...(year === 0 ? path : path.slice(1)));
    await command(`commit-${v.id}-${year}`, 'commit_candidate', { candidate_hash: rolled.candidate.candidate_hash });
  }
  results.push({ version: v, model_hash: registered.summary.model_hash, samples });
}
child.stdin.end();
writeFileSync(join(here, 'runs.json'), JSON.stringify(results, null, 1));

// A month-by-month summary of what the program computed.
const value = (sample, id) => {
  const v = sample.state[id];
  return typeof v === 'number' ? v : v?.value ?? v?.scalar ?? NaN;
};
const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (t) => `${month[Math.round(t) % 12]} ${1852 + Math.floor(Math.round(t) / 12)}`;
const out = ['# Runs of the office program', '', 'Month 0 is January 1852. Every value below is computed by the laws in `office.model.json`; none was entered by hand.', ''];
for (const r of results) {
  out.push(`## ${r.version.label}`, '', `Model ${r.model_hash.slice(0, 16)}.`, '', '| Month | Ordered h | Capacity h | Backlog h | Queue (months) | Jobs out unchecked |', '|---|---|---|---|---|---|');
  for (const t of [0, 3, 4, 6, 7, 8, 12, 24, 36]) {
    const s = r.samples.find((x) => Math.abs(x.time - t) < 1e-9);
    if (!s) continue;
    out.push(`| ${label(t)} | ${value(s, 'office.ordered_hours')} | ${value(s, 'office.check_capacity')} | ${value(s, 'office.backlog').toFixed(0)} | ${value(s, 'office.queue_months').toFixed(2)} | ${value(s, 'office.unchecked_jobs')} |`);
  }
  const first = r.samples.find((x) => value(x, 'office.unchecked_jobs') > 0);
  out.push('', first ? `First job delivered unchecked: month ${first.time} (${label(Math.floor(first.time))}).` : 'No job is delivered unchecked.', '');
}
writeFileSync(join(here, 'runs-summary.md'), out.join('\n'));
console.log(out.join('\n'));
