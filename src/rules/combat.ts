import { igniteTerr, inWater, terrainStep, waterLevel } from './terrain';
import type { Action, Opts, Unit } from '../types';
import { A } from '../data/actions';
import { T, tplOf } from '../data/fighters';
import { AREA_RU, DIR_RU, EFF_RU, ST_ICON, ST_RU, WDEG_RU } from '../data/labels';
import { canTarget, contestLog, isHuman, trapCheck, weaponsOf, zocWeapon } from './actions';
import { knockPlan, resolveAttack } from './attack';
import { applyDamage, downUnit } from './damage';
import { fallPain } from './height';
import { inB, isFloor, near1, unitAt } from './geometry';
import { LASSO_R, SNARE_PART, immobile, lassoPart, lassoSnap, lassoTarget, releaseLasso } from './lasso';
import { hiddenFrom } from './light';
import { ev, sleep, uName } from './log';
import { takeVuln, weakMag } from './magic';
import { onEdge, painInfo, painPen, painTxt, painWear, wClass } from './pain';
import { ap3Degree, defThr, dexFree, isSpell } from './reactions';
import { actId, dmgAfter, getEff, hasEff, hitCalc, modsStr, pContest, removeEff, reqOk, stat } from './stats';
import { AREAS, addWound, vital, woundPenTxt } from './wounds';
import { SET, TBL } from '../settings';
import { S, byId, friends, hostiles } from '../state';
import { HXD, cheb, d20, esc, hcube, hd, pct, pick, sum, sz } from '../util';
import { view } from '../view';
export const STRONG = {
  ripple: 'blind2',
  cough: 'mute',
};
export const stOf = (u: Unit, k) => (u && u.st && u.st[k]) || 0;
export const marker = () => S.round + ':' + S.phaseIdx;
export const fullDef = (u: Unit) => u.side === 'pc' || !!(T[u.tpl] && T[u.tpl].fullDef) || !!SET.enemyFullDef;
export function mast(u: Unit, ranged?) {
  const t = tplOf(u),
    v = ranged ? t.mr : t.mm;
  return v == null ? stat(u, 'dex') : v;
}
export function mastMg(u: Unit) {
  const v = tplOf(u).mg;
  return v == null ? stat(u, 'int') : v;
}
export const tplFlag = (u: Unit, f) => !!(u && T[u.tpl] && T[u.tpl][f]);

