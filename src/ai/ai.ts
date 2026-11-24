import { aiPathDanger, hasTerrain } from '../rules/terrain';
import { hasHeights } from '../rules/height';
import type { Unit } from '../types';
import { A } from '../data/actions';
import { DISP } from '../data/disorders';
import { T, tplOf } from '../data/fighters';
import {
  actCost,
  attackPossible,
  canTarget,
  okAct,
  perform,
  performMove,
  targetsFor,
  validCell,
  validThrow,
} from '../rules/actions';
import { stOf } from '../rules/combat';
import { disOf, guiltCell, obsessLock } from '../rules/disorders';
import {
  bfs,
  cellsOf,
  doorAt,
  footWalls,
  inB,
  isWall,
  los,
  near1,
  pairOptions,
  pathTo,
  posOf,
  unitAt,
} from '../rules/geometry';
import { lassoPart } from '../rules/lasso';
import { hiddenFrom, unitLight } from '../rules/light';
import { log, sleep } from '../rules/log';
import { limOf, onEdge, painOf } from '../rules/pain';
import { RANGE_OPT, openT } from '../rules/reactions';
import { AREA_BUFF, areaHasTarget, hasEff, hitCalc, isArea, speedOf, stat } from '../rules/stats';
import { careNeed, needsCare } from '../rules/wounds';
import { SET } from '../settings';
import { GEN, S, alive, byId, friends, hostiles } from '../state';
import { CANCEL, cheb, esc, key, nbrDirs, pick, sz, unkey } from '../util';
import { view } from '../view';
export async function runSideAI(side) {
  const us = alive(side).sort((a, b) => stat(b, 'dex') - stat(a, 'dex'));
  for (const u of us) {
    if (u.down || S.over) continue;
    S.sel = u.id;
    view.render();
    await sleep(220);
    await aiTurn(u);
  }
}
export async function aiTurn(u: Unit) {
  const g = GEN;
  u._ai = u._ai || {};
  let n = 0;
  const keep = Math.min(u.od, aiKeep(u));
  u.od -= keep;
  try {
    while (!u.down && !S.over && n++ < 10) {
      if (u.od <= 0) break;
      const did = await aiStep(u);
      if (g !== GEN) throw CANCEL;
      if (!did) break;
      view.render();
      await sleep(240);
    }
  } finally {
    u.od += keep;
  }
  if (keep && !u.down) log(`${esc(u.name)}: ${keep} ОД остаётся на защиту`, 'mv note');
}
export async function aiStep(u: Unit) {
  const foes = hostiles(u);
  if (!foes.length) return false;
  if (onEdge(u)) {
    if (okAct(u, 'bandage') && canTarget(u, A.bandage, u)) return await perform(u, 'bandage', u);
    return false;
  }
  if (await aiRescueMove(u, foes)) return true;
  if (u.prone && okAct(u, 'standup')) return await perform(u, 'standup');
  if (u.grabbedBy != null && okAct(u, 'escape')) return await perform(u, 'escape');
  if (
    hasEff(u, 'lasso') &&
    !hasEff(u, 'snare') &&
    okAct(u, 'escape') &&
    (lassoPart(u) === 'armR' || !foes.some(f => near1(u, f)))
  )
    return await perform(u, 'escape');
  if (hasEff(u, 'snare') && !foes.some(f => near1(u, f)) && okAct(u, 'escape')) return await perform(u, 'escape');
  if (u.guilt && u.guilt.stage === 'go') {
    const c = guiltCell(u, byId(u.guilt.id));
    if (c && (await performMove(u, c.x, c.y))) return true;
    u.guilt = null;
  }
  if (u.guilt && u.guilt.stage === 'band') {
    if (await perform(u, 'bandage', byId(u.guilt.id))) return true;
    u.guilt.stage = 'stay';
  }
  if (obsessLock(u)) {
    let best = null;
    for (const id of u.acts) {
      if (!isArea(id) || !okAct(u, id, true) || !areaHasTarget(u, id)) continue;
      const a = A[id];
      let v = 0,
        t = null;
      if (AREA_BUFF.has(id)) {
        const R = a.radius || 2;
        v = friends(u)
          .filter(o => cheb(u, o) <= R)
          .reduce((n, o) => n + (foes.some(f => cheb(o, f) <= 2) ? 1.5 : 0.5), 0);
      } else {
        const R = a.radius || 2;
        v = foes.filter(o => cheb(u, o) <= R).length * 1.6;
        if (disOf(u, 'obsess') === 2)
          v -= friends(u).filter(o => cheb(u, o) <= (DISP.obsess.fanR || R)).length * 2 * DISP.obsess.fanDmg;
      }
      if (!best || v > best.v)
        best = {
          id,
          v,
          t,
        };
    }
    if (best && (await perform(u, best.id, best.t))) return true;
  }
  const sup = aiSupport(u, foes);
  if (sup) return await perform(u, sup.id, sup.t);
  let did = await (AI[u.ai] || AI.dumb)(u, foes);
  if (!did && !u.down && !S.over) {
    const ids = u.acts.filter(id => A[id] && A[id].kind === 'attack');
    const st = bestStrike(u, ids);
    if (st) did = await perform(u, st.id, st.t);
  }
  return did;
}

