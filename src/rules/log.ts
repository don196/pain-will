import type { Unit } from '../types';
import { SET } from '../settings';
import { GEN, S } from '../state';
import { CANCEL, esc } from '../util';
import { view } from '../view';

export function uName(u: Unit) {
  return `<span class="nm ${u.side}" data-uid="${u.id}">${esc(u.name)}</span>`;
}

/* meta — разбор события для ленты и итогов боя: {k:'atk', att, def, dmg, t, ...}, {k:'edge'|'down'|'dead'|'fall'|'bleed', u}. */
export function log(html, cls = '', meta: any = null) {
  if (S.sim) return;
  const e: any = {
    html,
    cls,
  };
  if (meta) {
    meta.round = S.round;
    e.meta = meta;
    tally(meta);
  }
  S.log.push(e);
  if (S.log.length > 600) S.log.shift();
  view.appendLog(e);
}

export function ev(html, meta: any = null) {
  log(html, 'ev', meta);
}

/* Счёт боя по бойцам: Боль нанесена и получена, попадания, криты, раны. */
export function tally(m) {
  const T = (S.tally = S.tally || {});
  const of = id =>
    (T[id] = T[id] || { dealt: 0, taken: 0, atks: 0, hits: 0, crits: 0, wounds: 0, woundsGot: 0, downs: 0 });
  if (m.k === 'atk') {
    const a = of(m.att),
      d = of(m.def);
    a.atks++;
    if (m.t > 0) a.hits++;
    if (m.t === 3) a.crits++;
    a.dealt += m.dmg || 0;
    d.taken += m.dmg || 0;
    if (m.dmg >= 2 || m.t === 3) {
      S.keyRolls = S.keyRolls || [];
      S.keyRolls.push(m);
      S.keyRolls.sort((x, y) => y.dmg - x.dmg || y.t - x.t);
      S.keyRolls.length = Math.min(S.keyRolls.length, 6);
    }
  } else if (m.k === 'bleed' || m.k === 'fall') of(m.u).taken += m.n || 0;
  else if (m.k === 'down' || m.k === 'dead') {
    if (m.by != null) of(m.by).downs++;
  }
}

export function sleep(ms) {
  if (!S || S.sim) return Promise.resolve();
  const g = GEN;
  const f = SET.anim === 'fast' ? 0.3 : 1;
  return new Promise<void>((res, rej) => setTimeout(() => (g === GEN ? res() : rej(CANCEL)), ms * f));
}

/* Показать событие боя и дождаться анимации. В симуляции — ничего. */
export async function show(e) {
  if (!S || S.sim) return;
  const g = GEN;
  await view.play(e);
  if (g !== GEN) throw CANCEL;
}
