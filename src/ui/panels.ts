import { sfx } from './sound';
import { view } from '../view';
import type { Unit } from '../types';
import { aiTurn } from '../ai/ai';
import { A, ATTACK_KINDS } from '../data/actions';
import { DIS, DIS_ICON, disDesc } from '../data/disorders';
import { T } from '../data/fighters';
import { AREA_RU, EFF_RU, LIGHT_RU, PTYP_RU, STAT_RU, WDEG_RU, WNAME } from '../data/labels';
import { SCN } from '../data/scenarios';
import {
  actCost,
  canControl,
  canTarget,
  hasAct,
  hasTargets,
  isHuman,
  perform,
  weaponsOf,
  zocWeapon,
} from '../rules/actions';
import { V2_EFF, addSt, mast, mastMg, partSt, setProne, stOf, v2DefOptions } from '../rules/combat';
import { changeWill, disForm, disLock, disOf } from '../rules/disorders';
import { near1, pairOptions, posOf, unitAt } from '../rules/geometry';
import { hAt, hasHeights } from '../rules/height';
import { lassoPart, lassoTarget } from '../rules/lasso';
import { darkPen, unitLight } from '../rules/light';
import { ev, uName } from '../rules/log';
import { curseCalc, weakMag } from '../rules/magic';
import { PCLS, edgeOk, limOf, onEdge, painOf, painPen, wClass, wType } from '../rules/pain';
import { RBASE, adLeft, ap3Degree, canActiveDefend, conOf, defThr, odMax, openT, resist } from '../rules/reactions';
import { atkMods, bdefOf, hasEff, hitCalc, pContest, reqOk, speedOf, stat } from '../rules/stats';
import { AREAS, woundPenTxt } from '../rules/wounds';
import { SET } from '../settings';
import { S, alive, byId, friends, selUnit } from '../state';
import { CELL, boardW, drawLight, renderHL, renderTokens, tokPos } from './board';
import { renderEditor } from './editor';
import { restart } from './game';
import { hintOf } from './hints';
import { endTurnUI, onAction, run } from './input';
import { canRedo, canUndo, redo, remember, reroll, undo } from './history';
import { FORCED } from '../rng';
import { applyDamage } from '../rules/damage';
import { addWound } from '../rules/wounds';
import { armorTxt, downTxt, odPipsHTML, openLegend, painSegs, v2CardLines } from './status';
import { $, esc, fmtN, pct, sgn, sum, sz } from '../util';
export function actState(u: Unit, id) {
  const a = A[id];
  if (id === 'escape' && !hasEff(u, 'snare') && !hasEff(u, 'lasso'))
    return {
      show: false,
    };
  if (id === 'unlasso' && !lassoTarget(u))
    return {
      show: false,
    };
  if (id === 'standup' && (!u.prone || onEdge(u)))
    return {
      show: false,
    };
  if (id === 'revive' && !(u.side === 'pc'))
    return {
      show: false,
    };
  if (id === 'throwHeld' && !u.torch)
    return {
      show: false,
    };
  if (id === 'door' && !Object.keys(S.doors).length)
    return {
      show: false,
    };
  if (id === 'swap' && (sz(u) > 1 || !friends(u).length))
    return {
      show: false,
    };
  if (id === 'relight')
    return {
      show: false,
    };
  if (id === 'douse' && !S.torches.length)
    return {
      show: false,
    };
  let why = null;
  const cdR = a.cd ? (u.cd || {})[id] || 0 : 0;
  if (S.over) why = 'бой окончен';
  else if (u.side !== S.phase) why = 'сейчас ход другой стороны';
  else if (!isHuman(u.side)) why = 'управляет ИИ';
  else if (S.busy) why = 'подождите';
  else if (onEdge(u) && !edgeOk(id, a)) why = 'на пороге: только ползти, перевязывать, приказывать';
  else if (a.cost > u.od) why = `нужно ${a.cost} ОД`;
  else if (cdR > S.round) why = `перезарядка: снова в раунде ${cdR}`;
  else if (!reqOk(u, id))
    why = `нужна ${Object.entries(a.req)
      .map(([s, v]) => STAT_RU[s] + ' ' + v)
      .join(', ')}`;
  else if (a.needLoad && !u.loaded) why = 'арбалет разряжен';
  else if (id === 'reload' && u.loaded) why = 'уже заряжен';
  else if (a.once && u._once && u._once[id]) why = 'только один раз за ход';
  else if (a.kind === 'throw' && !(u.torches > 0)) why = 'факелов в запасе нет';
  else if (a.ammo && !((u.ammo || {})[id] > 0)) why = 'запас кончился';
  else if (a.kind === 'trap' && !(u.traps > 0)) why = 'капканов не осталось';
  else if (['move'].includes(a.kind) && hasEff(u, 'snare')) why = 'в капкане';
  else if (a.kind === 'bandage' && !(u.bandages > 0)) why = 'бинтов не осталось';
  else if (a.kind === 'bandage' && !hasTargets(u, id)) why = 'нет кровотечения и открытых ран рядом';
  else if (a.kind === 'revive' && !hasTargets(u, id))
    why = 'рядом нет союзника без сознания (и клетка под ним должна быть свободна)';
  else if (a.speech && hasEff(u, 'mute')) why = 'Немота: нужна речь';
  else if (a.kind === 'move' && hasEff(u, 'lasso')) why = 'в силке';
  else if (a.kind === 'prep' && u.prep) why = 'уже готовится';
  else if (a.lasso && lassoTarget(u)) why = 'силок занят';
  else if (ATTACK_KINDS.includes(a.kind) && !a.magic && !a.lasso && (partSt(u, 'armR') >= 3 || lassoPart(u) === 'armR'))
    why = 'рука с оружием не действует';
  else if (disLock(u, id)) why = disLock(u, id);
  else if (!hasTargets(u, id)) why = 'нет доступной цели';
  return {
    show: true,
    ok: !why,
    why,
  };
}
export function actsOf(u: Unit) {
  const out = [];
  for (const id of u.acts) {
    out.push(id);
    if (id === 'move') out.push('swap', 'door');
  }
  if (!out.includes('swap')) out.push('swap', 'door');
  out.push('breakbind', 'unbind', 'unlasso');
  if (u.side === 'pc') out.push('revive');
  return out;
}
export function visibleActs(u: Unit) {
  return actsOf(u).filter(id => A[id] && actState(u, id).show);
}
export const UI = (() => {
  const d = {
    zoc: true,
    fc: true,
    logF: 'all',
    det: {},
  };
  try {
    const o = Object.assign(d, JSON.parse(localStorage.getItem('polygon2-ui') || '{}'));
    /* 4.1: общая сетка зон контроля по умолчанию скрыта — предупреждение показывается на пути */
    if (!o.v || o.v < 2) {
      o.zoc = false;
      o.v = 2;
    }
    return o;
  } catch (e) {
    return d;
  }
})();
export function saveUI() {
  try {
    localStorage.setItem('polygon2-ui', JSON.stringify(UI));
  } catch (e) {}
}
export let HINT_ID = null,
  HINT_PIN = null;
export function peek(id) {
  document.querySelectorAll('#toks .peek').forEach(d => d.classList.remove('peek'));
  if (id != null) {
    const d = $(`#toks [data-id="${id}"]`);
    if (d) d.classList.add('peek');
  }
}

