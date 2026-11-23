import { cellsOf } from './rules/geometry';
import { FORCED } from './rng';
export const $ = s => document.querySelector(s);
export const el = (t, c, h?) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (h != null) e.innerHTML = h;
  return e;
};
export const key = (x, y) => x + ',' + y;
export const unkey = k => k.split(',').map(Number);
export const sz = o => (o && o.size) || 1;

/* Гексагоны (только для симуляции, true): смещённые строки «odd-r» — нечётные строки сдвинуты вправо на полклетки. Соседей 6, расстояние — по кубическим координатам. */
export const HXD = [
  [
    [1, 0],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ],
  [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [0, 1],
    [1, 1],
  ],
];
export const nbrDirs = (x, y) => HXD[y & 1];
export function hcube(x, y) {
  const q = x - (y - (y & 1)) / 2;
  return [q, y, -q - y];
}
export function hd(x1, y1, x2, y2) {
  const a = hcube(x1, y1),
    b = hcube(x2, y2);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
export const hpx = (x, y) => [x + (y & 1 ? 0.5 : 0), y * 0.8660254];
export function hround(q, r) {
  const s_ = -q - r;
  let rq = Math.round(q),
    rr = Math.round(r),
    rs = Math.round(s_);
  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s_);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return {
    x: rq + (rr - (rr & 1)) / 2,
    y: rr,
  };
}
export function hexLine(p, q, e) {
  const A_ = hcube(p.x, p.y),
    B_ = hcube(q.x, q.y),
    N = hd(p.x, p.y, q.x, q.y),
    out = [];
  for (let i = 1; i < N; i++) {
    const t = i / N;
    out.push(hround(A_[0] + (B_[0] - A_[0]) * t + e, A_[1] + (B_[1] - A_[1]) * t + 2 * e));
  }
  return out;
}
export const cheb = (a, b) => {
  if (sz(a) === 1 && sz(b) === 1) return hd(a.x, a.y, b.x, b.y);
  let m = 1e9;
  for (const p of cellsOf(a))
    for (const q of cellsOf(b)) {
      const d = hd(p.x, p.y, q.x, q.y);
      if (d < m) m = d;
    }
  return m;
};
export const d20 = () => (FORCED.length ? FORCED.shift() : 1 + Math.floor(Math.random() * 20));
export const pick = a => (a.length ? a[Math.floor(Math.random() * a.length)] : null);
export const sum = a => a.reduce((s, m) => s + m.v, 0);
export const fmtN = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
export const pct = p => Math.round(p * 100) + '%';
export const sgn = n => (n >= 0 ? '+' : '−') + Math.abs(n);
export const CANCEL = {
  cancel: true,
};
export const REDUCED =
  typeof window !== 'undefined' && !!window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export const clone = <X>(o: X): X => JSON.parse(JSON.stringify(o));
export const esc = v =>
  String(v ?? '').replace(
    /[&<>"]/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      })[c],
  );
