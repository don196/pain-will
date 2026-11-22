/* Симулятор без браузера: правила работают сами, обе стороны ведёт ИИ.
   node dist/sim.cjs batch '{"scn":"dummies","n":300,"set":{"dexMode":"od"}}'  — статистика в JSON
   node dist/sim.cjs golden dummies 300                                        — подпись каждого боя (для проверки переделок) */
import { initCombat, phaseLoop } from '../rules/turns';
import { SET } from '../settings';
import { S, buildState, parseScenario, setS } from '../state';

/** Детерминированный генератор: одинаковое зерно — одинаковый бой. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fight(snap: any, seed?: number) {
  if (seed != null) Math.random = mulberry32(seed);
  setS(buildState(snap));
  S.sim = true;
  S.stat = { wounds: 0, heroWounds: 0, torch: 0, band: 0 };
  initCombat();
  await phaseLoop();
}

async function batch(job: { scn: string; n: number; set?: Record<string, any>; seed?: number }) {
  if (job.set) Object.assign(SET, job.set);
  const snap = parseScenario(job.scn);
  const out = {
    n: 0, over: { pc: 0, en: 0, draw: 0 },
    rounds: [] as number[], downs: {} as Record<string,number>,
    hw: [] as number[], ps: {} as Record<string,number>,
    heroFalls: 0, heroDeaths: 0, heroDownAtEnd: 0,
    woundsByHero: {} as Record<string,number>,
    skillEvents: {} as Record<string,number>,
    skillInterrupts: {} as Record<string,number>,
    skillHits: {} as Record<string,{attempts:number;hits:number;pain:number}>,
  };
  for (let i = 0; i < job.n; i++) {
    await fight(snap, job.seed != null ? job.seed + i : undefined);
    out.n++;
    out.over[S.over || 'draw']++;
    out.rounds.push(S.round);
    for (const u of S.units) if (u.side === 'pc') {
      if (u.down) {
        out.downs[u.tpl] = (out.downs[u.tpl] || 0) + 1;
        out.heroDownAtEnd++;
      }
      if (u.dead) out.heroDeaths++;
    }
    out.heroFalls += S.stat.ko || 0;
    out.hw.push(S.stat.heroWounds || 0);
    for (const k of ['edge','ko','dead','revive','band']) out.ps[k] = (out.ps[k] || 0) + (S.stat[k] || 0);
    for (const [k,v] of Object.entries(S.stat.skillEvents || {})) out.skillEvents[k] = (out.skillEvents[k] || 0) + (v as number);
    for (const [k,v] of Object.entries(S.stat.skillInterrupts || {})) out.skillInterrupts[k] = (out.skillInterrupts[k] || 0) + (v as number);
    for (const [k,v] of Object.entries(S.stat.skillHits || {})) {
      const a = out.skillHits[k] || (out.skillHits[k]={attempts:0,hits:0,pain:0});
      a.attempts += (v as any).attempts;
      a.hits += (v as any).hits;
      a.pain += (v as any).pain;
    }
  }
  return out;
}

async function golden(scn: string, n: number) {
  const snap = parseScenario(scn);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    await fight(snap, 1000 + i);
    const units = S.units.slice().sort((a, b) => a.id - b.id);
    lines.push(`${S.over}|${S.round}|` + units.map(u => [u.tpl, u.hp, u.down ? 1 : 0, Object.keys(u.wounds || {}).length, u.bleed, u.armorPts == null ? '-' : u.armorPts].join(':')).join(','));
  }
  return lines.join('\n') + '\n';
}

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  if (cmd === 'batch') process.stdout.write(JSON.stringify(await batch(JSON.parse(args[0]))));
  else if (cmd === 'golden') process.stdout.write(await golden(args[0], +(args[1] || 300)));
  else {
    console.error('node dist/sim.cjs batch \'{"scn":"dummies","n":300}\' | golden <сценарий> [боёв]');
    process.exit(2);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