/* Стаки части тела: серьёзная рана 1, тяжёлая 2, ампутация 3 (обычная рана стаков не даёт). */
export function partSt(u: Unit, ar) {
  const w = u.wounds && u.wounds[ar];
  return Math.min(3, w ? Math.max(0, w.deg - 1) : 0);
}
export const legPara = (u: Unit) => partSt(u, 'legL') >= 3 || partSt(u, 'legR') >= 3;
export function legSpeedPen(u: Unit) {
  let p = 0;
  for (const l of ['legL', 'legR']) {
    const s = partSt(u, l);
    p += s >= 3 ? 2 : s;
  }
  return p;
}
export function legDodgePen(u: Unit) {
  let p = 0;
  for (const l of ['legL', 'legR']) {
    const s = partSt(u, l);
    p += s >= 3 ? 8 : 2 * s;
  }
  return p;
}
export function interrupt(u: Unit, why) {
  if (u.charge) {
    if (S.stat) {
      const st = S.stat.skillInterrupts || (S.stat.skillInterrupts = {});
      st[u.charge.kind] = (st[u.charge.kind] || 0) + 1;
    }
    u.charge = null;
    ev(`<span class="dim">${esc(u.name)}: усиленная подготовка сорвана (${why})</span>`);
  }
  if (u.prep) {
    u.prep = null;
    ev(`<span class="dim">${esc(u.name)}: подготовка сорвана (${why})</span>`);
  }
  if (u.lassoT) releaseLasso(u, why);
}
export function setProne(u: Unit, why?) {
  if (u.down || u.prone) return;
  interrupt(u, 'падение');
  u.prone = true;
  if (u.st) u.st.unst = 0;
  ev(`⤵ ${uName(u)} сбит с ног${why ? ' — ' + why : ''}: −5 к обычным атакам и активной защите, встать — 1 ОД`);
  view.fxText(u, 'сбит', 'info');
  interrupt(u, 'падение');
}
/* Падение с уступа (толчок, отбрасывание): сбит, Боль по высоте сквозь броню; с 3 уровней — рана, с 5 — ещё одна; с 6 — смерть. */
export function fall(u: Unit, h) {
  if (u.down || h <= 0) return;
  if (S.stat) S.stat.falls = (S.stat.falls || 0) + 1;
  if (h >= 6) {
    ev(`✝ ${uName(u)} падает с высоты ${h} и разбивается`);
    u.dead = true;
    u.hp = 0;
    downUnit(u, null);
    return;
  }
  const n = fallPain(h);
  ev(`⤵ ${uName(u)} падает с высоты ${h}: ${n} Боли сквозь броню${h >= 3 ? ', рана' : ''}`, {
    k: 'fall',
    u: u.id,
    n,
  });
  setProne(u, 'падение');
  applyDamage(u, n, null);
  if (h >= 3 && !u.down) addWound(u, pick(AREAS), { deg: h >= 5 ? 3 : h >= 4 ? 2 : 1 });
}
export function addStrong(u: Unit, type) {
  u.effects = u.effects.filter(e => e.type !== type);
  u.effects.push({
    type,
    left: 1,
    at: marker(),
    end: 1e9,
  });
  ev(`${type === 'blind2' ? '🕶' : '🤐'} ${uName(u)}: ${EFF_RU[type]} до конца своего следующего хода`);
  view.fxText(u, EFF_RU[type], 'info');
  if (type === 'mute' && u.prep && u.prep.speech) interrupt(u, 'Немота');
}
export function addSt(u: Unit, k, n, why) {
  if (!u || u.down || !(n > 0)) return;
  if (k === 'unst' && (u.prone || sz(u) > 1)) return;
  if (k === 'heat' && inWater(u)) return;
  u.st = u.st || {};
  u.st[k] = (u.st[k] || 0) + n;
  ev(`${ST_ICON[k]} ${uName(u)}: ${ST_RU[k]} +${n}${why ? ' (' + why + ')' : ''}, стаков ${u.st[k]}`);
  if (k === 'heat') {
    while (u.st.heat >= 3 && !u.down) {
      u.st.heat -= 3;
      ev(`🔥 Горение: три стака Нагрева сгорают — ${uName(u)} получает ${'2 Боли'} сквозь броню`);
      applyDamage(u, 2, null);
    }
    return;
  }
  if (k === 'unst') {
    if (u.st.unst >= 2) setProne(u, 'второй стак Неустойчивости');
    return;
  }
  if (k === 'disor') {
    if (u.st.disor >= 3) {
      u.st.disor = 0;
      ev(`😵 ${uName(u)} теряет сознание: падает и пропускает следующий ход`);
      u.stunned = true;
      setProne(u);
    }
    return;
  }
  const s = STRONG[k];
  if (s && u.st[k] >= 3 && !hasEff(u, s)) {
    u.st[k] = 0;
    addStrong(u, s);
  }
}

/* Конец своего хода: каждый слабый эффект теряет стак (Нагрев сам не спадает; Кашель от силка на голове держится). */
export function decaySt(u: Unit) {
  if (!u.st) return;
  for (const k of ['ripple', 'cough', 'disor', 'unst']) {
    if (!(u.st[k] > 0)) continue;
    if (k === 'cough' && lassoPart(u) === 'head' && u.st[k] <= 1) continue;
    u.st[k]--;
  }
}
export function cauterize(u: Unit, ar0) {
  const ar = ar0 || pick(AREAS),
    w = u.wounds[ar];
  if (w && w.open) {
    w.deg = Math.min(3, w.deg + 1);
    w.open = false;
    ev(
      `🔥 Прижигание: ${uName(u)} — ${AREA_RU[ar]}, открытая рана становится ${WDEG_RU[w.deg] === 'тяжёлая' ? 'тяжёлой' : 'серьёзной'} и закрывается (${woundPenTxt(ar, w.deg)})`,
    );
  } else if (w) ev(`🔥 Прижигание: ${uName(u)} — ${AREA_RU[ar]}, по закрытой ране: степень не растёт`);
  else {
    u.wounds[ar] = {
      deg: 1,
      open: false,
      age: 0,
    };
    if (S.stat) S.stat.wounds++;
    ev(`🔥 Прижигание: ${uName(u)} — ${AREA_RU[ar]}, закрытая обычная рана, без кровотечения`);
  }
  view.fxText(u, 'ожог', 'dmg');
  return 'wound';
}
export const ripplePen = (u: Unit) => (hasEff(u, 'blind2') ? 0 : 2 * stOf(u, 'ripple'));

