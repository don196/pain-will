/* Окружение боя (по полигону 4.5): мебель и бочки, шипы, вода, обрушаемый пол, разливы и огонь.
   Пока на карте нет ни одного объекта, правила работают в точности как без окружения. */
import type { Unit } from '../types';
import { A } from '../data/actions';
import { TERRAIN } from '../data/terrain';
import { S } from '../state';
import { cheb, d20, hd, hexLine, key, nbrDirs, sum } from '../util';
import { view } from '../view';
import { addSt, fall, meleeInHand } from './combat';
import { applyDamage } from './damage';
import { adjOk, cellsOf, inB, unitAt } from './geometry';
import { hAt } from './height';
import { ev, log, uName } from './log';
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
/* Лишняя клетка шага: вода и стулья. */
export const slowAt = (x, y) => (S && S.terrain && terrDef(x, y)?.slow ? 1 : 0);
export function waterLevel(u: { x: number; y: number }) {
  const d = terrDef(u.x, u.y);
  return (d && d.water) || 0;
}
/* Стоит в воде или в луже — Нагрев не копится. */
export function inWater(u: Unit) {
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

export function placeTerr(x, y, type) {
  if (!inB(x, y)) return;
  S.terrain = S.terrain || {};
  const def = TERRAIN[type],
    k = key(x, y);
  if (!def) {
    delete S.terrain[k];
    return;
  }
  S.terrain[k] = { type, hp: def.hp == null ? null : def.hp };
  if (type === 'collapse') S.terrain[k].depth = 2;
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
    if (u && type === 'wet' && u.st && u.st.heat) {
      u.st.heat = 0;
      ev(`💧 ${uName(u)}: намокает, Нагрев снят`);
    }
  }
  ev(`${type === 'wet' ? '💧 Вода' : '🛢 Горючая жидкость'} разливается вокруг, радиус 1`);
}

/* Повреждение предмета — отдельная прочность, не Боль. */
export function terrainDamage(x, y, n, why) {
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
    delete S.terrain[k];
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
   Падение с уступа при отбрасывании считают толчок и отбрасывание сами. */
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
  }
  if (d.collapse) {
    const depth = Math.min(5, Math.max(1, t.depth || 2)),
      area = collapseArea(x, y),
      fallen = new Set(area);
    const victims = S.units.filter(o => !o.down && cellsOf(o).some(c => fallen.has(key(c.x, c.y))));
    S.hgt = S.hgt || {};
    for (const k of area) {
      delete S.terrain[k];
      S.hgt[k] = (S.hgt[k] || 0) - depth;
    }
    ev(
      `🕳 Обрушение пола: участок ${area.length} гекс., глубина ${depth}; падают: ${victims.length ? victims.map(o => uName(o)).join(', ') : 'никто'}`,
    );
    for (const v of victims) fall(v, depth);
    redraw();
  }
  if (d.fire && !u.down) addSt(u, 'heat', 2, 'горящая поверхность');
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
    d = TERRAIN[obj.type];
  const r = d.hp === 8 ? d20() + stat(u, 'str') : 15;
  const steps = d.hp === 8 ? (r >= 15 ? 1 : 0) : 1;
  if (!steps) {
    ev(`📦 ${uName(u)} пытается толкнуть: ${d.name} — не поддалась (d20 + Сила = ${r} против 15)`);
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
