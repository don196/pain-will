/* Рисование окружения и высот «как в 4.5»: верх каждой площадки остаётся на своём гексе,
   высоту показывают оттенок площадки, светлая кромка и грань, свисающая к нижнему соседу.
   Предметы — на том же гексе, что и бойцы. */
import { TERRAIN } from '../data/terrain';
import { hAt, isStairs } from '../rules/height';
import { S } from '../state';
import { hash, hd, key, unkey } from '../util';
import { CELL, KY, ROT, floorAt, hc, hexPath, hexPts } from './board';

/* Соседи по сторонам гекса: угол i — угол j, клетка за этой стороной. */
export function edgeNbrs(x, y) {
  const o = y & 1;
  return [
    [0, 1, x + o, y - 1],
    [1, 2, x + 1, y],
    [2, 3, x + o, y + 1],
    [3, 4, x - 1 + o, y + 1],
    [4, 5, x - 1, y],
    [5, 0, x - 1 + o, y - 1],
  ];
}

/* Оттенок пола по уровню: выше — светлее, ниже нуля — темнее. */
export function floorTone(x, y, v) {
  const lv = hAt(x, y);
  if (!lv) return `rgb(${v - 10},${v - 4},${v + 6})`;
  const d = lv > 0 ? Math.min(6, lv) * 9 : Math.max(-6, lv) * 9;
  return `rgb(${v - 10 + d},${v - 4 + d},${v + 6 + d})`;
}

/* Грани и кромки между разными уровнями. Грань свисает вниз от передней стороны площадки;
   если внизу рядом стоит боец, грань полупрозрачна, чтобы его не прятать. */
export function drawHeightEdges(g, order, flat = true) {
  const cs = CELL;
  for (const [x, y] of order) {
    if (!floorAt(x, y)) continue;
    const lv = hAt(x, y);
    if (!flat && lv > 0) continue; /* приподнятые площадки рисует их объём */
    const c = hc(x, y),
      p = hexPts(c.x, c.y, 1.005);
    for (const [i, j, nx, ny] of edgeNbrs(x, y)) {
      if (!floorAt(nx, ny)) continue;
      const nl = hAt(nx, ny);
      if (nl >= lv) continue;
      const a = p[i],
        b = p[j],
        front = (a[1] + b[1]) / 2 > c.y + 0.5;
      const near = S.units.some(u => !u.down && hAt(u.x, u.y) < lv && hd(u.x, u.y, x, y) <= 1);
      if (front) {
        const drop = Math.min(4, lv - nl) * cs * 0.12;
        g.save();
        g.globalAlpha = near ? 0.38 : 1;
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.lineTo(b[0], b[1] + drop);
        g.lineTo(a[0], a[1] + drop);
        g.closePath();
        const lx = (a[0] + b[0]) / 2 < c.x;
        g.fillStyle = lx ? '#323d45' : '#28343b';
        g.fill();
        g.strokeStyle = 'rgba(8,16,23,.45)';
        g.lineWidth = 1;
        g.stroke();
        if (drop > cs * 0.19) {
          g.strokeStyle = 'rgba(154,166,174,.15)';
          g.beginPath();
          g.moveTo(a[0], a[1] + drop * 0.58);
          g.lineTo(b[0], b[1] + drop * 0.58);
          g.stroke();
        }
        g.restore();
      }
      g.strokeStyle = near ? 'rgba(197,218,221,.38)' : 'rgba(199,219,222,.79)';
      g.lineWidth = front ? 2.4 : 1.7;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }
}

/* Ступени лестницы: косые полосы поперёк гекса. */
export function drawStairsFlat(g, x, y) {
  const c = hc(x, y),
    cs = CELL;
  g.strokeStyle = 'rgba(248,238,220,.6)';
  g.lineWidth = Math.max(1.5, cs * 0.035);
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo(c.x - cs * 0.26, c.y + (i * cs * 0.06 + cs * 0.08) * KY);
    g.lineTo(c.x + cs * 0.26, c.y + (i * cs * 0.06 - cs * 0.08) * KY);
    g.stroke();
  }
}