/* Поправки 2.0 к броску атаки или способности по цели. */
export function v2AtkMods(u: Unit, act: Action, m, t) {
  if (act.lasso && u._snarePart && SNARE_PART[u._snarePart] && SNARE_PART[u._snarePart].v)
    m.push({
      l: 'силок: ' + SNARE_PART[u._snarePart].l,
      v: SNARE_PART[u._snarePart].v,
    });
  const rp = ripplePen(u);
  if (rp)
    m.push({
      l: 'Рябь',
      v: -rp,
    });
  if (u.prone && act.kind === 'attack' && !act.complex)
    m.push({
      l: 'сбит',
      v: -5,
    });
  if (act.complex && stOf(u, 'disor'))
    m.push({
      l: 'Дезориентация',
      v: -2 * stOf(u, 'disor'),
    });
  if (act.speech && stOf(u, 'cough') && !hasEff(u, 'mute'))
    m.push({
      l: 'Кашель',
      v: -2 * stOf(u, 'cough'),
    });
  if (hasEff(u, 'weak2') && !isSpell(act))
    m.push({
      l: 'Слабость',
      v: -weakMag(u),
    });
  if (!act.magic && act.kind === 'attack') {
    const s = partSt(u, 'armR');
    if (s && s < 3)
      m.push({
        l: 'рана руки',
        v: -2 * s,
      });
  }
  if (act.cbonus)
    m.push({
      l: 'контратака',
      v: act.cbonus,
    });
  const pp = painPen(u);
  if (pp)
    m.push({
      l: 'Боль',
      v: -pp,
    });
}
export function wtOf(act: Action) {
  if (act.ranged || act.magic) return 0;
  if (act.wt != null) return act.wt;
  return (act.reach || 1) > 1 ? 4 : 2;
}
export function meleeInHand(u: Unit) {
  for (const id of u.acts) {
    const a = A[id];
    if (!a || a.kind !== 'attack' || a.ranged || a.magic || a.fixed != null || id === 'improv') continue;
    if (a.w && u.wield && a.w !== u.wield && weaponsOf(u).length > 1) continue;
    return id;
  }
  return null;
}
export function v2DefOptions(def: Unit, att: Unit, act: Action, opt) {
  const out = [],
    rp = ripplePen(def),
    bl = hasEff(def, 'blind2'),
    dp = 0;
  const common = m => {
    if (rp)
      m.push({
        l: 'Рябь',
        v: -rp,
      });
    if (bl)
      m.push({
        l: 'Слепота',
        v: -8,
      });
    if (def.prone)
      m.push({
        l: 'сбит',
        v: -5,
      });
    if (dp)
      m.push({
        l: 'темнота',
        v: -dp,
      });
    if (S.terrain) {
      const wl = waterLevel(def);
      if (wl === 2) m.push({ l: 'глубокая вода', v: -8 });
      else if (wl === 1 && m.some(x => x.l === 'Ловкость')) m.push({ l: 'мелкая вода', v: -3 });
    }
    return m;
  };
  const m = [
    {
      l: 'Ловкость',
      v: stat(def, 'dex'),
    },
  ];
  if (immobile(def))
    m.push({
      l: 'обездвижен',
      v: -3,
    });
  const lp = legDodgePen(def);
  if (lp)
    m.push({
      l: 'рана ноги',
      v: -lp,
    });
  out.push({
    mode: 'dodge',
    name: 'Уклонение',
    mods: common(m),
  });
  if (!fullDef(def)) return out;
  const wt = wtOf(act);
  if (def.shield > 0 && partSt(def, 'armL') < 3 && lassoPart(def) !== 'armL') {
    const m = [
      {
        l: 'Сила',
        v: stat(def, 'str'),
      },
    ];
    const bb = (T[def.tpl] && T[def.tpl].blockB) || 0;
    if (bb)
      m.push({
        l: 'баклер',
        v: bb,
      });
    m.push({
      l: 'щит',
      v: def.shield,
    });
    if (wt)
      m.push({
        l: 'вес оружия',
        v: -wt,
      });
    const s = partSt(def, 'armL');
    if (s)
      m.push({
        l: 'рана руки',
        v: -2 * s,
      });
    if (def.effects.some(e => e.type === 'bucklerOpen')) m.push({ l: 'Подбив баклером', v: -3 });
    out.push({
      mode: 'block',
      name: 'Блок щитом',
      mods: common(m),
    });
  }
  if (
    act.kind === 'attack' &&
    !act.ranged &&
    !act.magic &&
    act.fixed == null &&
    actId(act) !== 'improv' &&
    !opt.prepared &&
    meleeInHand(def) &&
    partSt(def, 'armR') < 3 &&
    lassoPart(def) !== 'armR'
  ) {
    const m = [
      {
        l: 'Мастерство',
        v: mast(def),
      },
    ];
    if (SET.parryDiff) {
      /* вариант 4.5: штраф — разница условных весов оружия защитника и атакующего */
      const W = TBL().parryW,
        dw = A[meleeInHand(def)],
        diff = dw ? Math.abs((W[wClass(def, dw)] || 3) - (W[wClass(att, act)] || 3)) : 0;
      if (diff)
        m.push({
          l: 'разница весов',
          v: -diff,
        });
    } else if (wt)
      m.push({
        l: 'вес оружия',
        v: -wt,
      });
    const s = partSt(def, 'armR');
    if (s)
      m.push({
        l: 'рана руки',
        v: -2 * s,
      });
    if (def.effects.some(e => e.type === 'bucklerOpen')) m.push({ l: 'Подбив баклером', v: -3 });
    out.push({
      mode: 'parry',
      name: 'Парирование',
      mods: common(m),
    });
  }
  return out;
}
export const V2_EFF = new Set(['blind2', 'mute', 'weak2', 'vuln2', 'fmark', 'magsight', 'lasso', 'spots', 'ordnow']);