/* Группы действий на панели: шаг, удар, умение, вещи. */
export function actGroup(id, a) {
  if (['move', 'swap', 'door', 'escape', 'standup'].includes(a.kind)) return 0;
  if (a.kind === 'prep') return 4;
  if (a.kind === 'push') return 1;
  if (a.kind === 'unlasso') return 3;
  if (['throw', 'bandage', 'trap', 'wswap', 'revive'].includes(a.kind) || id === 'reload') return 3;
  if ((ATTACK_KINDS.includes(a.kind) || a.kind === 'pair') && !a.magic) return 1;
  return 2;
}
export function actMeta(u: Unit, id, a) {
  const left = a.ammo ? ' · ×' + ((u.ammo || {})[id] || 0) : '';
  if (['attack', 'pair'].includes(a.kind) && a.fixed == null && (a.K || a.base != null))
    return (
      'Боль ' +
      [1, 2, 3].map(t => PCLS[wClass(u, a)][t]).join('·') +
      ' · ' +
      PTYP_RU[wType(a)] +
      (a.ranged ? ' · ' + a.range + ' г.' : (a.reach || 1) > 1 ? ' · дост. ' + a.reach : '') +
      left
    );
  if (a.kind === 'attack' && a.fixed != null) return a.fixed ? 'урон ' + a.fixed + '' : 'без урона';
  if (a.kind === 'move') return speedOf(u) + ' гекс. за ОД';
  if (a.kind === 'push') return 'Сила ' + stat(u, 'str') + (u.shield > 0 ? ' + щит 2' : '');
  if (a.kind === 'prep') return 'до своего хода';
  if (a.kind === 'standup') return 'снимает «сбит»';
  if (a.kind === 'flash') return 'источник огня';
  if (a.kind === 'habits') return '2 слабых места';
  if (a.kind === 'curse2' || a.kind === 'ordnow' || a.kind === 'ordback')
    return 'дальность ' + (a.range || 3) + (a.speech ? ' · речь' : '');
  if (a.lasso) return 'без урона · ' + a.range + ' г.';
  if (a.kind === 'throw') return a.held ? 'из рук' : 'в запасе ' + (u.torches || 0);
  if (a.kind === 'bandage') return 'бинтов ' + (u.bandages || 0);
  if (a.kind === 'revive') return 'сосед без сознания';
  if (a.kind === 'trap') return 'осталось ' + (u.traps || 0);
  if (a.kind === 'wswap') return 'в руках ' + (WNAME[u.wield] || '—');
  if (a.ammo) return 'осталось ' + ((u.ammo || {})[id] || 0);
  if (a.radius) return 'радиус ' + a.radius + (a.cd ? ' · пауза ' + a.cd : '');
  if (a.range) return 'дальность ' + a.range + (a.cd ? ' · пауза ' + a.cd : '');
  if (a.cd) return 'пауза ' + a.cd;
  return '';
}
export function actLong(u: Unit, id, a) {
  let hint = hintOf(id, a);
  if (['attack'].includes(a.kind) && a.fixed == null) {
    const parts = [a.magic ? 'мастерство магии' : a.ranged ? 'мастерство дальнего боя' : 'мастерство ближнего боя'];
    if (a.range) parts.push('дальность ' + a.range);
    if (a.reach > 1) parts.push('досягаемость ' + a.reach);
    hint = parts.join(' · ') + (hint ? '. ' + hint : '');
  }
  return hint || '';
}

/* Кто ударит, если боец пройдёт этим путём (зона контроля). Ничего не меняет в состоянии. */
export function zocPreview(u: Unit, path) {
  if (!SET.zoc || !path || !path.length) return [];
  const out = [],
    hit = new Set();
  let cx = u.x,
    cy = u.y;
  for (const [x, y] of path) {
    const ghost = Object.assign({}, u, {
        x: cx,
        y: cy,
      }),
      to = posOf(u, x, y);
    for (const e of S.units) {
      if (e.down || e.side === u.side || hit.has(e.id) || e.zocRound === S.round || !near1(e, ghost) || near1(e, to))
        continue;
      const id = zocWeapon(e, ghost);
      if (!id) continue;
      hit.add(e.id);
      out.push({
        e,
        id,
        p: hitCalc(e, A[id], ghost).hit,
      });
    }
    cx = x;
    cy = y;
  }
  return out;
}

/* Прогноз прямо на поле: шанс и ожидаемый урон над каждой доступной целью. */
/* Действие по умолчанию: у своего героя с ОД без выбранного действия — перемещение, область видна сразу. */
export function defaultMove(u: Unit) {
  return !!u && canControl(u) && u.acts.includes('move') && actState(u, 'move').ok;
}
export function effAct(u: Unit) {
  if (!u || !canControl(u)) return null;
  return S.act || (defaultMove(u) ? 'move' : null);
}

