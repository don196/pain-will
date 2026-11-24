/* Окружение боя (по полигону 4.5): мебель и бочки, шипы, вода, обрушаемый пол, разливы и огонь.
   Пока на карте нет ни одного объекта, правила работают в точности как без окружения. */
import type { Unit } from '../types';
import { A } from '../data/actions';
import { TERRAIN } from '../data/terrain';
import { S } from '../state';
import { cheb, d20, hd, hexLine, key, nbrDirs, pick, sum } from '../util';
import { view } from '../view';
import { addSt, fall, meleeInHand } from './combat';
import { applyDamage } from './damage';
import { adjOk, cellsOf, inB, unitAt } from './geometry';
import { hAt } from './height';
import { ev, log, uName } from './log';
import { AREAS, addWound } from './wounds';
import { ap3Degree } from './reactions';
import { atkMods, modsStr, stat } from './stats';
import { wClass } from './pain';

export const hasTerrain = () => !!S && !!S.terrain && Object.keys(S.terrain).length > 0;
export const terrAt = (x, y) => (S && S.terrain && S.terrain[key(x, y)]) || null;
export function terrDef(x, y) {
  const a = terrAt(x, y);
  return a ? TERRAIN[a.type] || null : null;
}
export const isTerrSolid = (x, y) => !!(S && S.terrain && terrDef(x, y)?.solid);
export const isTerrOpaque = (x, y) => !!(S && S.terrain && terrDef(x, y)?.opaque);
export const terrCover = (x, y) => !!terrDef(x, y)?.cover;
/* Лишняя цена шага: вода — +1 клетка, стул — ещё 1 ОД (столько клеток, сколько боец проходит за ОД). */
export function slowAt(x, y, climb = 3) {
  if (!S || !S.terrain) return 0;
  const d = terrDef(x, y);
  return !d ? 0 : d.slowOD ? climb : d.slow ? 1 : 0;
}
export const coverAt = (x, y) => !!(S && S.terrain && terrDef(x, y)?.cover);
/* Кровать и скамья занимают два гекса: вторая клетка ссылается на первую. */
export function terrMain(x, y) {
  const t = terrAt(x, y);
  if (t && t.link) {
    const [lx, ly] = t.link;
    return { x: lx, y: ly, t: terrAt(lx, ly) };
  }
  return { x, y, t };
}
export function waterLevel(u: { x: number; y: number }) {
  const d = terrDef(u.x, u.y);
  return (d && d.water) || 0;
}
/* Стоит в воде, в луже или мокрый — Нагрев не копится. */
export function inWater(u: Unit) {
  if (u && u.effects && u.effects.some(e => e.type === 'wet')) return true;
  if (!S || !S.terrain) return false;
  const t = terrAt(u.x, u.y);
  return waterLevel(u) > 0 || (!!t && t.type === 'wet');
}

/* Укрытие на линии выстрела. Предмет рядом с целью, если он ближе к стрелку, тоже прикрывает. */
export function coverBetween(a, b) {
  if (!hasTerrain() || !a || !b || cheb(a, b) <= 1) return false;
  for (const c of hexLine({ x: a.x, y: a.y }, { x: b.x, y: b.y }, 1e-6)) if (terrCover(c.x, c.y)) return true;
  for (const [dx, dy] of nbrDirs(b.x, b.y)) {
    const x = b.x + dx,
      y = b.y + dy;
    if (terrCover(x, y) && hd(a.x, a.y, x, y) < hd(a.x, a.y, b.x, b.y)) return true;
  }
  return false;
}
export function hasLocalCover(u: Unit) {
  if (!hasTerrain()) return false;
  return nbrDirs(u.x, u.y).some(([dx, dy]) => terrCover(u.x + dx, u.y + dy));
}

