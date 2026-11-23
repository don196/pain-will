import { S, selUnit } from '../state';
import { $ } from '../util';
import { boardH, boardW, tokPos } from './board';

/* Поле на телефоне: двумя пальцами — масштаб, одним — сдвиг. Короткое касание остаётся нажатием на клетку.
   На широком экране поле не масштабируется. */
const Z = { on: false, k: 1, x: 0, y: 0, fit: false };
let dragged = false;
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches;

/* Было ли последнее касание сдвигом поля (тогда это не нажатие на клетку). */
export function consumeDrag() {
  const d = dragged;
  dragged = false;
  return d;
}

function apply() {
  const b = $('#board');
  if (!b) return;
  b.style.transform = Z.on ? `translate(${Z.x.toFixed(1)}px,${Z.y.toFixed(1)}px) scale(${Z.k.toFixed(3)})` : '';
}

function clamp() {
  const w = $('#wrap'),
    W = boardW() * Z.k,
    H = boardH() * Z.k,
    vw = w.clientWidth,
    vh = w.clientHeight,
    m = 48;
  Z.x = W <= vw ? (vw - W) / 2 : Math.min(m, Math.max(vw - W - m, Z.x));
  Z.y = H <= vh ? (vh - H) / 2 : Math.min(m, Math.max(vh - H - m, Z.y));
}

/* fit — поле целиком; иначе обычный масштаб с выбранным бойцом в центре. */
export function zoomReset(fit = false) {
  Z.on = isPhone();
  if (!Z.on || !S) {
    apply();
    return;
  }
  const w = $('#wrap'),
    vw = w.clientWidth,
    vh = w.clientHeight,
    fitK = Math.min(vw / boardW(), vh / boardH());
  Z.fit = fit;
  if (fit) {
    Z.k = fitK;
    Z.x = (vw - boardW() * Z.k) / 2;
    Z.y = (vh - boardH() * Z.k) / 2;
  } else {
    Z.k = Math.max(fitK, Math.min(1.6, (vh / boardH()) * 0.96), 1);
    const u = selUnit(),
      p = u && !u.down ? tokPos(u) : { x: boardW() / 2, y: boardH() / 2 };
    Z.x = vw / 2 - p.x * Z.k;
    Z.y = vh / 2 - p.y * Z.k;
    clamp();
  }
  apply();
}

export function initZoom() {
  const w = $('#wrap');
  const pts = new Map();
  let st = null;
  const local = e => {
    const r = w.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const snap = () => {
    const a = [...pts.values()];
    const c = a.length > 1 ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 } : a[0];
    const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
    st = { c, d, k: Z.k, x: Z.x, y: Z.y, n: a.length };
  };
  w.addEventListener('pointerdown', e => {
    if (!Z.on || (e.target as HTMLElement).closest('.bov,.bctl')) return;
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) dragged = false;
    snap();
  });
  w.addEventListener('pointermove', e => {
    if (!Z.on || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    const a = [...pts.values()];
    if (a.length !== st.n) snap();
    if (a.length === 1) {
      const dx = a[0].x - st.c.x,
        dy = a[0].y - st.c.y;
      if (!dragged && Math.hypot(dx, dy) < 10) return;
      dragged = true;
      Z.x = st.x + dx;
      Z.y = st.y + dy;
    } else {
      dragged = true;
      const c = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 },
        d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const k = Math.max(0.3, Math.min(2.6, (st.k * d) / Math.max(1, st.d)));
      const bx = (st.c.x - st.x) / st.k,
        by = (st.c.y - st.y) / st.k;
      Z.k = k;
      Z.x = c.x - bx * k;
      Z.y = c.y - by * k;
    }
    Z.fit = false;
    clamp();
    apply();
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (pts.size) snap();
  };
  w.addEventListener('pointerup', up);
  w.addEventListener('pointercancel', up);
  /* после сдвига щелчок по клетке не засчитывается */
  w.addEventListener(
    'click',
    e => {
      if (dragged) {
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
      }
    },
    true,
  );
  const fitBtn = $('#btnFit');
  if (fitBtn) fitBtn.onclick = () => zoomReset(!Z.fit);
}