/* Плоское окружение: вода, лужи, масло, огонь, шипы, провальный пол (виден только в редакторе). */
export function drawTerrainFlat(g) {
  const cs = CELL;
  for (const [k, t] of Object.entries(S.terrain || {}) as [string, any][]) {
    const [x, y] = unkey(k),
      d = TERRAIN[t.type];
    if (!d || !floorAt(x, y)) continue;
    const c = hc(x, y);
    if (d.water != null || t.type === 'oil' || t.type === 'burning') {
      g.save();
      hexPath(g, c.x, c.y, 0.96);
      g.clip();
      if (d.water != null) {
        g.fillStyle =
          d.water >= 2 ? 'rgba(30,78,138,.62)' : d.water === 1 ? 'rgba(64,128,170,.46)' : 'rgba(90,150,180,.28)';
        g.fillRect(c.x - cs, c.y - cs, cs * 2, cs * 2);
        g.strokeStyle = d.water >= 2 ? 'rgba(200,230,255,.28)' : 'rgba(223,245,255,.32)';
        g.lineWidth = 1.2;
        const ph = hash(x, y) * 6;
        for (let yy = -2; yy <= 2; yy++) {
          const oy = c.y + yy * cs * 0.12 * KY;
          g.beginPath();
          g.moveTo(c.x - cs * 0.45, oy);
          g.bezierCurveTo(
            c.x - cs * 0.2,
            oy - cs * 0.05 + ph,
            c.x + cs * 0.05,
            oy + cs * 0.04,
            c.x + cs * 0.4,
            oy - cs * 0.02,
          );
          g.stroke();
        }
      } else if (t.type === 'oil') {
        g.fillStyle = 'rgba(125,97,47,.4)';
        g.fillRect(c.x - cs, c.y - cs, cs * 2, cs * 2);
        g.strokeStyle = 'rgba(214,180,110,.25)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.ellipse(c.x - cs * 0.07, c.y, cs * 0.18, cs * 0.18 * KY, 0, 0, 7);
        g.stroke();
        g.beginPath();
        g.ellipse(c.x + cs * 0.15, c.y - cs * 0.03, cs * 0.11, cs * 0.11 * KY, 0, 0, 7);
        g.stroke();
      } else {
        g.fillStyle = 'rgba(160,62,20,.42)';
        g.fillRect(c.x - cs, c.y - cs, cs * 2, cs * 2);
      }
      g.restore();
      if (t.type === 'burning') flame(g, c.x, c.y, cs);
      continue;
    }
    if (d.spikes) {
      g.fillStyle = d.tint;
      g.strokeStyle = 'rgba(17,12,8,.6)';
      g.lineWidth = 1;
      for (const [dx, dy] of [
        [-0.18, -0.06],
        [0, -0.1],
        [0.18, -0.06],
        [-0.1, 0.08],
        [0.1, 0.08],
      ]) {
        const bx = c.x + dx * cs,
          by = c.y + dy * cs * KY + cs * 0.05;
        g.beginPath();
        g.moveTo(bx - cs * 0.05, by);
        g.lineTo(bx, by - cs * 0.2);
        g.lineTo(bx + cs * 0.05, by);
        g.closePath();
        g.fill();
        g.stroke();
      }
      badge(g, t, d, c);
      continue;
    }
    if (d.collapse && S.editor) {
      g.strokeStyle = 'rgba(200,120,90,.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(c.x - cs * 0.2, c.y - cs * 0.06);
      g.lineTo(c.x - cs * 0.02, c.y - cs * 0.02);
      g.lineTo(c.x + cs * 0.05, c.y + cs * 0.02);
      g.lineTo(c.x + cs * 0.18, c.y - cs * 0.04);
      g.moveTo(c.x - cs * 0.09, c.y + cs * 0.11);
      g.lineTo(c.x - cs * 0.02, c.y + cs * 0.01);
      g.lineTo(c.x + cs * 0.1, c.y + cs * 0.08);
      g.stroke();
      g.font = `700 ${Math.max(10, cs * 0.2)}px sans-serif`;
      g.fillStyle = 'rgba(240,190,160,.9)';
      g.textAlign = 'center';
      g.fillText('◇', c.x, c.y - cs * 0.12);
    }
  }
}