/* Активная защита 2.0: один из трёх способов против уже выпавшего броска атаки. Неудача ничего не ухудшает. */
export async function v2Defend(def: Unit, att: Unit, act: Action, total, pas, opt) {
  let ops = v2DefOptions(def, att, act, opt);
  if ((def.od || 0) <= 0) ops = ops.filter(o => o.mode === 'dodge' && dexFree(def));
  if (!ops.length) return null;
  for (const o of ops) o.free = o.mode === 'dodge' && dexFree(def);
  const dth = defThr(def, act);
  for (const o of ops) {
    o.m = sum(o.mods);
    o.p = Math.max(0, Math.min(1, (21 - Math.max(dth + 1, total - o.m + 1)) / 20));
    o.pc = o.mode === 'dodge' ? 0 : Math.max(0, Math.min(1, (21 - Math.max(dth + 1, total - o.m + 5)) / 20));
    if (dth) ((o.mods = o.mods.concat([])), (o.thr = dth));
  }
  let ch;
  if (isHuman(def.side)) {
    const dNow = ap3Degree(total - pas);
    ch = await view.askChoice(
      'Активная защита',
      `<p>Атака: ${uName(att)} → ${uName(def)} (${esc(act.name)}). Бросок <b>${total}</b> против Стойкости ${pas}: ${dNow.txt}${dNow.t ? `, Боль <b>${dmgAfter(att, act, def, dNow.t)}</b>` : ''}.</p><p>Защита сравнивается с этим же броском. Она тратит 1 очко реакции (осталось ${def.od || 0}${dexFree(def) ? ', плюс бесплатное уклонение' : ''}); неудачная защита ничего не ухудшает.</p>`,
      [
        ...ops.map(o => ({
          v: o.mode,
          label: o.name + (o.free ? ' (бесплатно)' : ''),
          sub: `d20${modsStr(o.mods)} · отбить ${pct(o.p)}${o.mode === 'dodge' ? '' : ` · контратака ${pct(o.pc)}`}`,
        })),
        {
          v: '',
          label: 'Принять удар',
          sub: 'очко реакции останется',
        },
      ],
    );
  } else {
    const best = ops.slice().sort((a, b) => b.p + b.pc * 0.5 - (a.p + a.pc * 0.5))[0];
    ch = best.p > 0 ? best.mode : '';
  }
  const o = ops.find(x => x.mode === ch);
  if (!o) return null;
  if ((o.mode === 'parry' || o.mode === 'block') && def.effects.some(e => e.type === 'bucklerOpen')) {
    def.effects = def.effects.filter(e => e.type !== 'bucklerOpen');
  }
  const r = d20(),
    tot = r + o.m,
    margin = tot - total,
    thrFail = dth > 0 && r <= dth,
    ok = margin > 0 && !thrFail;
  if (S.stat) {
    S.stat.v2def = S.stat.v2def || {};
    S.stat.v2def[o.mode] = (S.stat.v2def[o.mode] || 0) + 1;
  }
  return {
    mode: o.mode,
    name: o.name,
    r,
    tot,
    mods: o.mods,
    ok,
    margin,
    thrFail,
    counter: ok && o.mode !== 'dodge' && margin >= 5 ? (margin >= 10 ? 10 : 5) : 0,
  };
}