/* Боль: поднимать союзника имеет смысл, только если его тут же не добьют — рядом нет врагов и стрелки его не видят. */
export function koThreat(o, foes) {
  return foes.some(
    f =>
      cheb(f, o) <= 4 ||
      (f.acts.some(id => A[id] && A[id].ranged && !A[id].magic && A[id].kind === 'attack') &&
        cheb(f, o) <= 10 &&
        los(f, o, f).ok),
  );
}

/* Боль: дойти до союзника без сознания, если рядом нет врагов и есть чем помочь. */
export async function aiRescueMove(u: Unit, foes) {
  if (u._ai.rescue || !okAct(u, 'move') || foes.some(f => near1(u, f))) return false;
  const ko = S.units.filter(
    o =>
      o.side === u.side &&
      o.down &&
      o.ko &&
      !o.dead &&
      cheb(u, o) > 1 &&
      (needsCare(o) ? u.bandages > 0 && u.od >= 2 : u.od >= 3 && !koThreat(o, foes)),
  );
  if (!ko.length) return false;
  u._ai.rescue = true;
  const dist = bfs(u, {
    max: speedOf(u),
  });
  let best = null;
  for (const o of ko)
    for (const [dx, dy] of nbrDirs(o.x, o.y)) {
      const v = dist.get(key(o.x + dx, o.y + dy));
      if (v && v.d > 0 && (!best || v.d < best.d))
        best = {
          x: o.x + dx,
          y: o.y + dy,
          d: v.d,
        };
    }
  return best ? await performMove(u, best.x, best.y) : false;
}

