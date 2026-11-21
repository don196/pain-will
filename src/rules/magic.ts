import type { Unit } from '../types';
import { A } from '../data/actions';
import { DIS, DISP, DIS_ICON } from '../data/disorders';
import { addSt, addStrong, marker, mastMg, tplFlag, v2AtkMods } from './combat';
import { applyDamage } from './damage';
import { disOf, isLit } from './disorders';
import { blocksLight, cellsOf, inB, torchAt, unitAt } from './geometry';
import { ev, log, uName } from './log';
import { composure } from './pain';
import { ap3Degree, missThr } from './reactions';
import { getEff, hasEff, modsStr, removeEff, stat } from './stats';
import { SET } from '../settings';
import { S } from '../state';
import { d20, esc, hd, hexLine, sgn, sum } from '../util';
import { view } from '../view';
export function takeVuln(t) {
  if (!hasEff(t, 'vuln2')) return false;
  removeEff(t, 'vuln2');
  ev(`🎯 Уязвимость срабатывает: воздействие на ${uName(t)} удвоено, проклятие снято`);
  return true;
}

/* Линия от источника огня: стены и закрытые двери её перекрывают. */
export function fireLine(src, c) {
  if (src.x === c.x && src.y === c.y) return true;
  for (const p of hexLine(src, c, 1e-6)) if (blocksLight(p.x, p.y)) return false;
  return true;
}
export function fireSources() {
  const out = S.torches
    .filter(t => t.lit)
    .map(t => ({
      x: t.x,
      y: t.y,
    }));
  for (const o of S.units)
    if (!o.down && o.torch)
      out.push({
        x: o.x,
        y: o.y,
      });
  return out;
}
export function validFlash(u: Unit, c) {
  if (!c || !inB(c.x, c.y)) return false;
  const tc = torchAt(c.x, c.y),
    o = unitAt(c.x, c.y);
  if (!((tc && tc.lit) || (o && o.torch))) return false;
  return fireLine(c, u);
}
export function doFlash(u: Unit, c) {
  let B = 1,
    Rr = 3;
  const t = spellRoll(u, A.flash);
  if (!t) {
    ev(`<span class="dim">✴ Вспышка: огонь не отзывается</span>`);
    return;
  }
  B = [0, 1, 1, 2][t];
  Rr = [0, 2, 3, 3][t];
  ev(`✴ Вспышка: ${uName(u)} заставляет огонь полыхнуть — Слепота в радиусе ${B}, Рябь в радиусе ${Rr}`);
  for (const o of S.units.slice()) {
    if (o.down) continue;
    const d = Math.min(...cellsOf(o).map(p => hd(c.x, c.y, p.x, p.y)));
    if (d > Rr || !fireLine(c, o)) continue;
    if (d <= B) addStrong(o, 'blind2');
    else addSt(o, 'ripple', 1, 'Вспышка');
  }
}
export function doCurse3(u: Unit, t, a, id) {
  const c = curseCalc(u, a, t),
    r = d20(),
    tot = r + c.M,
    diff = tot - c.R,
    cf = selfHateHit(u) && r === 1,
    miss = cf || (c.th.v && r <= c.th.v);
  const dg = miss ? null : ap3Degree(diff);
  log(
    `<div class="lh">${uName(u)} → ${uName(t)} · ${a.name}</div><div class="lr">d20 <b>${r}</b>${modsStr(c.mods)} = <b>${tot}</b> против ${'Самообладания'} <b>${c.R}</b>${c.th.v ? ` · порог промаха ${c.th.v} (${c.th.src})` : ''}</div><div class="lo"><span class="chip ${miss ? 'fail' : dg.c}">${cf ? 'критический провал' : miss ? 'промах' : `разница ${sgn(diff)} · ${dg.txt}`}</span></div>`,
    'atk',
  );
  view.fxLine(u, t, 'fire');
  if (cf) backlash(u, a);
  if (miss) return;
  if (id === 'curseVuln') {
    removeEff(t, 'vuln2');
    t.effects.push({
      type: 'vuln2',
      by: u.id,
      end: 1e9,
    });
    ev(
      `🎯 Уязвимость на ${uName(t)}: следующее воздействие сработает вдвойне (урон после брони ×2, стаки ×2, толчок ×2)`,
    );
  } else {
    const mag = weakOf(u, dg.t);
    removeEff(t, 'weak2');
    t.effects.push({
      type: 'weak2',
      by: u.id,
      left: 2,
      mag,
      at: marker(),
      end: 1e9,
    });
    ev(`🥀 Слабость на ${uName(t)}: −${mag} к атакам, способностям и Стойкости на 2 хода (на заклинания не действует)`);
  }
  if (tplFlag(u, 'flameMark') && !hasEff(t, 'fmark')) {
    t.effects.push({
      type: 'fmark',
      by: u.id,
      end: 1e9,
    });
    ev(`🔥 Метка пламени на ${uName(t)}`);
  }
}
export function doCurse2(u: Unit, t, a, id) {
  return doCurse3(u, t, a, id);
}
export function selfHateHit(u: Unit) {
  return disOf(u, 'shame') === 2;
}
export function backlash(u: Unit, a) {
  ev(
    `${DIS_ICON.shame} ${uName(u)} — Самоненависть: критический провал «${esc(a.name)}», магическая отдача — ${'1 Боль'} сквозь броню`,
  );
  view.fxText(u, 'отдача', 'dmg');
  applyDamage(u, 1, null);
}
export function spellMods(u: Unit) {
  const f = disOf(u, 'shame');
  return f && isLit(u)
    ? [
        {
          l: DIS.shame[f - 1] + ' (на свету)',
          v: -DISP.shame.pen[f - 1],
        },
      ]
    : [];
}
export function weakMag(u: Unit) {
  const e = getEff(u, 'weak2');
  return e ? e.mag || 3 : 0;
}
export const SPELL_DC = () => +SET.spellDC || 12;