/* Контратака после блока или парирования с перевесом 5+: обычная атака оружием в руке с +5 или +10. */
export async function v2Counter(def: Unit, att: Unit, bonus) {
  if (def.down || att.down || def.prone || S.over) return;
  const id = zocWeapon(def, att);
  if (!id || id === 'improv') {
    ev(`<span class="dim">Контратака пропадает: ${esc(att.name)} вне досягаемости оружия</span>`);
    return;
  }
  ev(`↺ Контратака: ${uName(def)} отвечает ${uName(att)} с +${bonus} к попаданию`);
  const ca = Object.create(A[id]);
  ca.cbonus = bonus;
  S.lastAtk = null;
  await resolveAttack(def, ca, att, {
    free: true,
    counter: true,
  });
  const la = S.lastAtk;
  if (!la || !la.hit || att.down || S.over) return;
  for (const k of friends(def)) {
    if (onEdge(k) || !tplFlag(k, 'syncCounter') || k.syncRound === S.round || k.prone || k.stunned || cheb(k, def) > 2)
      continue;
    const sid = meleeInHand(k);
    if (!sid || !canTarget(k, A[sid], att)) continue;
    k.syncRound = S.round;
    const a = A[sid],
      pi = painInfo(k, a, att, 1, {});
    ev(`⚔ Согласованная контратака: ${uName(k)} без броска бьёт ${uName(att)} — ${painTxt(pi, 1)}`);
    painWear(att, pi);
    k._striking = true;
    applyDamage(att, pi.net, k);
    k._striking = false;
    break;
  }
}

/* Удар в спину: союзник строго напротив атакующего или цель беспомощна. */
export function backstab(att: Unit, act: Action, def: Unit) {
  if (act.kind !== 'attack' || act.ranged || act.magic || act.fixed != null || def.side === att.side) return false;
  if (def.prone || hasEff(def, 'blind2') || def.stunned || hasEff(def, 'lasso')) return true;
  if (sz(def) > 1 || sz(att) > 1 || hd(att.x, att.y, def.x, def.y) !== 1) return false;
  const a = hcube(att.x, att.y),
    d = hcube(def.x, def.y),
    q = 2 * d[0] - a[0],
    r = 2 * d[1] - a[1],
    ox = q + (r - (r & 1)) / 2,
    o = unitAt(ox, r);
  return !!o && o.side === att.side && o !== att && !o.prone && !o.stunned;
}
export function v2Extra(att: Unit, act: Action, def: Unit, hit) {
  if (!hit)
    return {
      vx: 0,
      vd: 0,
      bs: 0,
    };
  const v = act.fixed == null && hasEff(def, 'vuln2');
  return {
    vx: 0,
    vd: v ? 1 : 0,
    bs: backstab(att, act, def) ? 3 : 0,
  };
}
/* Эффекты попадания 2.0. */
export async function v2OnHit(att: Unit, act: Action, def: Unit, deg, dmg, x, hb, opt) {
  let dbl = 1;
  if (hasEff(def, 'vuln2')) {
    takeVuln(def);
    dbl = 2;
  }
  const basic = act.kind === 'attack' && !act.complex && !act.magic && act.fixed == null;
  if (act.lasso) {
    const sp = att._snarePart || 'leg',
      ar = sp ? (sp === 'leg' ? pick(['legL', 'legR']) : sp) : pick(AREAS);
    if (ar === 'torso') ev(`➰ Силок соскальзывает с корпуса ${uName(def)} — захвата нет`);
    else {
      def.effects.push({
        type: 'lasso',
        by: att.id,
        part: ar,
        end: 1e9,
      });
      att.lassoT = def.id;
      interrupt(def, 'силок');
      ev(
        `➰ Силок: ${uName(att)} ловит ${uName(def)} — ${AREA_RU[ar]}. Обездвиживание${ar === 'head' ? ' и Кашель' : ar === 'armR' ? ', оружием в этой руке не ударить' : ar === 'armL' ? ', щитом не закрыться' : ''}. Освободиться: Сила против ${10 + stat(att, 'str')}`,
      );
      if (ar === 'head') addSt(def, 'cough', 1, 'силок на горле');
    }
  }
  if (def.down) return;
  if (act.heat) addSt(def, 'heat', act.heat * dbl, act.name);
  if (act.ptyp === 'fire') igniteTerr(def.x, def.y);
  const ck = act.coughDeg ? act.coughDeg[deg.t] || 0 : act.cough;
  if (ck && !def.down) addSt(def, 'cough', ck * dbl, act.name);
  if (def.down) return;
  const fm = getEff(def, 'fmark');
  if (fm && basic && att.side !== def.side && att.id !== fm.by) {
    removeEff(def, 'fmark');
    addSt(def, 'heat', 1, 'Метка пламени');
  }
  if (def.down) return;
  if (act.magic && tplFlag(att, 'flameMark') && !hasEff(def, 'fmark')) {
    def.effects.push({
      type: 'fmark',
      by: att.id,
      end: 1e9,
    });
    ev(`🔥 Метка пламени на ${uName(def)}: попадание обычной атакой союзника даст 1 Нагрев`);
  }
  const on = getEff(att, 'ordnow');
  if (on && on.tgt === def.id && dmg > 0) {
    removeEff(att, 'ordnow');
    addSt(def, 'disor', 1 * dbl, 'приказ «Сейчас!»');
  }
  if (def.down) return;
  const sp = getEff(def, 'spots');
  if (sp && basic && dmg > 0 && hb !== 'wound') {
    const ar = pick(AREAS);
    if (sp.areas.includes(ar)) {
      ev(`⌖ Слабое место: удар пришёлся в выявленную область (${AREA_RU[ar]}) — рана`);
      addWound(def, ar);
    } else
      ev(
        `<span class="dim">⌖ Слабые места: удар пришёлся в ${AREA_RU[ar]} — мимо выявленных (${sp.areas.map(a => AREA_RU[a]).join(', ')})</span>`,
      );
  }
  if (def.down) return;
  if (act.finisher) {
    const ws = Object.keys(def.wounds || {}).filter(ar => !(def.wounds[ar].deg >= 4 && !vital(ar)));
    if (ws.length) {
      let ar = ws.slice().sort((a, b) => def.wounds[b].deg - def.wounds[a].deg)[0];
      if (ws.length > 1 && isHuman(att.side))
        ar =
          (await view.askChoice(
            'Добивание',
            `<p>Какую рану ${uName(def)} развить?</p>`,
            ws.map(a => ({
              v: a,
              label: AREA_RU[a],
              sub: `${WDEG_RU[def.wounds[a].deg]}, ${def.wounds[a].open ? 'открыта' : 'закрыта'}`,
            })),
          )) || ar;
      ev(`🗡 Добивание: рана (${AREA_RU[ar]}) ${def.wounds[ar].open ? 'растёт на степень' : 'открывается заново'}`);
      addWound(def, ar);
    }
  }
}

