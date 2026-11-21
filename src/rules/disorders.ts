import type { Unit } from '../types';
import { A, ATTACK_KINDS } from '../data/actions';
import { DIS, DISP, DIS_ICON } from '../data/disorders';
import { canTarget, hasTargets, okAct } from './actions';
import { bfs, near1, posOf } from './geometry';
import { unitLight } from './light';
import { ev, uName } from './log';
import { areaHasTarget, isArea, speedOf } from './stats';
import { needsCare, openWounds } from './wounds';
import { S, byId, hostiles } from '../state';
import { cheb, esc, unkey } from '../util';
export function disForm(u: Unit) {
  if (!u || !u.disorder || u.will == null) return 0;
  if (u.forceF != null) {
    return u.forceF;
  }
  if (u.will <= -20) return 2;
  if (u.will <= -10) return 1;
  return 0;
}
export const disOf = (u: Unit, k) => (u && u.disorder === k ? disForm(u) : 0);

/* Недоверие действует и у Недоверия/Паранойи, и у Безумия (как слабая форма — без внеочередной атаки). */
export const woundedT = t => !!t && (t.bleed > 0 || openWounds(t).length > 0);
export const isLit = (u: Unit) => unitLight(u) > 0;

/* Поправки расстройств к способностям (не ударам оружием): Стыд — на свету. */

/* Чудаковатость: к броску d20 добавляется d6. Значение d6 запоминается для Безумия. */
export function oddRoll(u: Unit, mods) {
  if (!u) return;
  const f = disOf(u, 'odd');
  if (!f) {
    u._d6 = 0;
    return;
  }
  const d = 1 + Math.floor(Math.random() * 6);
  u._d6 = d;
  mods.push({
    l: `${DIS.odd[f - 1]}, d6 ${d}`,
    v: d <= 4 ? -DISP.odd.lo : DISP.odd.hi,
  });
}
export const madSwap = (u: Unit) => disOf(u, 'odd') === 2 && (u._d6 === 1 || u._d6 === 6);
export function critWill(u: Unit, dg) {
  return;
}

