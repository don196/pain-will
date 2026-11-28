import type { GameState, Side, Unit } from './types';
import { A } from './data/actions';
import { CHAR_TPL, T, tplOf } from './data/fighters';
import { SCN } from './data/scenarios';
import { TERRAIN } from './data/terrain';
import { weaponsOf } from './rules/actions';
import { footCells } from './rules/geometry';
import { SET } from './settings';
import { key, nbrDirs, pick } from './util';
export let S: GameState = null;
export let GEN = 0;
export let UID = 1;
export let SIMULATING = false;
export function mkUnit(tpl: string, side: Side | null, x: number, y: number): Unit {
  const t = T[tpl];
  return {
    id: UID++,
    tpl,
    name: t.name,
    tname: t.name,
    glyph: t.glyph,
    side: side || t.side,
    x,
    y,
    size: t.size || 1,
    base: {
      str: t.str,
      dex: t.dex,
      int: t.int,
      cha: t.cha,
      con: t.con == null ? 4 : t.con,
    },
    will: t.will,
    maxHp: t.hp,
    hp: t.hp,
    armor: t.armor,
    shield: t.shield || 0,
    nv: !!t.nightVision,
    resist: false,
    speed: t.speed,
    od: 2,
    effects: [],
    bleed: 0,
    wounds: {},
    bandages: t.bandages || 0,
    torches: t.torches || 0,
    traps: t.traps || 0,
    ammo: ammoOf(t),
    wield: weaponsOf(t)[0] || null,
    freeReload: !!t.freeReload,
    fract: [],
    disorder: t.disorder || null,
    mustAttack: false,
    grabbedBy: null,
    hold: null,
    loaded: true,
    st: {},
    prone: false,
    lassoT: null,
    prep: null,
    extraUsed: false,
    torch: false,
    down: false,
    stunned: false,
    skipped: false,
    counter: false,
    cd: {},
    adUsed: 0,
    binding: null,
    moveOnly: false,
    flash: null,
    ai: t.ai,
    acts: t.acts.slice(),
    liturgy: [],
    disarmed: false,
    droppedSwords: 0,
    _ai: {},
    _once: {},
  };
}
export function ammoOf(t) {
  const o = {};
  for (const id of t.acts || []) if (A[id] && A[id].ammo) o[id] = A[id].ammo;
  return o;
}
export function nameUnit(u: Unit, list) {
  u.tname = T[u.tpl].name;
  const same = list.filter(o => o.tpl === u.tpl && o.side === u.side);
  if (same.length) {
    if (same.length === 1 && same[0].name === T[u.tpl].name) same[0].name = T[u.tpl].name + ' 1';
    u.name = T[u.tpl].name + ' ' + (same.length + 1);
  }
}
export function parseScenario(id) {
  const sc = SCN[id];
  const spawns = [];
  const walls = [],
    torches = [],
    units = [],
    doors = {},
    bars = {};
  sc.map.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const k = key(x, y);
      if (ch === '#') walls.push(k);
      else if (ch === 'T') {
        walls.push(k);
        torches.push({
          x,
          y,
          lit: true,
        });
      } else if (ch === 'D')
        doors[k] = {
          open: false,
          locked: false,
        };
      else if (ch === 'd')
        doors[k] = {
          open: true,
          locked: false,
        };
      else if (ch === 'L')
        doors[k] = {
          open: false,
          locked: true,
        };
      else if (ch === '|')
        bars[k] = {
          shoot: false,
        };
      else if (ch === '!')
        bars[k] = {
          shoot: true,
        };
      else if (ch === '?' && sc.pool) {
        const tp = CHAR_TPL[pick(sc.pool)];
        if (T[tp]) {
          const u = mkUnit(tp, null, x, y);
          nameUnit(u, units);
          units.push(u);
        }
      } else if (ch === '@')
        spawns.push({
          x,
          y,
        });
      else if (CHAR_TPL[ch] && T[CHAR_TPL[ch]]) {
        const u = mkUnit(CHAR_TPL[ch], null, x, y);
        nameUnit(u, units);
        units.push(u);
      }
    }),
  );
  const W = sc.map[0].length,
    H = sc.map.length,
    wset = new Set(walls);
  const list = units;
  const blocked = (x, y) => {
    const k = key(x, y);
    return x < 0 || y < 0 || x >= W || y >= H || wset.has(k) || (doors[k] && !doors[k].open) || !!bars[k];
  };
  const occ = (x, y) => list.some(u => footCells(u.x, u.y, u.size || 1).some(c => c.x === x && c.y === y));
  const freeNear = c => {
    const seen = new Set([key(c.x, c.y)]),
      q = [[c.x, c.y]];
    let i = 0;
    while (i < q.length) {
      const [x, y] = q[i++];
      if (!blocked(x, y) && !occ(x, y))
        return {
          x,
          y,
        };
      for (const [dx, dy] of nbrDirs(x, y)) {
        const nx = x + dx,
          ny = y + dy,
          k = key(nx, ny);
        if (seen.has(k) || blocked(nx, ny)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return null;
  };
  const party = (SET.party || []).filter(k => T[k]);
  /* На картах тюремного блока из 4.5.6: Конрад и Вальтер впереди, Хельга сзади. */
  if (sc.heroOrder) party.sort((a,b)=>{
    const ai=sc.heroOrder.indexOf(a), bi=sc.heroOrder.indexOf(b);
    return (ai<0?999:ai)-(bi<0?999:bi);
  });
  party.forEach((tpl, i) => {
    if (!spawns.length) return;
    const c = spawns[i] && !occ(spawns[i].x, spawns[i].y) ? spawns[i] : freeNear(spawns[0]);
    if (!c) return;
    const u = mkUnit(tpl, 'pc', c.x, c.y);
    nameUnit(u, list);
    list.push(u);
  });
  /* Носитель факела: первый герой и первый противник с запасом факелов начинают бой с горящим факелом в руке (из своего запаса). */
  for (const side of ['pc', 'en']) {
    const b = list.find(u => u.side === side && u.torches > 0);
    if (b) {
      b.torch = true;
      b.torches--;
    }
  }
  const hgt = {},
    stairs = {};
  (sc.hmap || []).forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const k = key(x, y);
      if (ch >= '1' && ch <= '6') hgt[k] = +ch;
      else if (ch >= 'a' && ch <= 'g') {
        stairs[k] = true;
        if (ch !== 'a') hgt[k] = ch.charCodeAt(0) - 97;
      }
    }),
  );
  /* Слои 4.5: прямоугольники [x1,y1,x2,y2] и клетки [x,y]; последний слой побеждает, type 'clear' — сухой островок. */
  const cellsFor = layer => {
    const out = [];
    if (layer.rect) {
      const [x1, y1, x2, y2] = layer.rect;
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push([x, y]);
    }
    if (layer.cells) out.push(...layer.cells);
    return out.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H && !wset.has(key(x, y)));
  };
  for (const layer of sc.heightLayers || [])
    for (const [x, y] of cellsFor(layer)) {
      if (layer.level) hgt[key(x, y)] = layer.level;
      else delete hgt[key(x, y)];
    }
  const terrain = {};
  for (const layer of sc.terrainLayers || [])
    for (const [x, y] of cellsFor(layer)) {
      const k = key(x, y);
      if (layer.type === 'clear') {
        delete terrain[k];
        continue;
      }
      if (layer.type === 'stairs') {
        stairs[k] = true;
        continue;
      }
      const def = TERRAIN[layer.type];
      if (!def) continue;
      /* сплошные предметы не появляются под бойцом */
      if (def.solid && list.some(u => footCells(u.x, u.y, u.size || 1).some(p => p.x === x && p.y === y))) continue;
      if (terrain[k] && terrain[k].link) continue;
      terrain[k] = { type: layer.type, hp: def.hp == null ? null : def.hp };
      if (layer.type === 'collapse') terrain[k].depth = layer.depth || 2;
      if (layer.type === 'burning') terrain[k].left = 3;
      /* кровать и скамья — два гекса: вторая клетка справа (или как задано в layer.dir) */
      if (def.two) {
        const [dx, dy] = layer.dir || [1, 0],
          x2 = x + dx,
          y2 = y + dy,
          k2 = key(x2, y2);
        if (x2 >= 0 && y2 >= 0 && x2 < W && y2 < H && !wset.has(k2) && !terrain[k2]) {
          terrain[k2] = { type: layer.type, hp: null, link: [x, y] };
          terrain[k].part = [x2, y2];
        }
      }
    }
  return {
    scn: id,
    w: W,
    h: H,
    walls,
    torches,
    doors,
    bars,
    hgt,
    stairs,
    terrain,
    units: list,
  };
}
export function buildState(snap): GameState {
  const units = JSON.parse(JSON.stringify(snap.units));
  UID = Math.max(UID, ...units.map(u => u.id + 1), 1);
  return {
    scn: snap.scn,
    w: snap.w,
    h: snap.h,
    traps: [],
    dropped: [],
    walls: new Set(snap.walls),
    torches: snap.torches.map(t => ({
      ...t,
    })),
    doors: JSON.parse(JSON.stringify(snap.doors || {})),
    bars: JSON.parse(JSON.stringify(snap.bars || {})),
    hgt: { ...(snap.hgt || {}) },
    stairs: { ...(snap.stairs || {}) },
    terrain: JSON.parse(JSON.stringify(snap.terrain || {})),
    units,
    round: 1,
    phaseIdx: 0,
    order: ['pc', 'en'],
    phase: 'pc',
    sel: null,
    act: null,
    over: null,
    sim: false,
    busy: false,
    editor: false,
    etool: 'unit',
    etpl: 'dummy',
    eside: 'pc',
    emove: null,
    log: [],
    hover: null,
    initWhy: '',
    initial: snap,
    mapVer: 1,
  };
}
export function snapshotNow() {
  const units = S.units
    .filter(u => !u.down)
    .map(u => {
      const c = JSON.parse(JSON.stringify(u));
      const tt = tplOf(c);
      Object.assign(c, {
        od: 2,
        st: {},
        prone: false,
        lassoT: null,
        prep: null,
        effects: [],
        bleed: 0,
        wounds: {},
        traps: tt.traps || 0,
        ammo: ammoOf(tt),
        dying: false,
        numb: false,
        bandages: tt.bandages || 0,
        torches: Math.max(0, (tt.torches || 0) - (c.torch ? 1 : 0)),
        mustAttack: false,
        grabbedBy: null,
        hold: null,
        loaded: true,
        extraUsed: false,
        stunned: false,
        skipped: false,
        counter: false,
        cd: {},
        adUsed: 0,
        binding: null,
        moveOnly: false,
        flash: null,
        liturgy: [],
        disarmed: false,
        droppedSwords: 0,
        _ai: {},
        _once: {},
      });
      return c;
    });
  return {
    scn: S.scn,
    w: S.w,
    h: S.h,
    walls: [...S.walls],
    torches: S.torches.map(t => ({
      ...t,
    })),
    doors: JSON.parse(JSON.stringify(S.doors)),
    bars: JSON.parse(JSON.stringify(S.bars)),
    hgt: { ...(S.hgt || {}) },
    stairs: { ...(S.stairs || {}) },
    terrain: JSON.parse(JSON.stringify(S.terrain || {})),
    units,
  };
}
export const byId = id => S.units.find(u => u.id === id) || null;
export const alive = side => S.units.filter(u => !u.down && u.side === side);
export const hostiles = (u: Unit) => S.units.filter(o => !o.down && o.side !== u.side);
export const friends = (u: Unit) => S.units.filter(o => !o.down && o.side === u.side && o.id !== u.id);
export const selUnit = () => (S.sel != null ? byId(S.sel) : null);
export function setGEN(v) {
  GEN = v;
}
export function setS(v) {
  S = v;
}
export function setSIMULATING(v) {
  SIMULATING = v;
}
export function setUID(v) {
  UID = v;
}
