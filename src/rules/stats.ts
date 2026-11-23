import type { Action, Opts, Unit } from '../types';
import { A } from '../data/actions';
import { DIS, DISP } from '../data/disorders';
import { STAT_RU } from '../data/labels';
import { legSpeedPen, mast, mastMg, partSt, v2AtkMods } from './combat';
import { disForm, isLit, woundedT } from './disorders';
import { adjOk } from './geometry';
import { heightMod } from './height';
import { snareP } from './lasso';
import { darkPen } from './light';
import { selfHateHit } from './magic';
import { painInfo } from './pain';
import { ap3Degree, missThr, resist } from './reactions';
import { friends, hostiles } from '../state';
import { cheb, sum } from '../util';
export const getEff = (u: Unit, t) => u.effects.find(e => e.type === t);
export const hasEff = (u: Unit, t) => !!getEff(u, t);
export const AREA_BUFF = new Set(['psalm', 'ditty']);
export function isArea(id) {
  const a = A[id];
  return !!a && a.kind === 'self' && !!a.radius;
}
export function areaHasTarget(u: Unit, id) {
  const a = A[id];
  const R =
    id === 'blindlight'
      ? Math.max(1, Math.floor(stat(u, 'int') / a.K + 1e-9) - (a.off == null ? 2 : a.off))
      : a.radius || 2;
  if (AREA_BUFF.has(id)) return friends(u).some(o => cheb(u, o) <= R);
  return hostiles(u).some(o => cheb(u, o) <= R && (id !== 'wrath' || cheb(u, o) > 1 || adjOk(u, o)));
}

/* Ограничения действий от расстройств. Возвращает причину запрета или null. */
/* Безумие: бафф союзника уходит на противника в пределах той же дальности (выбирает игрок; ИИ — самого слабого). */
/* Отдельная проверка Недоверия для баффа по области: накладывающий против базовой защиты + той же характеристики цели, ничья — провал. */
export function actId(a) {
  if (a && a._id && A[a._id] === a) return a._id;
  for (const k in A) if (A[k] === a) return k;
  return null;
}
export const MAIN3 = ['str', 'dex', 'int'];
export function mainKey(u: Unit) {
  let b = 'str';
  for (const s of MAIN3) if (stat(u, s) > stat(u, b)) b = s;
  return b;
}
export function roleKey(u: Unit, s, role) {
  if (s !== 'main') return s;
  return role === 'atk' ? 'dex' : 'str';
}
export function stat(u: Unit, s) {
  if (s === 'main') return stat(u, mainKey(u));
  let v = u.base[s];
  const hs = partSt(u, 'head');
  if (hs && s === 'cha') v -= 2 * hs;
  if (u.disorder) {
    const f = disForm(u);
    if (f) {
      const P = DISP[u.disorder];
      if (P.stat === s && P.sp) v -= P.sp[f - 1];
    }
  }
  return v;
}
export function removeEff(u: Unit, t) {
  u.effects = u.effects.filter(e => e.type !== t);
}
export function effMag(u: Unit, t) {
  const e = getEff(u, t);
  return e ? e.mag || 0 : 0;
}

/* def=true: защита и сопротивление (Затуманенный разум на них не действует — только на атаки и способности). */
export const bdefOf = (u: Unit) => (u.bdef == null ? 6 : u.bdef) + 0;
export function boundPen(u: Unit) {
  return 0;
}
export function shieldOf(u: Unit, act: Action) {
  return act && act.ignoreShield ? 0 : u.shield || 0;
}

/* Поправки к защите от эффектов героев: Псалом +, Ускользание +, Подножка −, Ярость −. */
export function defFx(u: Unit) {
  if (!u.effects || !u.effects.length) return [];
  const m = [];
  const ps = effMag(u, 'psalm');
  if (ps)
    m.push({
      l: 'Псалом стойкости',
      v: ps,
    });
  const ev_ = effMag(u, 'evade');
  if (ev_)
    m.push({
      l: 'Ускользание',
      v: ev_,
    });
  const pr = 0;
  if (pr)
    m.push({
      l: 'сбит с ног',
      v: -pr,
    });
  return m;
}
export function speedOf(u: Unit) {
  let s = 3 + Math.max(0, Math.floor((stat(u, 'dex') - 5) / 2));
  if (u.prone || hasEff(u, 'blind2')) return 1;
  s = Math.max(1, s - legSpeedPen(u));
  return s;
}
export function reqOk(u: Unit, id) {
  const a = A[id];
  if (a.req) for (const s in a.req) if (stat(u, s) < a.req[s]) return false;
  return true;
}
export function adStat(u: Unit, act: Action) {
  if (shieldOf(u, act) > 0 && stat(u, 'str') > stat(u, 'dex')) return 'str';
  return 'dex';
}
export function activeMods(u: Unit, act: Action) {
  const s = adStat(u, act);
  const m = [
    {
      l: s === 'str' ? 'Сила (блок щитом)' : STAT_RU[s],
      v: stat(u, s),
    },
  ];
  const sh = shieldOf(u, act);
  if (sh)
    m.push({
      l: 'щит',
      v: sh,
    });
  const vm = 0;
  if (vm)
    m.push({
      l: 'Уязвимость',
      v: -vm,
    });
  const bp = boundPen(u);
  if (bp)
    m.push({
      l: 'Вязка',
      v: -bp,
    });
  const dp = !act || !act.magic ? darkPen(u) : 0;
  if (dp)
    m.push({
      l: 'темнота',
      v: -dp,
    });
  m.push(...defFx(u));
  return m;
}