/* Печаль: провал (−5 и хуже) запрещает повторять именно это действие. */
export function sadFail(u: Unit, diff) {
  const f = disOf(u, 'sad');
  if (!f || diff > -5 || S.curActor !== u || !S.curAct) return;
  const id = S.curAct;
  u.ban = {
    id,
    until: (u.turnNo || 0) + DISP.sad.ban[f - 1],
  };
  ev(
    `${DIS_ICON.sad} ${uName(u)} — ${DIS.sad[f - 1]}: «${esc(A[id].name)}» нельзя повторить ${DISP.sad.ban[f - 1] === 1 ? 'до конца следующего хода' : 'следующие ' + DISP.sad.ban[f - 1] + ' хода'}`,
  );
}
export function obsessLock(u: Unit) {
  return (
    disOf(u, 'obsess') > 0 &&
    !u._acted &&
    S.phase === u.side &&
    u.acts.some(id => isArea(id) && okAct(u, id, true) && areaHasTarget(u, id))
  );
}
export function guiltNext(u: Unit) {
  const v = byId(u.guilt && u.guilt.id);
  if (!v) return 'stay';
  if (!near1(u, v)) return 'go';
  return !v.down && u.bandages > 0 && needsCare(v) && u.od >= (A.bandage ? A.bandage.cost : 1) ? 'band' : 'stay';
}
export function guiltCell(u: Unit, v) {
  if (!v) return null;
  const sp = speedOf(u),
    dist = bfs(u, {
      max: sp * Math.min(2, u.od),
    });
  let best = null;
  for (const [k, d] of dist) {
    if (!d.d) continue;
    const [x, y] = unkey(k),
      c = posOf(u, x, y);
    if (!near1(c, v)) continue;
    const sc = (d.d <= sp ? 0 : 5) + hostiles(u).filter(f => near1(c, f)).length * 2 + d.d * 0.1;
    if (!best || sc < best.sc)
      best = {
        x,
        y,
        sc,
      };
  }
  return best;
}
export function guiltWatch(v) {
  if (!S || !S.units) return;
  for (const g of S.units) {
    if (g === v || g.down || g.side !== v.side) continue;
    const f = disOf(g, 'guilt');
    if (!f || cheb(g, v) > DISP.guilt.r) continue;
    if (g.guiltDue !== v.id)
      ev(
        `${DIS_ICON.guilt} ${uName(g)} — ${DIS.guilt[f - 1]}: ${esc(v.name)} ${v.down ? 'падает' : 'ранен'} рядом — в следующий ход идёт к нему`,
      );
    g.guiltDue = v.id;
  }
}
export function disLock(u: Unit, id) {
  const a = A[id];
  if (!a || (!u.disorder && !u.mustAttack && !u.ban && !u.guilt)) return null;
  if (u.ban && u.ban.id === id && (u.turnNo || 0) <= u.ban.until) {
    const f = disOf(u, 'sad');
    if (f) return `${DIS.sad[f - 1]}: после провала нельзя повторить`;
  }
  if (
    u.mustAttack &&
    S.phase === u.side &&
    !(ATTACK_KINDS.includes(a.kind) && !a.magic) &&
    u.acts.some(i => A[i] && ATTACK_KINDS.includes(A[i].kind) && !A[i].magic && okAct(u, i, true) && hasTargets(u, i))
  )
    return 'расстройство: следующее действие — атака оружием';
  if (u.guilt && S.phase === u.side) {
    const g = u.guilt,
      v = byId(g.id),
      nm = v ? v.name : 'союзник';
    if (g.stage === 'go' && (!okAct(u, 'move', true) || !guiltCell(u, v))) {
      u.guilt = null;
      return disLock(u, id);
    }
    if (g.stage === 'band' && !(okAct(u, 'bandage', true) && v && canTarget(u, A.bandage, v))) g.stage = 'stay';
    if (g.stage === 'go' && a.kind !== 'move')
      return `${DIS.guilt[disOf(u, 'guilt') - 1] || 'Вина'}: сначала дойти до: ${nm}`;
    if (g.stage === 'band' && id !== 'bandage')
      return `${DIS.guilt[disOf(u, 'guilt') - 1] || 'Вина'}: сначала перевязать: ${nm}`;
    if (g.stage === 'stay' && ['move'].includes(a.kind)) return 'Вина: ход надо закончить рядом с союзником';
  }
  if (!isArea(id) && obsessLock(u))
    return `${DIS.obsess[disOf(u, 'obsess') - 1]}: первым действием — способность по области`;
  return null;
}
export function changeWill(u: Unit, delta, why) {
  if (u.will == null) {
    ev(`${uName(u)} не имеет Воли — эффект не действует`);
    return;
  }
  const f0 = disForm(u),
    w0 = u.will;
  u.will += delta;
  const f1 = disForm(u);
  if (S.stat && f1) {
    S.stat.dis = S.stat.dis || {};
    S.stat.dis[u.tpl] = Math.max(S.stat.dis[u.tpl] || 0, f1);
  }
  ev(`${why ? why + ': ' : ''}${uName(u)} — Воля ${w0} → <b>${u.will}</b>`);
  if (u.disorder && f1 !== f0)
    ev(
      f1
        ? `${DIS_ICON[u.disorder]} ${uName(u)}: ${DIS[u.disorder][f1 - 1]} (${f1 === 1 ? 'слабая' : 'сильная'} форма)`
        : `${uName(u)}: расстройство отступило`,
    );
  else if (!u.disorder && u.will <= -10 && w0 > -10)
    ev(
      `<span class="dim">${uName(u)}: порог расстройства пройден, но расстройство не назначено — выберите его в карточке</span>`,
    );
}
