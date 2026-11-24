import type { Unit } from '../types';
import { A } from '../data/actions';
import { canControl, canTarget, isHuman, trapCells, validCell, validThrow } from '../rules/actions';
import { stOf } from '../rules/combat';
import {
  adjOk,
  bfs,
  cellsOf,
  inB,
  isFloor,
  los,
  pairOptions,
  pathTo,
  posOf,
  reachClear,
  near1,
  ringCells,
  torchAt,
  unitAt,
} from '../rules/geometry';
import { hAt, hasHeights, isStairs } from '../rules/height';
import { lassoTarget } from '../rules/lasso';
import { darkPen, lightGrid, lightSources } from '../rules/light';
import { fireLine, fireSources, validFlash } from '../rules/magic';
import { hasEff, speedOf } from '../rules/stats';
import { SET } from '../settings';
import { S, selUnit } from '../state';
import { UI, effAct, renderForecast, zocPreview } from './panels';
import { fxChips, fxNames, odPipsHTML } from './status';
import { limOf, onEdge, painOf } from '../rules/pain';
import { sfx, syncDrone } from './sound';
import { drawAllStairsFlat, drawHeightEdges, drawTerrainFlat, drawTerrainObj, floorTone } from './terrain-draw';
import { $, REDUCED, cheb, el, esc, hash, hd, key, pct, sz, unkey } from '../util';
import { phoneH } from './mode';
export let CELL = 46;
export function appendLog(e) {
  const box = $('#log');
  box.appendChild(el('div', 'le ' + e.cls, e.html));
  while (box.children.length > 600) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
export const SQ3 = Math.sqrt(3);

/* Гексагоны вершиной вверх: CELL — ширина гекса, ряды через CELL·√3/2, нечётные ряды сдвинуты на полгекса вправо.
   Плоскость поля (px, py) проецируется на экран: обычно как есть со сжатием по вертикали (KY),
   а в повороте для телефона — на четверть оборота: левый край поля внизу, верхний ряд слева.
   Высота стен и уступов всегда растёт вверх по экрану, поэтому объём не ломается. */
export let ROT = false;
export function setRot(v: boolean) {
  ROT = v;
}
const PW = () => (S.w + 0.5) * CELL,
  PH = () => ((S.h - 1) * CELL * SQ3) / 2 + (CELL * 2) / SQ3;
function proj(px, py) {
  return ROT ? { x: py, y: TOPM() + (PW() - px) * KY } : { x: px, y: TOPM() + py * KY };
}
export function hc0(x, y) {
  return proj((x + 0.5 + (y & 1 ? 0.5 : 0)) * CELL, (y * CELL * SQ3) / 2 + CELL / SQ3);
}
/* Соседи клетки в смещённых рядах. */
export const NB = y =>
  y & 1
    ? [
        [1, 0],
        [1, -1],
        [0, -1],
        [-1, 0],
        [0, 1],
        [1, 1],
      ]
    : [
        [1, 0],
        [0, -1],
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
      ];
/* Порядок рисования: от дальних к ближним по экрану. */
let ORD = null,
  ORDK = '';
export function cellOrder() {
  const k = S.w + 'x' + S.h + (ROT ? 'r' : '');
  if (ORDK !== k) {
    ORDK = k;
    ORD = [];
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) ORD.push([x, y]);
    const sy = ([x, y]) => (ROT ? -((x + 0.5 + (y & 1 ? 0.5 : 0)) * 2) : y * 2);
    ORD.sort((a, b) => sy(a) - sy(b) || (ROT ? a[1] - b[1] : a[0] - b[0]));
  }
  return ORD;
}
/* Центр верхней грани клетки: поднятая клетка рисуется выше на LVL за уровень (вариант А макета 24.11:
   уступы со стенкой, полоса кладки на уровень, тень, кромка по перепаду, метка уровня). */
export const LVL = () => CELL * 0.42;
/* Площадки всегда приподняты; плоский вид 4.5 больше не включается. */
export const RAISED = () => true;
/* Самый высокий уровень на поле — под него нужен запас сверху, чтобы площадки не обрезались. */
let HMX = 0,
  HMXK = '';
export function maxLevel() {
  const k = hgtSig();
  if (k !== HMXK) {
    HMXK = k;
    HMX = Math.max(0, ...Object.values((S && S.hgt) || {}).map(Number));
  }
  return HMX;
}
const extraTop = () => Math.max(0, maxLevel() * 0.42 - 0.8);
export function hc(x, y) {
  const c = hc0(x, y);
  if (S && S.hgt && RAISED()) c.y -= Math.max(0, hAt(x, y)) * LVL();
  return c;
}
/* Подпись высот: если поменялась, кликабельные гексы пересобираются. */
export const hgtSig = () => (S && S.hgt ? Object.entries(S.hgt).join(';') : '');
export const boardW = () => (ROT ? PH() : PW()),
  boardH = () => TOPM() + (ROT ? PW() : PH()) * KY + CELL * 0.45;