/* Толчок: встречная проверка Силы; 1–4 — 1 гекс, 5–9 — 2, 10+ — 3. Не вызывает атак зоны контроля. */
export async function doPush(u: Unit, t, opt: Opts = {}) {
  if (sz(t) > 1) {
    ev(`${uName(t)} слишком велик — толчок не действует`);
    return false;
  }
  const ma = [
    {
      l: 'Сила',
      v: stat(u, 'str'),
    },
  ];
  if (u.shield > 0 && partSt(u, 'armL') < 3)
    ma.push({
      l: 'щит',
      v: 2,
    });
  if (stOf(t, 'unst') > 0)
    ma.push({
      l: 'цель неустойчива',
      v: 3,
    });
  if (u.prone)
    ma.push({
      l: 'сбит',
      v: -5,
    });
  const mb = [
    {
      l: 'Сила',
      v: stat(t, 'str'),
    },
  ];
  const ra = d20(),
    rb = d20(),
    diff = ra + sum(ma) - (rb + sum(mb)),
    ok = diff > 0;
  let n = diff >= 10 ? 3 : diff >= 5 ? 2 : diff >= 1 ? 1 : 0;
  if (ok && takeVuln(t)) n *= 2;
  contestLog(
    `${uName(u)}: толчок${opt.why ? ' (' + opt.why + ')' : ''} → ${uName(t)}`,
    ma,
    ra,
    mb,
    rb,
    `цель отброшена на ${n}`,
    'цель устояла',
    ok,
    diff,
  );
  if (S.stat) S.stat.push = (S.stat.push || 0) + 1;
  if (!ok) return false;
  await shove(u, t, n);
  return true;
}
export async function shove(u: Unit, t, n) {
  let hitWhat = null,
    other = null,
    moved = 0;
  for (let i = 0; i < n; i++) {
    const kb = knockPlan(u, t);
    if (kb.held) {
      ev(kb.big ? `${uName(t)} невосприимчив к перемещению` : `${uName(t)} удерживается и не сдвигается`);
      break;
    }
    if (kb.to) {
      t.x = kb.to.x;
      t.y = kb.to.y;
      moved++;
      view.renderTokens();
      await sleep(70);
      if (kb.fall) {
        fall(t, kb.fall);
        break;
      }
      terrainStep(t, t.x, t.y, { forced: true });
      if (t.down || S.over) break;
      if (trapCheck(t)) break;
      continue;
    }
    hitWhat = kb.what;
    other = kb.o || null;
    break;
  }
  if (moved) {
    interrupt(t, 'толчок');
    const lt = t.lassoT && lassoTarget(t);
    if (lt && cheb(t, lt) > LASSO_R) releaseLasso(t, 'оттолкнули дальше длины силка');
  }
  addSt(t, 'unst', 1, 'принудительное перемещение');
  if (moved) lassoSnap(t);
  if (hitWhat && !t.down) {
    ev(`${uName(t)} врезается в ${hitWhat}`);
    addSt(t, 'unst', 1, 'столкновение');
    if (other && !other.down) addSt(other, 'unst', 1, 'столкновение');
  }
}

