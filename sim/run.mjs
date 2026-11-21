// Сводка баланса: node sim/run.mjs [--n 200] [--scn dummies,dummies6] [--modes pain,hp]
// Гоняет сценарии в обоих режимах здоровья параллельно и печатает таблицу в Markdown.
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const n = +arg('n', 200);
const scns = arg('scn', 'dummies,dummies6').split(',');
const modes = arg('modes', 'pain,hp').split(',');
const MODE = { pain: { name: 'Боль', set: { pain: true } }, hp: { name: 'HP', set: { pain: false } } };

const jobs = [];
for (const scn of scns) for (const m of modes) jobs.push({ scn, mode: m, job: { scn, n, set: MODE[m].set } });

function runOne(j) {
  return new Promise((res, rej) => execFile('node', [path.join(dir, 'sim.js'), JSON.stringify(j.job)], { maxBuffer: 64 << 20 },
    (err, out, errOut) => err ? rej(new Error(`${j.scn}/${j.mode}: ${errOut || err.message}`)) : res(JSON.parse(out))));
}
async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const f1 = x => x.toFixed(1).replace('.', ','), f2 = x => x.toFixed(2).replace('.', ',');

const t0 = Date.now();
let res;
try { res = await pool(jobs, Math.max(1, cpus().length), runOne); }
catch (e) { console.error('Симуляция упала:', e.message); process.exit(1); }

const rows = res.map((r, i) => {
  const j = jobs[i], c = v => (v || 0) / r.n, ps = r.ps || {};
  return [j.scn, MODE[j.mode].name, Math.round(100 * r.over.pc / r.n) + '%', f1(mean(r.rounds)),
    f2(c(Object.values(r.downs).reduce((a, b) => a + b, 0))), f2(c(ps.edge)), f2(c(ps.ko)), Math.round(100 * c(ps.dead)) + '%', f2(mean(r.hw))];
});
console.log(`### Баланс: ${n} боёв на строку\n`);
console.log('| Сценарий | Здоровье | Победы героев | Раунды | Героев выбыло к концу | На пороге | Без сознания | Боёв со смертью героя | Ран у героев |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
console.log(`\n_ИИ ведёт обе стороны. «На пороге», «без сознания» и смерть бывают только в режиме Боли. ${Math.round((Date.now() - t0) / 1000)} с._`);