export function hexPts(cx, cy, k = 1) {
  const r = (CELL / SQ3) * k,
    w = (CELL / 2) * k;
  const d = [
    [0, -r],
    [w, -r / 2],
    [w, r / 2],
    [0, r],
    [-w, r / 2],
    [-w, -r / 2],
  ];
  /* углы те же по смыслу (0 — к верхнему ряду), меняется только их место на экране */
  return d.map(([dx, dy]) => (ROT ? [cx + dy, cy - dx * KY] : [cx + dx, cy + dy * KY]));
}
export function hexPath(g, cx, cy, k) {
  const p = hexPts(cx, cy, k);
  g.beginPath();
  g.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < 6; i++) g.lineTo(p[i][0], p[i][1]);
  g.closePath();
}
export function tokPos(u: Unit) {
  const cs = cellsOf(u);
  let x = 0,
    y = 0;
  for (const c of cs) {
    const p = hc(c.x, c.y);
    x += p.x;
    y += p.y;
  }
  return {
    x: x / cs.length,
    y: y / cs.length,
  };
}
export function fxText(u: Unit, txt, cls) {
  if (S.sim) return;
  const p = tokPos(u);
  const d = el('div', 'fxt ' + cls, txt);
  d.style.left = p.x + 'px';
  d.style.top = p.y - CELL * 1.25 + 'px';
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), 1200);
}
export function fxLine(a, b, cls) {
  if (S.sim) return;
  const p = tokPos(a),
    q = tokPos(b);
  const dx = q.x - p.x,
    dy = q.y - p.y;
  const d = el('div', 'fxl ' + cls);
  d.style.left = p.x + 'px';
  d.style.top = p.y - CELL * 0.5 + 'px';
  d.style.width = Math.hypot(dx, dy) + 'px';
  d.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  $('#fx').appendChild(d);
  setTimeout(() => d.remove(), 600);
}
export function flash(u: Unit) {
  if (S.sim) return;
  const d = $(`#toks [data-id="${u.id}"]`);
  if (!d) return;
  d.classList.remove('hit');
  void d.offsetWidth;
  d.classList.add('hit');
}
export function computeCell() {
  const wrap = $('#wrap');
  /* поле вписывается и по ширине, и по высоте — при старте видно целиком (телефон тоже, макет 24.11) */
  const wide = wrap.clientHeight > 120;
  const aw = wrap.clientWidth - 22,
    ah = wide ? wrap.clientHeight - 22 : 99999;
  const pw = S.w + 0.5,
    ph = ((S.h - 1) * SQ3) / 2 + 2 / SQ3;
  return Math.max(
    wide ? 30 : 34,
    Math.min(78, Math.floor(Math.min(aw / (ROT ? ph : pw), ah / ((ROT ? pw : ph) * KY + 2.0 + extraTop())))),
  );
}
/* Поворот: «авто» — на телефоне в портрете, если поле шире, чем выше. */
export function wantRot() {
  const m = UI.rot || 'auto';
  if (m === 'on') return true;
  if (m === 'off' || !S) return false;
  return window.innerWidth <= 700 && window.innerHeight > window.innerWidth && S.w > S.h;
}
/* Компьютер в одну колонку (узкое окно): поле занимает экран до панели действий. */
function fitWrapHeight() {
  const wrap = $('#wrap');
  if (!wrap) return;
  const iw = window.innerWidth;
  if (iw <= 700 || iw > 1180 || phoneH()) {
    wrap.style.height = '';
    return;
  }
  const top = wrap.getBoundingClientRect().top + window.scrollY,
    dock = $('#dock') ? $('#dock').offsetHeight : 0;
  wrap.style.height = Math.max(340, Math.round(window.innerHeight - top - dock - 22)) + 'px';
}
export function layoutBoard() {
  setRot(wantRot());
  fitWrapHeight();
  CELL = computeCell();
  document.documentElement.style.setProperty('--cell', CELL + 'px');
  const W = boardW(),
    H = boardH(),
    b = $('#board');
  b.style.width = W + 'px';
  b.style.height = H + 'px';
  syncHexes();
  drawFloor();
  drawLight(performance.now());
  renderTokens();
}
export function syncHexes() {
  const W = boardW(),
    H = boardH();
  const hl = $('#hl');
  hl.setAttribute('width', W);
  hl.setAttribute('height', H);
  hl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const v = CELL + 'x' + S.w + 'x' + S.h + 'x' + hgtSig() + (ROT ? 'r' : '') + (RAISED() ? 'R' : '');
  if (hl._v !== v) {
    hl._v = v;
    hl.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    for (const [x, y] of cellOrder()) {
      const p = document.createElementNS(NS, 'polygon'),
        c = hc(x, y);
      p.setAttribute(
        'points',
        hexPts(c.x, c.y, 0.98)
          .map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1))
          .join(' '),
      );
      p.setAttribute('class', 'c');
      p.setAttribute('data-x', String(x));
      p.setAttribute('data-y', String(y));
      hl.appendChild(p);
    }
  }
}
export function sizeCanvas(c) {
  const dpr = window.devicePixelRatio || 1,
    W = boardW(),
    H = boardH();
  c.width = Math.ceil(W * dpr);
  c.height = Math.ceil(H * dpr);
  c.style.width = W + 'px';
  c.style.height = H + 'px';
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}
export const KY = 0.62,
  TOPM = () => CELL * (1.05 + extraTop());
export const floorAt = (x, y) => inB(x, y) && !S.walls.has(key(x, y));

/* Срез стен: стена, за которой может кто-то стоять, рисуется низкой, остальные — в полный рост. */
export function wallH(x, y) {
  /* за стеной (выше по экрану) есть пол — значит, там может стоять боец */
  const cy = hc0(x, y).y;
  const behind = NB(y).some(([dx, dy]) => floorAt(x + dx, y + dy) && hc0(x + dx, y + dy).y < cy - CELL * 0.1);
  let base = behind ? CELL * 0.2 : CELL * 0.8;
  if (hasHeights() && RAISED()) {
    let m = 0;
    for (const [dx, dy] of NB(y)) if (floorAt(x + dx, y + dy)) m = Math.max(m, hAt(x + dx, y + dy));
    if (m) base = Math.max(base, m * LVL() + CELL * 0.2);
  }
  return base;
}
/* Поднятая клетка: призма от пола до своего уровня. Верх того же тона, что пол (яркость — только свет),
   на видимых стенках — полоса кладки на каждый уровень, по краю — кромка по перепаду:
   пунктир — подъём на 1 за лишнее ОД, толстая — 2 уровня и больше, пешком не пройти; у лестницы — тонкая. */
