import type { Action, Opts, Unit } from '../types';
import { T, tplOf } from '../data/fighters';
import { DEG_RU, PCLS_RU, PTYP_RU } from '../data/labels';
import { addSt, interrupt, wtOf } from './combat';
import { inFoot } from './geometry';
import { ev, uName } from './log';
import { stat } from './stats';
import { AREAS, addWound, tickWounds } from './wounds';
import { S } from '../state';
import { esc, pick } from '../util';
import { view } from '../view';

/* Предел: 5, герой +1, Крепкий +1, Хрупкий −1, рядовой противник −1. Внутри: hp — сколько Боли ещё можно принять. Противник: maxHp = предел. Герой: maxHp = предел + 1, hp 1 — «на пороге». */
export const PCLS = {
  light: [0, 1, 1, 2],
  med: [0, 1, 2, 3],
  heavy: [0, 1, 2, 4],
};
export function painLim(t) {
  t = t || {};
  return t.lim != null
    ? t.lim
    : 5 + (t.side === 'pc' ? 1 : 0) + (t.tough ? 1 : 0) - (t.fragile ? 1 : 0) - (t.mook ? 1 : 0);
}
export const limOf = (u: Unit) => (u.lim != null ? u.lim : painLim(T[u.tpl]));
export function painOf(u: Unit) {
  return Math.max(0, Math.min(limOf(u) + 1, u.maxHp - Math.max(0, u.hp)));
}

/* Боль мешает действовать: −1 к атакам и способностям за каждые 2 Боли. */
export function painPen(u: Unit) {
  return Math.floor(Math.min(limOf(u), painOf(u)) / 2);
}
export const onEdge = (u: Unit) => !!u && u.side === 'pc' && !u.down && u.hp <= 1;
export const armorNow = (u: Unit) => (u.armorPts == null ? u.armor || 0 : u.armorPts);
export const composure = t => 8 + stat(t, 'int');
export function wClass(att: Unit, act: Action) {
  let c = act.pcls || (wtOf(act) >= 4 ? 'heavy' : wtOf(act) === 0 && !act.ranged && !act.magic ? 'light' : 'med');
  if (c === 'heavy' && stat(att, 'str') < 6) c = 'med';
  return c;
}
export function wType(act: Action) {
  return act.ptyp || (act.magic ? 'fire' : act.ranged ? 'pierce' : 'cut');
}

/* Боль удара: класс × степень (+1 в спину, +1 о преграду). Броня гасит половину текущей прочности (вверх), колющее усиленным и критическим — на 1 меньше. Прочность стирают крит, дробящее усиленным и Сила 7+ в ближнем бою (усиленный, критический). */
export function painInfo(att: Unit, act: Action, def: Unit, t, o: Opts = {}) {
  const cls = wClass(att, act),
    typ = wType(act);
  let raw = PCLS[cls][t] || 0;
  const notes = [];
  if (o.bs) {
    raw += 1;
    notes.push('в спину +1');
  }
  if (o.collide) {
    raw += 1;
    notes.push('о преграду +1');
  }
  const ap = act.ignoreArmor ? 0 : armorNow(def);
  let abs = 0,
    wear = 0;
  /* Броня гасит половину текущей прочности (вверх) от каждого удара; колющее усиленным и критическим — на 1 меньше. Критический стирает пункт прочности, дробящее — и усиленный. */
  if (ap > 0) {
    const k = Math.ceil(ap / 2);
    abs = Math.min(raw, typ === 'pierce' && t > 1 ? k - 1 : k);
    wear = t >= 3 || (typ === 'blunt' && t >= 2) ? 1 : 0;
  }
  const crush = !act.ranged && !act.magic && t >= 2 && stat(att, 'str') >= 7 && ap - wear > 0 ? 1 : 0;
  let net = raw - abs;
  if (o.vd) net *= 2;
  return {
    cls,
    typ,
    t,
    raw,
    ap,
    abs,
    wear,
    crush,
    net,
    notes,
    vd: !!o.vd,
    heavyDown: act.pcls === 'heavy' && cls !== 'heavy',
  };
}
export function painTxt(p, t) {
  let s = `Боль: ${PCLS_RU[p.cls]} ${PTYP_RU[p.typ]}${p.heavyDown ? ' (Сила ниже 6 — как среднее)' : ''}, ${DEG_RU[t]} — ${PCLS[p.cls][t]}`;
  if (p.notes.length) s += ', ' + p.notes.join(', ');
  if (p.ap)
    s += ` − броня ${p.abs}${p.typ === 'pierce' && p.t > 1 ? ' (колющее: на 1 меньше)' : ''}${p.wear + p.crush ? ` [прочность ${p.ap} → ${Math.max(0, p.ap - p.wear - p.crush)}${p.crush ? ', Сила 7+ ломает ещё 1' : ''}]` : ''}`;
  if (p.vd) s += ' × 2 (Уязвимость)';
  return s + ` = <b>${p.net}</b>`;
}
export function painWear(def: Unit, p) {
  if (!p || !(p.wear + p.crush)) return;
  const a0 = armorNow(def);
  def.armorPts = Math.max(0, a0 - p.wear - p.crush);
  if (a0 > 0 && def.armorPts === 0)
    ev(`<span class="dim">🛡 ${esc(def.name)}: броня больше не держит (прочность 0)</span>`);
}
export function painAfterTxt(def: Unit, dmg) {
  const L = limOf(def),
    p = painOf(def) + dmg;
  if (dmg <= 0) return `Боль цели ${painOf(def)}/${L}`;
  if (def.side === 'pc') {
    if (onEdge(def)) return 'цель теряет сознание';
    if (p >= L) return 'цель на пороге';
  } else if (p >= L) return 'цель выбывает';
  return `Боль цели ${p}/${L}`;
}