/* Удар исподтишка: цель рядом с другим союзником атакующего, или атакующий в темноте (цель без ночного зрения), или в Завесе. */

export function atkMods(u: Unit, act: Action, t) {
  const ak = roleKey(u, act.atk, 'atk');
  const m = [
    ak === 'dex' && !act.magic
      ? {
          l: act.ranged ? 'Мастерство (дальний бой)' : 'Мастерство (ближний бой)',
          v: mast(u, !!act.ranged),
        }
      : ak === 'int' && act.magic
        ? {
            l: 'Мастерство (магия)',
            v: mastMg(u),
          }
        : {
            l: STAT_RU[ak],
            v: stat(u, ak),
          },
  ];
  const pen = act.hexPenalty != null ? act.hexPenalty : act.penalty;
  if (pen)
    m.push({
      l: act.name,
      v: pen,
    });
  if (u.effects && u.effects.length) {
    const di = 0;
    if (di)
      m.push({
        l: 'Песенка',
        v: di,
      });
    const dr = 0;
    if (dr)
      m.push({
        l: 'Глас',
        v: -dr,
      });
  }
  const dp = 0;
  if (dp)
    m.push({
      l: 'темнота',
      v: -dp,
    });
  const f = disForm(u);
  if (f) {
    const k = u.disorder,
      P = DISP[k],
      nm = DIS[k][f - 1];
    if (k === 'fear')
      m.push({
        l: nm,
        v: -P.pen[f - 1],
      });
    else if (k === 'aggr')
      m.push({
        l: nm,
        v: -P.pen[f - 1],
      });
    else if (k === 'cruel' && t && !woundedT(t))
      m.push({
        l: nm + ' (цель без раны)',
        v: -P.pen[f - 1],
      });
    else if (k === 'shame' && act.magic && isLit(u))
      m.push({
        l: nm + ' (на свету)',
        v: -P.pen[f - 1],
      });
  }
  const hm = heightMod(u, t);
  if (hm)
    m.push({
      l: 'сверху',
      v: hm,
    });
  v2AtkMods(u, act, m, t);
  return m;
}
export function dmgAfter(att: Unit, act: Action, def: Unit, t) {
  if (act.fixed != null) return act.fixed;
  return painInfo(att, act, def, t, {
    vd: !!(def && hasEff(def, 'vuln2')),
  }).net;
}
export function checkDegree(d) {
  if (d >= 10)
    return {
      ok: true,
      t: 3,
      txt: 'критический успех',
      c: 'crit',
    };
  if (d >= 5)
    return {
      ok: true,
      t: 2,
      txt: 'усиленный успех',
      c: 'enh',
    };
  if (d >= 0)
    return {
      ok: true,
      t: 1,
      txt: 'обычный успех',
      c: 'ok',
    };
  if (d >= -4)
    return {
      ok: false,
      t: 0,
      txt: 'незначительный провал',
      c: 'minor',
    };
  if (d >= -9)
    return {
      ok: false,
      t: 0,
      txt: 'провал',
      c: 'fail',
    };
  return {
    ok: false,
    t: 0,
    txt: 'критический провал',
    c: 'cfail',
    cf: true,
  };
}
export const modsStr = m => m.map(x => ` ${x.v < 0 ? '−' : '+'} ${x.l} ${Math.abs(x.v)}`).join('');
export function hitCalc(att: Unit, act: Action, def: Unit, opt: Opts = {}) {
  const M = sum(atkMods(att, act, def));
  if (act.lasso) {
    const h = snareP(att, act, def, 0);
    return {
      hit: h,
      p: [1 - h, h, 0, 0],
      dm: [0, 0, 0, 0],
      E: 0,
      Eact: 0,
      reps: 1,
      M,
      D: 8 + stat(def, 'dex'),
    };
  }
  const R = resist(def),
    th = missThr(att, act, def),
    sh = act.magic && selfHateHit(att),
    p = [0, 0, 0, 0];
  let E = 0;
  const dm = [0, 1, 2, 3].map(t => (t ? dmgAfter(att, act, def, t) : 0));
  for (let r = 1; r <= 20; r++) {
    if (r <= th.v || (sh && r === 1)) {
      p[0]++;
      continue;
    }
    let t = ap3Degree(r + M - R).t;
    p[t]++;
    E += dm[t];
  }
  const reps = 1;
  return {
    hit: 1 - p[0] / 20,
    p: p.map(x => x / 20),
    dm,
    E: E / 20,
    Eact: (E / 20) * reps,
    reps,
    M,
    D: R,
    thr: th,
  };
}

/* Вероятность встречной проверки: a против b; tieA — ничья в пользу a */
export function pContest(a, b, tieA) {
  let w = 0;
  for (let x = 1; x <= 20; x++) for (let y = 1; y <= 20; y++) if (x + a > y + b || (tieA && x + a === y + b)) w++;
  return w / 400;
}
