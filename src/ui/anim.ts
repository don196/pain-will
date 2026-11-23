import { SET } from '../settings';
import { S } from '../state';
import { CELL, tokPos } from './board';
import { $, REDUCED, el } from '../util';

/* Проигрыватель событий боя. Правила сообщают, что случилось («удар», «на пороге»), и ждут,
   пока экран это покажет. В симуляции и тестах без браузера правила этот слой не трогают. */
export function play(e): Promise<void> {
  if (!S || S.sim) return Promise.resolve();
  if (e.t === 'strike') return strikeFx(e);
  if (e.t === 'edge') edgeFx();
  return Promise.resolve();
}

const speed = () => (SET.anim === 'fast' ? 0.4 : 1);
const tokEl = u => (u ? $(`#toks [data-id="${u.id}"]`) : null);
const wait = ms => new Promise<void>(res => setTimeout(res, ms));

function restartClass(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/* Удар: выпад к цели (или отдача при выстреле), бросок d20 над целью, след клинка при попадании. */
function strikeFx(e) {
  const f = speed();
  const A = tokEl(e.att),
    D = tokEl(e.def);
  rollBadge(e, REDUCED ? 0 : 380 * f);
  if (REDUCED || !A || !D) return wait(REDUCED ? 250 : 0);
  const pa = tokPos(e.att),
    pd = tokPos(e.def),
    dx = pd.x - pa.x,
    dy = pd.y - pa.y,
    len = Math.hypot(dx, dy) || 1,
    k = e.ranged ? -0.12 : 0.34;
  const fig = A.querySelector('.fig');
  if (fig) {
    fig.style.setProperty('--lx', ((dx / len) * CELL * k).toFixed(1) + 'px');
    fig.style.setProperty('--ly', ((dy / len) * CELL * k * 0.7).toFixed(1) + 'px');
    restartClass(fig, 'lunge');
  }
  if (e.hit && !e.ranged) setTimeout(() => slashAt(e.def, dx < 0), 140 * f);
  return wait(430 * f);
}

const DEG_SHORT = ['мимо', 'обычный', 'усиленный', 'крит'];
/* своя случайность для мелькающих цифр — поток боя не трогаем */
let spinN = 7;
function rollBadge(e, spin) {
  const p = tokPos(e.def),
    d = el('div', 'roll');
  const deg = e.deg || { t: 0, c: 'fail' };
  const label = deg.t ? DEG_SHORT[deg.t] : e.parried ? 'отбито' : 'мимо';
  d.innerHTML = `<span class="d20"><b>${spin ? Math.max(1, e.total - 7) : e.total}</b></span><span class="rv"><span class="vs">против ${e.vs}</span><span class="dg ${deg.c || 'fail'}">${label}</span></span>`;
  d.style.left = p.x.toFixed(1) + 'px';
  d.style.top = (p.y - CELL * 1.55).toFixed(1) + 'px';
  $('#fx').appendChild(d);
  const b = d.querySelector('b');
  if (spin) {
    d.classList.add('spin');
    const lo = Math.max(1, e.total - 12),
      hi = e.total + 6,
      t0 = performance.now();
    const tick = () => {
      if (!d.isConnected) return;
      if (performance.now() - t0 >= spin) {
        b.textContent = String(e.total);
        d.classList.remove('spin');
        d.classList.add('done');
        return;
      }
      spinN = (spinN * 1103515245 + 12345) & 0x7fffffff;
      b.textContent = String(lo + (spinN % (hi - lo + 1)));
      setTimeout(tick, 45);
    };
    tick();
  } else d.classList.add('done');
  setTimeout(() => d.remove(), spin + 1300 * speed());
}

function slashAt(u, flip) {
  const p = tokPos(u),
    s = CELL * 0.9;
  const d = el(
    'div',
    'slash' + (flip ? ' flip' : ''),
    `<svg viewBox="0 0 40 40" width="${s.toFixed(0)}" height="${s.toFixed(0)}" aria-hidden="true"><path d="M8 6 Q 34 16 30 36" fill="none" stroke="#ffd27a" stroke-width="3.2" stroke-linecap="round"/></svg>`,
  );
  d.style.left = p.x.toFixed(1) + 'px';
  d.style.top = (p.y - CELL * 0.62).toFixed(1) + 'px';
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), 520);
}

/* Герой на пороге: края поля темнеют красным. */
function edgeFx() {
  const w = $('#wrap');
  if (!w || REDUCED) return;
  restartClass(w, 'edgefx');
  setTimeout(() => w.classList.remove('edgefx'), 1900);
}
