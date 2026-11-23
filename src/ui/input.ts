import { A } from '../data/actions';
import { LIGHT_RU } from '../data/labels';
import { canControl, canTarget, perform, performMove, validCell, validThrow, validTrap } from '../rules/actions';
import { barsAt, bfs, doorAt, inFoot, los, pairOptions, pathTo, unitAt } from '../rules/geometry';
import { hiddenFrom, unitLight } from '../rules/light';
import { validFlash } from '../rules/magic';
import { koAt } from '../rules/pain';
import { hAt, isStairs } from '../rules/height';
import { adLeft, canActiveDefend, resist } from '../rules/reactions';
import { activeMods, hitCalc, speedOf } from '../rules/stats';
import { openWounds } from '../rules/wounds';
import { SET } from '../settings';
import { GEN, S, SIMULATING, alive, selUnit } from '../state';
import { onEndTurn } from '../rules/turns';
import { isHuman } from '../rules/actions';
import { askChoice } from './prompt';
import { renderHL } from './board';
import { closeCtx, openCtx } from './ctxmenu';
import { editorClick } from './editor';
import { FC_KINDS, actState, effAct, render, zocPreview } from './panels';
import { remember } from './history';
import { armorTxt, hpTxt } from './status';
import { $, CANCEL, cheb, esc, fmtN, key, pct, sgn, sum } from '../util';
/* Чем нажали последний раз: пальцем — удар по цели сначала показывает карточку прогноза. */
export let lastPtr = 'mouse';
export function notePointer(e) {
  lastPtr = e.pointerType || 'mouse';
}
/* Завершить ход: если у кого-то из героев остались ОД и есть кого атаковать — один раз спросить. */
export async function endTurnUI() {
  if (!S || S.busy || S.over || S.editor || !isHuman(S.phase)) return;
  const mark = S.round + ':' + S.phaseIdx;
  if (S.warned !== mark) {
    const idle = alive(S.phase).filter(
      u =>
        u.od > 0 &&
        !u.skipped &&
        u.acts.some(id => A[id] && ['attack', 'pair'].includes(A[id].kind) && actState(u, id).ok),
    );
    if (idle.length) {
      S.warned = mark;
      const go = await askChoice(
        'Завершить ход?',
        `<p>${idle.map(u => `<b>${esc(u.name)}</b> — ${u.od} ОД`).join(', ')}: ${idle.length > 1 ? 'есть' : 'есть'} кого атаковать. Неистраченные ОД уйдут на защиту до следующего хода.</p>`,
        [
          { label: 'Завершить ход', v: true, sub: 'Enter' },
          { label: 'Вернуться к ходу', v: false, sub: 'Esc' },
        ],
      );
      if (!go) return;
    }
  }
  remember();
  await onEndTurn();
}
export const IMMEDIATE = ['self', 'circle', 'escape', 'aura', 'breakbind', 'unbind', 'standup', 'prep', 'unlasso'];
export function onAction(id) {
  const u = selUnit();
  if (!canControl(u)) return;
  const a = A[id],
    st = actState(u, id);
  if (!st.ok) return;
  if (IMMEDIATE.includes(a.kind)) {
    run(() => perform(u, id));
    return;
  }
  S.act = S.act === id ? null : id;
  S.pendT = null;
  S.pathNote = null;
  hideTip();
  render();
}
export async function run(fn) {
  remember();
  closeCtx();
  S.busy = true;
  S.act = null;
  S.pendT = null;
  S.pathNote = null;
  hideTip();
  render();
  const g = GEN;
  try {
    await fn();
  } catch (e) {
    if (e !== CANCEL) console.error(e);
  }
  if (g === GEN) {
    S.busy = false;
    render();
  }
}
export function cellFromEvent(e) {
  const c = e.target.closest && e.target.closest('.c');
  if (!c) return null;
  return {
    x: +c.getAttribute('data-x'),
    y: +c.getAttribute('data-y'),
  };
}
export function onCellClick(e) {
  if (SIMULATING) return;
  const p = cellFromEvent(e);
  if (!p) return;
  if (S.editor) {
    editorClick(p.x, p.y);
    return;
  }
  if (S.busy) return;
  const u = selUnit(),
    t = unitAt(p.x, p.y) || koAt(p.x, p.y),
    cur = effAct(u);
  if (cur && canControl(u)) {
    const a = A[cur],
      id = cur;
    if (a.kind === 'move') {
      const dist = bfs(u, {
        max: speedOf(u) * Math.min(2, u.od),
      });
      const v = dist.get(key(p.x, p.y));
      if (v && v.d > 0) {
        /* пальцем: первое касание показывает путь и цену, второе — идёт */
        if (lastPtr === 'touch' && (!S.hover || S.hover.x !== p.x || S.hover.y !== p.y)) {
          S.hover = p;
          S.pathNote = `путь ${v.d} кл. · ${v.d <= speedOf(u) ? 1 : 2} ОД — нажмите ещё раз, чтобы пойти`;
          render();
          return;
        }
        run(() => performMove(u, p.x, p.y));
        return;
      }
    } else if (a.kind === 'pair') {
      if (t && pairOptions(u).some(q => q.includes(t))) {
        run(() => perform(u, id, t));
        return;
      }
    } else if (a.kind === 'wswap') {
      run(() => perform(u, id));
      return;
    } else if (a.kind === 'throw') {
      if (validThrow(u, a, p)) {
        run(() => perform(u, id, p));
        return;
      }
    } else if (a.kind === 'trap') {
      if (validTrap(u, p)) {
        run(() => perform(u, id, p));
        return;
      }
    } else if (a.kind === 'flash') {
      if (validFlash(u, p)) {
        run(() => perform(u, id, p));
        return;
      }
    } else if (a.kind === 'door') {
      if (validCell(u, a, p.x, p.y)) {
        run(() => perform(u, id, p));
        return;
      }
    } else if (t && canTarget(u, a, t)) {
      if (lastPtr === 'touch' && FC_KINDS.includes(a.kind) && S.pendT !== t.id) {
        S.pendT = t.id;
        renderHL();
        return;
      }
      run(() => perform(u, id, t));
      return;
    }
  }
  if (S.act) {
    S.act = null;
    S.pendT = null;
    closeCtx();
    render();
    return;
  }
  openCtx(e, p, t || S.units.find(o => inFoot(o, p.x, p.y)));
}
export function onCellHover(e) {
  const p = cellFromEvent(e);
  if (!p) {
    S.hover = null;
    hideTip();
    return;
  }
  if (!S.hover || S.hover.x !== p.x || S.hover.y !== p.y) {
    S.hover = p;
    renderHL();
  }
  showTip(e, p);
}
export function hideTip() {
  $('#tip').hidden = true;
}
export function showTip(e, p) {
  const tip = $('#tip'),
    u = selUnit();
  const cur = effAct(u);
  if (S.editor || S.busy || !u || !cur || !canControl(u) || (!S.act && unitAt(p.x, p.y))) {
    const o = unitAt(p.x, p.y);
    if (o && !S.editor) {
      tip.innerHTML = `<b>${esc(o.name)}</b> · ${hpTxt(o)}${hAt(o.x, o.y) ? ' · высота ' + hAt(o.x, o.y) : ''}<div class="m">${`стойкость ${resist(o)}`} · броня ${armorTxt(o)} · ОД ${o.od}${o.side !== S.phase ? ' (запас реакций)' : ''} · акт. защита ${adLeft(o) > 0 ? 'есть' : 'нет'} · ${LIGHT_RU[unitLight(o)]}${o.nv ? ', ночное зрение' : ''}</div>`;
    } else {
      const d = doorAt(p.x, p.y),
        b = barsAt(p.x, p.y),
        hv = hAt(p.x, p.y),
        st = isStairs(p.x, p.y);
      if (hv || st) {
        tip.innerHTML = `${hv ? 'Высота ' + hv : 'Пол'}${st ? ' · лестница: подъём без доплаты' : ''}`;
      } else if (!S.editor && (d || b)) {
        tip.innerHTML = d
          ? `Дверь: ${d.open ? 'открыта' : 'закрыта'}${d.locked ? ', заперта' : ''}`
          : `Решётка: свет проходит, пройти нельзя, ${b.shoot ? 'бить сквозь неё можно' : 'бить сквозь неё нельзя'}`;
      } else {
        hideTip();
        return;
      }
    }
  } else {
    const a = A[cur];
    let html = '';
    if (FC_KINDS.includes(a.kind) && $('#fcard') && !$('#fcard').hidden) {
      hideTip();
      return;
    }
    if (a.kind === 'move') {
      const sp = speedOf(u),
        dist = bfs(u, {
          max: sp * Math.min(2, u.od),
        }),
        v = dist.get(key(p.x, p.y));
      if (!v || !v.d) {
        hideTip();
        return;
      }
      const zp = zocPreview(u, pathTo(dist, p.x, p.y));
      const hv = hAt(p.x, p.y);
      html = `Путь ${v.d} гекс. · <b>${v.d <= sp ? 1 : 2} ОД</b>${hv ? ' · высота ' + hv : ''}${zp.map(z => `<div class="zw">Выход из зоны: ${esc(z.e.name)} ударит (${esc(A[z.id].name)}), попадёт в ${pct(z.p)}</div>`).join('')}`;
    } else if (a.kind === 'trap') {
      if (!validTrap(u, p)) {
        hideTip();
        return;
      }
      html = `Поставить капкан · 1 ОД<div class="m">осталось ${u.traps}</div>`;
    } else if (a.kind === 'throw') {
      if (!validThrow(u, a, p)) {
        hideTip();
        return;
      }
      html = `Бросить факел сюда · 1 ОД<div class="m">свет на ${SET.torchR || 3} гекса отсюда; в запасе ${u.torches}</div>`;
    } else if (a.kind === 'door') {
      if (!validCell(u, a, p.x, p.y)) {
        hideTip();
        return;
      }
      const d = doorAt(p.x, p.y);
      html =
        a.kind === 'door'
          ? `${d.open ? 'Закрыть' : 'Открыть'} дверь · 1 ОД`
          : 'Разрушить препятствие · 1 ОД, гарантированно';
    } else {
      const t = unitAt(p.x, p.y);
      if (!t || !canTarget(u, a, t)) {
        if (t && t.side !== u.side && !['swap', 'bandage'].includes(a.kind)) {
          const l = los(u, t, u);
          html = `<span class="dim">${esc(t.name)} недоступен${hiddenFrom(u, t) ? ': стоит в темноте, только вплотную' : !l.ok ? ': линию перекрывает ' + esc(l.why) : cheb(u, t) < 2 && a.noAdj ? ': вплотную нельзя' : ''}</span>`;
        } else {
          hideTip();
          return;
        }
      } else if (a.kind === 'attack') {
        const h = hitCalc(u, a, t);
        html = `<b>${esc(u.name)} → ${esc(t.name)}</b> · ${esc(a.name)}<div class="big">${pct(h.hit)}</div>`;
        html += `<div class="m">d20 ${sgn(h.M)} против защиты ${h.D}</div>`;
        html += `<div class="m">обычный ${pct(h.p[1])} · усиленный ${pct(h.p[2])} · крит ${pct(h.p[3])}</div><div class="m">${'Боль'} по степеням ${h.dm[1]} / ${h.dm[2]} / ${h.dm[3]}${''}</div><div>Ожидаемо <b>${fmtN(h.Eact)}</b> за действие${h.reps > 1 ? ` (${h.reps} броска)` : ''}</div>`;
        if (canActiveDefend(t))
          html += `<div class="dim">У цели есть активная защита: повторный бросок d20 ${sgn(sum(activeMods(t, a)))}</div>`;
      } else if (a.kind === 'swap') {
        html = `Поменяться местами с ${esc(t.name)} · 1 ОД`;
      } else if (a.kind === 'bandage') {
        const pts = a.pts || 3,
          rm = Math.min(pts, t.bleed),
          cl = Math.min(pts - rm, openWounds(t).length);
        html = `<b>Перевязка</b> → ${t === u ? 'себя' : esc(t.name)} · 1 бинт<div class="m">стаков кровотечения ${t.bleed}, открытых ран ${openWounds(t).length}</div><div class="m">снимет стаков ${rm}${cl ? `, закроет ран ${cl}` : ''}</div>`;
      }
    }
    tip.innerHTML = html;
  }
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 16,
    y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
