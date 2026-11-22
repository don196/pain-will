// Таблица баланса: node sim/run.mjs [--n 200] [--scn dummies,dummies6] [--set '{"dexMode":"od"}']
// Гоняет сценарии параллельно через dist/sim.cjs (сначала npm run build) и печатает таблицу в Markdown.
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const n = +arg('n', 200);
const scns = arg('scn', 'dummies,dummies6').split(',');
const set = JSON.parse(arg('set', '{}'));
const parts = Math.max(1, Math.min(cpus().length, 8));
const seed = +arg('seed', 20261123);

// каждый сценарий делим на части, чтобы занять все ядра
const jobs = [];
for (const scn of scns) for (let p = 0; p < parts; p++) {
  const k = Math.floor(n / parts) + (p < n % parts ? 1 : 0);
  if (k) jobs.push({ scn, n: k, set, seed: seed + 10000 * scns.indexOf(scn) + p*2000 });
}
const run = job => new Promise((res, rej) => execFile('node', [path.join(root, 'dist', 'sim.cjs'), 'batch', JSON.stringify(job)], { maxBuffer: 64 << 20 },
  (err, out, errOut) => (err ? rej(new Error(`${job.scn}: ${errOut || err.message}`)) : res(JSON.parse(out)))));

const t0 = Date.now();
let res;
try { res = await Promise.all(jobs.map(run)); } catch (e) { console.error('Симуляция упала:', e.message); process.exit(1); }

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = x => x.toFixed(1).replace('.', ','), f2 = x => x.toFixed(2).replace('.', ',');
console.log(`### Баланс: ${n} боёв на сценарий${Object.keys(set).length ? ' · настройки ' + JSON.stringify(set) : ''}\n`);
console.log('| Сценарий | Победы героев | Победы врагов | Ничьи | Раунды | Падений героев за бой | Выбыло к концу | Смертей героев за бой | Ран у героев за бой |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const scn of scns) {
  const rs = res.filter((_, i) => jobs[i].scn === scn);
  const tot = { n: 0, pc: 0, en: 0, draw: 0, rounds: [], downs: 0, hw: [], ps: {}, falls: 0, deaths: 0, skillEvents: {}, skillHits: {}, skillInterrupts: {} };
  for (const r of rs) {
    tot.n += r.n; tot.pc += r.over.pc; tot.en += r.over.en; tot.draw += r.over.draw; tot.rounds.push(...r.rounds); tot.hw.push(...r.hw);
    tot.falls += r.heroFalls || 0; tot.deaths += r.heroDeaths || 0;
    for (const [k,v] of Object.entries(r.skillEvents||{})) tot.skillEvents[k]=(tot.skillEvents[k]||0)+v;
    for (const [k,v] of Object.entries(r.skillInterrupts||{})) tot.skillInterrupts[k]=(tot.skillInterrupts[k]||0)+v;
    for (const [k,v] of Object.entries(r.skillHits||{})) {let t=tot.skillHits[k]||(tot.skillHits[k]={attempts:0,hits:0,pain:0}); for (const f of ['attempts','hits','pain']) t[f]+=v[f]||0;}
    tot.downs += Object.values(r.downs).reduce((a, b) => a + b, 0);
    for (const [k, v] of Object.entries(r.ps)) tot.ps[k] = (tot.ps[k] || 0) + v;
  }
  const c = v => (v || 0) / tot.n;
  console.log(`| ${scn} | ${Math.round((100 * tot.pc) / tot.n)}% | ${Math.round((100*tot.en)/tot.n)}% | ${Math.round((100*tot.draw)/tot.n)}% | ${f1(mean(tot.rounds))} | ${f2(c(tot.falls))} | ${f2(c(tot.downs))} | ${f2(c(tot.deaths))} | ${f2(mean(tot.hw))} |`);
  if (Object.keys(tot.skillEvents).length) {
    console.log('\n| Приём | Применений за 100 боёв | Атак | Попаданий | Боль противникам | Прерванных подготовок |');
    console.log('|---|---:|---:|---:|---:|---:|');
    for (const [k,n] of Object.entries(tot.skillEvents)) {let h=tot.skillHits[k]||{attempts:0,hits:0,pain:0}; let x=k==='spearReady'?'suppress':k==='aimReady'?'aim':k;console.log(`| ${k} | ${n} | ${h.attempts} | ${h.hits} | ${h.pain} | ${tot.skillInterrupts[x]||0} |`)}
    console.log('');
  }
}
console.log(`\n_ИИ ведёт обе стороны. ${Math.round((Date.now() - t0) / 1000)} с._`);