export function placeTerr(x, y, type, x2?, y2?) {
  if (!inB(x, y)) return;
  S.terrain = S.terrain || {};
  const def = TERRAIN[type],
    k = key(x, y);
  dropTerr(x, y);
  if (!def) return;
  S.terrain[k] = { type, hp: def.hp == null ? null : def.hp };
  if (type === 'collapse') S.terrain[k].depth = 2;
  if (type === 'burning') S.terrain[k].left = 3;
  /* двухгексовый предмет: вторая клетка — соседняя (по умолчанию справа) */
  if (def.two) {
    let c2 = x2 != null ? { x: x2, y: y2 } : null;
    if (!c2 || !inB(c2.x, c2.y)) {
      const ok = (cx, cy) => inB(cx, cy) && !S.walls.has(key(cx, cy)) && !terrAt(cx, cy) && !unitAt(cx, cy);
      c2 = [[1, 0], [-1, 0], ...nbrDirs(x, y)].map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find(c => ok(c.x, c.y));
    }
    if (c2) {
      dropTerr(c2.x, c2.y);
      S.terrain[key(c2.x, c2.y)] = { type, hp: null, link: [x, y] };
      S.terrain[k].part = [c2.x, c2.y];
    }
  }
}
/* Убрать предмет с клетки вместе со второй половиной. */
export function dropTerr(x, y) {
  if (!S || !S.terrain) return;
  const t = S.terrain[key(x, y)];
  if (!t) return;
  if (t.link) delete S.terrain[key(t.link[0], t.link[1])];
  if (t.part) delete S.terrain[key(t.part[0], t.part[1])];
  delete S.terrain[key(x, y)];
}
const redraw = () => {
  S.lv = (S.lv || 0) + 1;
  if (!S.sim) {
    view.drawFloor();
    view.drawLight(typeof performance !== 'undefined' ? performance.now() : 0);
  }
};

export function spreadLiquid(x, y, type: 'wet' | 'oil') {
  const cells = [{ x, y }, ...nbrDirs(x, y).map(([dx, dy]) => ({ x: x + dx, y: y + dy }))];
  for (const c of cells) {
    if (!inB(c.x, c.y) || S.walls.has(key(c.x, c.y))) continue;
    const d = terrDef(c.x, c.y);
    if (d && d.solid) continue;
    placeTerr(c.x, c.y, type);
    const u = unitAt(c.x, c.y);
    if (!u) continue;
    if (type === 'wet') {
      /* «Мокрый»: стак на 1 ход, снимает Нагрев и не даёт ему копиться */
      u.effects.push({ type: 'wet', left: 1, end: 1e9 });
      if (u.st && u.st.heat) u.st.heat = 0;
      ev(`💧 ${uName(u)}: мокрый — Нагрев снят`);
    } else if (!u.effects.some(e => e.type === 'oily')) {
      /* «Горючий»: при воспламенении снимается и даёт 2 Нагрева */
      u.effects.push({ type: 'oily', end: 1e9 });
      ev(`🛢 ${uName(u)}: облит горючим — огонь даст ему ещё 2 Нагрева`);
    }
  }
  ev(`${type === 'wet' ? '💧 Вода' : '🛢 Горючая жидкость'} разливается вокруг, радиус 1`);
}

/* Повреждение предмета — отдельная прочность, не Боль. */
export function terrainDamage(x, y, n, why) {
  const m = terrMain(x, y);
  x = m.x;
  y = m.y;
  const k = key(x, y),
    obj = terrAt(x, y);
  if (!obj) return;
  const d = TERRAIN[obj.type];
  if (!d || d.hp == null) return;
  const raw = Math.max(0, Math.round(n));
  obj.hp = Math.max(0, obj.hp - raw);
  ev(`⚒ ${d.name}: ${why || 'попадание'} ${raw} прочности, осталось ${obj.hp}/${d.hp}`);
  if (d.liquid && raw >= 3 && obj.hp > 0) spreadLiquid(x, y, d.liquid);
  if (obj.hp <= 0) {
    dropTerr(x, y);
    void k;
    if (d.liquid) spreadLiquid(x, y, d.liquid);
    if (d.solidCargo) placeTerr(x, y, 'rubble');
    ev(`💥 ${d.name} разрушен`);
  }
  redraw();
}

