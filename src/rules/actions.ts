import {
  canTerrainAct,
  coverBetween,
  hasLocalCover,
  hasTerrain,
  objectPush,
  objectStrike,
  terrainStep,
} from './terrain';
import type { Action, Opts, Unit } from '../types';
import { A, ATTACK_KINDS } from '../data/actions';
import { DIS, DISP, DIS_ICON } from '../data/disorders';
import { AREA_RU, WDEG_RU, WNAME } from '../data/labels';
import { resolveAttack } from './attack';
import { allyScreen } from './geometry';
import {
  doHabits,
  doOrderBack,
  doOrderNow,
  doPush,
  legPara,
  marker,
  interrupt,
  partSt,
  shieldControl,
  v2PrepCheck,
} from './combat';
import { applyDamage, release } from './damage';
import { critWill, disForm, disLock, disOf, distrustOk, guiltNext, oddRoll, sadFail, woundedT } from './disorders';
import {
  adjOk,
  bfs,
  doorAt,
  inB,
  inFoot,
  isFloor,
  los,
  near1,
  pairOptions,
  pairTargets,
  pathTo,
  posOf,
  reachClear,
  ringCells,
  torchAt,
  unitAt,
} from './geometry';
import { chooseSnarePart, doEscapeLasso, immobile, lassoPart, lassoTarget, releaseLasso } from './lasso';
import { hiddenFrom } from './light';
import { ev, log, sleep, uName } from './log';
import { doCurse2, doFlash, fireLine, fireSources, spellRoll, validFlash } from './magic';
import { doRevive, edgeOk, limOf, onEdge, painOf } from './pain';
import { escapePrisonGrip, prisonChainCircle, prisonChainIntercept, releasePrisonGrip, tryPrisonGrab } from './prisoners';
import { reactWants } from './reactions';
import { checkDegree, getEff, hasEff, hitCalc, modsStr, removeEff, reqOk, speedOf, stat } from './stats';
import { doBandage, needsCare, openWounds, syncBleed } from './wounds';
import { SET } from '../settings';
import { S, byId, friends, hostiles } from '../state';
import { HXD, cheb, d20, esc, hd, key, pick, sgn, sum, sz, unkey } from '../util';
import { view } from '../view';
export function isHuman(side) {
  if (S.sim) return false;
  return side === 'pc' || SET.enemyCtrl === 'manual';
}
export const BUILTIN = ['swap', 'door', 'unlasso', 'revive', 'objectStrike', 'objectPush', 'coverFull'];
/* Предметы окружения — действия героев (как в 4.5). */
export const TERR_ACTS = ['objectStrike', 'objectPush', 'coverFull'];
export function weaponsOf(o) {
  const out = [];
  for (const id of o.acts || []) {
    const w = A[id] && A[id].w;
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}
export const needSwap = (u: Unit, id) => {
  const w = A[id] && A[id].w;
  return !!w && !!u.wield && w !== u.wield && weaponsOf(u).length > 1;
};
export const swapCost = (u: Unit) => (u.freeReload && !(u._once && u._once.freeSR) ? 0 : 1);
export function nextWeapon(u: Unit) {
  const ws = weaponsOf(u);
  if (ws.length < 2) return null;
  return ws[(ws.indexOf(u.wield) + 1) % ws.length];
}
export function doWield(u: Unit, w) {
  if (!w || u.wield === w) return;
  const free = swapCost(u) === 0;
  if (free) {
    u._once = u._once || {};
    u._once.freeSR = true;
  }
  log(`${esc(u.name)}: смена оружия → ${WNAME[w] || w}${free ? ' (бесплатно)' : ''}`, 'mv');
  u.wield = w;
}
export function hasAct(u: Unit, id) {
  return u.acts.includes(id) || BUILTIN.includes(id);
}
export function actCost(u: Unit, id) {
  const a = A[id];
  if (a.kind === 'prep') return 0;
  if (id === 'standup') return legPara(u) ? 2 : 1;
  if (id === 'reload' && u.freeReload && !(u._once && u._once.freeSR)) return 0;
  if (a.kind === 'wswap') return swapCost(u);
  return a.cost + (needSwap(u, id) ? swapCost(u) : 0);
}
export function okAct(u: Unit, id, raw?) {
  const a = A[id];
  if (!a || !hasAct(u, id) || u.down) return false;
  if (!raw && disLock(u, id)) return false;
  if (actCost(u, id) > u.od) return false;
  if (!reqOk(u, id)) return false;
  if (a.cd && S.round < ((u.cd || {})[id] || 0)) return false;
  if (a.kind === 'revive' && u.side !== 'pc') return false;
  if (TERR_ACTS.includes(id) && (u.side !== 'pc' || !hasTerrain())) return false;
  if (id === 'coverFull' && !hasLocalCover(u)) return false;
  if (onEdge(u) && !edgeOk(id, a)) return false;
  if (a.speech && hasEff(u, 'mute')) return false;
  if (a.kind === 'standup' && (!u.prone || (partSt(u, 'legL') >= 3 && partSt(u, 'legR') >= 3))) return false;
  if (a.kind === 'unlasso' && !lassoTarget(u)) return false;
  if (a.lasso && lassoTarget(u)) return false;
  if (a.kind === 'prep' && u.prep) return false;
  if (a.kind === 'charge' && u.charge) return false;
  if (a.kind === 'prisonGrab' && u.hold) return false;
  if (a.kind === 'prisonRelease' && !u.hold) return false;
  if (a.kind === 'prisonCircle' && !S.units.some(t => t !== u && !t.down && near1(u,t))) return false;
  if (a.kind === 'move' && (u.grabbedBy != null || u.hold)) return false;
  if (a.requiresCharge && (!u.charge || u.charge.kind !== a.requiresCharge || S.round !== u.charge.readyRound))
    return false;
  if (a.requiresShield && !u.shield) return false;
  if (['move'].includes(a.kind) && hasEff(u, 'lasso')) return false;
  if (ATTACK_KINDS.includes(a.kind) && !a.magic && !a.lasso && (partSt(u, 'armR') >= 3 || lassoPart(u) === 'armR' || u.grabbedArm === 'armR'))
    return false;
  const snared = hasEff(u, 'snare') || hasEff(u, 'lasso') || u.grabbedBy != null;
  if (['move'].includes(a.kind) && snared) return false;
  if (a.ammo && !((u.ammo || {})[id] > 0)) return false;
  if (a.kind === 'trap' && !(u.traps > 0)) return false;
  if (a.kind === 'swap' && sz(u) > 1) return false;
  if (ATTACK_KINDS.includes(a.kind)) {
  }
  if (a.kind === 'wswap' && !nextWeapon(u)) return false;
  if (a.kind === 'pair' && !pairOptions(u).length) return false;
  if (a.needLoad && !u.loaded) return false;
  if (id === 'reload' && u.loaded) return false;
  if (id === 'escape' && !snared) return false;
  if (a.once && u._once && u._once[id]) return false;
  if (id === 'relight') return false;
  if (a.kind === 'bandage' && !(u.bandages > 0)) return false;
  if (a.kind === 'throw' && !(a.held ? u.torch : u.torches > 0)) return false;
  return true;
}

/* Жестокость: если в досягаемости этого действия есть противник с раной или кровотечением, бить можно только таких. */
export function canTarget(u: Unit, act: Action, t, from?, friendly?) {
  if (!canTarget0(u, act, t, from, friendly)) return false;
  if (
    u.disorder === 'cruel' &&
    act.kind === 'attack' &&
    t.side !== u.side &&
    !woundedT(t) &&
    disForm(u) === 2 &&
    S.units.some(o => !o.down && o.side !== u.side && o !== t && woundedT(o) && canTarget0(u, act, o, from))
  )
    return false;
  return true;
}
export function canTarget0(u: Unit, act: Action, t, from, friendly?) {
  from = from || u;
  if (act.kind === 'revive')
    return (
      !!t &&
      t.down &&
      t.ko &&
      !t.dead &&
      t.side === u.side &&
      cheb(from, t) === 1 &&
      adjOk(from, t) &&
      !S.units.some(o => !o.down && inFoot(o, t.x, t.y))
    );
  if (t && t.down && act.kind === 'cauterHeal' && t.ko && !t.dead)
    return t.side === u.side && cheb(from, t) === 1 && adjOk(from, t) && openWounds(t).length > 0;
  if (t && t.down && act.kind === 'bandage' && t.ko && !t.dead)
    return t.side === u.side && cheb(from, t) === 1 && adjOk(from, t) && needsCare(t);
  if (!t || t.down) return false;
  if (act.ranged && t.covered && coverBetween(from, t)) return false;
  const d = cheb(from, t);
  if (act.kind === 'bandage') return t.side === u.side && (d === 0 || (d === 1 && adjOk(from, t))) && needsCare(t);
  if (act.kind === 'cauterHeal')
    return t.side === u.side && (d === 0 || (d === 1 && adjOk(from, t))) && openWounds(t).length > 0;
  if (t.id === u.id) return false;
  if (act.kind === 'swap') return t.side === u.side && d === 1 && adjOk(from, t) && sz(t) === 1 && true && true && true;
  if (act.kind === 'ordnow' || act.kind === 'ordback')
    return t.side === u.side && d <= (act.range || 2) && (act.kind === 'ordnow' || !immobile(t));
  if (!friendly && t.side === u.side) return false;
  if (act.kind === 'push') return d === 1 && adjOk(from, t) && sz(t) === 1;
  if (act.kind === 'prisonGrab') return d === 1 && adjOk(from, t) && t.side !== u.side && t.grabbedBy == null;
  if (act.kind === 'curse2' || act.kind === 'habits') {
    if (hiddenFrom(u, t, from)) return false;
    return (act.kind === 'habits' || d <= (act.range || 3)) && los(from, t, u).ok;
  }
  if (act.lasso && (sz(t) > 1 || hasEff(t, 'lasso'))) return false;
  if (act.finisher && !Object.keys(t.wounds || {}).length) return false;
  if (['attack'].includes(act.kind) && hiddenFrom(u, t, from)) return false;
  if (act.ranged) {
    if (act.noAdj && d < 2) return false;
    if (act.fireSrc && hasEff(u, 'magsight') && !(d <= act.range && los(from, t, u).ok))
      return fireSources().some(s => hd(s.x, s.y, t.x, t.y) <= 3 && fireLine(s, t) && fireLine(s, from));
    if (d > act.range) return false;
    if (los(from, t, u, { ignoreFriendly: !!act.ignoreFriendlyLos }).ok) return true;
    return !!screenFor(u, act, t, from);
  }
  if (act.onlyDistance != null && d !== act.onlyDistance) return false;
  const reach = act.reach || 1;
  if (d > reach) return false;
  if (d > 1) return reachClear(from, t, u);
  return d === 1 && adjOk(from, t);
}
/* Выстрел через плечо союзника (свод 2.4): только обычный физический выстрел, не дальше 3 свободных гексов до союзника.
   ИИ стреляет так только вплотную или через 1 гекс и не рискует союзником на пороге или с серьёзной раной. */
export function screenFor(u: Unit, act, t, from?) {
  if (!SET.allyFire || !act.ranged || act.magic || !t) return null;
  const s = allyScreen(from || u, t, u);
  if (!s) return null;
  if (!s.ally) return s;
  if (s.free > 3) return null;
  if (!isHuman(u.side)) {
    const al = s.ally;
    if (s.free > 1 || onEdge(al) || painOf(al) >= limOf(al) - 1) return null;
    if (Object.values(al.wounds || {}).some((w: any) => w.deg >= 2)) return null;
  }
  return s;
}
export function validCell(u: Unit, a, x, y) {
  if (
    cheb(u, {
      x,
      y,
    }) !== 1 ||
    !adjOk(u, {
      x,
      y,
    })
  )
    return false;
  if (a.kind === 'door') {
    const d = doorAt(x, y);
    if (!d) return false;
    if (d.open) return !unitAt(x, y);
    return !d.locked;
  }
  if (a.kind === 'objectStrike' || a.kind === 'objectPush') return canTerrainAct(u, a.kind, { x, y });
  return false;
}
export function validThrow(u: Unit, a, c) {
  if (!inB(c.x, c.y) || !isFloor(c.x, c.y) || torchAt(c.x, c.y)) return false;
  const d = cheb(u, c);
  if (d > (a.range || 4)) return false;
  return (
    d === 0 ||
    los(
      u,
      {
        x: c.x,
        y: c.y,
      },
      u,
      {
        noUnits: true,
      },
    ).ok
  );
}
export const TRAP_R = 2;
export function trapCells(u: Unit) {
  const out = [];
  for (let y = u.y - TRAP_R; y <= u.y + TRAP_R; y++)
    for (let x = u.x - TRAP_R - 1; x <= u.x + TRAP_R + 1; x++)
      if (
        validTrap(u, {
          x,
          y,
        })
      )
        out.push({
          x,
          y,
        });
  return out;
}
export function validTrap(u: Unit, c) {
  if (!inB(c.x, c.y) || !isFloor(c.x, c.y) || unitAt(c.x, c.y) || trapAt(c.x, c.y)) return false;
  const d = cheb(u, c);
  if (d < 1 || d > TRAP_R) return false;
  return d === 1
    ? adjOk(u, c)
    : los(
        u,
        {
          x: c.x,
          y: c.y,
        },
        u,
        {
          noUnits: true,
        },
      ).ok;
}
export const trapAt = (x, y) => (S.traps || []).find(t => t.x === x && t.y === y) || null;

/* Рывок: клетка в пределах скорости, откуда клинок достаёт цель. */
/* Боевой приказ: лучший удар, который союзник может нанести прямо сейчас. */
export function targetsFor(u: Unit, id, from?) {
  return hostiles(u).filter(t => canTarget(u, A[id], t, from));
}
export function hasTargets(u: Unit, id) {
  const a = A[id];
  switch (a.kind) {
    case 'move':
      return [
        ...bfs(u, {
          max: speedOf(u),
        }).values(),
      ].some(v => v.d > 0);
    case 'attack':
      return targetsFor(u, id).length > 0;
    case 'charge':
      return !u.charge;
    case 'prisonGrab':
      return targetsFor(u,id).length > 0;
    case 'prisonCircle':
      return S.units.some(t => !t.down && t !== u && near1(u,t));
    case 'prisonRelease':
      return !!u.hold;
    case 'push':
    case 'curse2':
    case 'habits':
      return targetsFor(u, id).length > 0;
    case 'ordnow':
    case 'ordback':
      return friends(u).some(o => canTarget(u, a, o));
    case 'flash':
      return fireSources().some(s => validFlash(u, s));
    case 'swap':
      return friends(u).some(o => canTarget(u, a, o));
    case 'pair':
      return pairOptions(u).length > 0;
    case 'wswap':
      return !!nextWeapon(u);
    case 'bandage':
      return (
        [u, ...friends(u)].some(o => canTarget(u, a, o)) ||
        (a.kind === 'bandage' && S.units.some(o => o.down && canTarget(u, a, o)))
      );
    case 'revive':
      return S.units.some(o => canTarget(u, a, o));
    case 'cauterHeal':
      return S.units.some(o => canTarget(u, a, o));
    case 'trap':
      return trapCells(u).length > 0;
    case 'door':
    case 'objectStrike':
    case 'objectPush':
      return ringCells(u).some(c => validCell(u, a, c.x, c.y));
    default:
      return true;
  }
}
export function attackPossible(u: Unit) {
  return u.acts.some(id => A[id] && ATTACK_KINDS.includes(A[id].kind) && okAct(u, id) && hasTargets(u, id));
}
export async function perform(u: Unit, id, tgt?) {
  const a = A[id];
  if (!okAct(u, id)) return false;
  if (
    [
      'attack',
      'swap',
      'bandage',
      'cauterHeal',
      'push',
      'curse2',
      'habits',
      'ordnow',
      'ordback',
      'revive',
      'prisonGrab',
    ].includes(a.kind) &&
    tgt &&
    !canTarget(u, a, tgt)
  )
    return false;
  if (a.kind === 'flash' && !(tgt && validFlash(u, tgt))) return false;
  if (a.kind === 'trap' && !(tgt && validTrap(u, tgt))) return false;
  if ((a.kind === 'objectStrike' || a.kind === 'objectPush') && !(tgt && validCell(u, a, tgt.x, tgt.y))) return false;
  /* полное укрытие держится до следующего своего действия; выходящего из укрытия встречает подготовленный выстрел */
  if (u.covered && id !== 'coverFull') {
    u.covered = false;
    await v2PrepCheck(u, { ranged: true });
    if (u.down || S.over) return true;
  }
  if (a.kind === 'move') return performMove(u, tgt.x, tgt.y, id);
  if (u.guilt && u.guilt.stage === 'band' && id === 'bandage' && tgt && tgt.id !== u.guilt.id) return false;
  if (u.mustAttack && disOf(u, 'aggr') === 2 && a.kind === 'attack' && !a.magic && u.side === S.phase) {
    const ts = targetsFor(u, id);
    if (ts.length) {
      const nt = pick(ts);
      if (nt !== tgt) ev(`${DIS_ICON.aggr} Бешенство: ${uName(u)} бьёт случайного противника — ${uName(nt)}`);
      tgt = nt;
    }
  }
  const cost = actCost(u, id);
  u._acted = true;
  const pAct = S.curAct,
    pActor = S.curActor;
  S.curAct = id;
  S.curActor = u;
  if (u.guilt && u.guilt.stage === 'band' && id === 'bandage') u.guilt.stage = 'stay';
  u._once = u._once || {};
  if (id === 'reload' && cost === 0 && a.cost > 0) u._once.freeSR = true;
  if (needSwap(u, id)) doWield(u, a.w);
  u.od -= cost;
  if (a.once) u._once[id] = true;
  if (a.cd) {
    u.cd = u.cd || {};
    u.cd[id] = S.round + a.cd;
  }
  if (a.metrics && S.stat) {
    const m = S.stat.skillEvents || (S.stat.skillEvents = {});
    m[a.metrics] = (m[a.metrics] || 0) + 1;
  }
  if (a.requiresCharge) u.charge = null;
  if (a.ammo) {
    u.ammo = u.ammo || {};
    u.ammo[id] = Math.max(0, (u.ammo[id] || 0) - 1);
  }
  if (ATTACK_KINDS.includes(a.kind)) {
    u.mustAttack = false;
    u._atk = true;
  }
  if (u.side === S.phase && (ATTACK_KINDS.includes(a.kind) || ['pair', 'push', 'curse2', 'prisonGrab', 'prisonCircle'].includes(a.kind))) {
    await v2PrepCheck(u);
    const lost =
      u.down ||
      S.over ||
      (tgt && tgt.id && ['attack', 'push', 'curse2', 'prisonGrab'].includes(a.kind) && (tgt.down || !canTarget(u, a, tgt)));
    if (lost) {
      if (!u.down && !S.over) ev(`<span class="dim">${esc(u.name)}: действие «${esc(a.name)}» сорвано</span>`);
      if (a.needLoad) u.loaded = false;
      S.curAct = pAct;
      S.curActor = pActor;
      view.render();
      return true;
    }
    if (a.kind === 'attack' && hasEff(u, 'blind2')) {
      const base = a.ranged ? tgt : u,
        dd = HXD[base.y & 1][Math.floor(Math.random() * 6)],
        cx = base.x + dd[0],
        cy = base.y + dd[1],
        o = inB(cx, cy) ? unitAt(cx, cy) : null;
      if (!o || o === u) {
        ev(`🕶 Слепота: ${uName(u)} бьёт наугад — в пустоту`);
        if (a.needLoad) u.loaded = false;
        S.curAct = pAct;
        S.curActor = pActor;
        view.render();
        return true;
      }
      ev(`🕶 Слепота: удар наугад приходится по ${uName(o)}`);
      tgt = o;
    }
  }
  switch (a.kind) {
    case 'charge':
      u.charge = { kind: a.chargeType, readyRound: S.round + 1 };
      ev(`⏳ ${uName(u)}: ${esc(a.name)} — подготовка до следующего хода, без перемещения`);
      break;
    case 'prisonGrab':
      tryPrisonGrab(u,tgt);
      break;
    case 'prisonRelease':
      releasePrisonGrip(u, 'отпущен добровольно');
      break;
    case 'prisonCircle':
      await prisonChainCircle(u);
      break;
    case 'push':
      await doPush(u, tgt);
      break;
    case 'standup':
      u.prone = false;
      ev(`${uName(u)} встаёт`);
      break;
    case 'prep':
      u.prep = {
        kind: a.prep,
      };
      ev(
        `⏱ ${uName(u)} готовит ${a.prep === 'push' ? 'толчок' : 'удар'}: сработает на первого врага в досягаемости до своего следующего хода`,
      );
      break;
    case 'unlasso':
      releaseLasso(u, 'отпущен');
      break;
    case 'ordnow':
      await doOrderNow(u, tgt);
      break;
    case 'ordback':
      await doOrderBack(u, tgt);
      break;
    case 'flash':
      doFlash(u, tgt);
      view.drawLight(performance.now());
      break;
    case 'curse2':
      doCurse2(u, tgt, a, id);
      break;
    case 'habits':
      doHabits(u, tgt);
      break;
    case 'attack': {
      if (a.needLoad) u.loaded = false;
      let reps = a.repeats || 1;
      if (a.lasso) await chooseSnarePart(u, a, tgt);
      for (let i = 0; i < reps; i++) {
        if (tgt.down || u.down || S.over) break;
        await resolveAttack(u, a, tgt, {
          part: reps > 1 ? i + 1 : 0,
        });
      }
      if (a.lasso) u._snarePart = null;
      break;
    }
    case 'wswap':
      doWield(u, nextWeapon(u));
      break;
    case 'cauterHeal':
      if (await distrustOk(u, tgt, 'прижигание')) await doCauterHeal(u, tgt);
      break;
    case 'pair': {
      const ts = pairTargets(u, tgt);
      if (!ts.length) ev(`${uName(u)}: ${a.name} — некого задеть`);
      for (const t of ts) {
        if (t.down || u.down || S.over) continue;
        await resolveAttack(u, a, t, {
          area: false,
          noCover: true,
        });
      }
      break;
    }
    case 'bandage':
      if (await distrustOk(u, tgt, 'перевязка')) doBandage(u, tgt, a);
      break;
    case 'revive':
      if (await distrustOk(u, tgt, 'привести в чувство')) doRevive(u, tgt);
      break;
    case 'trap':
      u.traps--;
      S.traps.push({
        x: tgt.x,
        y: tgt.y,
        side: u.side,
        by: u.id,
      });
      ev(`🪤 ${uName(u)} ставит капкан. Осталось ${u.traps}`);
      if (S.stat) S.stat.trapSet = (S.stat.trapSet || 0) + 1;
      view.drawFloor();
      break;
    case 'throw':
      if (a.held) u.torch = false;
      else u.torches--;
      S.torches.push({
        x: tgt.x,
        y: tgt.y,
        lit: true,
        floor: true,
      });
      S.lv = (S.lv || 0) + 1;
      if (S.stat) S.stat.torch++;
      ev(
        `🔥 ${uName(u)} бросает ${a.held ? 'факел из рук' : 'горящий факел'}${cheb(u, tgt) ? ' на ' + cheb(u, tgt) + ' кл.' : ' себе под ноги'}${a.held ? ' — больше не носитель факела' : ''}. Факелов в запасе ${u.torches}`,
      );
      view.drawFloor();
      view.drawLight(performance.now());
      break;
    case 'swap':
      doSwap(u, tgt);
      break;
    case 'door':
      doDoor(u, tgt);
      break;
    case 'objectStrike':
      objectStrike(u, tgt);
      break;
    case 'objectPush':
      objectPush(u, tgt);
      break;
    case 'escape':
      await doEscape(u);
      break;
    case 'self':
      if (id === 'coverFull') {
        u.covered = true;
        ev(`🛡 ${uName(u)} полностью укрылся до следующего своего действия: стрелять в него сквозь укрытие нельзя`);
      } else if (id === 'magsight') {
        let n = 3;
        const t = spellRoll(u, a);
        if (!t) {
          ev(`<span class="dim">👁 Магическое зрение не открылось</span>`);
          break;
        }
        n = Math.max(1, Math.floor((stat(u, 'int') * [0, 1, 1.5, 2][t]) / 4 + 1e-9));
        removeEff(u, 'magsight');
        u.effects.push({
          type: 'magsight',
          left: n,
          at: marker(),
          end: 1e9,
        });
        ev(`👁 ${uName(u)} включает Магическое зрение на ${n} ${n === 1 ? 'ход' : n < 5 ? 'хода' : 'ходов'}`);
      } else if (id === 'reload') {
        u.loaded = true;
        ev(`${uName(u)} перезаряжает арбалет`);
      } else if (id === 'rage') {
        u.effects = u.effects.filter(e => e.type !== 'rage');
        u.effects.push({
          type: 'rage',
          left: a.turns || 2,
          at: S.round + ':' + S.phaseIdx,
          atkB: a.atkB || 0,
          strB: a.strB || 0,
          defP: a.defP || 0,
          end: 1e9,
        });
        ev(
          `😤 ${uName(u)} впадает в ярость: +${a.atkB || 0} к атакам, Сила +${a.strB || 0}, защита −${a.defP || 0}, штрафы ран не действуют, при 0 HP не падает до конца ярости`,
        );
        view.fxText(u, 'ярость', 'dmg');
      }
      break;
  }
  S.curAct = pAct;
  S.curActor = pActor;
  if (u._flee) {
    u._flee = false;
    if (u.side === S.phase && !u.down) await flee(u);
  }
  if (u._endTurn) {
    u._endTurn = false;
    if (u.side === S.phase) u.od = 0;
  }
  view.render();
  return true;
}
export async function performMove(u: Unit, x, y, id = 'move') {
  if (!okAct(u, id)) return false;
  const a = A[id],
    sp = speedOf(u),
    dist = bfs(u, {
      max: a.stepback ? 1 : sp * Math.min(2, u.od),
    }),
    v = dist.get(key(x, y));
  if (!v || v.d === 0) return false;
  const cost = a.stepback ? 1 : v.d <= sp ? 1 : 2;
  if (cost > u.od) return false;
  interrupt(u, 'добровольное перемещение');
  if (u.covered) {
    u.covered = false;
    await v2PrepCheck(u, { ranged: true });
    if (u.down || S.over) return true;
  }
  u.od -= cost;
  u._acted = true;
  u._once = u._once || {};
  if (a.once) u._once[id] = true;
  log(`${esc(u.name)}: ${a.stepback ? 'Отскок' : 'перемещение'} на ${v.d} кл. (${cost} ОД)`, 'mv');
  await walk(u, pathTo(dist, x, y), { noZoc: !!a.stepback });
  if (u.guilt && u.guilt.stage === 'go') u.guilt.stage = guiltNext(u);
  view.render();
  return true;
}
export async function walk(u: Unit, path, opt: Opts = {}) {
  const hit = new Set();
  if (u.st && u.st.unst) u.st.unst = 0;
  for (const [x, y] of path) {
    if (SET.zoc && !opt.noZoc && !(await zocStep(u, x, y, hit))) break;
    if (u.down || (u.prone && path.length > 1 && (u.x !== x || u.y !== y) && hd(u.x, u.y, x, y) !== 1)) break;
    const pr0 = u.prone;
    const from = {x:u.x,y:u.y};
    u.x = x;
    u.y = y;
    terrainStep(u, x, y);
    view.renderTokens();
    await sleep(150);
    if (u.down || S.over || (u.prone && !pr0)) break;
    if (trapCheck(u)) break;
    await prisonChainIntercept(u, from);
    if (u.down || S.over) break;
    const wasProne = u.prone;
    await v2PrepCheck(u);
    if (u.down || S.over || (u.prone && !wasProne) || u.x !== x || u.y !== y) break;
  }
}

/* Зона контроля (опция): кто выходит из соседства с противником, получает от него внеочередную базовую атаку оружием. Ходить внутри зоны можно; зоны разных противников независимы; от одного противника — одна атака за перемещение. */
export async function zocStep(u: Unit, x, y, hit) {
  const to = posOf(u, x, y);
  const px = u.x,
    py = u.y,
    wp = u.prone;
  if (!(await shieldControl(u, to, hit)) || u.x !== px || u.y !== py || (u.prone && !wp)) return false;
  for (const e of S.units) {
    if (e.down || e.side === u.side || hit.has(e.id) || e.zocRound === S.round || !near1(e, u) || near1(e, to))
      continue;
    const id = zocWeapon(e, u);
    if (!id) continue;
    hit.add(e.id);
    const pre = e._zocYes === u.id;
    e._zocYes = null;
    if (!pre && !(await reactWants(e, u, 'zoc'))) continue;
    if (!pre) e.od = Math.max(0, e.od - 1);
    e.zocRound = S.round;
    ev(`⚔ Зона контроля: ${uName(u)} выходит из зоны ${uName(e)} — внеочередная атака`);
    if (S.stat) S.stat.zoc = (S.stat.zoc || 0) + 1;
    await resolveAttack(e, A[id], u, {
      free: true,
      zoc: true,
    });
    if (u.down || S.over) return false;
  }
  return true;
}
export function zocWeapon(e, u: Unit) {
  if (e.stunned || onEdge(e)) return null;
  let best = null;
  for (const id of e.acts) {
    const a = A[id];
    if (
      !a ||
      a.kind !== 'attack' ||
      a.ranged ||
      a.magic ||
      a.fixed != null ||
      a.cost > 1 ||
      !reqOk(e, id) ||
      (a.needLoad && !e.loaded)
    )
      continue;
    if (a.w && e.wield && a.w !== e.wield && weaponsOf(e).length > 1) continue;
    if (!canTarget(e, a, u)) continue;
    const E = hitCalc(e, a, u).Eact;
    if (!best || E > best.E)
      best = {
        id,
        E,
      };
  }
  if (!best && A.improv && canTarget(e, A.improv, u)) return 'improv';
  return best && best.id;
}

/* Капкан срабатывает на противника стороны, поставившей его: урон без брони, стак кровотечения, удержание до проверки Силы. Крупного (2×2) не держит. */
export function trapCheck(u: Unit) {
  if (!S.traps || !S.traps.length || u.down) return false;
  const tr = S.traps.find(t => t.side !== u.side && inFoot(u, t.x, t.y));
  if (!tr) return false;
  S.traps = S.traps.filter(t => t !== tr);
  view.drawFloor();
  const dmg = 1,
    dc = (A.trap && A.trap.dc) || 12;
  ev(
    `🪤 ${uName(u)} попадает в капкан: ${dmg} ${'Боль'}${sz(u) > 1 ? ' — слишком велик, чтобы его удержать' : `, не может двигаться, пока не вырвется (Сила против ${dc})`}`,
  );
  if (S.stat) S.stat.trap = (S.stat.trap || 0) + 1;
  applyDamage(u, dmg, null);
  if (!u.down) {
    u.bleedX = (u.bleedX || 0) + 1;
    syncBleed(u);
    if (sz(u) === 1) {
      u.effects = u.effects.filter(e => e.type !== 'snare');
      u.effects.push({
        type: 'snare',
        dc,
        end: 1e9,
      });
    }
  }
  view.fxText(u, 'капкан', 'dmg');
  return true;
}
export async function flee(u: Unit) {
  ev(`${uName(u)} бежит, тратя все оставшиеся ОД`);
  let n = 0;
  while (u.od > 0 && !u.down && n++ < 3) {
    const foes = hostiles(u);
    if (!foes.length) break;
    const sc = c => Math.min(...foes.map(f => cheb(c, f)));
    const dist = bfs(u, {
      max: speedOf(u),
    });
    let best = null,
      bs = sc(u);
    for (const [k, v] of dist) {
      if (!v.d) continue;
      const [x, y] = unkey(k);
      const s = sc(posOf(u, x, y));
      if (s > bs || (best && s === bs && v.d > best.d)) {
        best = {
          x,
          y,
          d: v.d,
        };
        bs = s;
      }
    }
    if (!best) break;
    u.od--;
    await walk(u, pathTo(dist, best.x, best.y));
  }
  u.od = 0;
}
export function contestLog(title, ma, ra, mb, rb, okTxt, failTxt, ok, diff) {
  const ta = ra + sum(ma),
    tb = rb + sum(mb);
  log(
    `<div class="lh">${title}</div><div class="lr">d20 <b>${ra}</b>${modsStr(ma)} = <b>${ta}</b> против d20 <b>${rb}</b>${modsStr(mb)} = <b>${tb}</b></div><div class="lo"><span class="chip ${ok ? (diff >= 10 ? 'crit' : 'ok') : 'fail'}">разница ${sgn(diff)} · ${ok ? okTxt : failTxt}</span></div>`,
    'atk',
  );
}
export async function doEscape(u: Unit) {
  if (u.grabbedBy != null) {
    escapePrisonGrip(u);
    return;
  }
  if (!hasEff(u, 'snare') && hasEff(u, 'lasso')) {
    doEscapeLasso(u);
    return;
  }
  if (hasEff(u, 'snare')) {
    const e = getEff(u, 'snare'),
      c = checkRoll(
        u,
        [
          {
            l: 'Сила',
            v: stat(u, 'str'),
          },
        ],
        e.dc || 12,
        {
          noSad: true,
        },
      );
    log(`<div class="lh">${uName(u)}: вырваться из капкана</div>` + c.html, 'atk');
    if (c.dg.ok) {
      removeEff(u, 'snare');
      ev(`${uName(u)} освобождается из капкана`);
    }
    return;
  }
  const g = byId(null);
  if (!g) {
    return;
  }
  const ma = [
      {
        l: 'Сила',
        v: stat(u, 'str'),
      },
    ],
    mb = [
      {
        l: 'Сила',
        v: stat(g, 'str'),
      },
    ],
    ra = d20(),
    rb = d20(),
    diff = ra + sum(ma) - (rb + sum(mb)),
    ok = diff > 0;
  contestLog(
    `${uName(u)}: попытка вырваться (держит ${uName(g)})`,
    ma,
    ra,
    mb,
    rb,
    'вырвался',
    'захват держится',
    ok,
    diff,
  );
  if (ok) release(g);
}

/* --- Инквизитор --- */
export function checkRoll(u: Unit, mods, dc, opt: Opts = {}) {
  oddRoll(u, mods);
  let r = d20(),
    tot = r + sum(mods),
    diff = tot - dc,
    dg = checkDegree(diff),
    extra = '';
  const fi = disOf(u, 'indec');
  if (fi && dg.t === 3) {
    const r0 = r,
      p = DISP.indec.re[fi - 1];
    mods.push({
      l: DIS.indec[fi - 1] + ': переброс',
      v: -p,
    });
    r = d20();
    tot = r + sum(mods);
    diff = tot - dc;
    dg = checkDegree(diff);
    extra = `<div class="ld">${DIS_ICON.indec} ${DIS.indec[fi - 1]}: критический успех (d20 ${r0}) перебрасывается с −${p}</div>`;
    if (fi === 2 && !dg.ok && u.side === S.phase) {
      u._endTurn = true;
      extra += `<div class="ld">Ступор: повторный бросок не удался — ход завершается</div>`;
    }
  }
  if (!opt.noWill) critWill(u, dg);
  if (!opt.noSad) sadFail(u, diff);
  return {
    r,
    tot,
    diff,
    dg,
    html:
      `<div class="lr">d20 <b>${r}</b>${modsStr(mods)} = <b>${tot}</b> против сложности <b>${dc}</b></div><div class="lo"><span class="chip ${dg.c}">разница ${sgn(diff)} · ${dg.txt}</span></div>` +
      extra,
  };
}
export function doSwap(u: Unit, t) {
  const x = u.x,
    y = u.y;
  u.x = t.x;
  u.y = t.y;
  t.x = x;
  t.y = y;
  ev(`${uName(u)} и ${uName(t)} меняются местами`);
  view.renderTokens();
}
export function doDoor(u: Unit, c) {
  const d = doorAt(c.x, c.y);
  if (!d) return;
  d.open = !d.open;
  S.lv = (S.lv || 0) + 1;
  ev(`${uName(u)} ${d.open ? 'открывает' : 'закрывает'} дверь`);
  view.drawFloor();
  view.drawLight(performance.now());
}
export function canControl(u: Unit) {
  return !!u && !u.down && !S.over && !S.busy && !S.editor && u.side === S.phase && isHuman(u.side);
}

/* Прижигание Хельги (свод 2.4, §11.4): 1 Боль сквозь броню, затем закрывается одна выбранная открытая рана. */
export async function doCauterHeal(u: Unit, t) {
  const ws = openWounds(t).sort((x, y) => y[1].deg - x[1].deg);
  if (!ws.length) return;
  let ar = ws[0][0];
  if (ws.length > 1 && isHuman(u.side) && !S.sim) {
    const v = await view.askChoice(
      'Прижигание',
      `<p>Какую открытую рану ${t === u ? 'себе' : uName(t)} закрыть?</p>`,
      ws.map(([a, w]) => ({ v: a, label: AREA_RU[a], sub: WDEG_RU[w.deg] })),
    );
    if (v) ar = v;
  }
  ev(
    `🔥 Прижигание: ${uName(u)} прижигает ${t === u ? 'себе' : 'ране ' + uName(t)} — ${AREA_RU[ar]}, 1 Боль сквозь броню`,
  );
  applyDamage(t, 1, null);
  const w = t.wounds[ar];
  if (w) w.open = false;
  syncBleed(t);
  view.fxText(t, 'прижигание', 'heal');
}
