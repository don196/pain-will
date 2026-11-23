import { S, selUnit } from '../state';
import { $ } from '../util';
import { cellsOf } from '../rules/geometry';
import { boardH, boardW, tokPos } from './board';

/* Масштаб и сдвиг поля. Телефон: двумя пальцами — масштаб, одним — сдвиг. Компьютер: колесо — масштаб
   вокруг курсора, перетаскивание мышью — сдвиг. Короткое нажатие остаётся нажатием на клетку. */
const Z = { k: 1, x: 0, y: 0, fit: true };
let dragged = false;
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches;

/* Было ли последнее нажатие сдвигом поля (тогда это не нажатие на клетку). */
/* Долгое нажатие на фишку (палец) — открыть карточку бойца. */
let lpT = null;
export const LP = { cb: null as null | ((id) => void) };
function unitIdAt(t: HTMLElement) {
  const tok = t.closest('#toks [data-id]') as HTMLElement;
  if (tok) return +tok.dataset.id;
  const c = t.closest('#hl [data-x]') as HTMLElement;
  if (!c || !S) return null;
  const x = +c.dataset.x,
    y = +c.dataset.y;
  const u =
    S.units.find(o => o.x === x && o.y === y) || S.units.find(o => cellsOf(o).some(q => q.x === x && q.y === y));
  return u ? u.id : null;
}
export function consumeDrag() {
  const d = dragged;
  dragged = false;
  return d;
}

function apply() {
  const b = $('#board');
  if (!b) return;
  b.style.transform = `translate(${Z.x.toFixed(1)}px,${Z.y.toFixed(1)}px) scale(${Z.k.toFixed(3)})`;
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

/* fit — поле целиком; иначе на телефоне крупнее, с выбранным бойцом в центре. keep — сохранить текущий вид. */
export function zoomReset(fit = false, keep = false) {
  if (!S) return;
  const w = $('#wrap');
  if (!w) return;
  if (keep && !Z.fit) {
    clamp();
    apply();
    return;
  }
  const vw = w.clientWidth,
    vh = w.clientHeight,
    fitK = Math.min(vw / boardW(), vh / boardH(), isPhone() ? 9 : 1);
  if (fit || !isPhone()) {
    Z.fit = true;
    Z.k = fitK;
    Z.x = (vw - boardW() * Z.k) / 2;
    Z.y = (vh - boardH() * Z.k) / 2;
  } else {
    Z.fit = false;
    Z.k = Math.max(fitK, Math.min(1.6, (vh / boardH()) * 0.96), 1);
    const u = selUnit(),
      p = u && !u.down ? tokPos(u) : { x: boardW() / 2, y: boardH() / 2 };
    Z.x = vw / 2 - p.x * Z.k;
    Z.y = vh / 2 - p.y * Z.k;
    clamp();
  }
  apply();
}

function zoomAt(cx, cy, k) {
  k = Math.max(0.4, Math.min(3, k));
  const bx = (cx - Z.x) / Z.k,
    by = (cy - Z.y) / Z.k;
  Z.k = k;
  Z.x = cx - bx * k;
  Z.y = cy - by * k;
  Z.fit = false;
  clamp();
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
    if ((e.target as HTMLElement).closest('.bov,.bctl,#fcard')) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) dragged = false;
    snap();
    clearTimeout(lpT);
    if (e.pointerType !== 'mouse' && pts.size === 1 && LP.cb) {
      const id = unitIdAt(e.target as HTMLElement);
      if (id != null)
        lpT = setTimeout(() => {
          if (dragged || pts.size !== 1) return;
          dragged = true; /* следующий щелчок не засчитывается */
          if (navigator.vibrate) navigator.vibrate(12);
          LP.cb(id);
        }, 520);
    }
  });
  w.addEventListener('contextmenu', e => {
    if (isPhone()) e.preventDefault();
  });
  w.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    const a = [...pts.values()];
    if (a.length !== st.n) snap();
    if (a.length === 1) {
      const dx = a[0].x - st.c.x,
        dy = a[0].y - st.c.y;
      if (!dragged && Math.hypot(dx, dy) < (e.pointerType === 'mouse' ? 6 : 10)) return;
      clearTimeout(lpT);
      dragged = true;
      w.classList.add('panning');
      Z.x = st.x + dx;
      Z.y = st.y + dy;
    } else {
      dragged = true;
      const c = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 },
        d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const k = Math.max(0.3, Math.min(3, (st.k * d) / Math.max(1, st.d)));
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
    clearTimeout(lpT);
    pts.delete(e.pointerId);
    w.classList.remove('panning');
    if (pts.size) snap();
  };
  w.addEventListener('pointerup', up);
  w.addEventListener('pointercancel', up);
  w.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') up(e);
  });
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
  w.addEventListener(
    'wheel',
    e => {
      if ((e.target as HTMLElement).closest('#fcard')) return;
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Z.k * Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  const fitBtn = $('#btnFit');
  if (fitBtn) fitBtn.onclick = () => zoomReset(!Z.fit || !isPhone() ? true : false);
}