/* Общее для всех ИИ: перевязка, если кровотечение и открытые раны обойдутся дороже удара; бросок факела, если свои стоят в темноте рядом с врагом. */
export function aiSupport(u: Unit, foes) {
  if (u.mustAttack && attackPossible(u)) return null;
  if (u.guilt || obsessLock(u)) return null;
  if (okAct(u, 'bandage') && !okAct(u, 'mend')) {
    let best = null;
    for (const o of [u, ...friends(u)]) {
      if (!canTarget(u, A.bandage, o)) continue;
      const n = careNeed(o) + (onEdge(o) ? 3 : 0);
      if (n >= 2 && (!best || n > best.n))
        best = {
          n,
          t: o,
        };
    }
    if (best)
      return {
        id: 'bandage',
        t: best.t,
      };
  }
  /* Прижигание (Хельга): если бинтов нет, останавливает кровотечение — себе, соседу или лежащему без сознания */
  if (okAct(u, 'cauterHeal') && !okAct(u, 'bandage')) {
    const cand = [...S.units.filter(o => o.side === u.side && o.down && o.ko && !o.dead), u, ...friends(u)].filter(
      o => o.bleed > 0 && canTarget(u, A.cauterHeal, o) && (o.down || painOf(o) < limOf(o) - 1),
    );
    if (cand.length)
      return {
        id: 'cauterHeal',
        t: cand[0],
      };
  }
  if (!onEdge(u)) {
    const ko = S.units.filter(o => o.side === u.side && o.down && o.ko && !o.dead);
    for (const o of ko)
      if (okAct(u, 'bandage') && canTarget(u, A.bandage, o))
        return {
          id: 'bandage',
          t: o,
        };
    for (const o of ko)
      if (!needsCare(o) && okAct(u, 'revive') && canTarget(u, A.revive, o) && !koThreat(o, foes))
        return {
          id: 'revive',
          t: o,
        };
  }
  const canT = okAct(u, 'throwTorch'),
    canH = okAct(u, 'throwHeld');
  if ((canT || canH) && !u._ai.thrown) {
    const c = aiTorchCell(u, foes);
    if (c) {
      u._ai.thrown = true;
      return {
        id: canT ? 'throwTorch' : 'throwHeld',
        t: c,
      };
    }
  }
  return null;
}
export function aiTorchCell(u: Unit, foes) {
  if (!SET.darkRules) return null;
  const side = [u, ...friends(u)];
  const darkAllies = side.filter(a => !a.nv && unitLight(a) === 0 && foes.some(f => cheb(a, f) <= 4));
  const ranged = side.some(a =>
    a.acts.some(id => A[id] && A[id].kind === 'attack' && (A[id].ranged || (A[id].reach || 1) > 1)),
  );
  const hiddenFoes = ranged ? foes.filter(f => unitLight(f) === 0 && side.some(a => cheb(a, f) <= 6)) : [];
  if (!darkAllies.length && !hiddenFoes.length) return null;
  const cand = [],
    seen = new Set();
  const addC = (x, y) => {
    const k = key(x, y);
    if (seen.has(k)) return;
    seen.add(k);
    if (
      validThrow(u, A.throwTorch, {
        x,
        y,
      })
    )
      cand.push({
        x,
        y,
      });
  };
  for (const a of darkAllies) for (const c of cellsOf(a)) addC(c.x, c.y);
  for (const f of hiddenFoes) {
    addC(f.x, f.y);
    for (const [dx, dy] of nbrDirs(f.x, f.y)) addC(f.x + dx, f.y + dy);
  }
  if (!cand.length) return null;
  const units = S.units.filter(o => !o.down),
    before = new Map(units.map(o => [o.id, unitLight(o)]));
  let best = null;
  for (const c of cand) {
    S.torches.push({
      x: c.x,
      y: c.y,
      lit: true,
      floor: true,
    });
    let v = 0;
    for (const o of units) {
      if (before.get(o.id) !== 0 || unitLight(o) === 0) continue;
      if (o.side === u.side) {
        if (!o.nv) v += foes.some(f => cheb(o, f) <= 4) ? 2 : 0.3;
      } else {
        if (!o.nv && side.some(a => cheb(a, o) <= 4)) v -= 1.5;
        if (ranged && side.some(a => cheb(a, o) <= 6)) v += 1;
      }
    }
    S.torches.pop();
    if (!best || v > best.v)
      best = {
        x: c.x,
        y: c.y,
        v,
      };
  }
  return best && best.v >= 2
    ? {
        x: best.x,
        y: best.y,
      }
    : null;
}

/* Куда ускользнуть: без соседних врагов, лучше — откуда можно стрелять. */
/* Филин по приоритетам (опция): ослеплён — бьёт ослепившего, пока не спадёт; иначе гасит все факелы на стенах уровня, потом на полу, потом бьёт носителя факела, потом случайного героя. */
/* Позиция поддержки: рядом с союзниками, в радиусе голоса, но не вплотную к врагам. */
export function primaryAttack(u: Unit) {
  return u.acts.find(id => A[id] && A[id].kind === 'attack' && true && A[id].fixed == null) || null;
}
export function foeDist(u: Unit, dist, f, id) {
  let best = Infinity;
  for (const [k, v] of dist) {
    const [x, y] = unkey(k);
    if (v.d < best && canTarget(u, A[id], f, posOf(u, x, y))) best = v.d;
  }
  return best === Infinity ? 100 + cheb(u, f) : best;
}
export function nearestFoe(u: Unit, foes, id, bias?) {
  const dist = bfs(u);
  let best = null;
  for (const f of foes) {
    const v = foeDist(u, dist, f, id) - (bias ? bias(f) : 0) + Math.random() * 0.01;
    if (!best || v < best.v)
      best = {
        f,
        v,
      };
  }
  return best && best.f;
}
export function bestStrike(u: Unit, ids, bonus?) {
  let best = null;
  for (const id of ids) {
    if (!okAct(u, id)) continue;
    for (const t of targetsFor(u, id)) {
      const h = hitCalc(u, A[id], t);
      const fb = u.side === 'pc' ? (1 - t.hp / t.maxHp) * 2 + (t.hp <= h.dm[2] ? 2 : 0) : 0;
      const s = h.Eact / Math.max(1, actCost(u, id)) + fb + (bonus ? bonus(t) : 0) + Math.random() * 0.01;
      if (!best || s > best.s)
        best = {
          id,
          t,
          s,
        };
    }
  }
  return best;
}