/* Огонь по разлитому маслу — пол загорается. */
export function igniteTerr(x, y) {
  const t = terrAt(x, y);
  if (!t || t.type !== 'oil') return;
  placeTerr(x, y, 'burning');
  ev('🔥 Горючая жидкость воспламенилась');
  const o = unitAt(x, y);
  if (o) addSt(o, 'heat', 2, 'горящая поверхность');
  redraw();
}

/* Связный участок обрушаемого пола. */
function collapseArea(x, y) {
  const q = [[x, y]],
    seen = new Set(),
    out = [];
  while (q.length) {
    const [a, b] = q.shift(),
      k = key(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    const t = terrAt(a, b);
    if (!t || t.type !== 'collapse') continue;
    out.push(k);
    for (const [dx, dy] of nbrDirs(a, b)) q.push([a + dx, b + dy]);
  }
  return out;
}

/* Боец оказался на клетке: вода гасит Нагрев, шипы ранят протащенного, пол может обрушиться, огонь жжёт.
   Падение с уступа при отбрасывании считают толчок и отбрасывание сами.
   Шипы (свод 2.4 + решение 23.11): 1 Боль сквозь броню за гекс; с 2 гексов за одно перемещение — одна обычная открытая рана. */
export function terrainStep(u: Unit, x, y, opt: { forced?: boolean } = {}) {
  if (!S || !S.terrain || u.down) return;
  const t = terrAt(x, y),
    d = terrDef(x, y);
  if (!d) return;
  if (d.water != null && u.st && u.st.heat) {
    u.st.heat = 0;
    ev(`💧 ${uName(u)}: Нагрев потушен водой`);
  }
  if (d.spikes && opt.forced) {
    ev(`♰ ${uName(u)} протащен по шипам — +1 Боль сквозь броню`);
    applyDamage(u, 1, null);
    terrainDamage(x, y, 3, 'перемещение через шипы');
    u._spk = (u._spk || 0) + 1;
    if (u._spk === 2 && !u.down) {
      ev(`♰ Второй гекс шипов за одно перемещение — рана`);
      addWound(u, pick(AREAS));
    }
  }
  if (d.collapse) {
    /* свод 2.4: яма с пологими ступенчатыми краями — по 1 уровню от края к середине, до глубины участка;
       все клетки ямы — склон (как лестница), выбраться можно самому */
    const depth = Math.min(5, Math.max(1, t.depth || 2)),
      area = collapseArea(x, y),
      fallen = new Set(area);
    const ring = new Map();
    let front = area.filter(k => {
      const [ax, ay] = k.split(',').map(Number);
      return nbrDirs(ax, ay).some(([dx, dy]) => !fallen.has(key(ax + dx, ay + dy)));
    });
    let lv = 1;
    while (front.length) {
      for (const k of front) ring.set(k, Math.min(depth, lv));
      const nx = [];
      for (const k of front) {
        const [ax, ay] = k.split(',').map(Number);
        for (const [dx, dy] of nbrDirs(ax, ay)) {
          const kk = key(ax + dx, ay + dy);
          if (fallen.has(kk) && !ring.has(kk) && !nx.includes(kk)) nx.push(kk);
        }
      }
      front = nx;
      lv++;
    }
    const victims = S.units.filter(o => !o.down && cellsOf(o).some(c => fallen.has(key(c.x, c.y))));
    S.hgt = S.hgt || {};
    S.stairs = S.stairs || {};
    const drop = new Map();
    for (const k of area) {
      delete S.terrain[k];
      const dd = ring.get(k) || depth;
      drop.set(k, dd);
      S.hgt[k] = (S.hgt[k] || 0) - dd;
      if (!S.hgt[k]) delete S.hgt[k];
      S.stairs[k] = true;
    }
    ev(
      `🕳 Обрушение пола: участок ${area.length} гекс., до ${Math.max(...drop.values())} уровней вниз, края пологие; падают: ${victims.length ? victims.map(o => uName(o)).join(', ') : 'никто'}`,
    );
    for (const v of victims) fall(v, drop.get(key(v.x, v.y)) || depth);
    redraw();
  }
  if (d.fire && !u.down) addSt(u, 'heat', 2, 'горящая поверхность');
}
/* Конец раунда: огонь на полу гаснет через 3 раунда. */
export function terrainRound() {
  if (!S || !S.terrain) return;
  let ch = false;
  for (const [k, t] of Object.entries(S.terrain) as [string, any][])
    if (t.type === 'burning' && t.left != null && --t.left <= 0) {
      delete S.terrain[k];
      ch = true;
    }
  if (ch) {
    ev('<span class="dim">🔥 Огонь на полу догорел</span>');
    redraw();
  }
}

/* Конец своего хода: огонь под ногами жжёт, вода гасит Нагрев. */
export function terrainEndTurn(u: Unit) {
  if (!S || !S.terrain || u.down) return;
  const d = terrDef(u.x, u.y);
  if (d && d.fire) addSt(u, 'heat', 2, 'горящая поверхность');
  if (u.st && u.st.heat && inWater(u)) {
    u.st.heat = 0;
    ev(`💧 ${uName(u)}: Нагрев погашен`);
  }
}

/* Действия с предметами: ударить, толкнуть бочку, укрыться. */
export function canTerrainAct(u: Unit, kind, c) {
  if (!c || !inB(c.x, c.y)) return false;
  const d = terrDef(c.x, c.y);
  if (kind === 'objectPush' && terrAt(c.x, c.y)?.link) return false;
  if (!d || cheb(u, c) !== 1 || !adjOk(u, c)) return false;
  if (kind === 'objectStrike') return d.hp != null;
  if (kind === 'objectPush') return !!d.push;
  return false;
}
export function objectStrike(u: Unit, c) {
  const a = A[meleeInHand(u) || 'improv'],
    mods = atkMods(u, a, null),
    r = d20(),
    total = r + sum(mods),
    hit = total >= 10,
    dg = hit ? ap3Degree(total - 10) : { t: 0, txt: 'промах' };
  const n = ({ light: 3, med: 4, heavy: 6 }[wClass(u, a)] || 4) * dg.t;
  const nm = TERRAIN[terrAt(c.x, c.y).type].name;
  log(
    `<div class="lh">${uName(u)} → ${nm}: удар по предмету</div><div class="lr">d20 ${r}${modsStr(mods)} = ${total} против 10 · ${dg.txt}</div><div class="ld">Повреждение предмета ${n} (своя прочность, не Боль)</div>`,
    'atk',
  );
  if (n) terrainDamage(c.x, c.y, n, 'удар оружием');
}
export function objectPush(u: Unit, c) {
  const obj = terrAt(c.x, c.y),
    d = TERRAIN[obj.type],
    light = d.hp <= 8;
  /* гнилая бочка и стул — d20 + Сила против 15; стул отъезжает по степени: 15+ — 1, 20+ — 2, 25+ — 3 */
  const r = light ? d20() + stat(u, 'str') : 15;
  const steps = !light ? 1 : r >= 25 && d.slowOD ? 3 : r >= 20 && d.slowOD ? 2 : r >= 15 ? 1 : 0;
  if (!steps) {
    ev(`📦 ${uName(u)} пытается толкнуть: ${d.name} — не поддаётся (d20 + Сила = ${r} против 15)`);
    return;
  }
  if (d.slowOD) {
    chairSlide(u, c, steps, r);
    return;
  }
  /* бочка катится от толкающего: соседняя клетка, самая дальняя от него */
  const far = nbrDirs(c.x, c.y)
    .map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }))
    .sort((p, q) => hd(u.x, u.y, q.x, q.y) - hd(u.x, u.y, p.x, p.y))[0];
  terrainDamage(c.x, c.y, 4, 'толчок');
  if (!terrAt(c.x, c.y)) return;
  const other = inB(far.x, far.y) ? unitAt(far.x, far.y) : null;
  const blocked =
    !inB(far.x, far.y) ||
    S.walls.has(key(far.x, far.y)) ||
    !!S.doors[key(far.x, far.y)] ||
    !!S.bars[key(far.x, far.y)] ||
    !!terrDef(far.x, far.y)?.solid ||
    !!other ||
    hAt(far.x, far.y) > hAt(c.x, c.y);
  if (blocked) {
    if (other) {
      addSt(other, 'unst', 1, 'столкновение с бочкой');
      ev(`📦 ${d.name} врезается в ${uName(other)}`);
    }
    terrainDamage(c.x, c.y, 4, 'столкновение');
    return;
  }
  S.terrain[key(far.x, far.y)] = obj;
  delete S.terrain[key(c.x, c.y)];
  ev(`📦 ${uName(u)} толкает: ${d.name} откатывается на 1 гекс`);
  redraw();
}

