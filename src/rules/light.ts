import type { Unit } from '../types';
import { blocksLight, cellsOf, inB } from './geometry';
import { hasEff } from './stats';
import { SET } from '../settings';
import { S } from '../state';
import { HXD, cheb, key, sz } from '../util';

/* Свет течёт по клеткам без диагоналей: ромб радиуса R (крест по R клеток и всё между концами). Стены и закрытые двери не пропускают. */
export let _lc: {
  sig: any;
  grid: any;
  S: any;
} = {
  sig: '',
  grid: null,
  S: null,
};
export function lightSources() {
  const L = [];
  const TR = SET.torchR || 3;
  for (const t of S.torches)
    if (t.lit)
      L.push({
        x: t.x,
        y: t.y,
        r: TR,
      });
  for (const u of S.units) {
    if (u.down) continue;
    if (u.torch)
      L.push({
        x: u.x,
        y: u.y,
        r: TR,
        u,
      });
  }
  return L;
}

/* Кэш: версия карты света S.lv растёт при изменении факелов, дверей и стен; носители света учитываются по позициям. */
export function lightSig() {
  let h = ((S.lv || 0) * 1000003 + S.walls.size * 131 + S.torches.length * 17) | 0;
  for (const u of S.units)
    if (!u.down && u.torch) h = (h * 31 + u.x * 97 + u.y * 13 + 0 + sz(u) + (u.torch ? 3 : 0)) | 0;
  return h;
}
export function lightGrid() {
  const sig = lightSig();
  if (_lc.S === S && _lc.sig === sig) return _lc.grid;
  const L = lightSources();
  const g = new Uint8Array(S.w * S.h),
    extra = 0;
  for (const l of L) {
    const starts = l.u
        ? cellsOf(l.u)
        : [
            {
              x: l.x,
              y: l.y,
            },
          ],
      dist = new Map(),
      q = [];
    for (const c of starts) {
      dist.set(key(c.x, c.y), 0);
      q.push([c.x, c.y]);
    }
    let qi = 0;
    while (qi < q.length) {
      const [x, y] = q[qi++],
        d = dist.get(key(x, y));
      if (inB(x, y) && !blocksLight(x, y)) {
        const i = y * S.w + x,
          v = d <= l.r ? 2 : 1;
        if (g[i] < v) g[i] = v;
      }
      if (d >= l.r + extra) continue;
      for (const [dx, dy] of HXD[y & 1]) {
        const nx = x + dx,
          ny = y + dy,
          k = key(nx, ny);
        if (dist.has(k) || !inB(nx, ny) || blocksLight(nx, ny)) continue;
        dist.set(k, d + 1);
        q.push([nx, ny]);
      }
    }
  }
  _lc = {
    sig,
    grid: g,
    S,
  };
  return g;
}
export function cellLight(x, y) {
  if (!SET.darkRules || !inB(x, y)) return 2;
  return lightGrid()[y * S.w + x];
}
export function unitLight(u: Unit) {
  if (!SET.darkRules || u.noLight) return 2;
  let m = 0;
  for (const c of cellsOf(u)) m = Math.max(m, cellLight(c.x, c.y));
  return m;
}
export function darkPen(u: Unit) {
  return SET.darkRules && !u.nv && unitLight(u) === 0 ? 5 : 0;
}

/* По цели в темноте можно действовать только с соседней клетки (кроме ночного зрения). */
export function hiddenFrom(u: Unit, t, from?) {
  if (hasEff(u, 'magsight')) return false;
  const f = from || u;
  if (cheb(f, t) <= 1) return false;
  return SET.darkRules && !u.nv && unitLight(t) === 0;
}

/* Завеса: облако радиуса r вокруг клетки; кто внутри, тот виден и доступен только с соседней клетки, и сам действует только на соседей. Ночное зрение не помогает. */