/* План пути с препятствиями: двери открываются (1 ОД), Страж ломает стены и решётки (1 ОД за клетку). */
export function planPath(u: Unit, goal) {
  const smash = u.acts.includes('smash');
  const start = key(u.x, u.y),
    best = new Map([
      [
        start,
        {
          c: 0,
          p: null,
        },
      ],
    ]),
    open = [[0, u.x, u.y]];
  const cost = (x, y) => {
    let extra = 0;
    const s = sz(u);
    for (let dy = 0; dy < s; dy++)
      for (let dx = 0; dx < s; dx++) {
        const cx = x + dx,
          cy = y + dy;
        if (!inB(cx, cy)) return null;
        const o = unitAt(cx, cy);
        if (o && o !== u) return null;
        if (isWall(cx, cy)) {
          const d = doorAt(cx, cy);
          if (d && !d.locked) extra += 1;
          else if (smash) extra += 1;
          else return null;
        }
      }
    return 1 + extra;
  };
  let n = 0;
  while (open.length && n++ < 4000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [c, x, y] = open.splice(bi, 1)[0],
      k = key(x, y);
    if (best.get(k).c < c) continue;
    if (k !== start && goal(x, y)) {
      const out = [];
      let kk = k;
      while (kk && best.get(kk).p) {
        out.unshift(unkey(kk));
        kk = best.get(kk).p;
      }
      return out;
    }
    for (const [dx, dy] of nbrDirs(x, y)) {
      const nx = x + dx,
        ny = y + dy;
      const sc = cost(nx, ny);
      if (sc == null) continue;
      const nk = key(nx, ny),
        nc = c + sc;
      if (!best.has(nk) || best.get(nk).c > nc) {
        best.set(nk, {
          c: nc,
          p: k,
        });
        open.push([nc, nx, ny]);
      }
    }
  }
  return null;
}
export async function aiFollowPlan(u: Unit, path) {
  const sp = speedOf(u);
  let i = 0;
  while (i < path.length && !footWalls(u, path[i][0], path[i][1])) i++;
  if (i === 0) {
    const [x, y] = path[0];
    for (const c of cellsOf(posOf(u, x, y))) {
      if (!isWall(c.x, c.y)) continue;
      const d = doorAt(c.x, c.y);
      if (d && !d.locked && okAct(u, 'door') && validCell(u, A.door, c.x, c.y)) return await perform(u, 'door', c);
      if (u.acts.includes('smash') && okAct(u, 'smash') && validCell(u, A.smash, c.x, c.y))
        return await perform(u, 'smash', c);
    }
    return false;
  }
  const j = Math.min(i, sp) - 1;
  const [x, y] = path[j];
  return await performMove(u, x, y);
}

/* Хрупкий герой (Хельга) при прочих равных встаёт рядом с Конрадом, чтобы тот мог прикрыть. */
export function guardAdj(u: Unit, c) {
  if (!tplOf(u).fragile) return false;
  return friends(u).some(o => o !== u && !o.down && tplOf(o).guardian && cheb(c, o) === 1);
}
export async function aiApproach(u: Unit, id, t) {
  if (!okAct(u, 'move')) return false;
  const sp = speedOf(u),
    dist = bfs(u),
    risky = hasHeights() || hasTerrain();
  let best = null;
  for (const [k, v] of dist) {
    const [x, y] = unkey(k),
      c = posOf(u, x, y);
    if (!canTarget(u, A[id], t, c)) continue;
    let sc = !v.d ? -100 : v.d <= sp ? v.d * 0.01 - (guardAdj(u, c) ? 10 : 0) : v.d;
    if (risky && v.d) sc += aiPathDanger(u, pathTo(dist, x, y));
    if (!best || sc < best.sc)
      best = {
        x,
        y,
        d: v.d,
        sc,
      };
  }
  if (best) {
    if (best.d === 0) return false;
    if (best.d <= sp) return await performMove(u, best.x, best.y);
    const path = pathTo(dist, best.x, best.y);
    const [x, y] = path[Math.min(sp, path.length) - 1];
    return await performMove(u, x, y);
  }
  const plan = planPath(u, (x, y) => canTarget(u, A[id], t, posOf(u, x, y)));
  if (plan && plan.length) return await aiFollowPlan(u, plan);
  let bd = cheb(u, t),
    dest = null;
  for (const [k, v] of dist) {
    if (!v.d || v.d > sp) continue;
    const [x, y] = unkey(k);
    const dd = cheb(posOf(u, x, y), t);
    if (dd < bd) {
      bd = dd;
      dest = {
        x,
        y,
      };
    }
  }
  return dest ? await performMove(u, dest.x, dest.y) : false;
}
export async function aiRetreat(u: Unit, id) {
  if (!okAct(u, 'move')) return false;
  const sp = speedOf(u),
    dist = bfs(u, {
      max: sp,
    }),
    foes = hostiles(u);
  let best = null;
  for (const [k, v] of dist) {
    if (!v.d) continue;
    const [x, y] = unkey(k);
    const c = posOf(u, x, y);
    const md = Math.min(...foes.map(f => cheb(c, f)));
    let s = Math.min(md, 4) * 2 - v.d * 0.1;
    if (id && foes.some(f => canTarget(u, A[id], f, c))) s += 5;
    if (md < 2) s -= 10;
    if (guardAdj(u, c)) s += 3;
    s -= aiPathDanger(u, pathTo(dist, x, y));
    if (!best || s > best.s)
      best = {
        x,
        y,
        s,
      };
  }
  return best ? await performMove(u, best.x, best.y) : false;
}