/* Прогноз прямо на поле: шанс и ожидаемый урон над каждой доступной целью. */
export function renderForecast() {
  const box = $('#fc');
  if (!box) return;
  const u = selUnit();
  let html = '';
  if (UI.fc && u && S.act && canControl(u)) {
    const a = A[S.act];
    const put = (t, pr, sub?) => {
      const p = tokPos(t);
      html += `<div class="fcb${pr < 0.35 ? ' lo' : pr >= 0.7 ? ' hi' : ''}" style="left:${p.x.toFixed(1)}px;top:${(p.y + CELL * 0.42).toFixed(1)}px"><b>${pct(pr)}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
    };
    const foes = S.units.filter(o => !o.down && o.side !== u.side);
    if (a.kind === 'attack') {
      for (const t of foes)
        if (canTarget(u, a, t)) {
          const h = hitCalc(u, a, t);
          const p = tokPos(t);
          html += `<div class="fcb${h.p[3] >= 0.25 ? ' hi' : ''}${openT(t) ? ' op' : ''}" style="left:${p.x.toFixed(1)}px;top:${(p.y + CELL * 0.42).toFixed(1)}px"><b>${a.lasso ? pct(h.hit) : '≈' + fmtN(h.Eact)}</b><i>${a.lasso ? 'силок' : (h.hit < 1 ? 'мимо ' + pct(1 - h.hit) + ' · ' : '') + 'крит ' + pct(h.p[3])}${openT(t) ? ' · открыт' : ''}</i></div>`;
        }
    } else if (a.kind === 'push') {
      for (const t of foes)
        if (canTarget(u, a, t))
          put(
            t,
            pContest(
              stat(u, 'str') + (u.shield > 0 ? 2 : 0) + (stOf(t, 'unst') ? 3 : 0) - (u.prone ? 5 : 0),
              stat(t, 'str'),
              false,
            ),
            stOf(t, 'unst') ? 'упадёт' : '',
          );
    } else if (a.kind === 'curse2') {
      for (const t of foes) if (canTarget(u, a, t)) put(t, curseCalc(u, a, t).land);
    } else if (a.kind === 'pair') {
      const seen = new Set();
      for (const pr of pairOptions(u))
        for (const t of pr) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          const h = hitCalc(u, a, t);
          put(t, h.hit, '≈' + fmtN(h.E));
        }
    }
  }
  box.innerHTML = html;
  renderFcard();
}

/* Карточка прогноза у цели: степени успеха, сколько Боли пройдёт и что станет с целью.
   Мышью — при наведении, щелчок бьёт. Пальцем — первое касание открывает карточку, удар — кнопкой. */
export const FC_KINDS = ['attack', 'pair'];
export const PHONE = () => typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches;
export function fcardTarget() {
  const u = selUnit();
  if (!u || !S.act || !canControl(u)) return null;
  const a = A[S.act];
  if (!FC_KINDS.includes(a.kind)) return null;
  const pend = S.pendT != null ? byId(S.pendT) : null;
  if (pend && !pend.down && canTarget(u, a, pend)) return pend;
  if (!UI.fc || !S.hover) return null;
  const t = unitAt(S.hover.x, S.hover.y);
  if (!t || t.side === u.side) return null;
  if (a.kind === 'pair') return pairOptions(u).some(p => p.includes(t)) ? t : null;
  return canTarget(u, a, t) ? t : null;
}
/* Прогноз удара с учётом активной защиты цели и шанс вывести её из боя за оставшиеся ОД. */
export function fcCalc(u: Unit, a, t) {
  const h = hitCalc(u, a, t),
    th = h.thr ? h.thr.v : 0;
  let best = null;
  if (canActiveDefend(t) && !a.lasso) {
    const dth = defThr(t, a);
    for (const o of v2DefOptions(t, u, a, {})) {
      const m = sum(o.mods),
        pf = tot => Math.max(0, Math.min(1, (21 - Math.max(dth + 1, tot - m + 1)) / 20));
      let avg = 0;
      for (let r = 1; r <= 20; r++) avg += r <= th ? 0 : pf(r + h.M);
      if (!best || avg > best.avg) best = { name: o.name, pf, avg: avg / 20 };
    }
  }
  const one = withDef => {
    const p = [0, 0, 0, 0];
    let par = 0;
    for (let r = 1; r <= 20; r++) {
      if (r <= th) {
        p[0]++;
        continue;
      }
      const tot = r + h.M,
        deg = a.lasso ? (tot >= h.D ? 1 : 0) : ap3Degree(tot - h.D).t,
        pd = withDef && best ? best.pf(tot) : 0;
      par += pd;
      p[deg] += 1 - pd;
    }
    return { p: p.map(x => x / 20), par: par / 20 };
  };
  const first = one(true);
  /* вывести из боя: противник — Боль до предела; герой — сверх предела (после «на пороге») */
  const L = limOf(t),
    p0 = Math.min(L, painOf(t)),
    need = t.side === 'pc' ? (onEdge(t) ? 1 : L - p0 + 1) : L - p0;
  const cost = Math.max(1, actCost(u, S.act || '') || a.cost || 1),
    k = Math.max(1, Math.floor((u.od || 0) / cost)),
    reacts = canActiveDefend(t) ? Math.max(1, adLeft(t)) : 0;
  let dist = [1];
  for (let i = 0; i < k; i++) {
    const o = one(i < reacts),
      next = new Array(dist.length + 5).fill(0);
    dist.forEach((pv, s0) => {
      if (!pv) return;
      next[s0] += pv * (o.p[0] + o.par);
      for (let d = 1; d <= 3; d++) next[s0 + Math.max(0, h.dm[d] || 0)] += pv * o.p[d];
    });
    dist = next;
  }
  const ko = a.noPain || a.fixed === 0 ? 0 : dist.reduce((acc, pv, s0) => acc + (s0 >= need ? pv : 0), 0);
  return { h, best, first, ko, k, need, L, p0 };
}
export function renderFcard() {
  const box = $('#fcard');
  if (!box) return;
  const t = fcardTarget(),
    u = selUnit();
  if (!t || !u) {
    box.hidden = true;
    box.dataset.t = '';
    return;
  }
  const a = A[S.act],
    F = fcCalc(u, a, t),
    h = F.h,
    cost = actCost(u, S.act),
    L = F.L,
    p0 = F.p0,
    touch = S.pendT === t.id;
  const DN = ['Мимо', 'Обычный', 'Усиленный', 'Крит'],
    DC = ['miss', 'ok', 'enh', 'crit'];
  let rows = '';
  const miss = F.first.p[0] + F.first.par;
  for (let k = 0; k <= 3; k++) {
    const pk = k ? F.first.p[k] : miss;
    if (!k && pk <= 0) continue;
    const d = k ? h.dm[k] : 0,
      res =
        k === 0
          ? F.first.par > 0
            ? `отбито ${pct(F.first.par)}`
            : 'без Боли'
          : a.noPain || a.fixed === 0
            ? 'без Боли'
            : d <= 0
              ? '0 — броня гасит'
              : `+${d} Боли${p0 + d >= L ? (t.side === 'pc' ? ', на пороге' : ', выбывает') : ''}`;
    rows += `<div class="fr ${DC[k]}"><span class="fl">${k ? DN[k] : F.first.par > 0 ? 'Отбито' : DN[0]}</span><span class="fb"><i style="width:${Math.round(pk * 100)}%"></i></span><span class="fp">${pct(pk)}</span><span class="fd">${res}</span></div>`;
  }
  const maxD = Math.max(0, ...h.dm.slice(1));
  let segs = '';
  for (let i = 0; i < L; i++) segs += `<i class="${i < p0 ? 'on' : i < p0 + maxD ? 'gh' : ''}"></i>`;
  const mods = atkMods(u, a, t);
  const ad = F.best
    ? `<div class="fn">Цель защищается: ${esc(F.best.name.toLowerCase())}, отбивает ${pct(F.best.avg)} бросков (запас реакций ${adLeft(t)})</div>`
    : `<div class="fn dim">Активной защиты у цели сейчас нет</div>`;
  const ko =
    a.noPain || a.fixed === 0
      ? ''
      : `<div class="fko"><span>Вывести из боя за этот ход${F.k > 1 ? ` (${F.k} удара)` : ''}</span><b>≈${pct(F.ko)}</b></div>`;
  box.innerHTML = `<div class="fh"><b>${esc(a.name)} → ${esc(t.name)}</b><span class="cost">${cost} ОД</span></div>
    <div class="fm">d20 ${sgn(h.M)} против Стойкости ${h.D}<span class="dim">${mods.map(m => ' · ' + esc(m.l) + ' ' + sgn(m.v)).join('')}</span></div>
    <div class="frs">${rows}</div>${ad}
    <div class="ft"><span>Боль цели</span><span class="segs fcs">${segs}</span><span class="mono">${p0}/${L}</span></div>${ko}
    ${touch ? `<div class="fbtn"><button type="button" class="primary" id="fcGo">${esc(a.name)} · ${cost} ОД</button><button type="button" id="fcNo">Отмена</button></div>` : '<div class="fn dim">Щелчок по цели — выполнить · Esc — отмена</div>'}`;
  /* место для карточки (в координатах окна): справа, слева, снизу или сверху от цели — где влезает и не закрывает ни цель, ни атакующего */
  box.hidden = false;
  if (!PHONE()) {
    const br = $('#board').getBoundingClientRect(),
      k = br.width / boardW(),
      scr = q => ({ x: br.left + q.x * k, y: br.top + q.y * k }),
      p = scr(tokPos(t)),
      a0 = scr(tokPos(u)),
      W = box.offsetWidth || 320,
      H = box.offsetHeight || 220,
      gap = CELL * k * 0.75,
      vw = window.innerWidth,
      vh = window.innerHeight;
    const cand = [
      [p.x + gap, p.y - H * 0.5],
      [p.x - gap - W, p.y - H * 0.5],
      [p.x - W / 2, p.y + CELL * k * 0.8],
      [p.x - W / 2, p.y - CELL * k * 1.4 - H],
    ];
    let best = null;
    for (const [x0, y0] of cand) {
      const x = Math.max(4, Math.min(vw - W - 4, x0)),
        y = Math.max(4, Math.min(vh - H - 4, y0));
      const r = CELL * k * 0.45;
      const cover = q => q.x > x - r && q.x < x + W + r && q.y > y - r * 2 && q.y < y + H + r;
      const sc = Math.abs(x - x0) + Math.abs(y - y0) + (cover(a0) ? 1000 : 0) + (cover(p) ? 2000 : 0);
      if (!best || sc < best.sc) best = { x, y, sc };
    }
    box.style.left = best.x.toFixed(0) + 'px';
    box.style.top = best.y.toFixed(0) + 'px';
  }
  box.dataset.t = String(t.id);
  const go = $('#fcGo'),
    no = $('#fcNo');
  if (go)
    go.onclick = () => {
      const id = S.act;
      S.pendT = null;
      run(() => perform(u, id, t));
    };
  if (no)
    no.onclick = () => {
      S.pendT = null;
      renderHL();
    };
}
export function renderHint() {
  const box = $('#hint');
  if (!box) return;
  const u = selUnit(),
    id = HINT_ID || S.act || HINT_PIN;
  if (!u || !id || !A[id] || !hasAct(u, id)) {
    box.innerHTML =
      'Выберите действие, затем цель на поле. <kbd>1</kbd>–<kbd>9</kbd> действия · <kbd>Tab</kbd> следующий герой · <kbd>Enter</kbd> конец хода · <kbd>Esc</kbd> отмена';
    return;
  }
  const a = A[id],
    st = actState(u, id),
    cost = actCost(u, id),
    long = actLong(u, id, a);
  box.innerHTML = `<b>${esc(a.name)}</b><span class="cost">${cost} ОД</span>${long}${a.pending ? ' <span class="pend">требует утверждения</span>' : ''}${!st.ok && st.why ? ` <span class="why">Сейчас нельзя: ${st.why}.</span>` : ''}`;
}
let lastPhase = '';
export function renderTurn() {
  const human = isHuman(S.phase),
    u = selUnit();
  const pk = S.round + S.phase;
  if (lastPhase && pk !== lastPhase && !S.over && !S.editor) sfx('turn');
  lastPhase = pk;
  const phase = S.over
    ? S.over === 'pc'
      ? 'Победа героев'
      : S.over === 'en'
        ? 'Герои пали'
        : 'Ничья'
    : S.editor
      ? 'Редактор поля'
      : (S.phase === 'pc' ? 'Ход героев' : 'Ход противников') + (human ? '' : ' · ИИ');
  let prompt;
  if (S.over) prompt = 'Бой окончен. Весь ход боя — в журнале.';
  else if (S.editor) prompt = 'Выберите инструмент и нажимайте на гексы.';
  else if (!human) prompt = 'Противники ходят…';
  else if (S.busy) prompt = 'Действие выполняется…';
  else if (!u || !canControl(u)) prompt = 'Выберите героя: нажмите на фигуру или на него в ленте сверху.';
  else if (S.act) {
    const a = A[S.act];
    const what =
      {
        move: 'выберите гекс',
        arc: 'выберите направление удара',
        throw: 'выберите гекс для факела',
        flare: 'выберите гекс',
        trap: 'выберите гекс для капкана',
        step: 'выберите соседний гекс',
        evade: 'выберите, куда уйти',
        jump: 'выберите тёмный гекс',
        door: 'выберите дверь',
        smash: 'выберите препятствие',
        torch: 'выберите факел',
        swap: 'выберите союзника',
        cover: 'выберите союзника',
        buff: 'выберите союзника',
        order: 'выберите союзника',
        heal: 'выберите, кого лечить',
        bandage: 'выберите, кого перевязать',
        pair: 'выберите одного из пары',
        push: 'выберите соседнего врага',
        flash: 'выберите источник огня',
        ordnow: 'выберите союзника в 2 гексах',
        ordback: 'выберите союзника в 2 гексах',
        curse2: 'выберите врага в 3 гексах',
        habits: 'выберите врага',
      }[a.kind] || 'выберите цель';
    const n = S.units.filter(t => canTarget(u, a, t)).length;
    prompt = `${esc(a.name)}: ${what}${FC_KINDS.includes(a.kind) && n ? ` · целей в досягаемости: ${n}` : ''}`;
  } else if (!u.od) prompt = 'ОД закончились';
  else
    prompt = defaultMove(u)
      ? S.pathNote || 'нажмите на подсвеченную клетку, чтобы пойти, или выберите действие'
      : 'выберите действие';
  $('#rnd').innerHTML =
    `<span class="cap">Раунд</span><span class="rn">${S.round}</span><span class="ph ${S.over ? 'over' : S.editor ? 'ed' : S.phase}">${phase}</span>${HOOKS.badge ? HOOKS.badge() : ''}`;
  const IC = {
    undo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',
    redo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/></svg>',
    dice: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/></svg>',
  };
  $('#hist').innerHTML =
    `<button type="button" class="icon sm" id="btnUndo" ${canUndo() ? '' : 'disabled'} title="Отменить последнее действие (Z)" aria-label="Отменить">${IC.undo}</button><button type="button" class="icon sm" id="btnRedo" ${canRedo() ? '' : 'disabled'} title="Вернуть отменённое (Shift+Z)" aria-label="Вернуть">${IC.redo}</button><button type="button" class="icon sm" id="btnDice" ${S.busy || S.editor ? 'disabled' : ''} title="Другие кубики: новое зерно с этого места. Зерно боя ${S.seed || '—'}" aria-label="Другие кубики">${IC.dice}</button>`;
  $('#endwrap').innerHTML = S.over
    ? '<button type="button" class="primary end" id="btnAgain">Начать заново</button>'
    : `<button type="button" class="primary end" id="btnEnd" ${!human || S.busy || S.editor ? 'disabled' : ''}>Завершить ход<kbd>Enter</kbd></button>`;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnDice').onclick = reroll;
  const who =
    u && !S.editor
      ? `<span class="who"><span class="gl ${u.side}">${esc(u.glyph)}</span><b>${esc(u.name)}</b></span>${u.down ? '' : `${painSegs(u, 'sm')}<span class="pips" title="Очки действий">${odPipsHTML(u)}</span>`}${u.side === S.phase && !u.down && !S.over && human ? '<span class="dim odn">неистраченные ОД уйдут на защиту</span>' : ''}`
      : '';
  $('#ctx').innerHTML =
    `${who}${u ? '<button type="button" class="cardbtn" id="btnCardSheet">Карточка</button>' : ''}<span class="pr">${prompt}</span>`;
  const cb = $('#btnCardSheet');
  if (cb) cb.onclick = () => openCardSheet();
  $('#bov').innerHTML =
    `<button type="button" class="chipbtn" id="tgFc" aria-pressed="${!!UI.fc}" title="Шанс и Боль над целями и карточка прогноза у цели"><i></i>Прогноз</button><button type="button" class="chipbtn" id="tgZoc" aria-pressed="${!!(UI.zoc && SET.zoc)}" ${SET.zoc ? '' : 'disabled'} title="${SET.zoc ? 'Гексы, выход из которых вызовет удар противника' : 'Зона контроля выключена в правилах'}"><i></i>Зоны контроля</button><button type="button" class="chipbtn" id="tgLeg" title="Что означают значки над фигурами">Значки</button>`;
  $('#tgFc').onclick = () => {
    UI.fc = !UI.fc;
    saveUI();
    render();
  };
  $('#tgLeg').onclick = openLegend;
  $('#tgZoc').onclick = () => {
    UI.zoc = !UI.zoc;
    saveUI();
    render();
  };
  if ($('#btnEnd')) $('#btnEnd').onclick = endTurnUI;
  if ($('#btnAgain')) $('#btnAgain').onclick = () => restart();
  const party =
    (SET.party || [])
      .filter(k => T[k])
      .map(k => T[k].name)
      .join(', ') || 'нет';
  $('#sceneInfo').innerHTML =
    `<h2 class="pt">${esc(SCN[S.scn] ? SCN[S.scn].name : 'Своя расстановка')}</h2><p>${SCN[S.scn] ? SCN[S.scn].goal : 'Своя расстановка.'}</p><p class="dim">${S.initWhy}</p><p class="dim">${`3 ОД, запас реакций, бросок против Стойкости; ловкачи: ${
      {
        dodge: 'бесплатное уклонение',
        od: '+1 ОД',
        none: 'без бонуса',
      }[SET.dexMode || 'dodge']
    }. `}Группа: ${esc(party)}. Модель: Ловкость и Сила, блок щитом от Силы${SET.darkRules ? ', темнота' : ', темнота выключена'}${SET.zoc ? ', зона контроля' : ''}${hasHeights() ? ', высоты' : ''}.</p>`;
  $('#btnEditor').classList.toggle('on', !!S.editor);
}
export function renderRoster() {
  const box = $('#roster');
  const chip = (u: Unit) => {
    const cur = u.side === S.phase && !S.over && !S.editor;
    const tip = `${u.name}: ${u.down ? downTxt(u) : `Боль ${Math.min(limOf(u), painOf(u))} из ${limOf(u)}${onEdge(u) ? ', на пороге' : ''}, ОД ${u.od}`}`;
    const num = (u.name.match(/ (\d+)$/) || [])[1];
    return `<button type="button" class="uc ${u.side}${S.sel === u.id ? ' sel' : ''}${u.down ? ' down' : ''}${cur && !u.down && u.od === 0 ? ' spent' : ''}" data-id="${u.id}" title="${esc(tip)}" aria-label="${esc(tip)}"><span class="g">${esc(u.glyph)}${num ? `<sup>${num}</sup>` : ''}</span><span class="ub"><span class="nm">${esc(u.name)}</span><span class="ul">${u.down ? `<span class="dt">${downTxt(u)}</span>` : painSegs(u, 'sm') + `<span class="pips">${odPipsHTML(u)}</span>`}</span></span></button>`;
  };
  const grp = (side, title) => {
    const us = S.units.filter(u => u.side === side);
    if (!us.length) return '';
    const al = us.filter(u => !u.down).length;
    return `<div class="rg ${side}"><span class="rgh"><b>${title}</b><span class="cnt">${al}/${us.length}</span></span>${us.map(chip).join('')}</div>`;
  };
  box.innerHTML = grp('pc', 'Герои') + '<span class="rsep"></span>' + grp('en', 'Противники');
  box.querySelectorAll('[data-id]').forEach(b => {
    b.onclick = () => {
      S.sel = +b.dataset.id;
      S.act = null;
      S.pendT = null;
      S.pathNote = null;
      render();
    };
    b.onmouseenter = () => peek(+b.dataset.id);
    b.onmouseleave = () => peek(null);
  });
}
export function renderActs() {
  const box = $('#acts');
  if (S.editor) {
    renderEditor(box);
    return;
  }
  const u = selUnit();
  if (!u || u.down) {
    box.innerHTML = `<div class="dock-empty">${u ? esc(u.name) + ' вне боя.' : 'Нажмите на бойца на поле или в ленте сверху, чтобы увидеть его действия.'}</div>`;
    return;
  }
  const ids = visibleActs(u),
    ctrl = !S.busy && !S.over && u.side === S.phase && isHuman(u.side);
  const G = [[], [], [], [], []],
    off = [];
  ids.forEach(id => {
    if (!A[id]) return;
    if (ctrl && !actState(u, id).ok) off.push(id);
    else G[actGroup(id, A[id])].push(id);
  });
  const GN = ['Шаг', 'Атака', 'Умения', 'Вещи', 'Подготовка'];
  const dflt = defaultMove(u);
  let n = 0,
    top = 0;
  const btn = (id, numbered) => {
    const a = A[id],
      st = actState(u, id),
      cost = actCost(u, id);
    const k = numbered && ctrl && st.ok && n < 9 ? ++n : 0;
    const tp = numbered && top < 3 ? ++top : 0;
    const sel = S.act === id || (!S.act && id === 'move' && dflt);
    return `<button type="button" class="act${tp ? ' top' : ''}${sel ? ' sel' : ''}${!S.act && id === 'move' && dflt ? ' dflt' : ''}${st.ok ? '' : ' off'}${a.pending ? ' pd' : ''}" data-act="${id}"${k ? ` data-key="${k}"` : ''} aria-disabled="${st.ok ? 'false' : 'true'}"><span class="n">${esc(a.name)}</span><span class="m">${!st.ok && ctrl && st.why ? `<em>${st.why}</em>` : actMeta(u, id, a)}</span><span class="c" title="${cost} ОД">${cost ? '<b></b>'.repeat(cost) : '<b class="z"></b>'}</span>${k ? `<kbd>${k}</kbd>` : ''}</button>`;
  };
  let html = '<div class="agroups">';
  [0, 1, 2, 4, 3].forEach(gi => {
    const g = G[gi];
    if (!g.length) return;
    html += `<div class="ag"><span class="agn">${GN[gi]}</span><div class="agb">${g.map(id => btn(id, true)).join('')}</div></div>`;
  });
  if (off.length)
    html += `<div class="ag"><span class="agn" aria-hidden="true">&nbsp;</span><div class="agb"><button type="button" class="act more" id="btnMore" aria-expanded="${!!UI.more}"><span class="n">${UI.more ? 'Скрыть недоступные' : 'Ещё ' + off.length}</span><span class="m">${UI.more ? '' : 'сейчас недоступны'}</span></button></div></div>`;
  html += '</div>';
  if (off.length && UI.more) html += `<div class="agoff">${off.map(id => btn(id, false)).join('')}</div>`;
  const left = ctrl ? alive(S.phase).filter(o => o.od > 0 && !o.skipped) : [];
  box.innerHTML =
    html +
    '<div class="hint" id="hint"></div>' +
    (ctrl
      ? `<div class="dockft">${left.length ? `<span>ОД остались: ${left.map(o => `<button type="button" class="lk" data-go="${o.id}">${esc(o.name)}</button>`).join(', ')}</span>` : '<span>Все потратили ОД — можно завершать ход.</span>'}${canControl(u) ? '<button type="button" id="btnAiOne" class="ghost">Пусть за него сходит ИИ</button>' : ''}</div>`
      : '');
  box.querySelectorAll('[data-go]').forEach(
    b =>
      (b.onclick = () => {
        S.sel = +b.dataset.go;
        S.act = null;
        S.pendT = null;
        render();
      }),
  );
  const ai = $('#btnAiOne');
  if (ai) ai.onclick = () => run(() => aiTurn(u));
  const more = $('#btnMore');
  if (more)
    more.onclick = () => {
      UI.more = !UI.more;
      saveUI();
      renderActs();
    };
  box.querySelectorAll('[data-act]').forEach(b => {
    const id = b.dataset.act;
    b.onclick = () => {
      if (b.getAttribute('aria-disabled') === 'true') {
        HINT_PIN = id;
        renderHint();
        return;
      }
      HINT_PIN = null;
      onAction(id);
    };
    b.onmouseenter = b.onfocus = () => {
      HINT_ID = id;
      renderHint();
    };
    b.onmouseleave = b.onblur = () => {
      HINT_ID = null;
      renderHint();
    };
  });
  renderHint();
}
export function renderCard() {
  const u = selUnit(),
    box = $('#card');
  if (!u) {
    box.innerHTML =
      '<div class="sheet-empty"><h2>Лист бойца</h2><p>Нажмите на фигуру на поле или на бойца в ленте сверху: здесь появятся Боль, характеристики, раны и эффекты.</p></div>';
    return;
  }
  const f = disForm(u);
  const SHORT = {
    str: 'Сила',
    dex: 'Ловк.',
    int: 'Инт.',
    cha: 'Хар.',
  };
  const statBox = s => {
    const v = stat(u, s),
      b = u.base[s];
    return `<div class="${v < b ? 'low' : ''}" title="${STAT_RU[s]}${v !== b ? ': без штрафов ' + b : ''}"><b>${v}</b><span>${SHORT[s]}</span></div>`;
  };
  const effs = [];
  if (u.stunned) effs.push('💫 оглушён — пропустит ход');
  if (u.skipped && u.side === S.phase) effs.push('💫 пропускает этот ход');
  effs.push(...v2CardLines(u));
  for (const e of u.effects)
    if (!V2_EFF.has(e.type)) effs.push((EFF_RU[e.type] || e.type) + (e.left ? `, ходов осталось ${e.left}` : ''));
  if (u.numb) effs.push('🫥 онемел: следующий ход с 1 ОД');
  if (u.mustAttack) effs.push('⚔ следующее действие — атака оружием');
  if (u.ban && (u.turnNo || 0) <= u.ban.until && disOf(u, 'sad'))
    effs.push(`${DIS_ICON.sad} нельзя повторить «${esc(A[u.ban.id].name)}» до конца хода ${u.ban.until}`);
  if (u.guilt)
    effs.push(
      `${DIS_ICON.guilt} Вина: ${u.guilt.stage === 'go' ? 'сначала дойти до союзника' : u.guilt.stage === 'band' ? 'перевязать союзника' : 'закончить ход рядом с союзником'}`,
    );
  if (u.guiltDue) effs.push(`${DIS_ICON.guilt} в следующий ход — к раненому союзнику`);
  if (u.cruelDebt) effs.push(`${DIS_ICON.cruel} в начале хода −${u.cruelDebt} ОД (добивание)`);
  if (u.acts.some(id => A[id] && A[id].needLoad)) effs.push(u.loaded ? 'арбалет заряжен' : 'арбалет разряжен');
  for (const [id, r] of Object.entries(u.cd || {}) as [string, number][])
    if (r > S.round && A[id]) effs.push(`⏳ ${A[id].name}: снова в раунде ${r}`);
  const disSel = `<select id="disSel" aria-label="Личное расстройство"><option value="">нет расстройства</option>${Object.keys(
    DIS,
  )
    .map(k => `<option value="${k}" ${u.disorder === k ? 'selected' : ''}>${DIS[k][0]} → ${DIS[k][1]}</option>`)
    .join('')}</select>`;
  const pips = odPipsHTML(u);
  const inv = [`факелы <b>${u.torches || 0}</b>${u.torch ? ' и один в руке' : ''}`, `бинты <b>${u.bandages || 0}</b>`];
  if (u.traps) inv.push(`капканы <b>${u.traps}</b>`);
  for (const [id, n] of Object.entries(u.ammo || {}))
    if (A[id]) inv.push(`${esc(A[id].name.toLowerCase())} <b>${n}</b>`);
  const open = id => (UI.det[id] || (id === 'dGm' && S.editor) ? 'open' : '');
  const L = limOf(u),
    pn = Math.min(L, painOf(u)),
    pen = painPen(u),
    lv = hasHeights() ? hAt(u.x, u.y) : 0;
  const sub = [
    u.side === 'pc' ? 'герой' : 'противник',
    sz(u) > 1 ? 'занимает 3 гекса' : '',
    u.wield && weaponsOf(u).length > 1 ? 'в руках ' + (WNAME[u.wield] || u.wield) : '',
    lv ? 'на высоте ' + lv : '',
    u.down ? 'вне боя' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const painCap = u.down
    ? downTxt(u)
    : onEdge(u)
      ? 'на пороге: любая новая Боль — без сознания'
      : `${pen ? `−${pen} к атакам и умениям` : 'штрафа пока нет'} · ${u.side === 'pc' ? 'до порога' : 'до выбывания'} ${L - pn}`;
  const W = u.wounds || {};
  const zones = AREAS.map(ar => {
    const w = W[ar];
    return `<i class="z ${ar}${w ? ' d' + Math.min(3, w.deg) : ''}${w && w.open ? ' open' : ''}"></i>`;
  }).join('');
  const wl = Object.entries(W).map(([ar, w]: [string, any]) => {
    const wp = woundPenTxt(ar, w.deg);
    return `<span class="wln d${Math.min(3, w.deg)}"><b>${AREA_RU[ar]}</b> — ${WDEG_RU[w.deg]} рана, ${w.open ? 'открыта' : 'закрыта'}${wp ? ' · ' + wp : ''}</span>`;
  });
  const tags = [];
  if (u.bleed) tags.push(`<span class="tag blood">Кровотечение ×${u.bleed}: 1 Боль в начале хода</span>`);
  if (u.torch) tags.push('<span class="tag fire">Факел в руке</span>');
  if (u.prone && !u.down) tags.push('<span class="tag">Сбит с ног</span>');
  let html = `<div class="sh-hd"><div class="gl ${u.side}">${esc(u.glyph)}</div><div><div class="nm">${esc(u.name)}</div><div class="sd">${sub}</div></div>
    <div class="sh-od"><span class="pips" title="${`Очки действий: ${u.od} из ${odMax(u)}. Не потраченные в свой ход — запас реакций до следующего хода`}">${pips}</span></div></div>
    <div class="painbox${onEdge(u) ? ' edge' : ''}${u.down ? ' down' : ''}" title="Каждые 2 Боли — −1 к атакам и способностям. Герой на пределе — «на пороге», дальше без сознания; противник на пределе выбывает"><div class="pbh"><span class="cap">Боль</span><span class="pv"><b>${pn}</b> / ${L}</span></div>${painSegs(u, 'lg')}<div class="pbc">${painCap}</div></div>
    <div class="stats">${['str', 'dex', 'int', 'cha'].map(statBox).join('')}
      <div title="Телосложение: из него считается Стойкость"><b>${conOf(u)}</b><span>Тел.</span></div><div class="der" title="Стойкость = ${RBASE()} + Телосложение. Атака попадает всегда; разница броска со Стойкостью решает степень: +5 — усиленный, +10 — критический"><b>${resist(u)}</b><span>Стойкость</span></div><div title="Прочность брони сейчас / в начале боя. Броня гасит половину текущей прочности (вверх) от каждого удара; колющее усиленным и критическим — на 1 меньше. Прочность стирают крит, дробящее усиленным и Сила 7+ вблизи"><b>${armorTxt(u)}</b><span>Броня</span></div><div title="Гексов за 1 ОД"><b>${speedOf(u)}</b><span>Скорость</span></div></div>
    <div class="bodyrow"><div class="body" aria-hidden="true">${zones}</div><div class="wl">${wl.length ? wl.join('') : '<span class="dim">Ран нет</span>'}${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}</div></div>
    <div class="inv">мастерство: ближний бой <b>${mast(u)}</b> · дальний бой <b>${mast(u, true)}</b> · магия <b>${mastMg(u)}</b></div>
    <div class="inv">${inv.join(' · ')} · ${LIGHT_RU[unitLight(u)]}${u.nv ? ', ночное зрение' : darkPen(u) ? ' (−5 к атакам и защите)' : ''}</div>`;
  if (effs.length) html += `<ul class="effl">${effs.map(e => `<li>${e}</li>`).join('')}</ul>`;
  if (u.disorder && u.will != null && f)
    html += `<div class="dis">${f ? `${DIS_ICON[u.disorder]} ${DIS[u.disorder][f - 1]} (${f === 1 ? 'слабая' : 'сильная'} форма): ${disDesc(u.disorder, f)}` : 'Расстройство подавлено Воодушевлением.'}</div>`;
  const last = (S.log || [])
    .filter(e => e.cls === 'atk' || e.cls === 'ev')
    .slice(-4)
    .reverse();
  if (last.length)
    html += `<div class="mini"><div class="cap">Последнее</div>${last.map(e => `<div class="le ${e.cls}">${e.html}</div>`).join('')}<button type="button" class="lk" id="toLog">Весь журнал</button></div>`;
  html += `<details class="sec" id="dDet" ${open('dDet')}><summary>Расчёт защиты и атаки</summary><dl class="kv">
    ${`<dt>Стойкость</dt><dd><b>${resist(u)}</b> <span class="dim">= ${RBASE()} + Телосложение ${conOf(u)}${hasEff(u, 'weak2') ? ' − Слабость ' + weakMag(u) : ''}; против неё бросают атаку</span></dd><dt>Запас реакций</dt><dd><b>${u.side === S.phase ? '—' : u.od}</b> <span class="dim">не потраченные в свой ход ОД: защита, удар из зоны, подготовка${SET.dexMode === 'dodge' && stat(u, 'dex') >= 7 ? '; плюс одно бесплатное уклонение за раунд' : ''}</span></dd>`}
    <dt>Активная защита</dt><dd>${
      v2DefOptions(
        u,
        u,
        {
          name: '',
          cost: 1,
          kind: 'attack',
          reach: 1,
          wt: 0,
        },
        {},
      )
        .map(o => `${o.name} d20 <b>${sgn(sum(o.mods))}</b>`)
        .join(' · ') + ' <span class="dim">(блок и парирование — минус вес оружия атакующего: 0 / 2 / 4)</span>'
    }</dd>
    ${`<dt>Попадание</dt><dd>${`d20 + мастерство: ближний бой <b>${mast(u)}</b>, дальний <b>${mast(u, true)}</b>, магия <b>${mastMg(u)}</b>`}</dd><dt>Боль удара</dt><dd>по классу оружия и степени: лёгкое 1 / 1 / 2, среднее 1 / 2 / 3, тяжёлое 1 / 2 / 4${painPen(u) ? ` <span class=\"dim\">· сейчас −${painPen(u)} к атакам от Боли</span>` : ''}</dd>`}
    <dt>Скорость</dt><dd><b>${speedOf(u)}</b> <span class="dim">= 3 + 1 за каждые 2 Ловкости сверх 5</span></dd></dl></details>`;
  html += `<details class="sec" id="dGm" ${open('dGm')}><summary>Ведущему: Воля, расстройство, правка</summary>`;
  if (u.will == null) html += `<div class="willrow">Воли нет: эффекты Воли не действуют.</div>`;
  else
    html += `<div class="willrow">Воля <b style="font-family:var(--mono)">${u.will}</b>
    <button type="button" data-w="-5">−5</button><button type="button" data-w="-1">−1</button><button type="button" data-w="1">+1</button><button type="button" data-w="5">+5</button></div>
    <div class="willrow">${disSel}</div>${u.disorder && !f ? '<div class="help">Порог не достигнут: слабая форма с −10, сильная с −20.</div>' : ''}`;
  html += `<div class="willrow"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="torchChk" ${u.torch ? 'checked' : ''}> несёт горящий факел</label></div>`;
  if (!S.editor)
    html += `<div class="gmt"><div class="gml">Вмешаться в бой</div>
      <div class="gmr"><button type="button" data-gm="pain+">Боль +1</button><button type="button" data-gm="pain-">Боль −1</button><select id="gmArea" aria-label="Куда рана">${AREAS.map(a => `<option value="${a}">${AREA_RU[a]}</option>`).join('')}</select><button type="button" data-gm="wound">Рана</button></div>
      <div class="gmr"><button type="button" data-gm="prone">Сбить</button><button type="button" data-gm="unst">Неустойчивость</button><button type="button" data-gm="disor">Дезориентация</button><button type="button" data-gm="bleed">Кровотечение +1</button><button type="button" data-gm="stun">Оглушить</button><button type="button" data-gm="clear">Снять состояния</button></div>
      <div class="gmr"><button type="button" data-gm="move" ${S.gmMove === u.id ? 'aria-pressed="true"' : ''}>${S.gmMove === u.id ? 'Нажмите клетку…' : 'Переставить'}</button><label>следующий d20 <input type="number" class="ni" id="gmD20" min="1" max="20"></label><button type="button" data-gm="d20">Задать</button><span class="dim">${FORCED.length ? 'в очереди: ' + FORCED.join(', ') : ''}</span></div></div>`;
  if (S.editor && !u.down) {
    html += `<div class="edstats">
      ${[
        ['armor', 'Броня'],
        ['shield', 'Щит'],
      ]
        .map(
          ([k, l]) =>
            `<label for="ed_${k}">${l}</label><input type="number" id="ed_${k}" data-k="${k}" value="${k === 'bdef' ? bdefOf(u) : k === 'adr' ? (u.adr == null ? 1 : u.adr) : u[k]}">`,
        )
        .join('')}
      ${['str', 'dex', 'int', 'cha'].map(s => `<label for="ed_${s}">${STAT_RU[s]}</label><input type="number" id="ed_${s}" data-s="${s}" value="${u.base[s]}">`).join('')}
      <label for="ed_side">Сторона</label><select id="ed_side"><option value="pc" ${u.side === 'pc' ? 'selected' : ''}>герои</option><option value="en" ${u.side === 'en' ? 'selected' : ''}>противники</option></select></div>`;
  }
  html += '</details>';
  box.innerHTML = html;
  const tl = $('#toLog');
  if (tl) tl.onclick = () => setTab('log');
  box
    .querySelectorAll('[data-gm]')
    .forEach(b => ((b as HTMLElement).onclick = () => gmAct(u, (b as HTMLElement).dataset.gm)));
  box.querySelectorAll('[data-w]').forEach(
    b =>
      (b.onclick = () => {
        changeWill(u, +b.dataset.w, 'Ведущий');
        render();
      }),
  );
  const ds = $('#disSel');
  if (ds)
    ds.onchange = () => {
      u.disorder = ds.value || null;
      ev(`${uName(u)}: расстройство — ${u.disorder ? DIS[u.disorder].join(' → ') : 'нет'}`);
      render();
    };
  $('#torchChk').onchange = e => {
    u.torch = e.target.checked;
    drawLight(performance.now());
    render();
  };
  box.querySelectorAll('[data-k]').forEach(
    i =>
      (i.onchange = () => {
        u[i.dataset.k] = +i.value;
        if (i.dataset.k === 'armor') u.armorPts = u.armor;
        render();
      }),
  );
  box.querySelectorAll('[data-s]').forEach(
    i =>
      (i.onchange = () => {
        u.base[i.dataset.s] = +i.value;
        render();
      }),
  );
  const sd = $('#ed_side');
  if (sd)
    sd.onchange = () => {
      u.side = sd.value;
      render();
    };
}
/* Вмешательство ведущего прямо в бою. Каждое действие можно отменить. */
export function gmAct(u: Unit, k) {
  if (!S || S.busy) return;
  if (k === 'move') {
    S.gmMove = S.gmMove === u.id ? null : u.id;
    render();
    return;
  }
  if (k === 'd20') {
    const v = Math.round(+$('#gmD20').value);
    if (v >= 1 && v <= 20) {
      FORCED.push(v);
      ev(`🎲 Ведущий: следующий d20 — ${v}`);
    }
    render();
    return;
  }
  remember();
  const who = uName(u);
  if (k === 'pain+') {
    ev(`🎲 Ведущий: ${who} +1 Боль`);
    applyDamage(u, 1, null);
  } else if (k === 'pain-' && !u.down) {
    u.hp = Math.min(u.maxHp, u.hp + 1);
    ev(`🎲 Ведущий: ${who} −1 Боль`);
  } else if (k === 'wound') {
    ev(`🎲 Ведущий: рана ${who}`);
    addWound(u, $('#gmArea').value);
  } else if (k === 'prone') setProne(u, 'ведущий');
  else if (k === 'unst') addSt(u, 'unst', 1, 'ведущий');
  else if (k === 'disor') addSt(u, 'disor', 1, 'ведущий');
  else if (k === 'bleed') {
    u.bleed = (u.bleed || 0) + 1;
    ev(`🎲 Ведущий: ${who} кровотечение +1, стаков ${u.bleed}`);
  } else if (k === 'stun') {
    u.stunned = true;
    ev(`🎲 Ведущий: ${who} оглушён — пропустит ход`);
  } else if (k === 'clear') {
    u.st = {};
    u.prone = false;
    u.bleed = 0;
    u.stunned = false;
    u.effects = [];
    ev(`🎲 Ведущий: с ${who} сняты состояния`);
  }
  render();
}
/* Вкладки правой панели: Боец, Журнал, Сцена. */
export function setTab(t) {
  UI.tab = t;
  saveUI();
  const side = document.querySelector('.side') as HTMLElement;
  if (side) side.dataset.tab = t;
  document
    .querySelectorAll('#stabs [data-tab]')
    .forEach(b => b.setAttribute('aria-selected', String((b as HTMLElement).dataset.tab === t)));
  if (t === 'log') {
    const lg = $('#log');
    lg.scrollTop = lg.scrollHeight;
  }
}
export function initUI2() {
  document
    .querySelectorAll('#stabs [data-tab]')
    .forEach(b => ((b as HTMLElement).onclick = () => setTab((b as HTMLElement).dataset.tab)));
  setTab(UI.tab || 'card');
  const lf = $('#logf'),
    setF = f => {
      UI.logF = f;
      saveUI();
      $('#log').dataset.f = f;
      lf.querySelectorAll('button[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === f)));
    };
  lf.querySelectorAll('button[data-f]').forEach(b => (b.onclick = () => setF(b.dataset.f)));
  setF(UI.logF || 'all');
  $('#log').addEventListener('click', e => {
    const n = e.target.closest('[data-uid]');
    if (!n || !S) return;
    const u = byId(+n.dataset.uid);
    if (u) {
      S.sel = u.id;
      S.act = null;
      render();
    }
  });
  $('#log').addEventListener('mouseover', e => {
    const n = e.target.closest('[data-uid]');
    peek(n ? +n.dataset.uid : null);
  });
  $('#log').addEventListener('mouseleave', () => peek(null));
  $('#card').addEventListener(
    'toggle',
    e => {
      const d = e.target;
      if (d.id && d.tagName === 'DETAILS') {
        UI.det[d.id] = d.open;
        saveUI();
      }
    },
    true,
  );
}
/* Лента событий раунда над полем: удары, «на пороге», выбывшие, падения. Нажатие — подсветить участников и показать бросок. */
const lab = id => {
  const u = byId(id);
  if (!u) return '?';
  const n = (u.name.match(/ (\d+)$/) || [])[1];
  return esc(u.glyph) + (n ? n : '');
};
export function renderRibbon() {
  const box = $('#ribbon');
  if (!box) return;
  const ents = [];
  for (let i = S.log.length - 1; i >= 0 && ents.length < 14; i--) {
    const e = S.log[i];
    if (e.meta && ['atk', 'edge', 'down', 'dead', 'fall'].includes(e.meta.k)) ents.push([i, e]);
  }
  ents.reverse();
  if (!ents.length) {
    box.innerHTML = '<span class="rbe">Здесь появятся удары и события раунда</span>';
    return;
  }
  let html = '',
    lastR = null;
  for (const [i, e] of ents) {
    const m = e.meta;
    if (m.round !== lastR) {
      html += `<span class="rbr">Р${m.round}</span>`;
      lastR = m.round;
    }
    let txt = '',
      cls = '';
    if (m.k === 'atk') {
      const att = byId(m.att);
      cls = (att ? att.side : '') + (m.t === 3 ? ' crit' : '') + (m.t === 0 ? ' miss' : '');
      txt = `${lab(m.att)}<i>→</i>${lab(m.def)} <b>${m.t === 0 ? (m.parried ? 'отбил' : 'мимо') : m.dmg > 0 ? '+' + m.dmg : '0'}</b>${m.t === 3 ? ' крит' : ''}${m.wound ? ' · рана' : ''}`;
    } else if (m.k === 'edge') {
      cls = 'edge';
      txt = `${lab(m.u)} на пороге`;
    } else if (m.k === 'down') {
      const u = byId(m.u);
      cls = 'down';
      txt = `${lab(m.u)} ${u && u.side === 'pc' ? 'без сознания' : 'выбыл'}`;
    } else if (m.k === 'dead') {
      cls = 'down';
      txt = `✝ ${lab(m.u)}`;
    } else if (m.k === 'fall') {
      cls = 'edge';
      txt = `${lab(m.u)} упал <b>+${m.n}</b>`;
    }
    html += `<button type="button" class="rbi ${cls}" data-i="${i}" aria-pressed="${S.rib === i}">${txt}</button>`;
  }
  box.innerHTML = html;
  box.scrollLeft = box.scrollWidth;
  box.querySelectorAll('[data-i]').forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.i;
      S.rib = S.rib === i ? null : i;
      renderRibbon();
      ribPop(S.rib == null ? null : S.log[i], b);
    };
  });
  if (S.rib != null && !S.log[S.rib]) ribPop(null, null);
}
function ribPop(e, btn) {
  const pop = $('#ribpop');
  document.querySelectorAll('#toks .peek').forEach(d => d.classList.remove('peek'));
  if (!e) {
    pop.hidden = true;
    S.rib = null;
    return;
  }
  const m = e.meta;
  for (const id of [m.att, m.def, m.u]) {
    if (id == null) continue;
    const d = $(`#toks [data-id="${id}"]`);
    if (d) d.classList.add('peek');
  }
  pop.innerHTML = `<button type="button" class="x" aria-label="Закрыть">✕</button><div class="le ${e.cls} open">${e.html}</div>`;
  const c = (document.querySelector('.center') as HTMLElement).getBoundingClientRect(),
    r = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(c.width - 340, r.left - c.left)) + 'px';
  pop.style.top = r.bottom - c.top + 6 + 'px';
  pop.hidden = false;
  pop.querySelector('.x').onclick = () => {
    S.rib = null;
    ribPop(null, null);
    renderRibbon();
  };
}

/* Подключаемые куски от других экранов (экспедиция): строка в шапке хода и продолжение в итогах. */
export const HOOKS = {
  badge: null as null | (() => string),
  bannerHtml: null as null | (() => string),
  bannerMount: null as null | (() => void),
};
/* Конец боя: итоги по бойцам, ключевые броски, переиграть с тем же зерном. */
export function renderBanner() {
  const b = $('#banner');
  if (!S.over || S.editor) {
    b.hidden = true;
    return;
  }
  b.hidden = false;
  if (b.dataset.over !== S.over + S.round) {
    b.dataset.over = S.over + S.round;
    b.dataset.closed = '';
    sfx(S.over === 'pc' ? 'win' : 'lose');
    const T = S.tally || {};
    const Z = { dealt: 0, taken: 0, atks: 0, hits: 0, crits: 0 };
    const row = (u: Unit) => {
      const t = T[u.id] || Z,
        st = u.down ? downTxt(u) : onEdge(u) ? 'на пороге' : 'на ногах',
        wn = Object.keys(u.wounds || {}).length;
      return `<tr><td><span class="nm ${u.side}">${esc(u.name)}</span></td><td>${t.dealt}</td><td>${t.taken}</td><td>${t.hits}/${t.atks}</td><td>${t.crits}</td><td>${wn}</td><td class="${u.down ? 'dim' : ''}">${st}</td></tr>`;
    };
    const units = [...S.units].sort((x, y) => (x.side === y.side ? 0 : x.side === 'pc' ? -1 : 1));
    const DG = ['промах', 'обычный', 'усиленный', 'крит'];
    const km = (S.keyRolls || [])
      .slice(0, 4)
      .map(m => {
        const a = byId(m.att),
          d = byId(m.def);
        return `<li><span class="dim">Р${m.round}</span> ${a ? `<span class="nm ${a.side}">${esc(a.name)}</span>` : '?'} → ${d ? `<span class="nm ${d.side}">${esc(d.name)}</span>` : '?'}: ${DG[m.t]}, <b>+${m.dmg} Боли</b>${m.wound ? ', рана' : ''} <span class="dim">(${m.total} против ${m.vs})</span></li>`;
      })
      .join('');
    b.innerHTML = `<div class="bx sum"><h2>${S.over === 'pc' ? 'Победа героев' : S.over === 'en' ? 'Герои пали' : 'Ничья'}</h2><p class="dim">Раунд ${S.round} · зерно боя ${S.seed || '—'}</p>
      <div class="sumw"><table class="sumt"><tr><th>Боец</th><th>Нанёс Боли</th><th>Получил</th><th>Попадания</th><th>Криты</th><th>Раны</th><th>Итог</th></tr>${units.map(row).join('')}</table></div>
      ${km ? `<h3>Ключевые броски</h3><ul class="km">${km}</ul>` : ''}
      ${HOOKS.bannerHtml ? HOOKS.bannerHtml() : ''}
      <div class="bbtn"><button type="button" class="primary" id="bnSame" title="Те же кубики: если повторить те же действия, бой пойдёт так же">Переиграть с тем же зерном</button><button type="button" id="bnAgain">Новый бой</button><button type="button" id="bnClose">Осмотреть поле</button></div></div>`;
    if (HOOKS.bannerMount) HOOKS.bannerMount();
    $('#bnSame').onclick = () => restart(true);
    $('#bnAgain').onclick = () => restart();
    $('#bnClose').onclick = () => {
      b.hidden = true;
      b.dataset.closed = '1';
    };
  }
  if (b.dataset.closed === '1') b.hidden = true;
}
export function render() {
  if (!S || S.sim) return;
  renderTokens();
  renderHL();
  renderTurn();
  renderCard();
  renderActs();
  renderRoster();
  renderRibbon();
  renderBanner();
}

/* Телефон: карточка бойца — лист поверх поля (кнопка в панели или долгое нажатие на фишку). */
export function openCardSheet(id?) {
  if (id != null) S.sel = id;
  document.body.classList.add('sheet-open');
  setTab('card');
  view.render();
}
export function closeCardSheet() {
  document.body.classList.remove('sheet-open');
}
