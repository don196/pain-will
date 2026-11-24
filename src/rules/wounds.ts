import type { Area, Unit, Wound } from '../types';
import type { Opts } from '../types';
import { AREA_RU, WDEG_RU } from '../data/labels';
import { downUnit } from './damage';
import { guiltWatch, willEvent } from './disorders';
import { ev, uName } from './log';
import { S } from '../state';
import { view } from '../view';
export const AREAS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
export const vital = ar => ar === 'head' || ar === 'torso';
export function woundPenTxt(ar, deg) {
  const s = Math.min(3, Math.max(0, deg - 1));
  if (!s) return 'только кровотечение';
  if (ar === 'head') return `−${s} к Харизме и Интуиции`;
  if (ar === 'torso') return s >= 3 ? 'из захвата самому не вырваться' : `−${2 * s} к освобождению из захвата`;
  if (ar.startsWith('arm')) return s >= 3 ? 'рука не действует' : `−${2 * s} к действиям этой рукой`;
  return s >= 3 ? 'паралич ноги: −2 гекса, −8 к уклонению' : `−${s} гекс. скорости, −${2 * s} к уклонению`;
}

/* Удар: фактический урон 8+ — рана (с ней приходит стартовый стак), 5–7 или клинки Филина — один стак кровотечения. */

/* След крови на поле — только картинка, в симуляции не копится. */
export function bloodAt(u: Unit, n = 1) {
  if (!S || S.sim || !u) return;
  S.blood = S.blood || [];
  const b = S.blood.find(o => o.x === u.x && o.y === u.y);
  if (b) b.n = Math.min(6, b.n + n);
  else S.blood.push({ x: u.x, y: u.y, n });
  S.lv = (S.lv || 0) + 1;
  view.drawFloor();
}
/* Кровотечение (свод 2.4): идёт, когда суммарная тяжесть открытых ран (плюс особые источники) не меньше 2;
   тогда +1 Боль в конце своего хода. u.bleed — эта тяжесть, 0 — не кровоточит. */
export function bleedSev(u: Unit) {
  let s = u.bleedX || 0;
  for (const w of Object.values(u.wounds || {}) as Wound[]) if (w && w.open) s += w.deg;
  return s;
}
export function syncBleed(u: Unit) {
  const s = bleedSev(u);
  u.bleed = s >= 2 ? s : 0;
  return u.bleed;
}
export function addWound(u: Unit, ar, opt: Opts = {}) {
  if (!opt.closed) bloodAt(u, 2);
  const w = u.wounds[ar];
  if (w && w.deg >= 4 && !vital(ar)) return false;
  const want = opt.deg || 1;
  const deg = !w ? want : w.open ? Math.min(4, Math.max(w.deg + 1, want)) : Math.max(w.deg, want);
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
  }
  syncBleed(u);
  if (deg >= 3 && u.side === 'pc' && (!w || w.deg < 3)) willEvent(u, -3, 'тяжёлая рана');
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
    `🩸 Рана: ${uName(u)} — ${AREA_RU[ar]}, ${WDEG_RU[deg]}${opt.closed ? ' закрытая, без кровотечения' : ''}${w ? (w.open ? ' (повторно по открытой)' : ' (повторно по закрытой)') : ''}${pen ? ', ' + pen : ''}${u.bleed ? `. Кровотечение (тяжесть ${u.bleed}): +1 Боль в конце своего хода` : ''}`,
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
  void quiet;
  syncBleed(u);
  return add;
}
export const openWounds = (t: Unit) => (Object.entries(t.wounds || {}) as [Area, Wound][]).filter(([, w]) => w.open);
export function needsCare(t) {
  return (t.bleedX || 0) > 0 || openWounds(t).length > 0;
}
export function careNeed(t) {
  return bleedSev(t) + (t.bleed ? 2 : 0) + openWounds(t).length;
}
export function doBandage(u: Unit, t, a) {
  u.bandages--;
  if (S.stat) S.stat.band++;
  /* бинт — 3 пункта обработки: каждый закрывает одну открытую рану (сначала тяжёлые) или унимает особое кровотечение */
  let pts = a.pts || 3;
  const closed = [];
  for (const [ar, w] of openWounds(t).sort((x, y) => y[1].deg - x[1].deg)) {
    if (pts <= 0) break;
    w.open = false;
    pts--;
    closed.push(`${AREA_RU[ar]} (${WDEG_RU[w.deg]})`);
  }
  if (pts > 0 && t.bleedX) {
    t.bleedX = 0;
    pts--;
    closed.push('кровотечение унято');
  }
  syncBleed(t);
  ev(
    `🩹 ${uName(u)} перевязывает ${t === u ? 'себя' : uName(t)}${closed.length ? ': ' + closed.join(', ') : ''}${t.bleed ? `, кровотечение остаётся (тяжесть ${t.bleed})` : ', кровотечения нет'}${pts > 0 ? `, неиспользовано пунктов ${pts}` : ''}. Бинтов осталось ${u.bandages}`,
  );
  view.fxText(t, 'перевязка', 'heal');
}
