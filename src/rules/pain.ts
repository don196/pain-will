import type { Action, Opts, Unit } from '../types';
import { T, tplOf } from '../data/fighters';
import { DEG_RU, PCLS_RU, PTYP_RU } from '../data/labels';
import { addSt, interrupt, wtOf } from './combat';
import { inFoot } from './geometry';
import { ev, uName } from './log';
import { witnessDown } from './disorders';
import { stat } from './stats';
import { AREAS, addWound, syncBleed, tickWounds } from './wounds';
import { S } from '../state';
import { esc, pick } from '../util';
import { DEFAULT_TBL, SET, TBL } from '../settings';
import { view } from '../view';

/* Предел: 5, герой +1, Крепкий +1, Хрупкий −1, рядовой противник −1. Внутри: hp — сколько Боли ещё можно принять. Противник: maxHp = предел. Герой: maxHp = предел + 1, hp 1 — «на пороге». */
export const PCLS = {
  light: [0, 1, 1, 2],
  med: [0, 1, 2, 3],
  heavy: [0, 1, 2, 4],
};
/* Таблица Боли из «Правил»: подставить в PCLS (ссылки на массивы те же). */
export function applyTables() {
  const t = TBL();
  for (const k of ['light', 'med', 'heavy']) {
    const v = (t.pcls && t.pcls[k]) || DEFAULT_TBL.pcls[k];
    PCLS[k][1] = +v[0];
    PCLS[k][2] = +v[1];
    PCLS[k][3] = +v[2];
  }
}
export function painLim(t) {
  t = t || {};
  const b = TBL();
  return t.lim != null
    ? t.lim
    : b.limBase +
        (t.side === 'pc' ? b.limHero : 0) +
        (t.tough ? b.limTough : 0) +
        (t.fragile ? b.limFragile : 0) +
        (t.mook ? b.limMook : 0);
}
export const limOf = (u: Unit) => (u.lim != null ? u.lim : painLim(T[u.tpl]));
export function painOf(u: Unit) {
  return Math.max(0, Math.min(limOf(u) + 1, u.maxHp - Math.max(0, u.hp)));
}

/* Боль мешает действовать: −1 к атакам и способностям за каждые 2 Боли. */
export function painPen(u: Unit) {
  return Math.floor(Math.min(limOf(u), painOf(u)) / Math.max(1, TBL().painStep));
}
export const onEdge = (u: Unit) => !!u && u.side === 'pc' && !u.down && u.hp <= 1;
export const armorNow = (u: Unit) => (u.armorPts == null ? u.armor || 0 : u.armorPts);
export const composure = t => 8 + stat(t, 'int');
export function wClass(att: Unit, act: Action) {
  let c = act.pcls || (wtOf(act) >= 4 ? 'heavy' : wtOf(act) === 0 && !act.ranged && !act.magic ? 'light' : 'med');
  if (c === 'heavy' && stat(att, 'str') < 6) c = 'med';
  /* вариант 4.5: дубина толстяка — среднее оружие */
  if (SET.parryDiff && c === 'heavy' && att && att.tpl === 'dummyFat') c = 'med';
  return c;
}
export function wType(act: Action) {
  return act.ptyp || (act.magic ? 'fire' : act.ranged ? 'pierce' : 'cut');
}

/* Боль удара: класс × степень (+1 в спину, +1 о преграду), затем броня по таблице свода 2.4.
   Колющее и дробящее считают броню на 1 меньше. Броня не изнашивается. */