export function drawRaised(g, x, y) {
  const lv = hAt(x, y),
    c0 = hc0(x, y),
    h = hash(x, y),
    v = (58 + h * 20) | 0,
    cs = CELL,
    L = LVL();
  const pr = prism(
    g,
    c0,
    lv * L,
    `rgb(${v - 10},${v - 4},${v + 6})`,
    `rgb(${v - 26},${v - 22},${v - 12})`,
    `rgb(${v - 36},${v - 32},${v - 22})`,
  );
  const p = pr.p,
    q = pr.q,
    cy0 = p.reduce((a, b) => a + b[1], 0) / 6;
  /* видимые стенки: только те, что смотрят вниз по экрану (вертикальные рёбра пропускаем) */
  const vis = [0, 1, 2, 3, 4, 5].filter(i => (p[i][1] + p[(i + 1) % 6][1]) / 2 > cy0 + 0.5);
  g.lineCap = 'butt';
  g.strokeStyle = 'rgba(6,7,9,.85)';
  g.lineWidth = Math.max(1.5, cs * 0.035);
  g.beginPath();
  for (const i of vis)
    for (let k = 1; k < lv; k++) {
      const j = (i + 1) % 6;
      g.moveTo(p[i][0], p[i][1] - k * L);
      g.lineTo(p[j][0], p[j][1] - k * L);
    }
  g.stroke();
  g.strokeStyle = 'rgba(216,200,166,.28)';
  g.lineWidth = 1;
  g.beginPath();
  for (const i of vis) {
    const j = (i + 1) % 6;
    g.moveTo(q[i][0], q[i][1] + 1.5);
    g.lineTo(q[j][0], q[j][1] + 1.5);
  }
  g.stroke();
  const c = hc(x, y);
  hexPath(g, c.x, c.y - cs * 0.02, 0.8);
  g.fillStyle = 'rgba(255,240,210,.04)';
  g.fill();
  if (isStairs(x, y)) drawLadder(g, x, y, lv * L);
  drawRims(g, x, y, q);
  return pr;
}
/* Кромки верхней грани по перепаду с соседями. */
export function drawRims(g, x, y, q) {
  const cs = CELL,
    lv = hAt(x, y),
    o = y & 1,
    EDGE = [
      [0, 1, x + o, y - 1],
      [1, 2, x + 1, y],
      [2, 3, x + o, y + 1],
      [3, 4, x - 1 + o, y + 1],
      [4, 5, x - 1, y],
      [5, 0, x - 1 + o, y - 1],
    ];
  g.save();
  g.lineCap = 'round';
  for (const [i, j, nx, ny] of EDGE) {
    if (!floorAt(nx, ny)) continue;
    const d = lv - hAt(nx, ny);
    if (d <= 0) continue;
    const seg = () => {
      g.beginPath();
      g.moveTo(q[i][0], q[i][1]);
      g.lineTo(q[j][0], q[j][1]);
    };
    g.setLineDash([]);
    if (isStairs(x, y) || isStairs(nx, ny)) {
      seg();
      g.strokeStyle = 'rgba(232,220,192,.55)';
      g.lineWidth = 1.4;
      g.stroke();
    } else if (d >= 2) {
      seg();
      g.strokeStyle = 'rgba(10,11,13,.95)';
      g.lineWidth = Math.max(4, cs * 0.085);
      g.stroke();
      g.strokeStyle = '#f2e6c9';
      g.lineWidth = Math.max(2, cs * 0.04);
      g.stroke();
    } else {
      seg();
      g.setLineDash([Math.max(3, cs * 0.09), Math.max(2.5, cs * 0.07)]);
      g.strokeStyle = 'rgba(232,220,192,.8)';
      g.lineWidth = 1.6;
      g.stroke();
    }
  }
  g.restore();
}
/* Лестница: две тетивы и перекладины от низкой стороны к высокой. Нет соседа выше — косые ступени. */
export function drawLadder(g, x, y, lift = 0) {
  const lv = hAt(x, y),
    cs = CELL,
    c = hc0(x, y),
    o = y & 1;
  const EDGE = [
    [0, 1, x + o, y - 1],
    [1, 2, x + 1, y],
    [2, 3, x + o, y + 1],
    [3, 4, x - 1 + o, y + 1],
    [4, 5, x - 1, y],
    [5, 0, x - 1 + o, y - 1],
  ];
  let best = null;
  for (const e of EDGE) {
    const [, , nx, ny] = e;
    if (floorAt(nx, ny) && hAt(nx, ny) > lv && (!best || hAt(nx, ny) > hAt(best[2], best[3]))) best = e;
  }
  if (!best) {
    drawFlatStairs(g, x, y);
    return;
  }
  const a = hexPts(c.x, c.y - lift, 0.62),
    [i, j] = best,
    i2 = (i + 3) % 6,
    j2 = (j + 3) % 6;
  const B = [(a[i][0] + a[j][0]) / 2, (a[i][1] + a[j][1]) / 2],
    A0 = [(a[i2][0] + a[j2][0]) / 2, (a[i2][1] + a[j2][1]) / 2];
  /* перпендикуляр в плоскости поля, перенесённый на экран со сжатием */
  const sx = B[0] - A0[0],
    sy = B[1] - A0[1],
    mlen = Math.hypot(sx, sy / KY) || 1,
    w = cs * 0.17,
    px = ((-sy / KY) * w) / mlen,
    py = (sx * KY * w) / mlen;
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = '#d9b77a';
  g.lineWidth = Math.max(2, cs * 0.05);
  g.beginPath();
  for (const s of [-1, 1]) {
    g.moveTo(A0[0] + px * s, A0[1] + py * s);
    g.lineTo(B[0] + px * s, B[1] + py * s);
  }
  g.stroke();
  g.lineWidth = Math.max(1.5, cs * 0.04);
  g.beginPath();
  for (const t of [0.15, 0.38, 0.62, 0.85]) {
    const mx = A0[0] + sx * t,
      my = A0[1] + sy * t;
    g.moveTo(mx - px, my - py);
    g.lineTo(mx + px, my + py);
  }
  g.stroke();
  g.restore();
}
/* Тень от уступов на нижний пол: вниз-вправо, длина по высоте. Рисуется одной мягкой тенью
   (сама фигура уводится за край холста, остаётся только её размытая тень). */