/* Герои сначала добивают слабых и стрелков: поправка к расстоянию при выборе, к кому идти. */
export const AI: Record<string, (u: Unit, foes: Unit[]) => any> = {
  async dumb(u: Unit, foes) {
    if (u.od <= 0) return false;
    const main = primaryAttack(u);
    if (!main) return false;
    if (okAct(u, main)) {
      const ts = targetsFor(u, main);
      if (ts.length) return await perform(u, main, pick(ts));
    }
    const t = nearestFoe(u, foes, main);
    return t ? await aiApproach(u, main, t) : false;
  },
};

/* --- ИИ героев 2.0: простой, для кнопки «Пусть сходит ИИ» и прогонов --- */
Object.assign(AI, {
  async v2conrad(u: Unit, foes) {
    const adj = foes.filter(f => near1(u, f));
    if (adj.length) {
      const un = adj.find(f => stOf(f, 'unst') > 0 && sz(f) === 1 && !f.prone);
      if (un && okAct(u, 'push')) return await perform(u, 'push', un);
      if (okAct(u, 'csweep') && pairOptions(u).length && adj.length >= 2)
        return await perform(u, 'csweep', pairOptions(u)[0][0]);
      const st = bestStrike(u, ['csword']);
      if (st) return await perform(u, 'csword', st.t);
    }
    if (okAct(u, 'orderNow') && !u._ai.ord) {
      const al = friends(u).filter(
        o => canTarget(u, A.orderNow, o) && !hasEff(o, 'ordnow') && foes.some(f => cheb(o, f) <= 3),
      )[0];
      if (al) {
        u._ai.ord = true;
        return await perform(u, 'orderNow', al);
      }
    }
    const t = nearestFoe(u, foes, 'csword');
    if (t && okAct(u, 'move') && (await aiApproach(u, 'csword', t))) return true;
    if (okAct(u, 'prep')) return await perform(u, 'prep');
    return false;
  },
  async v2helga(u: Unit, foes) {
    const inR = foes.filter(f => canTarget(u, A.curseVuln, f));
    if (u.od >= 2 && okAct(u, 'curseVuln')) {
      const t = inR.filter(f => !hasEff(f, 'vuln2')).sort((a, b) => b.hp - a.hp)[0];
      if (t) return await perform(u, 'curseVuln', t);
    }
    const st = bestStrike(u, ['firebolt2', 'hotair'], t => (hasEff(t, 'vuln2') ? 2 : 0) + stOf(t, 'heat'));
    if (st) return await perform(u, st.id, st.t);
    if (foes.some(f => near1(u, f)) && okAct(u, 'move') && (await aiRetreat(u, 'firebolt2'))) return true;
    const t = nearestFoe(u, foes, 'firebolt2');
    if (t && okAct(u, 'move') && (await aiApproach(u, 'firebolt2', t))) return true;
    return false;
  },
  async v2walter(u: Unit, foes) {
    const adj = foes.filter(f => near1(u, f));
    if (adj.length) {
      if (u.od >= 2 && okAct(u, 'finish')) {
        const t = adj.filter(f => canTarget(u, A.finish, f)).sort((a, b) => a.hp - b.hp)[0];
        if (t) return await perform(u, 'finish', t);
      }
      if (u.od >= 2 && okAct(u, 'habits')) {
        const t = adj.filter(f => !hasEff(f, 'spots') && f.hp > 2).sort((a, b) => b.hp - a.hp)[0];
        if (t) return await perform(u, 'habits', t);
      }
      const st = bestStrike(u, ['wcleaver']);
      if (st) return await perform(u, 'wcleaver', st.t);
    }
    if (!u.loaded && okAct(u, 'reload') && actCost(u, 'reload') === 0) return await perform(u, 'reload');
    if (okAct(u, 'hxbow')) {
      const st = bestStrike(u, ['hxbow'], t => (1 - t.hp / t.maxHp) * 2);
      if (st) return await perform(u, 'hxbow', st.t);
    }
    if (!u.loaded && okAct(u, 'reload') && !foes.some(f => cheb(u, f) <= 2) && (u.ammo.hxbow || 0) > 0)
      return await perform(u, 'reload');
    const id = u.loaded && (u.ammo.hxbow || 0) > 0 ? 'hxbow' : 'wcleaver',
      t = nearestFoe(u, foes, id);
    return t && okAct(u, 'move') ? await aiApproach(u, id, t) : false;
  },
});