/* Заклинание без цели: d20 + мастерство магии против сложности. Возвращает степень 0–3. */
export function spellRoll(u: Unit, a) {
  const mods = [
    {
      l: 'Мастерство (магия)',
      v: mastMg(u),
    },
  ];
  v2AtkMods(u, a, mods, null);
  mods.push(...spellMods(u));
  const dc = SPELL_DC(),
    r = d20(),
    tot = r + sum(mods),
    diff = tot - dc,
    cf = selfHateHit(u) && r === 1;
  const t = cf ? 0 : diff < 0 ? 0 : diff >= 10 ? 3 : diff >= 5 ? 2 : 1;
  log(
    `<div class="lh">${uName(u)} · ${esc(a.name)}</div><div class="lr">d20 <b>${r}</b>${modsStr(mods)} = <b>${tot}</b> против сложности <b>${dc}</b></div><div class="lo"><span class="chip ${cf || !t ? 'fail' : ['', 'ok', 'enh', 'crit'][t]}">${cf ? 'критический провал' : !t ? 'провал' : ['', 'обычный успех', 'усиленный успех', 'критический успех'][t]}</span></div>`,
    'atk',
  );
  if (cf) backlash(u, a);
  return t;
}

/* Проклятие: ложится всегда, если не сработал порог промаха; степень — против Стойкости. */
export function curseCalc(u: Unit, a, t) {
  const mods = [
    {
      l: 'Мастерство (магия)',
      v: mastMg(u),
    },
  ];
  v2AtkMods(u, a, mods, t);
  mods.push(...spellMods(u));
  const M = sum(mods),
    R = composure(t),
    th = missThr(u, a, t),
    p = [0, 0, 0, 0];
  for (let r = 1; r <= 20; r++) {
    if (r <= th.v || (selfHateHit(u) && r === 1)) {
      p[0]++;
      continue;
    }
    p[ap3Degree(r + M - R).t]++;
  }
  return {
    mods,
    M,
    R,
    th,
    p: p.map(x => x / 20),
    land: 1 - p[0] / 20,
  };
}
export const weakOf = (u: Unit, t) => Math.max(1, Math.floor((stat(u, 'int') * [0, 1, 1.5, 2][t]) / 4 + 1e-9));