function flame(g, x, y, cs) {
  g.fillStyle = 'rgba(255,190,96,.9)';
  g.beginPath();
  g.moveTo(x, y - cs * 0.3);
  g.quadraticCurveTo(x + cs * 0.15, y - cs * 0.12, x, y + cs * 0.02);
  g.quadraticCurveTo(x - cs * 0.17, y - cs * 0.1, x, y - cs * 0.3);
  g.fill();
  g.fillStyle = 'rgba(255,90,44,.95)';
  g.beginPath();
  g.moveTo(x, y - cs * 0.18);
  g.quadraticCurveTo(x + cs * 0.08, y - cs * 0.08, x, y + cs * 0.02);
  g.quadraticCurveTo(x - cs * 0.09, y - cs * 0.06, x, y - cs * 0.18);
  g.fill();
}

/* Прочность предмета — только если он поврежден или открыт редактор. */
function badge(g, t, d, c) {
  if (d.hp == null || (t.hp >= d.hp && !S.editor)) return;
  const cs = CELL,
    txt = `${t.hp}/${d.hp}`;
  g.save();
  g.font = `600 ${Math.max(9, cs * 0.15)}px sans-serif`;
  const w = g.measureText(txt).width + 8,
    h = Math.max(12, cs * 0.2),
    by = c.y + cs * 0.24;
  g.fillStyle = 'rgba(25,18,12,.78)';
  g.beginPath();
  if (g.roundRect) g.roundRect(c.x - w / 2, by - h / 2, w, h, 5);
  else g.rect(c.x - w / 2, by - h / 2, w, h);
  g.fill();
  g.fillStyle = t.hp < d.hp * 0.5 ? '#ffb09c' : '#f4ead0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(txt, c.x, by + 1);
  g.restore();
}

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16),
    f = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
/* Прямоугольный ящик на полу: w — ширина, dp — глубина (в плоскости поля), h — высота. Поворот поля меняет местами ширину и глубину. */
function box(g, cx, cy, w, dp, h, tint) {
  if (ROT) [w, dp] = [dp, w];
  const d2 = (dp * KY) / 2,
    x0 = cx - w / 2,
    x1 = cx + w / 2;
  g.strokeStyle = 'rgba(17,12,8,.6)';
  g.lineWidth = 1;
  /* перед */
  g.fillStyle = shade(tint, 0.72);
  g.beginPath();
  g.rect(x0, cy + d2 - h, w, h);
  g.fill();
  g.stroke();
  /* верх */
  g.fillStyle = shade(tint, 1.05);
  g.beginPath();
  g.rect(x0, cy - d2 - h, w, d2 * 2);
  g.fill();
  g.stroke();
  return { x0, x1, top: cy - d2 - h, front: cy + d2 - h, bottom: cy + d2 };
}