/* Опасность клетки для ИИ: обрушение, огонь, шипы, глубина, спуск с уступа, край обрыва. */
export function aiCellDanger(x, y, from) {
  let s = 0;
  const d = terrDef(x, y);
  if (d) {
    if (d.collapse) s += 42;
    if (d.fire) s += 18;
    if (d.spikes) s += 14;
    if ((d.water || 0) >= 2) s += 10;
    else if ((d.water || 0) === 1) s += 4;
    if (S.terrain[key(x, y)].type === 'oil') s += 2;
  }
  if (S.hgt) {
    const ha = hAt(from.x, from.y),
      hb = hAt(x, y);
    if (ha > hb && !(S.stairs && (S.stairs[key(x, y)] || S.stairs[key(from.x, from.y)]))) s += 8 * (ha - hb);
    for (const [dx, dy] of nbrDirs(x, y)) {
      const nx = x + dx,
        ny = y + dy;
      if (!inB(nx, ny) || S.walls.has(key(nx, ny))) continue;
      if (hb > hAt(nx, ny) + 1) s += 3;
    }
  }
  return s;
}
export function aiPathDanger(u: Unit, path) {
  if (!path || !path.length || !(hasTerrain() || (S.hgt && Object.keys(S.hgt).length))) return 0;
  let s = 0,
    cur = { x: u.x, y: u.y };
  for (const [x, y] of path) {
    s += aiCellDanger(x, y, cur);
    cur = { x, y };
  }
  return s;
}