/* Сколько ОД ИИ оставляет на защиту. */
export function threatCount(u: Unit) {
  let n = 0;
  for (const e of hostiles(u)) {
    if (e.stunned) continue;
    const rng = e.acts.some(id => A[id] && A[id].ranged && A[id].kind === 'attack');
    const d = cheb(e, u);
    if (rng && d <= 10 && !hiddenFrom(e, u)) n++;
    else if (d <= speedOf(e) * 2 + 1) n++;
  }
  return n;
}
export function aiKeep(u: Unit) {
  const t = tplOf(u);
  if (u.side === 'en' || t.keep != null) return t.keep == null ? 1 : t.keep;
  const n = threatCount(u);
  if (!n) return 0;
  return u.hp < u.maxHp * 0.4 ? 2 : 1;
}

/* ---------- Паттерны болванчиков ---------- */
export function enemyScore(u: Unit, t) {
  return (openT(t) ? 3 : 0) + (1 - t.hp / t.maxHp) * 1.5 + (t.prone ? 1 : 0) - (t.id === u._ai.avoid ? 1 : 0);
}
export function enemyPick(u: Unit, ts) {
  return ts.slice().sort((a, b) => enemyScore(u, b) - enemyScore(u, a))[0];
}
export function rangedId(u: Unit) {
  return u.acts.find(id => A[id] && A[id].kind === 'attack' && A[id].ranged && !A[id].magic) || null;
}
export function shootCell(u: Unit, foes, id) {
  const a = A[id],
    dist = bfs(u, {
      max: speedOf(u),
    });
  let best = null;
  for (const [k, v] of dist) {
    const [x, y] = unkey(k),
      c = posOf(u, x, y);
    const md = Math.min(...foes.map(f => cheb(c, f)));
    if (md < 2) continue;
    let s = -v.d * 0.2 + Math.min(md, 5) * 0.3 - aiPathDanger(u, pathTo(dist, x, y));
    const ts = foes.filter(f => canTarget(u, a, f, c));
    if (ts.length) {
      s += 5;
      const ok = ts.filter(f => cheb(c, f) <= RANGE_OPT);
      if (ok.length) s += 2;
      if (ok.some(openT)) s += 2;
    }
    if (!best || s > best.s)
      best = {
        x,
        y,
        s,
      };
  }
  return best;
}
Object.assign(AI, {
  /* Рядовой: бьёт того, кто рядом (открытых и раненых охотнее), к остальным идёт к ближайшему. Ввязавшись в бой, не уходит; при трети HP отступает. */
  async pStd(u: Unit, foes) {
    const main = primaryAttack(u);
    if (!main) return false;
    const adj = foes.filter(f => near1(u, f));
    if (!T[u.tpl].noFlee && u.hp <= u.maxHp * 0.3 && adj.length && !u._ai.fled && okAct(u, 'move')) {
      u._ai.fled = true;
      if (await aiRetreat(u, main)) return true;
    }
    if (adj.length) {
      const ts = adj.filter(t => canTarget(u, A[main], t));
      if (ts.length && okAct(u, main)) return await perform(u, main, enemyPick(u, ts));
      return false;
    }
    if (okAct(u, main)) {
      const ts = targetsFor(u, main);
      if (ts.length) return await perform(u, main, enemyPick(u, ts));
    }
    if (okAct(u, 'move') && !u._ai.mv2) {
      const t = nearestFoe(u, foes, main);
      if (t) {
        if (u._ai.mv) u._ai.mv2 = true;
        u._ai.mv = true;
        return await aiApproach(u, main, t);
      }
    }
    return false;
  },
  /* Стрелок: держит 3–6 гексов, стреляет в открытых, перезаряжается; вплотную — отходит, если не накажут, иначе бьёт рукой. */
  async pShoot(u: Unit, foes) {
    const id = rangedId(u);
    if (!id) return AI.pStd(u, foes);
    const adj = foes.filter(f => near1(u, f));
    if (adj.length) {
      const safe = adj.every(f => (f.od || 0) <= 0 || f.zocRound === S.round);
      if (okAct(u, 'move') && !u._ai.back && (safe || u.hp <= u.maxHp * 0.5)) {
        u._ai.back = true;
        const c = shootCell(u, foes, id);
        if (c && (await performMove(u, c.x, c.y))) return true;
      }
      if (okAct(u, 'improv')) {
        const ts = adj.filter(t => canTarget(u, A.improv, t));
        if (ts.length) return await perform(u, 'improv', enemyPick(u, ts));
      }
      return false;
    }
    if (u.loaded && okAct(u, id)) {
      const ts = targetsFor(u, id);
      if (ts.length) {
        const t = ts
          .slice()
          .sort(
            (a, b) =>
              enemyScore(u, b) +
              (cheb(u, b) <= RANGE_OPT ? 2 : 0) -
              (enemyScore(u, a) + (cheb(u, a) <= RANGE_OPT ? 2 : 0)),
          )[0];
        return await perform(u, id, t);
      }
    }
    if (!u.loaded && okAct(u, 'reload')) return await perform(u, 'reload');
    if (okAct(u, 'move') && !u._ai.mv) {
      u._ai.mv = true;
      const c = shootCell(u, foes, id);
      if (c && (c.x !== u.x || c.y !== u.y)) return await performMove(u, c.x, c.y);
    }
    return false;
  },
});