/* Раны от удара: крит — рана (дробящее: закрытая, плюс Дезориентация); режущее усиленное по цели без брони — рана; дробящее усиленное — Неустойчивость; тесак — стак кровотечения, если Боль прошла сквозь броню. */
export function painWound(att: Unit, act: Action, def: Unit, deg, p) {
  if (!p || act.fixed != null || deg.t < 1) return null;
  const ar = () => pick(AREAS),
    t = deg.t;
  const xb = why => {
    if (act.xbleed && !def.down) {
      def.bleed += act.xbleed;
      ev(`🩸 ${esc(act.name)}: ${why} — ещё ${act.xbleed} стак кровотечения у ${uName(def)}, стаков ${def.bleed}`);
    }
  };
  if (p.typ === 'fire') return null;
  if (p.typ === 'blunt') {
    if (t === 3) {
      ev(`🔨 Критический дробящий удар — закрытая рана и Дезориентация`);
      const ok = addWound(def, ar(), {
        closed: true,
      });
      addSt(def, 'disor', 1, 'дробящий крит');
      return ok ? 'wound' : null;
    }
    if (t === 2) addSt(def, 'unst', 1, 'дробящий удар');
    return null;
  }
  if (t === 3 || (p.typ === 'cut' && t === 2 && p.ap === 0)) {
    ev(t === 3 ? `🗡 Критический успех — рана` : `🗡 Режущий усиленный удар по цели без брони — рана`);
    if (addWound(def, ar())) {
      xb('рана');
      return 'wound';
    }
  }
  if (act.xbleed && p.net > 0) {
    xb('удар прошёл сквозь броню');
    return 'bleed';
  }
  return null;
}
export function enterEdge(u: Unit) {
  if (S.stat) S.stat.edge = (S.stat.edge || 0) + 1;
  interrupt(u, 'на пороге');
  u.prep = null;
  u.prone = true;
  if (u.st) u.st.unst = 0;
  u.od = Math.min(u.od || 0, 1);
  ev(
    `💢 ${uName(u)} — Боль дошла до предела (${limOf(u)}): <b>на пороге</b>. Лежит, 1 ОД в ход: ползти, перевязывать, отдавать приказы. Любая новая Боль — без сознания`,
  );
  view.fxText(u, 'на пороге', 'dmg');
}
export function koTick(u: Unit) {
  tickWounds(u);
  if (u.bleed > 0) {
    u.bleed--;
    u.deathSteps = (u.deathSteps || 0) + 1;
    if (u.deathSteps >= 3) {
      u.dead = true;
      u.ko = false;
      if (S.stat) S.stat.dead = (S.stat.dead || 0) + 1;
      ev(`✝ ${uName(u)} истекает кровью без сознания и умирает`);
    } else ev(`🩸 ${uName(u)} без сознания истекает кровью: шаг к смерти ${u.deathSteps} из 3`);
  } else ev(`<span class="dim">${esc(u.name)} без сознания; кровотечения нет — состояние стабильно</span>`);
}
export function doRevive(u: Unit, t) {
  t.down = false;
  t.ko = false;
  t.hp = 1;
  t.prone = true;
  t.od = 0;
  t.st = {};
  t.deathSteps = 0;
  t.skipped = true;
  if (S.stat) S.stat.revive = (S.stat.revive || 0) + 1;
  ev(`✋ ${uName(u)} приводит в чувство ${uName(t)}: на пороге, ходит со следующего хода героев (1 ОД)`);
  view.fxText(t, 'в сознании', 'heal');
}
export const EDGE_KINDS = ['move', 'bandage', 'revive', 'ordnow', 'ordback', 'unlasso', 'escape'];
export const edgeOk = (id, a) => EDGE_KINDS.includes(a.kind) || id === 'escape';
export const koAt = (x, y) => S.units.find(o => o.down && o.ko && !o.dead && inFoot(o, x, y)) || null;
export function painPrep(u: Unit) {
  const t = tplOf(u);
  u.lim = painLim(t);
  u.maxHp = u.lim + (u.side === 'pc' ? 1 : 0);
  u.hp = u.maxHp;
  u.armorPts = u.armor || 0;
  u.ko = false;
  u.dead = false;
  u.deathSteps = 0;
  u._pm = true;
}