export function armorCut(ap, raw) {
  if (ap <= 0 || raw <= 0) return raw;
  const a = Math.min(3, ap),
    T = (TBL().armorT || DEFAULT_TBL.armorT)[a];
  if (raw <= 4) return Math.max(0, +T[raw - 1]);
  /* сверх таблицы — та же доля, что у четырёх */
  return Math.max(0, raw - Math.round(((4 - T[3]) * raw) / 4));
}
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
  const ap0 = act.ignoreArmor ? 0 : armorNow(def),
    ap = ap0 > 0 && (typ === 'pierce' || typ === 'blunt') ? ap0 - 1 : ap0;
  const abs = raw - armorCut(ap, raw),
    wear = 0,
    crush = 0;
  let net = raw - abs;
  if (o.vd) net *= 2;
  return {
    cls,
    typ,
    t,
    raw,
    ap,
    ap0,
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
  if (p.ap0) s += ` − броня ${p.ap}${p.ap !== p.ap0 ? ` (${p.ap0}, ${PTYP_RU[p.typ]} — на 1 меньше)` : ''}: ${p.abs}`;
  if (p.vd) s += ' × 2 (Уязвимость)';
  return s + ` = <b>${p.net}</b>`;
}
/* Броня не изнашивается (свод 2.4) — оставлено для совместимости вызовов. */
export function painWear(def: Unit, p) {
  void def;
  void p;
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
      def.bleedX = (def.bleedX || 0) + act.xbleed;
      syncBleed(def);
      ev(`🩸 ${esc(act.name)}: ${why} — кровотечение сильнее (+${act.xbleed} к тяжести) у ${uName(def)}`);
    }
  };
  /* Свод 2.4: последствия по виду оружия, только если после брони осталась Боль.
     Режущее: усиленный — обычная открытая рана, крит — серьёзная. Колющее: крит — обычная.
     Дробящее: усиленный — Неустойчивость, крит — ещё закрытая рана и Дезориентация. Огонь: крит — Прижигание (у карточки). */
  if (p.net <= 0) return null;
  if (p.typ === 'fire') return null;
  if (p.typ === 'blunt') {
    if (t >= 2) addSt(def, 'unst', 1, 'дробящий удар');
    if (t === 3 && !def.down) {
      ev(`🔨 Критический дробящий удар — закрытая рана и Дезориентация`);
      const ok = addWound(def, ar(), { closed: true });
      addSt(def, 'disor', 1, 'дробящий крит');
      return ok ? 'wound' : null;
    }
    return null;
  }
  const wd = p.typ === 'cut' ? (t === 3 ? 2 : t === 2 ? 1 : 0) : t === 3 ? 1 : 0;
  if (wd) {
    ev(
      p.typ === 'cut'
        ? `🗡 Режущий ${t === 3 ? 'критический' : 'усиленный'} удар — ${t === 3 ? 'серьёзная' : 'обычная'} открытая рана`
        : '🗡 Колющий критический удар — обычная открытая рана',
    );
    if (addWound(def, ar(), { deg: wd })) {
      xb('рана');
      return 'wound';
    }
  }
  if (act.xbleed) {
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
  u.od = SET.edgeLast ? 0 : Math.min(u.od || 0, 1);
  u._edgeMark = S.round + ':' + S.phaseIdx;
  u._lastTurn = false;
  ev(
    `💢 ${uName(u)} — Боль дошла до предела (${limOf(u)}): <b>на пороге</b>. ${SET.edgeLast ? 'Падает, ОД этого хода сгорают; следующий свой ход — последний: ползти, перевязывать, говорить и колдовать голосом, затем без сознания' : 'Лежит, 1 ОД в ход: ползти, перевязывать, отдавать приказы'}. Любая новая Боль — без сознания`,
    { k: 'edge', u: u.id },
  );
  view.fxText(u, 'на пороге', 'dmg');
  if (!S.sim) view.play({ t: 'edge', u });
}
export function koTick(u: Unit) {
  tickWounds(u);
  if (u.bleed > 0) {
    u.deathSteps = (u.deathSteps || 0) + 1;
    if (u.deathSteps >= 3) {
      u.dead = true;
      u.ko = false;
      if (S.stat) S.stat.dead = (S.stat.dead || 0) + 1;
      ev(`✝ ${uName(u)} истекает кровью без сознания и умирает`);
      witnessDown(u);
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
const ATTACKISH = ['attack', 'pair', 'arc', 'circle', 'grab', 'push', 'dash'];
/* На пороге: ползти, перевязывать, приказывать. Варианты 4.5: «последний ход» — ещё речь и неатакующая магия;
   «голос и жесты» — из магии только голосовые заклинания. */
export const edgeOk = (id, a) =>
  EDGE_KINDS.includes(a.kind) ||
  id === 'escape' ||
  (SET.voiceOnly
    ? a.cast === 'voice' || (!!a.speech && !a.magic && !ATTACKISH.includes(a.kind))
    : SET.edgeLast
      ? (!!a.speech || !!a.magic) && !ATTACKISH.includes(a.kind)
      : false);
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
  /* экспедиция: герой пришёл из прошлого боя со своей Болью и состоянием */
  const c = u._carry;
  if (c) {
    u.hp = Math.max(0, u.maxHp - c.pain);
    if (c.armorPts != null) u.armorPts = c.armorPts;
    u.ko = !!c.ko;
    u.dead = !!c.dead;
    u.deathSteps = c.deathSteps || 0;
    delete u._carry;
  }
}