/* Объёмные предметы рисуются вместе со стенами — от дальних к ближним. */
export function drawTerrainObj(g, x, y) {
  const t = S.terrain && S.terrain[key(x, y)];
  if (!t) return;
  const d = TERRAIN[t.type];
  if (!d || !d.tall) return;
  const cs = CELL,
    c = hc(x, y),
    h = d.tall * cs;
  if (t.type.endsWith('barrel') || t.type === 'rotten') {
    const rx = cs * 0.2,
      ry = rx * KY;
    g.strokeStyle = 'rgba(17,12,8,.6)';
    g.lineWidth = 1;
    g.fillStyle = shade(d.tint, 0.78);
    g.beginPath();
    g.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI);
    g.lineTo(c.x - rx, c.y - h);
    g.lineTo(c.x + rx, c.y - h);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = 'rgba(30,20,10,.55)';
    for (const f of [0.28, 0.7]) {
      g.beginPath();
      g.ellipse(c.x, c.y - h * f, rx, ry, 0, 0, Math.PI);
      g.stroke();
    }
    g.fillStyle = shade(d.tint, 1.08);
    g.beginPath();
    g.ellipse(c.x, c.y - h, rx, ry, 0, 0, 7);
    g.fill();
    g.strokeStyle = 'rgba(17,12,8,.6)';
    g.stroke();
    if (d.liquid) {
      g.fillStyle = d.liquid === 'wet' ? 'rgba(160,210,240,.8)' : 'rgba(240,200,120,.8)';
      g.beginPath();
      g.ellipse(c.x, c.y - h, rx * 0.45, ry * 0.45, 0, 0, 7);
      g.fill();
    }
  } else if (t.type === 'cupboard') {
    const b = box(g, c.x, c.y, cs * 0.5, cs * 0.34, h, d.tint);
    g.strokeStyle = 'rgba(20,12,6,.6)';
    g.beginPath();
    g.moveTo(c.x, b.front + 3);
    g.lineTo(c.x, b.bottom - 3);
    g.stroke();
    g.fillStyle = '#d9b26a';
    g.fillRect(c.x - 4, b.front + h * 0.45, 2, 4);
    g.fillRect(c.x + 2, b.front + h * 0.45, 2, 4);
  } else if (t.type === 'table') {
    /* перевёрнутый стол: столешница стоит ребром, ножки торчат назад */
    const b = box(g, c.x, c.y, cs * 0.62, cs * 0.1, h, d.tint);
    g.strokeStyle = shade(d.tint, 0.55);
    g.lineWidth = Math.max(2, cs * 0.04);
    g.beginPath();
    for (const dx of [-0.22, 0.22]) {
      g.moveTo(c.x + dx * cs, b.top + 2);
      g.lineTo(c.x + dx * cs, b.top - cs * 0.14);
    }
    g.stroke();
  } else if (t.type === 'bed') {
    box(g, c.x, c.y, cs * 0.64, cs * 0.42, h, d.tint);
    g.fillStyle = 'rgba(240,230,210,.75)';
    const pw = ROT ? cs * 0.14 : cs * 0.18;
    g.fillRect(c.x - cs * 0.3, c.y - h - cs * 0.12 * KY, pw, cs * 0.16 * KY);
  } else if (t.type === 'bench') {
    box(g, c.x, c.y, cs * 0.64, cs * 0.18, h, d.tint);
  } else if (t.type === 'chair') {
    box(g, c.x, c.y + cs * 0.03, cs * 0.3, cs * 0.28, h * 0.55, d.tint);
    box(g, c.x, c.y - cs * 0.1 * KY, cs * 0.3, cs * 0.05, h * 1.3, d.tint);
  } else if (t.type === 'rubble') {
    for (const [dx, dy, s] of [
      [-0.14, 0.04, 0.24],
      [0.12, 0.06, 0.2],
      [0, -0.08, 0.22],
    ])
      box(g, c.x + dx * cs, c.y + dy * cs * KY, cs * s, cs * s * 0.8, h * (0.6 + s), d.tint);
  }
  badge(g, t, d, c);
}

/* Лестницы в плоском виде рисуются полосами на всех уровнях. */
export function drawAllStairsFlat(g) {
  for (const k of Object.keys(S.stairs || {})) {
    const [x, y] = unkey(k);
    if (floorAt(x, y) && isStairs(x, y)) drawStairsFlat(g, x, y);
  }
}
