import type { Area, Unit, Wound } from '../types';
import type { Opts } from '../types';
import { AREA_RU, WDEG_RU } from '../data/labels';
import { downUnit } from './damage';
import { guiltWatch } from './disorders';
import { ev, uName } from './log';
import { S } from '../state';
import { view } from '../view';
export const AREAS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
export const vital = ar => ar === 'head' || ar === 'torso';
export function woundPenTxt(ar, deg) {
  const s = Math.min(3, Math.max(0, deg - 1));
  if (!s) return 'только кровотечение';
  if (ar === 'head') return `−${2 * s} к Харизме`;
  if (ar === 'torso') return s >= 3 ? 'из захвата самому не вырваться' : `−${2 * s} к освобождению из захвата`;
  if (ar.startsWith('arm')) return s >= 3 ? 'рука не действует' : `−${2 * s} к действиям этой рукой`;
  return s >= 3 ? 'паралич ноги: −2 гекса, −8 к уклонению' : `−${s} гекс. скорости, −${2 * s} к уклонению`;
}

/* Удар: фактический урон 8+ — рана (с ней приходит стартовый стак), 5–7 или клинки Филина — один стак кровотечения. */

export function addWound(u: Unit, ar, opt: Opts = {}) {
  const w = u.wounds[ar];
  if (w && w.deg >= 4 && !vital(ar)) return false;
  const deg = !w ? 1 : w.open ? Math.min(4, w.deg + 1) : w.deg;
  if (opt.closed) {
    u.wounds[ar] = {
      deg,
      open: !!(w && w.open),
      age: w ? w.age : 0,
    };
  } else {
    u.wounds[ar] = {
      deg,
      open: true,
      age: 0,
    };
    u.bleed++;
  }
  if (S.stat) {
    S.stat.wounds++;
    if (u.side === 'pc') S.stat.heroWounds = (S.stat.heroWounds || 0) + 1;
  }
  if (deg >= 4 && vital(ar)) {
    ev(`✝ Смертельное ранение: ${uName(u)} — ${AREA_RU[ar]}, четвёртая рана по открытой`);
    u.hp = 0;
    u.dead = true;
    if (S.stat) S.stat.dead = (S.stat.dead || 0) + 1;
    downUnit(u);
    return true;
  }
  const pen = woundPenTxt(ar, deg);
  ev(
    `🩸 Рана: ${uName(u)} — ${AREA_RU[ar]}, ${WDEG_RU[deg]}${opt.closed ? ' закрытая, без кровотечения' : ''}${w ? (w.open ? ' (повторно по открытой)' : ' (повторно по закрытой)') : ''}${pen ? ', ' + pen : ''}. Стаков кровотечения ${u.bleed}`,
  );
  view.fxText(u, 'рана', 'dmg');
  guiltWatch(u);
  return true;
}

/* Начало своего хода: открытая рана даёт +1 стак; обычная закрывается в начале 3-го хода, серьёзная — 4-го (сначала закрытие). */
export function tickWounds(u: Unit, quiet = false) {
  const closed = [];
  let add = 0;
  for (const ar in u.wounds) {
    const w = u.wounds[ar];
    if (!w.open) continue;
    w.age++;
    if ((w.deg === 1 && w.age >= 3) || (w.deg === 2 && w.age >= 4)) {
      w.open = false;
      closed.push(AREA_RU[ar]);
      continue;
    }
    add++;
  }
  if (closed.length) ev(`${uName(u)}: рана закрылась — ${closed.join(', ')}`);
  if (add) {
    u.bleed += add;
    if (!quiet) ev(`🩸 ${uName(u)}: открытые раны +${add} к кровотечению, стаков ${u.bleed}`);
  }
  return add;
}
export const openWounds = (t: Unit) => (Object.entries(t.wounds || {}) as [Area, Wound][]).filter(([, w]) => w.open);
export function needsCare(t) {
  return t.bleed > 0 || openWounds(t).length > 0;
}
export function careNeed(t) {
  return t.bleed + 2 * openWounds(t).length;
}
export function doBandage(u: Unit, t, a) {
  u.bandages--;
  if (S.stat) S.stat.band++;
  let pts = a.pts || 3;
  const rm = Math.min(pts, t.bleed);
  t.bleed -= rm;
  pts -= rm;
  const closed = [];
  for (const [ar, w] of openWounds(t).sort((x, y) => y[1].deg - x[1].deg)) {
    if (pts <= 0) break;
    w.open = false;
    pts--;
    closed.push(`${AREA_RU[ar]} (${WDEG_RU[w.deg]})`);
  }
  ev(
    `🩹 ${uName(u)} перевязывает ${t === u ? 'себя' : uName(t)}: снято стаков ${rm}${closed.length ? ', закрыты раны: ' + closed.join(', ') : ''}${pts > 0 ? `, неиспользовано пунктов ${pts}` : ''}. Бинтов осталось ${u.bandages}`,
  );
  view.fxText(t, 'перевязка', 'heal');
}
