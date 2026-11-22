import type { Opts, Unit } from '../types';
import { LASSO_R, lassoTarget } from './lasso';
import { hiddenFrom } from './light';
import { S, hostiles } from '../state';
import { cheb, hd, hexLine, key, nbrDirs, sz, unkey } from '../util';
export const inB = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h;
export const doorAt = (x, y) => S.doors[key(x, y)] || null;
export const barsAt = (x, y) => S.bars[key(x, y)] || null;
export const isWall = (x, y) => {
  if (!inB(x, y)) return true;
  const k = key(x, y);
  if (S.walls.has(k)) return true;
  const d = S.doors[k];
  if (d && !d.open) return true;
  return !!S.bars[k];
};
export const isFloor = (x, y) => !isWall(x, y);
export const blocksShot = (x, y) => {
  if (!inB(x, y)) return true;
  const k = key(x, y);
  if (S.walls.has(k)) return true;
  const d = S.doors[k];
  if (d && !d.open) return true;
  const b = S.bars[k];
  return !!(b && !b.shoot);
};
export const blocksLight = (x, y) => {
  if (!inB(x, y)) return true;
  const k = key(x, y);
  if (S.walls.has(k)) return true;
  const d = S.doors[k];
  return !!(d && !d.open);
};

/* Крупный боец на гексагонах — треугольник из трёх гексов вершиной вниз: опорный, правый сосед и общий нижний сосед. */
export function footCells(x, y, s) {
  if (s <= 1)
    return [
      {
        x,
        y,
      },
    ];
  return [
    {
      x,
      y,
    },
    {
      x: x + 1,
      y,
    },
    {
      x: x + (y & 1),
      y: y + 1,
    },
  ];
}
export const inFoot = (u: Unit, x, y) => {
  if (sz(u) === 1) return x === u.x && y === u.y;
  return footCells(u.x, u.y, sz(u)).some(c => c.x === x && c.y === y);
};
export const unitAt = (x, y) => S.units.find(u => !u.down && inFoot(u, x, y)) || null;
export const cellsOf = o => footCells(o.x, o.y, sz(o));
export const posOf = (u: Unit, x, y) => ({
  x,
  y,
  size: sz(u),
});
export const torchAt = (x, y) => S.torches.find(t => t.x === x && t.y === y) || null;
export function footFree(u: Unit, x, y) {
  for (const c of footCells(x, y, sz(u))) {
    if (isWall(c.x, c.y)) return false;
    const o = unitAt(c.x, c.y);
    if (o && o !== u) return false;
  }
  return true;
}
export function footWalls(u: Unit, x, y) {
  for (const c of footCells(x, y, sz(u))) if (isWall(c.x, c.y)) return true;
  return false;
}

/* Диагональ: между двумя стенами и между стеной и персонажем — нельзя; между двумя персонажами — можно. */
export function bfs(u: Unit, opt: Opts = {}) {
  const dist = new Map();
  dist.set(key(u.x, u.y), {
    d: 0,
    p: null,
  });
  const q = [[u.x, u.y]];
  let qi = 0;
  const leash = u.lassoT ? lassoTarget(u) : null;
  while (qi < q.length) {
    const [x, y] = q[qi++];
    const cur = dist.get(key(x, y));
    if (opt.max != null && cur.d >= opt.max) continue;
    for (const [dx, dy] of nbrDirs(x, y)) {
      const nx = x + dx,
        ny = y + dy,
        k = key(nx, ny);
      if (dist.has(k) || !footFree(u, nx, ny)) continue;
      if (leash && hd(nx, ny, leash.x, leash.y) > LASSO_R) continue;
      dist.set(k, {
        d: cur.d + 1,
        p: key(x, y),
      });
      q.push([nx, ny]);
    }
  }
  return dist;
}
export function pathTo(dist, x, y) {
  const out = [];
  let k = key(x, y);
  while (k && dist.get(k) && dist.get(k).p) {
    out.unshift(unkey(k));
    k = dist.get(k).p;
  }
  return out;
}
export function hexLosCells(p, q, a, b, att: Unit, opt) {
  const block = opt.light ? blocksLight : blocksShot;
  let last = null;
  for (const e of [1e-6, -1e-6]) {
    let bad = null;
    for (const c of hexLine(p, q, e)) {
      if (inFoot(a, c.x, c.y) || inFoot(b, c.x, c.y)) continue;
      if (block(c.x, c.y)) {
        bad = {
          ok: false,
          why: 'стена',
        };
        break;
      }
      if (!opt.noUnits) {
        const o = unitAt(c.x, c.y);
        if (o && o !== att && !(opt.ignoreFriendly && o.side === att.side)) {
          bad = {
            ok: false,
            why: o.name,
          };
          break;
        }
      }
    }
    if (!bad)
      return {
        ok: true,
      };
    last = bad;
  }
  return last;
}
export function los(a, b, att: Unit, opt: Opts = {}) {
  let last = {
    ok: false,
    why: 'стена',
  };
  for (const p of cellsOf(a))
    for (const q of cellsOf(b)) {
      const r = hexLosCells(p, q, a, b, att, opt);
      if (r.ok) return r;
      last = r;
    }
  return last;
}

/* Досягаемость 2: стены по линии; персонаж блокирует только строго посередине (прямо или по диагонали через него). */
export function reachClear(from, t, u: Unit) {
  if (
    !los(from, t, u, {
      noUnits: true,
    }).ok
  )
    return false;
  if (sz(from) === 1 && sz(t) === 1 && hd(from.x, from.y, t.x, t.y) === 2) {
    const m1 = hexLine(from, t, 1e-6)[0],
      m2 = hexLine(from, t, -1e-6)[0],
      occ_ = c => {
        const o = unitAt(c.x, c.y);
        return !!o && o !== u && o !== t;
      };
    if (occ_(m1) && occ_(m2)) return false;
  }
  return true;
}

/* Угол двух стен по диагонали — сплошная стена: из (x,y) в (x±1,y±1) нельзя ни пройти, ни увидеть, ни действовать, если обе боковые клетки — стены (или закрытые двери, глухие решётки). */

/* Соседство с учётом углов: хотя бы одна пара соседних клеток не разделена углом стены. */
export function adjOk(a, b) {
  for (const p of cellsOf(a))
    for (const q of cellsOf(b)) {
      if (hd(p.x, p.y, q.x, q.y) === 1) return true;
      continue;
    }
  return false;
}
export const near1 = (a, b) => cheb(a, b) === 1 && adjOk(a, b);
export function ringCells(u: Unit) {
  const s = sz(u),
    out = [];
  const fc = cellsOf(u);
  for (let y = u.y - 1; y <= u.y + s; y++)
    for (let x = u.x - 2; x <= u.x + s + 1; x++) {
      if (inFoot(u, x, y)) continue;
      if (fc.some(c => hd(c.x, c.y, x, y) === 1))
        out.push({
          x,
          y,
        });
    }
  return out;
}
/* Размашистый удар мечом: пара противников, оба рядом с персонажем и рядом друг с другом. */
export function pairOptions(u: Unit) {
  const ts = hostiles(u).filter(o => near1(u, o) && !hiddenFrom(u, o));
  const out = [];
  for (let i = 0; i < ts.length; i++)
    for (let j = i + 1; j < ts.length; j++) if (near1(ts[i], ts[j])) out.push([ts[i], ts[j]]);
  return out;
}
export function pairTargets(u: Unit, t) {
  const ops = pairOptions(u);
  if (!ops.length) return [];
  if (t) {
    const p = ops.find(p => p.includes(t));
    if (p) return p;
  }
  return ops[0];
}
