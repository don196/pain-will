import type { Unit } from '../types';
import { A } from '../data/actions';
import { canControl, canTarget, trapCells, validCell, validThrow } from '../rules/actions';
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
  ringCells,
  torchAt,
  unitAt,
} from '../rules/geometry';
import { lassoTarget } from '../rules/lasso';
import { darkPen, lightGrid, lightSources } from '../rules/light';
import { fireLine, fireSources, validFlash } from '../rules/magic';
import { hasEff, speedOf } from '../rules/stats';
import { SET } from '../settings';
import { S, selUnit } from '../state';
import { UI, renderForecast, zocPreview } from './panels';
import { fxChips, fxNames, hpFrac, odPipsHTML } from './status';
import { $, REDUCED, cheb, el, hash, hd, key, sz, unkey } from '../util';
export let CELL = 46;
export function appendLog(e) {
  const box = $('#log');
  box.appendChild(el('div', 'le ' + e.cls, e.html));
  while (box.children.length > 600) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
export const SQ3 = Math.sqrt(3);

/* Гексагоны вершиной вверх: CELL — ширина гекса, ряды через CELL·√3/2, нечётные ряды сдвинуты на полгекса вправо. */
export function hc(x, y) {
  return {
    x: (x + 0.5 + (y & 1 ? 0.5 : 0)) * CELL,
    y: TOPM() + ((y * CELL * SQ3) / 2 + CELL / SQ3) * KY,
  };
}
export const boardW = () => (S.w + 0.5) * CELL,
  boardH = () => TOPM() + (((S.h - 1) * CELL * SQ3) / 2 + (CELL * 2) / SQ3) * KY + CELL * 0.45;
export function hexPts(cx, cy, k = 1) {
  const r = (CELL / SQ3) * k * KY,
    w = (CELL / 2) * k;
  return [
    [cx, cy - r],
    [cx + w, cy - r / 2],
    [cx + w, cy + r / 2],
    [cx, cy + r],
    [cx - w, cy + r / 2],
    [cx - w, cy - r / 2],
  ];
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
  const wide = window.innerWidth > 1180;
  const aw = wrap.clientWidth - 22,
    ah = wide ? wrap.clientHeight - 22 : 99999;
  return Math.max(
    wide ? 30 : 34,
    Math.min(78, Math.floor(Math.min(aw / (S.w + 0.5), ah / ((((S.h - 1) * SQ3) / 2 + 2 / SQ3) * KY + 2.0)))),
  );
}
export function layoutBoard() {
  CELL = computeCell();
  document.documentElement.style.setProperty('--cell', CELL + 'px');
  const W = boardW(),
    H = boardH(),
    b = $('#board');
  b.style.width = W + 'px';
  b.style.height = H + 'px';
  const hl = $('#hl');
  hl.setAttribute('width', W);
  hl.setAttribute('height', H);
  hl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const v = CELL + 'x' + S.w + 'x' + S.h;
  if (hl._v !== v) {
    hl._v = v;
    hl.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    for (let y = 0; y < S.h; y++)
      for (let x = 0; x < S.w; x++) {
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
  drawFloor();
  drawLight(performance.now());
  renderTokens();
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
  TOPM = () => CELL * 1.05;
export const floorAt = (x, y) => inB(x, y) && !S.walls.has(key(x, y));

/* Срез стен: стена, за которой может кто-то стоять, рисуется низкой, остальные — в полный рост. */
export function wallH(x, y) {
  const ul = x + (y & 1 ? 0 : -1),
    ur = x + (y & 1 ? 1 : 0);
  return floorAt(ul, y - 1) || floorAt(ur, y - 1) ? CELL * 0.2 : CELL * 0.8;
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
  face(5, 4, fl);
  face(2, 1, fr);
  face(4, 3, fl);
  face(3, 2, fr);
  g.beginPath();
  g.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < 6; i++) g.lineTo(q[i][0], q[i][1]);
  g.closePath();
  g.fillStyle = top;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.stroke();
  return {
    p,
    q,
  };
}
export function drawFloor() {
  if (!S || S.sim) return;
  const g = sizeCanvas($('#floor')),
    cs = CELL,
    W = boardW(),
    H = boardH();
  g.clearRect(0, 0, W, H);
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      if (S.walls.has(key(x, y))) continue;
      const h = hash(x, y),
        c = hc(x, y),
        v = (58 + h * 20) | 0;
      hexPath(g, c.x, c.y, 1.01);
      g.fillStyle = `rgb(${v - 10},${v - 4},${v + 6})`;
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
  /* стены, двери и решётки — от дальних рядов к ближним */
  for (let y = 0; y < S.h; y++)
    for (let x = 0; x < S.w; x++) {
      const k = key(x, y),
        c = hc(x, y),
        h = hash(x, y);
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
          for (const f of [0.35, 0.68]) {
            g.moveTo(pr.p[4][0], pr.p[4][1] - wh * f);
            g.lineTo(pr.p[3][0], pr.p[3][1] - wh * f);
            g.lineTo(pr.p[2][0], pr.p[2][1] - wh * f);
          }
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
          g.moveTo(pr.p[3][0], pr.p[3][1]);
          g.lineTo(pr.q[3][0], pr.q[3][1]);
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
export const FIG_SVG = `<svg viewBox="0 0 40 60" aria-hidden="true">
<path class="bd2" d="M7 58 Q6 33 20 29 Q34 33 33 58 Z"/><path class="bd1" d="M11 58 Q11 36 20 32 Q29 36 29 58 Z"/><path class="ol" d="M7 58 Q6 33 20 29 Q34 33 33 58 Z"/>
<circle class="bd1" cx="20" cy="17" r="10"/><circle class="ol" cx="20" cy="17" r="10"/>
<g class="x-shield"><path d="M1 34 h12 v10 q0 7 -6 10 q-6 -3 -6 -10 Z" fill="#c9d2dc" stroke="#05070a" stroke-width="1.4"/></g>
<g class="x-torch"><rect x="33" y="24" width="3" height="16" fill="#5a3d22" stroke="#05070a" stroke-width=".8"/><ellipse cx="34.5" cy="19" rx="4" ry="7" fill="#ffcf70"/><ellipse cx="34.5" cy="21" rx="2.4" ry="4.5" fill="#f08a2a"/></g>
<g class="x-rope"><ellipse cx="20" cy="40" rx="15" ry="5" fill="none" stroke="#e8d9a8" stroke-width="2.5"/><ellipse cx="20" cy="46" rx="15" ry="5" fill="none" stroke="#e8d9a8" stroke-width="2.5"/></g>
<g class="x-eyes"><circle cx="16" cy="16" r="2.2" fill="#8ff7ff"/><circle cx="24" cy="16" r="2.2" fill="#8ff7ff"/></g>
<g class="x-rip"><path d="M9 13 q3 -4 6 0 t6 0 t6 0 t6 0 M9 19 q3 -4 6 0 t6 0 t6 0 t6 0" fill="none" stroke="#cfe0ff" stroke-width="1.8"/></g>
<g class="x-band"><rect x="9" y="12" width="22" height="7" fill="#000" stroke="#fff" stroke-width="1"/></g>
<g class="x-mute"><path d="M15 21 l10 6 M25 21 l-10 6" stroke="#ff5a4a" stroke-width="2.6"/></g>
<g class="x-prep"><path d="M36 6 v20 M31 11 h10" stroke="#e8e3d5" stroke-width="2.4"/></g>
<text x="20" y="52"></text></svg>`;
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
        '<div class="gr"></div><div class="fig c">' +
          FIG_SVG +
          '</div><div class="drip"></div><div class="stars">✦ ✦</div><div class="bar"><i></i></div><div class="od"></div><div class="fxs"></div><div class="fxn"></div>',
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
        [u.torch, 'torch'],
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
    d.style.left = p.x.toFixed(1) + 'px';
    d.style.top = p.y.toFixed(1) + 'px';
    d.style.zIndex = u.down ? 1 : 10 + Math.round(p.y);
    const fig = d.querySelector('.fig');
    fig.setAttribute('data-x', u.x);
    fig.setAttribute('data-y', u.y);
    const tx = d.querySelector('text');
    if (tx.textContent !== u.glyph) tx.textContent = u.glyph;
    const hp = hpFrac(u),
      bar = d.querySelector('.bar i');
    bar.style.width = hp * 100 + '%';
    bar.style.background = hp > 0.5 ? 'var(--good)' : hp > 0.25 ? 'var(--warn)' : 'var(--bad)';
    d.querySelector('.od').innerHTML = u.down ? '' : odPipsHTML(u);
    const fb = d.querySelector('.fxs'),
      html = u.down ? '' : fxChips(u);
    if (fb._h !== html) {
      fb._h = html;
      fb.innerHTML = html;
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
  } else if (u && S.act && canControl(u)) {
    const a = A[S.act];
    if (a.kind === 'move') {
      const sp = speedOf(u),
        dist = bfs(u, {
          max: sp * Math.min(2, u.od),
        });
      for (const [k, v] of dist) {
        if (!v.d) continue;
        const [x, y] = unkey(k);
        add(x, y, v.d <= sp ? 'mv1' : 'mv2');
        if (SET.zoc && zocPreview(u, pathTo(dist, x, y)).length) add(x, y, 'zw');
      }
      if (S.hover) {
        const hk = key(S.hover.x, S.hover.y);
        if (dist.has(hk) && dist.get(hk).d > 0) {
          for (const [x, y] of pathTo(dist, S.hover.x, S.hover.y)) add(x, y, 'path');
          addU(posOf(u, S.hover.x, S.hover.y), 'path');
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
    } else if (a.kind === 'door') {
      for (const c of ringCells(u)) if (validCell(u, a, c.x, c.y)) add(c.x, c.y, 'tgt');
    } else {
      if (a.ranged) {
        for (let y = 0; y < S.h; y++)
          for (let x = 0; x < S.w; x++) {
            const d = cheb(u, {
              x,
              y,
            });
            if (
              d >= (a.noAdj ? 2 : 1) &&
              d <= a.range &&
              isFloor(x, y) &&
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
          addU(t, ['swap', 'bandage', 'ordnow', 'ordback', 'revive'].includes(a.kind) ? 'ally' : 'tgt');
    }
  }
  if (!S.editor && u && !u.down) addU(u, 'selc');
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
  renderForecast();
}