/* Подготовка: первый враг, вошедший в досягаемость или начавший атаку из неё, получает удар (или толчок) до своего действия. */
export function prepWeapon(p, t) {
  let best = null;
  for (const id of p.acts) {
    const a = A[id];
    if (
      !a ||
      a.kind !== 'attack' ||
      a.complex ||
      a.fixed != null ||
      a.cost > 1 ||
      !reqOk(p, id) ||
      (a.needLoad && !p.loaded) ||
      (a.ammo && !((p.ammo || {})[id] > 0))
    )
      continue;
    if (a.w && p.wield && a.w !== p.wield && weaponsOf(p).length > 1) continue;
    if (a.speech && hasEff(p, 'mute')) continue;
    if (!canTarget(p, a, t)) continue;
    const E = hitCalc(p, a, t).Eact;
    if (!best || E > best.E)
      best = {
        id,
        E,
      };
  }
  return best && best.id;
}
export async function v2PrepCheck(mover) {
  for (const p of S.units) {
    if (p.down || p.side === mover.side || !p.prep || p.stunned || mover.down || S.over) continue;
    if ((p.od || 0) <= 0) continue;
    if (p.prep.kind === 'push') {
      if (!near1(p, mover) || sz(mover) > 1) continue;
      p.prep = null;
      p.od--;
      ev(`⏱ Подготовка: ${uName(p)} встречает ${uName(mover)} толчком`);
      await doPush(p, mover, {
        why: 'подготовка',
      });
    } else {
      const id = prepWeapon(p, mover);
      if (!id) continue;
      p.prep = null;
      p.od--;
      const a = A[id];
      ev(`⏱ Подготовка: ${uName(p)} бьёт первым — ${esc(a.name)}`);
      if (a.needLoad) p.loaded = false;
      if (a.ammo) {
        p.ammo[id] = Math.max(0, (p.ammo[id] || 0) - 1);
      }
      await resolveAttack(p, a, mover, {
        free: true,
        prepared: true,
      });
    }
  }
}