/* Стул катится от толкающего на 1–3 гекса и сам не ломается; упирается в стену, предмет или бойца. */
function chairSlide(u: Unit, c, steps, r) {
  let cur = { x: c.x, y: c.y };
  const obj = terrAt(c.x, c.y);
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const nx = nbrDirs(cur.x, cur.y)
      .map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy }))
      .sort((p, q) => hd(u.x, u.y, q.x, q.y) - hd(u.x, u.y, p.x, p.y))[0];
    if (!inB(nx.x, nx.y) || S.walls.has(key(nx.x, nx.y)) || terrAt(nx.x, nx.y) || unitAt(nx.x, nx.y)) break;
    delete S.terrain[key(cur.x, cur.y)];
    S.terrain[key(nx.x, nx.y)] = obj;
    cur = nx;
    n++;
  }
  ev(`🪑 ${uName(u)} толкает стул (d20 + Сила = ${r}): ${n ? 'отъехал на ' + n + ' гекс.' : 'упёрся'}`);
  if (n) redraw();
}

/* Попадание в укрытие (свод 2.4, §10.2.7): стрелы и болты — не больше 2 прочности, остальное — по весу оружия. */
export function coverHit(att: Unit, act, def: Unit) {
  if (!hasTerrain()) return;
  let c = null;
  for (const p of hexLine({ x: att.x, y: att.y }, { x: def.x, y: def.y }, 1e-6))
    if (terrCover(p.x, p.y)) {
      c = p;
      break;
    }
  if (!c)
    c = nbrDirs(def.x, def.y)
      .map(([dx, dy]) => ({ x: def.x + dx, y: def.y + dy }))
      .find(p => terrCover(p.x, p.y) && hd(att.x, att.y, p.x, p.y) < hd(att.x, att.y, def.x, def.y));
  if (!c) return;
  const n = act.ranged && !act.magic ? 2 : { light: 3, med: 4, heavy: 6 }[wClass(att, act)] || 4;
  terrainDamage(c.x, c.y, n, 'попадание в укрытие');
}