export function drawLedgeShadows(g) {
  const cs = CELL,
    L = LVL(),
    OFF = 20000,
    dpr = g.getTransform ? g.getTransform().a : 1;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.55)';
  g.shadowBlur = cs * 0.14 * dpr;
  g.shadowOffsetX = OFF * dpr;
  g.beginPath();
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      const lv = hAt(x, y);
      if (lv <= 0 || !floorAt(x, y)) continue;
      const c = hc0(x, y),
        H = lv * L;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const pts = hexPts(c.x + H * 0.55 * t - OFF, c.y + H * 0.35 * t, 1.02);
        g.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < 6; k++) g.lineTo(pts[k][0], pts[k][1]);
        g.closePath();
      }
    }
  g.fillStyle = '#000';
  g.fill('nonzero');
  g.restore();
}
/* Лестница на уровне 0 и ниже — лестница к высокому соседу. */
export function drawFlatStairs(g, x, y) {
  const c = hc(x, y),
    cs = CELL;
  g.strokeStyle = 'rgba(10,12,16,.5)';
  g.lineWidth = Math.max(1.5, cs * 0.04);
  g.beginPath();
  for (const f of [-0.22, 0, 0.22]) {
    g.moveTo(c.x - cs * 0.3, c.y + f * cs * KY);
    g.lineTo(c.x + cs * 0.3, c.y + f * cs * KY);
  }
  g.stroke();
}
export function prism(g, c, h, top, fl, fr, k?) {
  const p = hexPts(c.x, c.y, k || 1),
    q = p.map(a => [a[0], a[1] - h]);
  const face = (i, j, col) => {
    g.beginPath();
    g.moveTo(q[i][0], q[i][1]);
    g.lineTo(q[j][0], q[j][1]);
    g.lineTo(p[j][0], p[j][1]);
    g.lineTo(p[i][0], p[i][1]);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.lineWidth = 1;
    g.stroke();
  };
  /* видимы грани, обращённые к зрителю (вниз по экрану); левые темнее правых */
  const cy0 = p.reduce((a, b) => a + b[1], 0) / 6,
    cx0 = p.reduce((a, b) => a + b[0], 0) / 6;
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6,
      my = (p[i][1] + p[j][1]) / 2,
      mx = (p[i][0] + p[j][0]) / 2;
    if (my >= cy0 - 0.01) face(i, j, mx <= cx0 + 0.01 ? fl : fr);
  }
  g.beginPath();
  g.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < 6; i++) g.lineTo(q[i][0], q[i][1]);
  g.closePath();
  g.fillStyle = top;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.stroke();
  /* передние углы слева направо — для кладки и дверей */
  const front = [0, 1, 2, 3, 4, 5].filter(i => p[i][1] >= cy0 - 0.01).sort((a, b) => p[a][0] - p[b][0]);
  const bot = front.reduce((a, b) => (p[b][1] > p[a][1] + 0.01 ? b : a), front[0]);
  return {
    p,
    q,
    front,
    bot,
  };
}
export function drawFloor() {
  if (!S || S.sim) return;
  syncHexes();
  const g = sizeCanvas($('#floor')),
    cs = CELL,
    W = boardW(),
    H = boardH();
  g.clearRect(0, 0, W, H);
  const flat = !RAISED();
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      if (S.walls.has(key(x, y)) || (!flat && hAt(x, y) > 0)) continue;
      const h = hash(x, y),
        c = hc(x, y),
        v = (58 + h * 20) | 0;
      hexPath(g, c.x, c.y, 1.01);
      g.fillStyle = floorTone(x, y, v);
      g.fill();
      hexPath(g, c.x, c.y, 1);
      g.strokeStyle = 'rgba(0,0,0,.5)';
      g.lineWidth = 1;
      g.stroke();
      hexPath(g, c.x, c.y - cs * 0.02, 0.8);
      g.fillStyle = 'rgba(255,240,210,.035)';
      g.fill();
      if (h > 0.84) {
        g.strokeStyle = 'rgba(0,0,0,.4)';
        g.beginPath();
        g.moveTo(c.x - cs * 0.25, c.y + cs * 0.08);
        g.lineTo(c.x, c.y);
        g.lineTo(c.x + cs * 0.15, c.y + cs * 0.14);
        g.stroke();
      }
    }
  if (hasHeights()) drawHeightEdges(g, cellOrder(), flat);
  if (flat) drawAllStairsFlat(g);
  else
    for (let y = 0; y < S.h; y++)
      for (let x = 0; x < S.w; x++) if (isStairs(x, y) && hAt(x, y) <= 0 && floorAt(x, y)) drawLadder(g, x, y);
  if (S.terrain) drawTerrainFlat(g);
  /* кровь на полу: где ранили и где истекали кровью */
  for (const b of S.blood || []) {
    if (!floorAt(b.x, b.y)) continue;
    const c = hc(b.x, b.y),
      h0 = hash(b.x * 7 + b.n, b.y * 13);
    g.fillStyle = `rgba(${110 + ((h0 * 40) | 0)},14,12,${Math.min(0.75, 0.3 + b.n * 0.12)})`;
    for (let i = 0; i < Math.min(5, 1 + b.n); i++) {
      const hx = hash(b.x * 31 + i, b.y * 17 + i),
        hy = hash(b.y * 29 + i, b.x * 11 + i);
      g.beginPath();
      g.ellipse(
        c.x + (hx - 0.5) * cs * 0.5,
        c.y + (hy - 0.5) * cs * 0.3 * KY,
        cs * (0.08 + hx * 0.12),
        cs * (0.05 + hy * 0.08) * KY + 1,
        hx * 3,
        0,
        7,
      );
      g.fill();
    }
  }
  for (const tr of S.traps || []) {
    const c = hc(tr.x, tr.y);
    g.save();
    g.translate(c.x, c.y);
    g.scale(1, KY);
    g.strokeStyle = '#aab2bb';
    g.lineWidth = Math.max(1.5, cs * 0.05);
    g.beginPath();
    g.arc(0, 0, cs * 0.26, 0, 7);
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const an = (i * Math.PI) / 5;
      g.moveTo(Math.cos(an) * cs * 0.26, Math.sin(an) * cs * 0.26);
      g.lineTo(Math.cos(an) * cs * 0.38, Math.sin(an) * cs * 0.38);
    }
    g.stroke();
    g.restore();
  }
  for (const t of S.torches)
    if (t.floor) {
      const c = hc(t.x, t.y);
      g.save();
      g.translate(c.x, c.y + cs * 0.1);
      g.rotate(-0.4);
      g.fillStyle = '#4a3520';
      g.fillRect(-cs * 0.22, -cs * 0.03, cs * 0.36, cs * 0.06);
      g.restore();
    }
  if (hasHeights() && !flat) drawLedgeShadows(g);
  /* стены, двери и решётки — от дальних рядов к ближним */
  for (const [x, y] of cellOrder()) {
    const k = key(x, y),
      c = hc(x, y),
      h = hash(x, y);
    if (!S.walls.has(k) && hAt(x, y) > 0 && !flat) {
      drawRaised(g, x, y);
      drawTerrainObj(g, x, y);
      continue;
    }
    if (S.terrain && !S.walls.has(k)) drawTerrainObj(g, x, y);
    if (S.walls.has(k)) {
      const wh = wallH(x, y),
        t = (74 + h * 14) | 0;
      const pr = prism(
        g,
        c,
        wh,
        `rgb(${t},${t + 8},${t + 20})`,
        `rgb(${t - 30},${t - 25},${t - 14})`,
        `rgb(${t - 44},${t - 40},${t - 30})`,
      );
      if (wh > cs * 0.5) {
        g.strokeStyle = 'rgba(0,0,0,.35)';
        g.beginPath();
        for (const f of [0.35, 0.68])
          pr.front.forEach((i, n) => (n ? g.lineTo : g.moveTo).call(g, pr.p[i][0], pr.p[i][1] - wh * f));
        g.stroke();
      }
      const tc = torchAt(x, y);
      if (tc && !tc.floor) {
        g.fillStyle = '#2b2018';
        g.fillRect(c.x - cs * 0.04, c.y - wh * 0.5, cs * 0.08, cs * 0.22);
        g.fillStyle = '#6b4a28';
        g.fillRect(c.x - cs * 0.1, c.y - wh * 0.5 - cs * 0.03, cs * 0.2, cs * 0.07);
      }
    } else if (S.doors[k]) {
      const d = S.doors[k];
      if (d.open) {
        prism(
          g,
          {
            x: c.x - cs * 0.36,
            y: c.y,
          },
          cs * 0.55,
          '#6b4726',
          '#4a3018',
          '#3a2412',
          0.22,
        );
        prism(
          g,
          {
            x: c.x + cs * 0.36,
            y: c.y,
          },
          cs * 0.55,
          '#6b4726',
          '#4a3018',
          '#3a2412',
          0.22,
        );
      } else {
        const pr = prism(g, c, cs * 0.6, '#7a5230', '#5a3d22', '#48301a', 0.96);
        g.strokeStyle = '#22150a';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(pr.p[pr.bot][0], pr.p[pr.bot][1]);
        g.lineTo(pr.q[pr.bot][0], pr.q[pr.bot][1]);
        g.stroke();
        if (d.locked) {
          g.fillStyle = '#e2b93b';
          g.beginPath();
          g.arc(c.x, c.y - cs * 0.12, cs * 0.08, 0, 7);
          g.fill();
        }
      }
    } else if (S.bars[k]) {
      const b = S.bars[k];
      g.strokeStyle = b.shoot ? '#9aa3ad' : '#5a646e';
      g.lineWidth = Math.max(2, cs * 0.05);
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const fx = c.x - cs * 0.4 + i * cs * 0.2;
        g.moveTo(fx, c.y + cs * 0.08);
        g.lineTo(fx, c.y - cs * 0.6);
      }
      g.moveTo(c.x - cs * 0.44, c.y - cs * 0.6);
      g.lineTo(c.x + cs * 0.44, c.y - cs * 0.6);
      g.moveTo(c.x - cs * 0.44, c.y - cs * 0.2);
      g.lineTo(c.x + cs * 0.44, c.y - cs * 0.2);
      g.stroke();
    }
  }
}
export const FIG_SVG = `<svg viewBox="0 0 44 48" aria-hidden="true">
<path class="bd2" d="M4 47 Q3 25 22 21 Q41 25 40 47 Z"/><path class="bd1" d="M9 47 Q9 28 22 24.5 Q35 28 35 47 Z"/><path class="ol" d="M4 47 Q3 25 22 21 Q41 25 40 47 Z"/>
<circle class="bd1" cx="22" cy="16.5" r="9.5"/><circle class="ol" cx="22" cy="16.5" r="9.5"/>
<g class="x-shield"><path d="M1 27 h12 v9 q0 6 -6 9 q-6 -3 -6 -9 Z" fill="#c9d2dc" stroke="#05070a" stroke-width="1.4"/></g>
<g class="x-torch"><rect x="37" y="20" width="3" height="14" fill="#5a3d22" stroke="#05070a" stroke-width=".8"/><ellipse cx="38.5" cy="15" rx="4" ry="6.5" fill="#ffcf70"/><ellipse cx="38.5" cy="17" rx="2.4" ry="4.2" fill="#f08a2a"/></g>
<g class="x-rope"><ellipse cx="22" cy="33" rx="17" ry="4.5" fill="none" stroke="#e8d9a8" stroke-width="2.5"/><ellipse cx="22" cy="39" rx="17" ry="4.5" fill="none" stroke="#e8d9a8" stroke-width="2.5"/></g>
<g class="x-eyes"><circle cx="18" cy="16" r="2.2" fill="#8ff7ff"/><circle cx="26" cy="16" r="2.2" fill="#8ff7ff"/></g>
<g class="x-rip"><path d="M11 12 q3 -4 6 0 t6 0 t6 0 t6 0 M11 18 q3 -4 6 0 t6 0 t6 0 t6 0" fill="none" stroke="#cfe0ff" stroke-width="1.8"/></g>
<g class="x-band"><rect x="12" y="12" width="20" height="6.5" fill="#000" stroke="#fff" stroke-width="1"/></g>
<g class="x-mute"><path d="M17 20 l10 6 M27 20 l-10 6" stroke="#ff5a4a" stroke-width="2.6"/></g>
<g class="x-prep"><path d="M40 3 v15 M35 8 h10" stroke="#e8e3d5" stroke-width="2.4"/></g>
<g class="x-bow"><path d="M38 19 Q49 33 38 46" fill="none" stroke="#8a6a3c" stroke-width="2.6"/><path d="M38 19 L38 46" stroke="#d9cfb8" stroke-width="1"/></g>
<g class="x-mage"><path d="M11.5 19 Q22 -4 32.5 19 Q28 12.5 22 12.5 Q16 12.5 11.5 19Z" fill="var(--b2)" stroke="#05070a" stroke-width="1.4"/><path d="M4 17 L5.5 47" stroke="#6a5130" stroke-width="2.4"/><circle cx="4" cy="16" r="3" fill="#b9a0e6"/></g>
<g class="x-heavy"><ellipse cx="9" cy="27" rx="6.5" ry="4.5" fill="var(--b1)" stroke="#05070a" stroke-width="1.4"/><ellipse cx="35" cy="27" rx="6.5" ry="4.5" fill="var(--b1)" stroke="#05070a" stroke-width="1.4"/></g>
<g class="x-blade"><path d="M36 26 L42 9" stroke="#c9d2dc" stroke-width="2.2"/><path d="M34 27 L39 25" stroke="#6a5130" stroke-width="2.4"/></g>
<text x="22" y="41"></text></svg>`;
/* Силуэт по типу бойца: щит, лук, маг, тяжёлый, клинок. */
export function roleOf(u: Unit) {
  const acts = (u.acts || []).map(id => A[id]).filter(Boolean);
  if (acts.some(a => a.magic && ['attack', 'curse2'].includes(a.kind))) return 'mage';
  if (sz(u) > 1 || u.tpl === 'dummyFat') return 'heavy';
  if (acts.some(a => a.kind === 'attack' && a.ranged && !a.magic) && !(u.shield > 0)) return 'bow';
  return 'blade';
}
export function renderTokens() {
  if (!S || S.sim) return;
  const box = $('#toks'),
    seen = new Set();
  for (const u of S.units) {
    let d = box.querySelector(`[data-id="${u.id}"]`);
    if (!d) {
      d = el(
        'div',
        'tok3',
        '<div class="sh"></div><div class="gr"></div><div class="fig c">' +
          FIG_SVG +
          '</div><div class="drip"></div><div class="stars">✦ ✦</div><div class="bar"></div><div class="pn"></div><div class="od"></div><div class="fxs"></div><div class="fxn"></div>',
      );
      d.dataset.id = u.id;
      box.appendChild(d);
      const fg = d.querySelector('.fig');
      fg.onmouseenter = () => d.classList.add('hov');
      fg.onmouseleave = () => d.classList.remove('hov');
    }
    seen.add(String(u.id));
    const heat = stOf(u, 'heat');
    const vis = UI.fxVis !== false;
    const cls =
      'tok3 ' +
      u.side +
      [
        [u.down, 'down'],
        [S.sel === u.id, 'sel'],
        [sz(u) > 1, 's2'],
        [!u.down && !S.over && !S.editor && u.side === S.phase && u.od === 0, 'spent'],
        [!u.down && !S.over && !S.editor && !S.busy && u.side === S.phase && u.od > 0 && isHuman(u.side), 'ready'],
        [u.torch, 'torch'],
        [true, 'r-' + roleOf(u)],
        [u.shield > 0, 'shield'],
        [darkPen(u) > 0 && !(vis && heat), 'dark'],
        ...(!vis
          ? []
          : [
              [u.prone && !u.down, 'prone'],
              [hasEff(u, 'blind2') || false, 'blind'],
              [stOf(u, 'ripple') > 0, 'ripple'],
              [hasEff(u, 'mute'), 'mute'],
              [stOf(u, 'disor') > 0, 'disor'],
              [u.stunned, 'out'],
              [stOf(u, 'unst') > 0 && !u.prone, 'unst'],
              [heat === 1, 'heat1'],
              [heat >= 2, 'heat2'],
              [u.bleed > 0, 'bleed'],
              [hasEff(u, 'vuln2') || false, 'vuln'],
              [hasEff(u, 'weak2'), 'weak'],
              [hasEff(u, 'fmark'), 'fmark'],
              [hasEff(u, 'lasso'), 'lasso'],
              [hasEff(u, 'snare'), 'snare'],
              [hasEff(u, 'magsight'), 'msight'],
              [!!u.prep, 'prep'],
            ]),
      ]
        .filter(x => x[0])
        .map(x => ' ' + x[1])
        .join('');
    const keep =
      (d.classList.contains('hit') ? ' hit' : '') +
      (d.classList.contains('peek') ? ' peek' : '') +
      (d.classList.contains('hov') ? ' hov' : '');
    if (d.className.replace(' hit', '').replace(' peek', '').replace(' hov', '') !== cls) d.className = cls + keep;
    const p = tokPos(u);
    const pk = u.x + ',' + u.y;
    if (d._pk && d._pk !== pk && !S.editor) sfx('step');
    d._pk = pk;
    d.style.left = p.x.toFixed(1) + 'px';
    d.style.top = p.y.toFixed(1) + 'px';
    d.style.zIndex = u.down ? 1 : 10 + Math.round(p.y);
    const fig = d.querySelector('.fig');
    fig.setAttribute('data-x', u.x);
    fig.setAttribute('data-y', u.y);
    const tx = d.querySelector('text');
    if (tx.textContent !== u.glyph) tx.textContent = u.glyph;
    /* шкала Боли делениями; новые деления вспыхивают */
    const L = limOf(u),
      pn = Math.min(L, painOf(u)),
      bar = d.querySelector('.bar'),
      bk = L + ':' + pn + (onEdge(u) ? 'e' : '');
    if (bar._k !== bk) {
      const prev = bar._p == null ? pn : bar._p;
      let h = '';
      for (let i = 0; i < L; i++)
        h += `<i class="${i < pn ? 'on' : ''}${i >= prev && i < pn && !REDUCED ? ' new' : ''}"></i>`;
      bar.innerHTML = h;
      bar.className = 'bar segs' + (onEdge(u) ? ' edge' : '');
      bar._k = bk;
      bar._p = pn;
      /* Боль ещё и числом — не только цветом */
      const pe = d.querySelector('.pn');
      pe.textContent = u.down || !pn ? '' : `${pn}/${L}`;
      pe.style.left = ((L * 6) / 2 + 3).toFixed(0) + 'px';
      /* без Боли шкала не мешает — видна только при наведении и выборе */
      bar.classList.toggle('zero', !pn);
    }
    /* тень от ближайшего света: вытянута в сторону от него */
    const sh = d.querySelector('.sh');
    const ls = lightSources().filter(l => l.u !== u);
    let best = null;
    for (const l of ls) {
      const q = l.u ? tokPos(l.u) : hc(l.x, l.y),
        dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || dd < best.d) best = { q, d: dd };
    }
    if (best && best.d > 1) {
      const ang = Math.atan2(p.y - best.q.y, p.x - best.q.x),
        len = Math.max(0.35, Math.min(1, (CELL * 4) / best.d));
      sh.style.setProperty('--sa', ang.toFixed(3) + 'rad');
      sh.style.setProperty('--sl', len.toFixed(2));
      sh.style.opacity = String(Math.min(0.7, 0.25 + (CELL * 2) / best.d).toFixed(2));
    } else sh.style.opacity = '0';
    const od = d.querySelector('.od'),
      oh = u.down ? '' : odPipsHTML(u);
    if (od._h !== oh + CELL + sz(u)) {
      od._h = oh + CELL + sz(u);
      od.innerHTML = oh;
      /* очки действий — полукругом по переднему краю круга под ногами */
      const pips = [...od.children] as HTMLElement[],
        n = pips.length,
        big = sz(u) > 1 ? 2.1 : 1,
        rx = CELL * 0.4 * big,
        ry = CELL * 0.25 * big,
        step = Math.min(30, 120 / Math.max(1, n - 1)) / big;
      pips.forEach((b, i) => {
        const a = ((90 + (i - (n - 1) / 2) * step) * Math.PI) / 180;
        b.style.left = (Math.cos(a) * rx).toFixed(1) + 'px';
        b.style.top = (Math.sin(a) * ry).toFixed(1) + 'px';
      });
    }
    const fb = d.querySelector('.fxs'),
      html = u.down ? '' : fxChips(u);
    if (fb._h !== html) {
      fb._h = html;
      fb.innerHTML = html;
      /* в толпе — два значка и «+N», остальные при наведении */
      const n = fb.children.length;
      if (n > 2) fb.dataset.more = String(n - 2);
      else delete fb.dataset.more;
      d.querySelector('.fxn').innerHTML = u.down ? '' : fxNames(u);
    }
  }
  for (const d of [...box.children]) if (!seen.has(d.dataset.id)) d.remove();
  /* верёвка силка и линия Перехвата */
  const sv = $('#links');
  if (sv) {
    let h = '';
    const W = boardW(),
      H = boardH();
    sv.setAttribute('width', W);
    sv.setAttribute('height', H);
    const ln = (a, b, c) => {
      const p = tokPos(a),
        q = tokPos(b);
      h += `<line class="${c}" x1="${p.x.toFixed(1)}" y1="${(p.y - CELL * 0.45).toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${(q.y - CELL * 0.4).toFixed(1)}"/>`;
    };
    for (const u of S.units) {
      if (u.down || UI.fxVis === false) continue;
      const t = u.lassoT && lassoTarget(u);
      if (t) ln(u, t, 'rope');
    }
    sv.innerHTML = h;
  }
  syncDrone();
}
export function drawLight(t) {
  if (!S || S.sim) return;
  const c = $('#light');
  let g = c._g;
  if (!g || c._v !== CELL + 'x' + S.w + 'x' + S.h) {
    g = sizeCanvas(c);
    c._g = g;
    c._v = CELL + 'x' + S.w + 'x' + S.h;
  }
  const W = boardW(),
    H = boardH();
  g.clearRect(0, 0, W, H);
  if (SET.lighting) {
    const L = SET.darkRules ? lightGrid() : null;
    if (L) {
      for (let y = 0; y < S.h; y++)
        for (let x = 0; x < S.w; x++) {
          if (S.walls.has(key(x, y))) continue;
          const v = L[y * S.w + x];
          if (v === 2) continue;
          const c = hc(x, y);
          hexPath(g, c.x, c.y, 1.02);
          g.fillStyle = 'rgba(6,5,10,.7)';
          g.fill();
        }
      g.globalCompositeOperation = 'lighter';
      for (const l of lightSources()) {
        const p = l.u ? tokPos(l.u) : hc(l.x, l.y),
          cx = p.x,
          cy = p.y,
          f = REDUCED ? 1 : 0.92 + 0.06 * Math.sin(t / 140 + l.x * 7 + l.y) + 0.03 * Math.sin(t / 53 + l.x),
          R = (l.r + 0.5) * CELL * f;
        g.save();
        g.translate(cx, cy);
        g.scale(1, KY);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
        gr.addColorStop(0, 'rgba(224,144,63,.2)');
        gr.addColorStop(1, 'rgba(224,144,63,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(0, 0, R, 0, 7);
        g.fill();
        g.restore();
      }
      g.globalCompositeOperation = 'source-over';
    }
  }
  for (const tr of S.torches) {
    const hp = hc(tr.x, tr.y),
      cx = hp.x + (tr.floor ? CELL * 0.12 : 0),
      cy = hp.y + (tr.floor ? CELL * 0.06 : -wallH(tr.x, tr.y) * 0.5 - CELL * 0.06);
    if (tr.lit) {
      const f = REDUCED ? 1 : 1 + 0.12 * Math.sin(t / 90 + tr.x);
      g.fillStyle = '#ffcf70';
      g.beginPath();
      g.ellipse(cx, cy - CELL * 0.05, CELL * 0.09, CELL * 0.17 * f, 0, 0, 7);
      g.fill();
      g.fillStyle = '#e0903f';
      g.beginPath();
      g.ellipse(cx, cy, CELL * 0.06, CELL * 0.1 * f, 0, 0, 7);
      g.fill();
    } else {
      g.fillStyle = '#3a3530';
      g.beginPath();
      g.arc(cx, cy, CELL * 0.06, 0, 7);
      g.fill();
    }
  }
}
export let lastFrame = 0;
export function loop(t) {
  if (!REDUCED && S && !S.sim && t - lastFrame > 70) {
    lastFrame = t;
    drawLight(t);
  }
  requestAnimationFrame(loop);
}
export function renderHL() {
  if (!S || S.sim) return;
  let losLine = null,
    zlab = null;
  const cells = $('#hl').children,
    cls = new Array(S.w * S.h).fill('');
  const add = (x, y, c) => {
    if (inB(x, y)) cls[y * S.w + x] += ' ' + c;
  };
  const addU = (o, c) => {
    for (const p of cellsOf(o)) add(p.x, p.y, c);
  };
  const u = selUnit();
  if (S.editor) {
    for (let i = 0; i < cls.length; i++) cls[i] = ' ed';
  } else if (u && effAct(u) && canControl(u)) {
    const a = A[effAct(u)];
    if (a.kind === 'move') {
      const sp = speedOf(u),
        dist = bfs(u, {
          max: sp * Math.min(2, u.od),
        });
      for (const [k, v] of dist) {
        if (!v.d) continue;
        const [x, y] = unkey(k);
        add(x, y, v.d <= sp ? 'mv1' : 'mv2');
      }
      if (S.hover) {
        const hk = key(S.hover.x, S.hover.y);
        if (dist.has(hk) && dist.get(hk).d > 0) {
          const path = pathTo(dist, S.hover.x, S.hover.y);
          for (const [x, y] of path) add(x, y, 'path');
          addU(posOf(u, S.hover.x, S.hover.y), 'path');
          /* зона контроля — только на этом пути: кто ударит и с каким шансом */
          const zp = SET.zoc ? zocPreview(u, path) : [];
          for (const z of zp) addU(z.e, 'zthreat');
          if (zp.length)
            zlab = {
              at: S.hover,
              html: zp.map(z => `⚔ ${esc(z.e.name)} ударит, ${pct(z.p)}`).join('<br>'),
            };
        }
      }
    } else if (a.kind === 'pair') {
      const ops = pairOptions(u);
      for (const p of ops) for (const t of p) addU(t, 'tgt');
      if (S.hover) {
        const ht = unitAt(S.hover.x, S.hover.y);
        const p = ht && ops.find(p => p.includes(ht));
        if (p) for (const t of p) addU(t, 'arc');
      }
    } else if (a.kind === 'throw') {
      for (let y = 0; y < S.h; y++)
        for (let x = 0; x < S.w; x++)
          if (
            validThrow(u, a, {
              x,
              y,
            })
          )
            add(x, y, 'rng');
      if (S.hover && validThrow(u, a, S.hover)) add(S.hover.x, S.hover.y, 'tgt');
    } else if (a.kind === 'trap') {
      for (const c of trapCells(u)) add(c.x, c.y, 'tgt');
    } else if (a.kind === 'flash') {
      for (const c of fireSources())
        if (validFlash(u, c)) {
          add(c.x, c.y, 'tgt');
        }
      if (S.hover && validFlash(u, S.hover))
        for (let y = 0; y < S.h; y++)
          for (let x = 0; x < S.w; x++) {
            const d = hd(S.hover.x, S.hover.y, x, y);
            if (
              d <= 3 &&
              isFloor(x, y) &&
              fireLine(S.hover, {
                x,
                y,
              })
            )
              add(x, y, d <= 1 ? 'arc' : 'rng');
          }
    } else if (a.kind === 'door' || a.kind === 'objectStrike' || a.kind === 'objectPush') {
      for (const c of ringCells(u)) if (validCell(u, a, c.x, c.y)) add(c.x, c.y, 'tgt');
    } else {
      if (a.ranged) {
        for (let y = 0; y < S.h; y++)
          for (let x = 0; x < S.w; x++) {
            if (!isFloor(x, y)) continue;
            const d = cheb(u, {
              x,
              y,
            });
            if (
              d >= (a.noAdj ? 2 : 1) &&
              d <= a.range &&
              los(
                u,
                {
                  x,
                  y,
                },
                u,
              ).ok
            )
              add(x, y, 'rng');
            else if (d > 0) add(x, y, 'dimc');
          }
        /* линия выстрела к клетке под курсором: зелёная — чисто, красная — что перекрывает */
        if (S.hover && (S.hover.x !== u.x || S.hover.y !== u.y)) {
          const tu = unitAt(S.hover.x, S.hover.y);
          const tgt = tu || S.hover,
            d = cheb(u, tgt),
            l = los(u, tgt, u);
          const far = d > a.range,
            ok = l.ok && !far && !(a.noAdj && d < 2);
          losLine = {
            from: tokPos(u),
            to: tu ? tokPos(tu) : hc(S.hover.x, S.hover.y),
            ok,
            why: !l.ok
              ? 'перекрывает: ' + l.why
              : far
                ? `далеко: ${d} из ${a.range}`
                : a.noAdj && d < 2
                  ? 'вплотную нельзя'
                  : '',
          };
        }
      } else if ((a.reach || 1) > 1 && a.kind === 'attack') {
        for (let y = 0; y < S.h; y++)
          for (let x = 0; x < S.w; x++) {
            const d = cheb(u, {
              x,
              y,
            });
            if (
              d >= 1 &&
              d <= a.reach &&
              isFloor(x, y) &&
              (d === 1
                ? adjOk(u, {
                    x,
                    y,
                  })
                : reachClear(
                    u,
                    {
                      x,
                      y,
                    },
                    u,
                  ))
            )
              add(x, y, 'rng');
          }
      }
      for (const t of S.units)
        if (canTarget(u, a, t))
          addU(t, ['swap', 'bandage', 'cauterHeal', 'ordnow', 'ordback', 'revive'].includes(a.kind) ? 'ally' : 'tgt');
    }
  }
  if (!S.editor && u && !u.down) addU(u, 'selc');
  /* опасная кромка: стоит на уступе, рядом враг — могут столкнуть вниз */
  if (!S.editor && hasHeights())
    for (const o of S.units) {
      if (o.down || !hAt(o.x, o.y)) continue;
      const drop = ringCells(o).some(c => floorAt(c.x, c.y) && hAt(c.x, c.y) < hAt(o.x, o.y));
      if (drop && S.units.some(e => !e.down && e.side !== o.side && near1(e, o))) addU(o, 'ledge');
    }
  if (!S.editor && !S.over && UI.zoc && SET.zoc) {
    const side = u && !u.down ? u.side : 'pc';
    for (const e of S.units) {
      if (e.down || e.side === side || e.stunned || e.zocRound === S.round) continue;
      for (const c of ringCells(e)) if (inB(c.x, c.y) && isFloor(c.x, c.y) && adjOk(e, c)) add(c.x, c.y, 'zoc');
    }
  }
  for (let i = 0; i < cells.length; i++) {
    const c = 'c' + cls[i];
    if (cells[i].getAttribute('class') !== c) cells[i].setAttribute('class', c);
  }
  drawLos(losLine);
  drawZlab(zlab);
  drawLevels();
  renderForecast();
}
/* Метки уровня: одна на площадку — на ближней к зрителю свободной клетке; с «Уровнями» — цифра на каждом гексе. */
let PLAT = [],
  PLATK = '';
function plateaus() {
  const k = hgtSig() + '|' + Object.keys(S.stairs || {}).join(';');
  if (k === PLATK) return PLAT;
  PLATK = k;
  PLAT = [];
  const seen = new Set();
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      const lv = hAt(x, y);
      if (!lv || !floorAt(x, y) || isStairs(x, y) || seen.has(key(x, y))) continue;
      const comp = [],
        st = [[x, y]];
      seen.add(key(x, y));
      while (st.length) {
        const [a, b] = st.pop();
        comp.push([a, b]);
        for (const [dx, dy] of NB(b)) {
          const nx = a + dx,
            ny = b + dy,
            kk = key(nx, ny);
          if (!seen.has(kk) && floorAt(nx, ny) && !isStairs(nx, ny) && hAt(nx, ny) === lv) {
            seen.add(kk);
            st.push([nx, ny]);
          }
        }
      }
      PLAT.push({ lv, cells: comp });
    }
  return PLAT;
}
export function drawLevels() {
  const sv = $('#lvb');
  if (!sv) return;
  const W = boardW(),
    H = boardH();
  sv.setAttribute('width', W);
  sv.setAttribute('height', H);
  sv.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!S || S.sim || !hasHeights()) {
    sv.innerHTML = '';
    return;
  }
  const cs = CELL,
    f = n => n.toFixed(1),
    out = [];
  const busy = (x, y) => S.units.some(u => !u.down && cellsOf(u).some(c => c.x === x && c.y === y));
  if (UI.lvnum) {
    for (let y = 0; y < S.h; y++)
      for (let x = 0; x < S.w; x++) {
        const lv = hAt(x, y);
        if (!lv || !floorAt(x, y)) continue;
        const c = hc(x, y),
          dy = busy(x, y) ? cs * 0.3 : cs * 0.07;
        out.push(`<text class="ln all" x="${f(c.x)}" y="${f(c.y + dy)}" font-size="${f(cs * 0.2)}">${lv}</text>`);
      }
  }
  for (const pl of plateaus()) {
    const scr = pl.cells.map(([x, y]) => ({ x, y, p: hc(x, y), b: busy(x, y) }));
    scr.sort((a, b) => Number(a.b) - Number(b.b) || b.p.y - a.p.y || a.p.x - b.p.x);
    const { p } = scr[0],
      bw = cs * 0.62,
      bh = cs * 0.3,
      tx = p.x - bw * 0.2,
      s = bh * 0.32,
      up = pl.lv > 0,
      cy = p.y + (UI.lvnum ? cs * 0.3 : 0);
    out.push(
      `<g><rect class="lb" x="${f(p.x - bw / 2)}" y="${f(cy - bh / 2)}" width="${f(bw)}" height="${f(bh)}" rx="${f(bh / 2)}"/>` +
        `<path class="lt" d="${up ? `M${f(tx - s)} ${f(cy + s * 0.7)}L${f(tx)} ${f(cy - s * 0.8)}L${f(tx + s)} ${f(cy + s * 0.7)}Z` : `M${f(tx - s)} ${f(cy - s * 0.7)}L${f(tx)} ${f(cy + s * 0.8)}L${f(tx + s)} ${f(cy - s * 0.7)}Z`}"/>` +
        `<text class="ln" x="${f(p.x + bw * 0.14)}" y="${f(cy + bh * 0.24)}" font-size="${f(bh * 0.68)}">${Math.abs(pl.lv)}</text></g>`,
    );
  }
  sv.innerHTML = out.join('');
}
function drawLos(l) {
  const sv = $('#losl');
  if (!sv) return;
  sv.setAttribute('width', boardW());
  sv.setAttribute('height', boardH());
  if (!l) {
    sv.innerHTML = '';
    return;
  }
  const y0 = l.from.y - CELL * 0.45,
    y1 = l.to.y - CELL * 0.35,
    mx = (l.from.x + l.to.x) / 2,
    my = (y0 + y1) / 2;
  sv.innerHTML = `<line class="los ${l.ok ? 'ok' : 'bad'}" x1="${l.from.x.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${l.to.x.toFixed(1)}" y2="${y1.toFixed(1)}"/>${l.why ? `<text class="losw" x="${mx.toFixed(1)}" y="${(my - 8).toFixed(1)}">${esc(l.why)}</text>` : ''}`;
}
function drawZlab(z) {
  const box = $('#zlab');
  if (!box) return;
  if (!z) {
    box.hidden = true;
    return;
  }
  const p = hc(z.at.x, z.at.y);
  box.innerHTML = z.html;
  box.style.left = p.x.toFixed(1) + 'px';
  box.style.top = (p.y + CELL * 0.35).toFixed(1) + 'px';
  box.hidden = false;
}