/* Солдаты первого этажа. Приёмы используются настоящим ИИ, не только доступны в меню. */
Object.assign(AI, {
  async pInfantry(u: Unit, foes: Unit[]) {
    const nearby = foes.filter(f => near1(u, f));
    if (nearby.length) {
      const alliesAble = friends(u).some(a => a.ai === 'pSpearman' && !a.down && (a.od || 0) > 0 && cheb(a, u) <= 3);
      const t = enemyPick(u, nearby);
      if (
        alliesAble &&
        okAct(u, 'bucklerTap') &&
        !t.effects.some(e => e.type === 'bucklerOpen') &&
        canTarget(u, A.bucklerTap, t)
      )
        return await perform(u, 'bucklerTap', t);
      if (okAct(u, 'infantrySword') && canTarget(u, A.infantrySword, t)) return await perform(u, 'infantrySword', t);
    }
    return AI.pStd(u, foes);
  },
  async pSpearman(u: Unit, foes: Unit[]) {
    if (u.charge) {
      if (u.charge.kind === 'suppress' && u.charge.readyRound === S.round && okAct(u, 'spearSuppress')) {
        const ts = targetsFor(u, 'spearSuppress');
        if (ts.length) return await perform(u, 'spearSuppress', enemyPick(u, ts));
      }
      if (u.charge.readyRound > S.round) return false;
    }
    const near = foes.some(t => near1(u, t));
    if (!near && okAct(u, 'spearReady') && foes.some(t => cheb(u, t) <= 6)) return await perform(u, 'spearReady');
    return AI.pStd(u, foes);
  },
  async pCrossbow(u: Unit, foes: Unit[]) {
    if (u.charge) {
      if (u.charge.kind === 'aim' && u.charge.readyRound === S.round && okAct(u, 'aimedCrossbow')) {
        const ts = targetsFor(u, 'aimedCrossbow');
        if (ts.length) return await perform(u, 'aimedCrossbow', enemyPick(u, ts));
      }
      if (u.charge.readyRound > S.round) return false;
    }
    if (
      u.loaded &&
      okAct(u, 'aimReady') &&
      foes.some(t => cheb(u, t) >= 2 && cheb(u, t) <= 10 && los(u, t, u, { noUnits: true }).ok)
    )
      return await perform(u, 'aimReady');
    return AI.pShoot(u, foes);
  },
});