/* Контроль щитом Конрада: враг движется в его зоне — толчок; выходит — толчок или внеочередная атака. */
export async function shieldControl(u: Unit, to, hit) {
  for (const e of S.units) {
    if (
      e.down ||
      e.side === u.side ||
      !(tplFlag(e, 'shieldCtl') || tplFlag(e, 'bucklerCtl')) ||
      !(e.shield > 0) ||
      e.prone ||
      e.stunned ||
      !near1(e, u) ||
      sz(u) > 1
    )
      continue;
    e.pushed = e.pushed || {};
    if (e.pushed[u.id] === S.round) continue;
    if ((e.od || 0) <= 0) continue;
    const leaving = !near1(e, to);
    if (tplFlag(e, 'bucklerCtl')) {
      if (!leaving || e.bucklerCtlRound === S.round || (e.od || 0) < 1) continue;
      e.bucklerCtlRound = S.round;
      e.pushed[u.id] = S.round;
      e.od--;
      hit.add(e.id);
      if (S.stat) {
        const m = S.stat.skillEvents || (S.stat.skillEvents = {});
        m.bucklerCtl = (m.bucklerCtl || 0) + 1;
      }
      const ok = await doPush(e, u, { why: 'Контроль баклером' });
      if (ok || u.down || S.over) return false;
      continue;
    }
    const canAtk = leaving && e.zocRound !== S.round && !hit.has(e.id) && !!zocWeapon(e, u);
    let ch = canAtk ? 'atk' : 'push';
    if (!isHuman(e.side) && e.od < 2 && u.hp > 2) ch = '';
    if (isHuman(e.side))
      ch = await view.askChoice(
        'Контроль щитом',
        `<p>${uName(u)} ${leaving ? 'выходит из зоны контроля' : 'движется внутри зоны контроля'} ${uName(e)}.</p>`,
        [
          {
            v: 'push',
            label: 'Толкнуть щитом',
            sub: `${`1 очко реакции (осталось ${e.od}) · `}Сила против Силы · успех ${pct(pContest(stat(e, 'str') + 2 + (stOf(u, 'unst') ? 3 : 0), stat(u, 'str'), false))}`,
          },
          ...(canAtk
            ? [
                {
                  v: 'atk',
                  label: 'Внеочередная атака',
                  sub: '1 очко реакции',
                },
              ]
            : []),
          {
            v: '',
            label: 'Ничего не делать',
          },
        ],
      );
    if (ch === 'atk') {
      e._zocYes = u.id;
      e.od = Math.max(0, e.od - 1);
    }
    if (ch === 'push') {
      e.pushed[u.id] = S.round;
      e.od = Math.max(0, e.od - 1);
      if (leaving) hit.add(e.id);
      const ok = await doPush(e, u, {
        why: 'Контроль щитом',
      });
      if (ok || u.down || S.over) return false;
    } else if (ch !== 'atk' && leaving) hit.add(e.id);
  }
  return true;
}
export async function doOrderNow(u: Unit, ally: Unit) {
  const foes = hostiles(u)
    .filter(o => !hiddenFrom(ally, o) || cheb(ally, o) <= 1)
    .sort((a, b) => cheb(ally, a) - cheb(ally, b))
    .slice(0, 8);
  if (!foes.length) return;
  let e = foes[0];
  if (isHuman(u.side) && foes.length > 1) {
    const v = await view.askChoice(
      'Приказ «Сейчас!»',
      `<p>По кому ${uName(ally)} должен ударить?</p>`,
      foes.map(o => ({
        v: o.id,
        label: esc(o.name),
        sub: `до него ${cheb(ally, o)} гекс., HP ${o.hp}/${o.maxHp}`,
      })),
    );
    e = byId(v) || e;
  }
  removeEff(ally, 'ordnow');
  ally.effects.push({
    type: 'ordnow',
    by: u.id,
    tgt: e.id,
    left: 1,
    at: marker(),
    end: 1e9,
  });
  ev(
    `📣 «Сейчас!»: ${uName(u)} приказывает ${uName(ally)} бить ${uName(e)} — попадание с уроном даст цели Дезориентацию`,
  );
}
export async function doOrderBack(u: Unit, ally: Unit) {
  const cells = [];
  HXD[ally.y & 1].forEach(([dx, dy], i) => {
    const x = ally.x + dx,
      y = ally.y + dy;
    if (inB(x, y) && isFloor(x, y) && !unitAt(x, y))
      cells.push({
        x,
        y,
        i,
      });
  });
  if (!cells.length) {
    ev(`<span class="dim">«Отступаем!»: ${esc(ally.name)} некуда отойти</span>`);
    return;
  }
  let c = cells[0];
  if (isHuman(u.side)) {
    const v = await view.askChoice(
      'Приказ «Отступаем!»',
      `<p>Куда отходит ${uName(ally)}?</p>`,
      cells.map(o => ({
        v: o.i,
        label: DIR_RU[o.i],
      })),
    );
    c = cells.find(o => o.i === v) || c;
  } else {
    const fs = hostiles(u);
    c = cells.slice().sort((a, b) => Math.min(...fs.map(f => cheb(b, f))) - Math.min(...fs.map(f => cheb(a, f))))[0];
  }
  ev(`📣 «Отступаем!»: ${uName(ally)} отходит на гекс без внеочередных атак`);
  if (ally.st) ally.st.unst = 0;
  ally.x = c.x;
  ally.y = c.y;
  view.renderTokens();
  trapCheck(ally);
}
export function doHabits(u: Unit, t) {
  const areas = [];
  const limbs = ['armL', 'armR', 'legL', 'legR'];
  while (areas.length < 2) {
    const a = pick(limbs);
    if (!areas.includes(a)) areas.push(a);
  }
  removeEff(t, 'spots');
  t.effects.push({
    type: 'spots',
    areas,
    by: u.id,
    until: u.id,
    end: 1e9,
  });
  ev(
    `⌖ Выявление повадок: у ${uName(t)} слабые места — ${areas.map(a => AREA_RU[a]).join(' и ')}. До следующего хода ${uName(u)} обычная атака с уроном, попавшая туда (d6), даёт рану`,
  );
  ev(
    `<span class="dim">Предсказание действия: ведущий называет, что ${esc(t.name)} сделает в свой ход (на поле не отражается)</span>`,
  );
}
