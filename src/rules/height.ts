import type { Unit } from '../types';
import { S } from '../state';
import { key } from '../util';

/* Высоты. У клетки есть уровень 0–6; лестница снимает доплату за подъём на соседний уровень.
   Пока на карте нет ни одной поднятой клетки, правила работают в точности как без высот. */
export const H_MAX = 6;

export const hasHeights = () => !!S && !!S.hgt && Object.keys(S.hgt).length > 0;
export const hAt = (x, y) => (S && S.hgt && S.hgt[key(x, y)]) || 0;
export const isStairs = (x, y) => !!(S && S.stairs && S.stairs[key(x, y)]);
/* Уровень бойца — уровень его опорной клетки (крупный боец стоит только на ровном). */
export const hOf = (o: { x: number; y: number }) => hAt(o.x, o.y);

/* Цена шага в клетках перемещения. Ровно — 1. Уступ в 1 уровень без лестницы — 1 + Скорость, то есть ещё одно ОД.
   Уступ в 2 уровня и выше пешком не пройти. */
export function stepCost(fx, fy, tx, ty, climb) {
  const d = hAt(tx, ty) - hAt(fx, fy);
  if (!d) return 1;
  if (Math.abs(d) > 1) return Infinity;
  if (isStairs(fx, fy) || isStairs(tx, ty)) return 1;
  return 1 + climb;
}

/* Ближний бой и соседство — только через перепад не больше 1 уровня. */
export const hNearOk = (p, q) => Math.abs(hAt(p.x, p.y) - hAt(q.x, q.y)) <= 1;

/* Линия видимости с учётом высот (между клетками p и q, cells — клетки линии без концов).
   1) Клетка на линии на 2+ уровня выше обоих концов закрывает обзор, как стена.
   2) Снизу вверх: если по пути от нижнего конца к верхнему встречается подъём больше 1 уровня
      не у самой цели, обзор закрыт — с земли видно только край уступа. Правило симметрично. */
export function heightClear(p, q, cells) {
  const ha = hAt(p.x, p.y),
    hb = hAt(q.x, q.y),
    top = Math.max(ha, hb);
  for (const c of cells) if (hAt(c.x, c.y) >= top + 2) return false;
  if (ha === hb) return true;
  const seq = ha < hb ? [p, ...cells, q] : [q, ...[...cells].reverse(), p];
  for (let i = 1; i < seq.length - 1; i++)
    if (hAt(seq[i].x, seq[i].y) - hAt(seq[i - 1].x, seq[i - 1].y) > 1) return false;
  return true;
}

/* Атака сверху: +2, если атакующий выше цели. */
export function heightMod(u: Unit, t) {
  if (!t || !hasHeights()) return 0;
  return hOf(u) > hOf(t) ? 2 : 0;
}

/* Боль от падения: по уровню 1/2/3/4/5, с 6 — смерть; с 3 — рана, с 5 — серьёзная. */
export function fallPain(h) {
  return Math.min(5, Math.max(0, h));
}