/* Тюремный блок 4.5.6: тактические роли из карточек на Боли (22.11).
   Бегство по 30% HP и фиксированные стадии расстройств здесь намеренно НЕ включены. */
Object.assign(AI, {
  async pPrisonKnife(u: Unit, foes: Unit[]) {
    if (u._ai.prisonStruck && okAct(u,'prisonBackstep')) {
      const dist = bfs(u,{max:1});
      let best = null;
      for (const [k,v] of dist) {
        if (v.d !== 1) continue;
        const [x,y] = unkey(k);
        const here = Math.min(...foes.map(f=>cheb(u,f)));
        const away = Math.min(...foes.map(f=>cheb({x,y},f)));
        if (away > here && (!best || away > best.away)) best = {x,y,away};
      }
      if (best) return await performMove(u,best.x,best.y,'prisonBackstep');
    }
    if (okAct(u,'prisonKnifeAttack')) {
      const ts = targetsFor(u,'prisonKnifeAttack');
      if (ts.length) {
        const t = ts.slice().sort((a,b)=>
          (Object.keys(b.wounds||{}).length ? 2 : 0) + (b.prone ? 1 : 0) + (b.maxHp-b.hp)/b.maxHp -
          ((Object.keys(a.wounds||{}).length ? 2 : 0) + (a.prone ? 1 : 0) + (a.maxHp-a.hp)/a.maxHp))[0];
        u._ai.prisonStruck = true;
        return await perform(u,'prisonKnifeAttack',t);
      }
    }
    if (okAct(u,'move') && !u._ai.prisonMoved) {
      u._ai.prisonMoved = true;
      const t=nearestFoe(u,foes,'prisonKnifeAttack');
      if (t) return await aiApproach(u,'prisonKnifeAttack',t);
    }
    return false;
  },
  async pPrisonChain(u: Unit, foes: Unit[]) {
    if (u.charge?.kind === 'prisonChain') {
      if (u.charge.readyRound === S.round && okAct(u,'prisonChainThrow')) {
        const ts=targetsFor(u,'prisonChainThrow');
        if (ts.length) return await perform(u,'prisonChainThrow',enemyPick(u,ts));
      }
      if (u.charge.readyRound > S.round) return false;
    }
    const adj=foes.filter(t=>near1(u,t));
    if (adj.length >= 2 && okAct(u,'prisonChainCircle')) return await perform(u,'prisonChainCircle');
    if (adj.length && okAct(u,'prisonChainAttack')) {
      const ts=targetsFor(u,'prisonChainAttack');
      if (ts.length) return await perform(u,'prisonChainAttack',enemyPick(u,ts));
    }
    if (!adj.length && !u.charge && okAct(u,'prisonChainReady') && foes.some(t=>cheb(u,t)===2))
      return await perform(u,'prisonChainReady');
    if (okAct(u,'move') && !u._ai.prisonMoved) {
      u._ai.prisonMoved = true;
      const t=nearestFoe(u,foes,'prisonChainAttack');
      if (t) return await aiApproach(u,'prisonChainAttack',t);
    }
    return false;
  },
  async pPrisonJailer(u: Unit, foes: Unit[]) {
    if (u.hold?.kind === 'prisonJailer') {
      if (okAct(u,'prisonJailerClub')) {
        const t=byId(u.hold.t);
        if (t && !t.down && canTarget(u,A.prisonJailerClub,t))
          return await perform(u,'prisonJailerClub',t);
      }
      return false;
    }
    if (okAct(u,'prisonJailerGrab')) {
      const ts=targetsFor(u,'prisonJailerGrab').filter(t=>t.grabbedBy==null);
      if (ts.length) return await perform(u,'prisonJailerGrab',enemyPick(u,ts));
    }
    if (okAct(u,'prisonJailerClub')) {
      const ts=targetsFor(u,'prisonJailerClub');
      if (ts.length) return await perform(u,'prisonJailerClub',enemyPick(u,ts));
    }
    if (okAct(u,'move') && !u._ai.prisonMoved) {
      u._ai.prisonMoved=true;
      const t=nearestFoe(u,foes,'prisonJailerClub');
      if (t) return await aiApproach(u,'prisonJailerClub',t);
    }
    return false;
  },
});
