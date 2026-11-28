import { terrainEndTurn, terrainRound } from './terrain';
import { runSideAI } from '../ai/ai';
import { DIS, DIS_ICON } from '../data/disorders';
import { EFF_RU } from '../data/labels';
import { isHuman, okAct } from './actions';
import { decaySt } from './combat';
import { applyDamage, downUnit } from './damage';
import { disForm, disOf, guiltCell, guiltNext } from './disorders';
import { lassoPart } from './lasso';
import { ev, log, uName } from './log';
import { koTick, onEdge, painPrep } from './pain';
import { odMax } from './reactions';
import { getEff, hasEff, stat } from './stats';
import { bloodAt, needsCare, tickWounds } from './wounds';
import { SET } from '../settings';
import { GEN, S, alive, byId, selUnit } from '../state';
import { CANCEL, esc } from '../util';
import { view } from '../view';
export function initCombat() {
  S.round = 1;
  S.phaseIdx = 0;
  S.over = null;
  for (const u of S.units) painPrep(u);
  const pcs = alive('pc'),
    ens = alive('en');
  const maxPc = pcs.length ? Math.max(...pcs.map(u => stat(u, 'dex'))) : -99;
  const fast = ens.filter(u => stat(u, 'dex') > maxPc).sort((a, b) => stat(b, 'dex') - stat(a, 'dex'));
  let why;
  if (SET.ambush) {
    S.order = ['en', 'pc'];
    why = 'засада, группа застигнута врасплох';
  } else if (fast.length) {
    S.order = ['en', 'pc'];
    why = `${fast[0].name} — Ловкость ${stat(fast[0], 'dex')}, выше Ловкости всех героев (${maxPc})`;
  } else {
    S.order = ['pc', 'en'];
    why = `ни у одного противника Ловкость не выше ${maxPc}`;
  }
  S.initWhy = (S.order[0] === 'pc' ? 'Первыми ходят герои: ' : 'Первыми ходят противники: ') + why;
  for (const u of S.units) {
    u.od = SET.ambush && u.side === 'pc' ? 0 : odMax(u);
    u.adUsed = 0;
    u.fdUsed = false;
    u.cd = u.cd || {};
  }
  log(`<div class="lb">${S.initWhy}</div>`, 'sys');
}
export async function beginPhase() {
  S.phase = S.order[S.phaseIdx];
  log(`<div class="lb">Раунд ${S.round} · ${S.phase === 'pc' ? 'ходят герои' : 'ходят противники'}</div>`, 'sys');
  const sideIds = new Set(S.units.filter(u => u.side === S.phase).map(u => u.id));
  for (const o of S.units) {
    const gone = o.effects.filter(e => e.until != null && sideIds.has(e.until));
    if (gone.length) {
      o.effects = o.effects.filter(e => !(e.until != null && sideIds.has(e.until)));
      if (!o.down)
        ev(
          `<span class="dim">${esc(o.name)}: заканчивается ${[...new Set(gone.map(e => EFF_RU[e.type]))].join(', ')}</span>`,
        );
    }
  }
  for (const u of S.units)
    if (u.side === S.phase) {
    }
  for (const u of S.units) if (u.side === S.phase && u.down && u.ko && !u.dead) koTick(u);
  for (const u of alive(S.phase)) {
    tickWounds(u, true);
    u.prep = null;
    if (u.charge && u.charge.readyRound < S.round) u.charge = null;
    u._ai = {};
    u._once = {};
    u.adUsed = 0;
    u._atk = false;
    if (u.stunned) {
      u.stunned = false;
      u.od = 0;
      u.skipped = true;
      u.numb = false;
      ev(`💫 ${uName(u)} пропускает ход (оглушение)`);
    } else {
      u.od = odMax(u);
      u.fdUsed = false;
      u.skipped = false;
      if (u.numb) {
        u.numb = false;
        u.od = odMax(u) - 1;
        ev(`🫥 ${uName(u)} онемел: в этот ход 1 ОД`);
      }
    }
    u.turnNo = (u.turnNo || 0) + 1;
    u._acted = false;
    if (onEdge(u)) {
      u.prone = true;
      if (SET.edgeLast) {
        /* вариант 4.5.1: ход, в который дошёл до порога, потерян; следующий свой — со всеми ОД, затем без сознания */
        if (u._edgeMark === S.round + ':' + S.phaseIdx) u.od = 0;
        else if (!u.skipped) {
          u._lastTurn = true;
          ev(`⏳ ${uName(u)}: последний ход перед обмороком — все ${u.od} ОД на ползок, перевязку и речь`);
        }
      } else {
        u.od = Math.min(u.od, 1);
        if (!u.skipped) ev(`💢 ${uName(u)} на пороге: 1 ОД — ползти, перевязывать, приказывать`);
      }
    } else u._lastTurn = false;
    if (u.ban && u.turnNo > u.ban.until) u.ban = null;
    if (u.cruelDebt) {
      const d = Math.min(u.od, u.cruelDebt);
      u.od -= d;
      u.cruelDebt = 0;
      if (d) ev(`${DIS_ICON.cruel} ${uName(u)}: жестокое добивание отняло ${d} ОД этого хода`);
    }
    u.guilt = null;
    if (u.guiltDue) {
      const v = byId(u.guiltDue);
      u.guiltDue = null;
      const f = disOf(u, 'guilt');
      if (v && f && !u.skipped) {
        u.guilt = {
          id: v.id,
          stage: 'go',
        };
        u.guilt.stage = guiltNext(u);
        if (u.guilt.stage === 'go' && (!okAct(u, 'move', true) || !guiltCell(u, v))) {
          u.guilt = null;
          ev(
            `<span class="dim">${esc(u.name)} — ${DIS.guilt[f - 1]}: до ${esc(v.name)} не дойти, обязанность снята</span>`,
          );
        } else
          ev(
            `${DIS_ICON.guilt} ${uName(u)} — ${DIS.guilt[f - 1]}: сначала к ${uName(v)}${u.bandages > 0 && !v.down && needsCare(v) ? ' и перевязать' : ''}`,
          );
      }
    }
  }
  if (S.round === 1 && S.phaseIdx === 0) {
    const n = 2;
    for (const u of alive(S.phase)) u.od = Math.min(u.od, n);
    ev(
      `Первый ход боя: у начинающей стороны по ${n} ОД${'; у второй стороны полный запас — его можно сразу тратить на защиту'}`,
    );
  }
  view.drawLight(performance.now());
  view.render();
}
export async function endPhase() {
  const side = S.phase,
    marker = S.round + ':' + S.phaseIdx;
  for (const u of S.units) {
    if (u.side !== side) continue;
    if (u.charge && u.charge.readyRound <= S.round) u.charge = null;
    const keep = [];
    for (const e of u.effects) {
      if (e.thisTurn) continue;
      if (e.left != null && e.at !== marker) {
        e.left--;
        if (e.left <= 0) {
          if (!u.down)
            ev(
              `<span class="dim">${esc(u.name)}: ${e.type === 'inspire' ? `Воодушевление спадает${u.disorder && disForm(u) ? ', штрафы расстройства возвращаются' : ''}` : `спадает ${EFF_RU[e.type] || e.type}`}</span>`,
            );
          continue;
        }
      }
      keep.push(e);
    }
    u.effects = keep;
    if (!u.down && lassoPart(u) === 'head') {
      const ls = getEff(u, 'lasso');
      ev(`➰ Силок на горле: ${uName(u)} получает ${'1 Боль'} сквозь броню`);
      applyDamage(u, 1, ls ? byId(ls.by) : null);
      if (S.over) return;
    }
    if (!u.down) terrainEndTurn(u);
    /* кровотечение (свод 2.4): +1 Боль в конце своего хода, если тяжесть открытых ран 2+ (Слово «Милость» может остановить на раунд) */
    if (!u.down && u.bleed > 0 && !hasEff(u, 'bleedStop')) {
      ev(`🩸 ${uName(u)}: кровотечение (тяжесть ${u.bleed}) — +1 Боль`, { k: 'bleed', u: u.id, n: 1 });
      bloodAt(u, 1);
      applyDamage(u, 1, null);
      if (S.over) return;
    }
    if (!u.down) decaySt(u);
    if (SET.edgeLast && u._lastTurn && !u.down && onEdge(u)) {
      u._lastTurn = false;
      ev(`💤 ${uName(u)}: последний ход окончен — без сознания`);
      u.hp = 0;
      downUnit(u, null);
      if (S.over) return;
    }
  }
  S.phaseIdx++;
  if (S.phaseIdx >= 2) {
    await endRound();
    S.phaseIdx = 0;
    S.round++;
  }
}
export async function endRound() {
  terrainRound();
  for (const u of S.units) {
    const gone = u.effects.filter(e => e.end <= S.round);
    if (gone.length && !u.down)
      ev(`<span class="dim">${esc(u.name)}: спадает ${gone.map(e => EFF_RU[e.type] || e.type).join(', ')}</span>`);
    u.effects = u.effects.filter(e => e.end > S.round);
  }
}
export const SIM_CAP = 40;
export async function phaseLoop() {
  const g = GEN;
  while (!S.over) {
    await beginPhase();
    if (g !== GEN) return;
    if (S.over) break;
    if (isHuman(S.phase)) {
      S.busy = false;
      const cur = selUnit();
      if (!cur || cur.side !== S.phase || cur.down) {
        const f = alive(S.phase).find(u => u.od > 0) || alive(S.phase)[0];
        S.sel = f ? f.id : S.sel;
      }
      view.render();
      return;
    }
    S.busy = true;
    await runSideAI(S.phase);
    if (g !== GEN) return;
    if (S.over) break;
    await endPhase();
    if (S.sim && S.round > SIM_CAP) {
      S.over = 'draw';
      break;
    }
  }
  S.busy = false;
  view.render();
}
export async function onEndTurn() {
  if (!S || S.busy || S.over || S.editor || !isHuman(S.phase)) return;
  S.busy = true;
  S.act = null;
  view.hideTip();
  view.render();
  try {
    await endPhase();
    if (!S.over) await phaseLoop();
  } catch (e) {
    if (e !== CANCEL) console.error(e);
  }
  if (S.over) {
    S.busy = false;
    view.render();
  }
}
