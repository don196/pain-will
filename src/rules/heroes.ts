/* Механики героев 1-го этажа: Рагна (Берсерк, парные мечи, обезоруживание, прорыв),
   Лазарь (Литургия, Стигматы, Чудо «Искупление»), Бернхард (Личный пример, Выпад, Финт, Дуэльная стойка). */
import type { Action, Area, Opts, Unit } from '../types';
import { A } from '../data/actions';
import { T, tplOf } from '../data/fighters';
import { AREA_RU, ST_RU, WDEG_RU, WNAME } from '../data/labels';
import { isHuman, walk, weaponsOf } from './actions';
import { resolveAttack } from './attack';
import { addSt, partSt, stOf, tplFlag } from './combat';
import { applyDamage } from './damage';
import { distrustOk, WILL_MAX, willEvent } from './disorders';
import { adjOk, bfs, cellsOf, footFree, isFloor, los, near1, pathTo, unitAt } from './geometry';
import { immobile, lassoPart } from './lasso';
import { hiddenFrom, unitLight } from './light';
import { ev, log, uName } from './log';
import { takeVuln } from './magic';
import { composure, isBerserk, onEdge, painOf, painPen } from './pain';
import { missThr, nat1Side } from './reactions';
import { actId, getEff, hasEff, modsStr, removeEff, speedOf, stat } from './stats';
import { addWound, openWounds, syncBleed, vital } from './wounds';
import { SET } from '../settings';
import { S, byId, hostiles } from '../state';
import { cheb, d20, esc, hcube, hd, key, nbrDirs, pick, sgn, sum, sz, unkey } from '../util';
import { view } from '../view';

export { isBerserk };

/* ==================== Руки и обезоруживание (Рагна + общее) ==================== */

export function armDisabled(u: Unit, arm: 'armR' | 'armL'): boolean {
  return partSt(u, arm) >= 3 || lassoPart(u) === arm || u.grabbedArm === arm;
}

export function workingArms(u: Unit): ('armR' | 'armL')[] {
  const out: ('armR' | 'armL')[] = [];
  if (!armDisabled(u, 'armR')) out.push('armR');
  if (!armDisabled(u, 'armL')) out.push('armL');
  return out;
}

export const hasWorkingArm = (u: Unit) => workingArms(u).length > 0;
export const hasBothArms = (u: Unit) => workingArms(u).length === 2;

/* Штраф от ран рук: 3 стака (ампутация/нерабочая) блокируются проверкой доступности;
   в Берсерке 1–2 стака игнорируются; при выборе лучшей руки берётся наименее раненая. */
export function armWoundPen(u: Unit, opt: { twoArms?: boolean; eitherArm?: boolean } = {}): number {
  const eff = (arm: 'armR' | 'armL') => {
    const s = partSt(u, arm);
    if (s >= 3) return 3;
    return isBerserk(u) ? 0 : s;
  };
  if (opt.twoArms) {
    const s = Math.max(eff('armR'), eff('armL'));
    return s < 3 ? 2 * s : 0;
  }
  if (opt.eitherArm || tplFlag(u, 'dualWield')) {
    const arms = workingArms(u);
    if (!arms.length) return 0;
    const s = Math.min(...arms.map(eff));
    return s < 3 ? 2 * s : 0;
  }
  const s = eff('armR');
  return s < 3 ? 2 * s : 0;
}

/* Может ли цель быть обезоружена (имеет оружие в руках). */
export function disarmableWeaponName(u: Unit): string | null {
  if (!u || u.disarmed) return null;
  const wIds = (u.acts || []).filter(id => {
    const a = A[id];
    return a && a.kind === 'attack' && !a.magic && !a.unarmed && a.fixed == null && !a.lasso;
  });
  if (!wIds.length) return null;
  if (u.wield && WNAME[u.wield]) return WNAME[u.wield];
  return A[wIds[0]].name.toLowerCase();
}

/* Выбить оружие на случайный соседний свободный гекс (если все заняты — под ноги цели). */
export function disarmTarget(att: Unit, def: Unit): boolean {
  const wName = disarmableWeaponName(def);
  if (!wName) return false;
  S.dropped = S.dropped || [];
  const adj = nbrDirs(def.x, def.y)
    .map(([dx, dy]) => ({ x: def.x + dx, y: def.y + dy }))
    .filter(c => isFloor(c.x, c.y) && !unitAt(c.x, c.y) && adjOk(def, c));
  const spot = adj.length ? pick(adj) : { x: def.x, y: def.y };
  S.dropped.push({ x: spot.x, y: spot.y, owner: def.id, name: wName });
  if (tplFlag(def, 'dualWield') && !(def.droppedSwords > 0)) {
    def.droppedSwords = 1;
    ev(`⚔ Обезоруживание: ${uName(att)} выбивает один ${esc(wName)} у ${uName(def)} (падает рядом; парные приёмы недоступны до подбора)`);
  } else {
    def.disarmed = true;
    if (tplFlag(def, 'dualWield')) def.droppedSwords = (def.droppedSwords || 0) + 1;
    ev(`⚔ Обезоруживание: ${uName(att)} выбивает оружие (${esc(wName)}) у ${uName(def)} — падает рядом, подобрать за 1 ОД`);
  }
  view.fxText(def, 'обезоружен', 'info');
  view.drawFloor();
  return true;
}

export function droppedFor(u: Unit) {
  return (S.dropped || []).filter((d: any) => d.owner === u.id);
}

export function canPickupWeapon(u: Unit): boolean {
  if (!u || u.down || !hasWorkingArm(u)) return false;
  return droppedFor(u).some((d: any) => {
    const dist = cheb(u, d);
    return dist === 0 || (dist === 1 && adjOk(u, d));
  });
}

export function doPickupWeapon(u: Unit): boolean {
  const item = droppedFor(u).find((d: any) => {
    const dist = cheb(u, d);
    return dist === 0 || (dist === 1 && adjOk(u, d));
  });
  if (!item) return false;
  S.dropped = (S.dropped || []).filter((d: any) => d !== item);
  if (tplFlag(u, 'dualWield') && u.droppedSwords > 0) {
    u.droppedSwords = Math.max(0, u.droppedSwords - 1);
    if (u.droppedSwords < 2) u.disarmed = false;
  } else {
    u.disarmed = false;
  }
  ev(`🗡 ${uName(u)} подбирает своё оружие (${esc(item.name)})`);
  view.drawFloor();
  return true;
}

/* ==================== Рагна: Встречный прорыв и Кровавый надрез ==================== */

export function chargeLandingCell(u: Unit, t: Unit, from?: { x: number; y: number }) {
  if (!t || t.down || t.side === u.side) return null;
  const f = from || u;
  const sp = speedOf(u);
  const d0 = cheb(f, t);
  if (d0 < 2 || d0 > sp) return null;
  if (hiddenFrom(u, t, f)) return null;
  if (!los(f, t, u, { noUnits: true }).ok) return null;
  const dist = bfs(from ? Object.assign({}, u, { x: f.x, y: f.y }) : u, { max: sp });
  let best: { x: number; y: number; d: number; dist: Map<string, any> } | null = null;
  for (const [k, v] of dist) {
    if (!v.d || v.d > sp) continue;
    const [x, y] = unkey(k);
    const pos = { x, y, size: sz(u) };
    if (cheb(pos, t) === 1 && adjOk(pos, t)) {
      if (!best || v.d < best.d) best = { x, y, d: v.d, dist };
    }
  }
  return best;
}

export function canRagnaCharge(u: Unit, t: Unit, from?: { x: number; y: number }): boolean {
  return !!chargeLandingCell(u, t, from);
}

export async function doRagnaCharge(u: Unit, t: Unit) {
  const land = chargeLandingCell(u, t);
  if (!land) return;
  const path = pathTo(land.dist, land.x, land.y);
  ev(`⚡ Встречный прорыв: ${uName(u)} бросается к ${uName(t)} (${path.length} гекс.) — удары из зоны контроля не остановят её`);
  await walk(u, path, { charge: true });
  if (u.down || S.over) return;
  if (!t.down && near1(u, t) && hasWorkingArm(u) && !u.disarmed) {
    const strike = Object.assign(Object.create(A.ragnaSword), {
      name: 'Встречный прорыв (меч)',
      complex: true,
    });
    await resolveAttack(u, strike, t, {});
  }
}

export function doRagnaCut(u: Unit) {
  ev(`🩸 Кровавый надрез: ${uName(u)} режет себя — 1 Боль сквозь броню (без раны), +2 к следующей атаке в этот ход`);
  applyDamage(u, 1, null);
  if (u.down) return;
  removeEff(u, 'bloodCut');
  u.effects.push({
    type: 'bloodCut',
    left: 1,
    thisTurn: true,
    end: S.round,
  });
  if (isBerserk(u)) ev(`🔥 ${uName(u)} впадает в <b>Берсерка</b> (Боль ${painOf(u)})!`);
  view.fxText(u, '+2 атака', 'info');
}

/* ==================== Лазарь: Литургия, Стигматы, Чудо «Искупление» ==================== */

export const LITURGY_RU: Record<string, string> = {
  wrath: 'Гнев',
  mercy: 'Милость',
  faith: 'Вера',
};

const STIGMA_AREAS: Area[] = ['armL', 'armR', 'legL', 'legR', 'torso'];

export function stigmataOf(u: Unit): number {
  if (!u || !u.wounds) return 0;
  let total = 0;
  for (const ar of STIGMA_AREAS) {
    const w: any = u.wounds[ar];
    if (!w || !w.stigma) continue;
    /* Обычная рана даёт Стигмат пока открыта; серьёзная/тяжёлая — держится до полного заживления даже после бинта */
    if (w.deg >= 2 || w.open) total += typeof w.stigma === 'number' ? w.stigma : 1;
  }
  return Math.min(3, total);
}

/* Общие модификаторы для голосовой проверки Лазаря (Харизма + эффекты). */
function lazarVoiceMods(u: Unit, a: Action, extraStigma = 0) {
  const mods: { l: string; v: number }[] = [{ l: 'Харизма', v: stat(u, 'cha') }];
  if (extraStigma) mods.push({ l: 'Стигматы', v: extraStigma });
  if (stOf(u, 'cough') && !hasEff(u, 'mute')) mods.push({ l: 'Кашель', v: -2 * stOf(u, 'cough') });
  if (a.complex && stOf(u, 'disor')) mods.push({ l: 'Дезориентация', v: -2 * stOf(u, 'disor') });
  const pp = painPen(u);
  if (pp) mods.push({ l: 'Боль', v: -pp });
  return mods;
}

export async function doLazarWord(u: Unit, t: Unit, a: Action) {
  const word = a.word as 'wrath' | 'mercy' | 'faith';
  if (word === 'wrath') {
    const mods = lazarVoiceMods(u, a);
    const M = sum(mods);
    const dc = composure(t);
    const th = missThr(u, a, t);
    const r = d20();
    const n1 = SET.natRolls && r === 1;
    const tot = r + M + (SET.natRolls && r === 20 ? 5 : 0);
    const miss = n1 || (th.v > 0 && r <= th.v);
    const ok = !miss && tot >= dc;
    const diff = tot - dc;
    log(
      `<div class="lh">${uName(u)} → ${uName(t)} · ${esc(a.name)}</div>` +
        `<div class="lr">d20 <b>${r}</b>${modsStr(mods)} = <b>${tot}</b> против Самообладания <b>${dc}</b>${th.v ? ` · порог ${th.v}` : ''}</div>` +
        `<div class="lo"><span class="chip ${ok ? 'ok' : 'fail'}">${n1 ? 'натуральная 1 — промах' : ok ? `разница ${sgn(diff)} · Неустойчивость` : 'сопротивление'}</span></div>`,
      'atk',
    );
    view.fxLine(u, t, 'fire');
    if (n1) nat1Side(u, a);
    if (ok && !t.down) {
      const dbl = takeVuln(t) ? 2 : 1;
      addSt(t, 'unst', 1 * dbl, 'Слово «Гнев»');
    }
  } else if (word === 'mercy') {
    if (await distrustOk(u, t, 'Слово «Милость»')) {
      const weakKeys = (Object.keys(ST_RU) as string[]).filter(k => stOf(t, k) > 0);
      const canStopBleed = t.bleed > 0 && !hasEff(t, 'bleedStop');
      let choice: string | null = null;
      if (weakKeys.length && canStopBleed) {
        if (isHuman(u.side)) {
          const opts = [
            { v: 'bleed', label: 'Остановить кровотечение на этот раунд', sub: `тяжесть ${t.bleed}` },
            ...weakKeys.map(k => ({ v: 'st:' + k, label: `Снять 1 стак: ${ST_RU[k]}`, sub: `сейчас ${stOf(t, k)}` })),
          ];
          choice = (await view.askChoice('Слово «Милость»', `<p>Как помочь ${t === u ? 'себе' : uName(t)}?</p>`, opts)) || opts[0].v;
        } else {
          choice = t.bleed >= 2 ? 'bleed' : 'st:' + weakKeys[0];
        }
      } else if (canStopBleed) {
        choice = 'bleed';
      } else if (weakKeys.length) {
        if (weakKeys.length > 1 && isHuman(u.side)) {
          const opts = weakKeys.map(k => ({ v: 'st:' + k, label: `Снять 1 стак: ${ST_RU[k]}`, sub: `сейчас ${stOf(t, k)}` }));
          choice = (await view.askChoice('Слово «Милость»', `<p>Какое состояние ослабить у ${t === u ? 'себя' : uName(t)}?</p>`, opts)) || opts[0].v;
        } else {
          const prio = ['unst', 'disor', 'heat', 'cough', 'ripple'];
          choice = 'st:' + (prio.find(k => weakKeys.includes(k)) || weakKeys[0]);
        }
      }
      if (choice === 'bleed') {
        removeEff(t, 'bleedStop');
        t.effects.push({ type: 'bleedStop', by: u.id, end: S.round });
        ev(`🕊 Слово «Милость»: ${uName(u)} останавливает кровотечение ${t === u ? 'себе' : uName(t)} на этот раунд`);
        view.fxText(t, 'милость', 'heal');
      } else if (choice && choice.startsWith('st:')) {
        const k = choice.slice(3);
        t.st[k] = Math.max(0, (t.st[k] || 0) - 1);
        ev(`🕊 Слово «Милость»: ${uName(u)} снимает 1 стак «${ST_RU[k]}» с ${t === u ? 'себя' : uName(t)}`);
        view.fxText(t, 'милость', 'heal');
      } else {
        ev(`🕊 Слово «Милость»: ${uName(u)} произносит слово над ${t === u ? 'собой' : uName(t)} (состояний и кровотечения нет)`);
      }
    }
  } else if (word === 'faith') {
    if (await distrustOk(u, t, 'Слово «Вера»')) {
      removeEff(t, 'lazarFaith');
      t.effects.push({
        type: 'lazarFaith',
        by: u.id,
        until: u.id,
        mag: 2,
        end: 1e9,
      });
      ev(`✝ Слово «Вера»: ${t === u ? uName(u) : uName(t)} получает <b>+2 к активной защите</b> до следующего хода ${uName(u)}`);
      view.fxText(t, '+2 защита', 'heal');
    }
  }

  /* Литургия: добавляем знак в ряд из последних 3 слов */
  if (!u.down) {
    await pushLiturgy(u, word);
  }
}

export async function pushLiturgy(u: Unit, word: 'wrath' | 'mercy' | 'faith') {
  u.liturgy = Array.isArray(u.liturgy) ? u.liturgy.slice() : [];
  u.liturgy.push(word);
  if (u.liturgy.length > 3) u.liturgy.shift();
  ev(`🕯 Литургия ${uName(u)}: [${u.liturgy.map(w => LITURGY_RU[w]).join(' · ')}]`);
  if (u.liturgy.length === 3 && new Set(u.liturgy).size === 3) {
    u.liturgy = [];
    await doRedemption(u);
  }
}

export function redemptionClosableWounds(lazar: Unit, ally: Unit, stig: number) {
  const maxDeg = stig >= 2 ? 2 : 1;
  return openWounds(ally).filter(([, w]: [Area, any]) => w.deg <= maxDeg && !(ally === lazar && w.stigma));
}

export function redemptionWillEligible(ally: Unit): boolean {
  if (!ally || ally.dead || ally.will == null || ally.will >= WILL_MAX) return false;
  return !(S.willSeen && S.willSeen[ally.id + ':redemption'] != null);
}

export async function doRedemption(u: Unit) {
  if (u.down || hasEff(u, 'mute') || S.over) return;
  const stig = stigmataOf(u);
  if (S.stat) {
    const m = S.stat.skillEvents || (S.stat.skillEvents = {});
    m.lazarRedemption = (m.lazarRedemption || 0) + 1;
  }
  ev(`✨ <b>Чудо «Искупление»</b> (0 ОД, Стигматы ${stig}): ряд Литургии замкнулся!`);
  view.fxText(u, 'Искупление!', 'heal');

  /* 1. Выбор видимого врага в 3 гексах */
  const foes = hostiles(u)
    .filter(e => cheb(u, e) <= 3 && !hiddenFrom(u, e) && los(u, e, u, { noUnits: true }).ok)
    .sort((a, b) => a.hp - b.hp || cheb(u, a) - cheb(u, b));
  if (foes.length) {
    let foe = foes[0];
    if (isHuman(u.side) && foes.length > 1) {
      const v = await view.askChoice(
        'Чудо «Искупление»: враг',
        `<p>Выберите видимого врага в 3 гексах (d20 + Харизма + Стигматы ${stig} против Самообладания → ${stig >= 2 ? 2 : 1} Боль сквозь броню):</p>`,
        foes.map(o => ({
          v: o.id,
          label: esc(o.name),
          sub: `Боль ${painOf(o)}/${o.maxHp}, Самообладание ${composure(o)}`,
        })),
      );
      foe = byId(v) || foe;
    }
    const fakeAct: Action = { name: 'Чудо «Искупление»', cost: 0, kind: 'lazarWord', cast: 'voice', speech: true };
    const mods = lazarVoiceMods(u, fakeAct, stig);
    const M = sum(mods);
    const dc = composure(foe);
    const r = d20();
    const n1 = SET.natRolls && r === 1;
    const tot = r + M + (SET.natRolls && r === 20 ? 5 : 0);
    const ok = !n1 && tot >= dc;
    const baseDmg = stig >= 2 ? 2 : 1;
    log(
      `<div class="lh">${uName(u)} → ${uName(foe)} · Чудо «Искупление»</div>` +
        `<div class="lr">d20 <b>${r}</b>${modsStr(mods)} = <b>${tot}</b> против Самообладания <b>${dc}</b></div>` +
        `<div class="lo"><span class="chip ${ok ? 'crit' : 'fail'}">${n1 ? 'натуральная 1 — промах' : ok ? `+${baseDmg} Боли сквозь броню` : 'сопротивление'}</span></div>`,
      'atk',
    );
    view.fxLine(u, foe, 'fire');
    if (ok && !foe.down) {
      const dmg = baseDmg * (takeVuln(foe) ? 2 : 1);
      applyDamage(foe, dmg, u);
    }
  }
  if (S.over) return;

  /* 2. Выбор союзника (включая себя и лежащих без сознания) в 3 гексах */
  const allies = S.units
    .filter(o => o.side === u.side && !o.dead && (!o.down || o.ko) && cheb(u, o) <= 3)
    .sort((a, b) => {
      const wa = redemptionClosableWounds(u, a, stig).length;
      const wb = redemptionClosableWounds(u, b, stig).length;
      if (wb !== wa) return wb - wa;
      const wla = redemptionWillEligible(a) ? 1 : 0;
      const wlb = redemptionWillEligible(b) ? 1 : 0;
      if (wlb !== wla) return wlb - wla;
      return (a.will ?? 99) - (b.will ?? 99);
    });
  if (!allies.length) return;
  let ally = allies[0];
  if (isHuman(u.side) && allies.length > 1) {
    const v = await view.askChoice(
      'Чудо «Искупление»: союзник',
      `<p>Кому из союзников в 3 гексах даровать исцеление (закрыть рану${stig >= 2 ? ' до серьёзной' : ' обычную'} или +1 Воля раз за бой)?</p>`,
      allies.map(o => {
        const cw = redemptionClosableWounds(u, o, stig);
        const canW = redemptionWillEligible(o);
        return {
          v: o.id,
          label: o === u ? `${esc(o.name)} (сам)` : esc(o.name),
          sub: `${cw.length ? `закрыть ран: ${cw.length}` : 'нет подходящих открытых ран'}${canW ? ` · Воля ${o.will}→${o.will + 1}` : ''}`,
        };
      }),
    );
    ally = byId(v) || ally;
  }
  if (!(await distrustOk(u, ally, 'Чудо «Искупление»'))) return;
  const cw = redemptionClosableWounds(u, ally, stig).sort((a, b) => b[1].deg - a[1].deg);
  const canWill = redemptionWillEligible(ally);
  let pickMode = cw.length ? 'w:' + cw[0][0] : canWill ? 'will' : '';
  if (isHuman(u.side) && (cw.length > 1 || (cw.length && canWill))) {
    const opts = [
      ...cw.map(([ar, w]) => ({ v: 'w:' + ar, label: `Закрыть рану: ${AREA_RU[ar]}`, sub: WDEG_RU[w.deg] })),
      ...(canWill ? [{ v: 'will', label: '+1 к Воле (раз за бой)', sub: `сейчас ${ally.will}/${WILL_MAX}` }] : []),
    ];
    pickMode = (await view.askChoice('Чудо «Искупление»', `<p>Выберите эффект для ${ally === u ? 'себя' : uName(ally)}:</p>`, opts)) || pickMode;
  }
  if (pickMode.startsWith('w:')) {
    const ar = pickMode.slice(2) as Area;
    const w = ally.wounds[ar];
    if (w) {
      w.open = false;
      syncBleed(ally);
      ev(`✨ Искупление: у ${ally === u ? uName(u) : uName(ally)} закрывается рана — ${AREA_RU[ar]} (${WDEG_RU[w.deg]})`);
      view.fxText(ally, 'рана закрыта', 'heal');
    }
  } else if (pickMode === 'will' && canWill) {
    willEvent(ally, 1, 'Чудо «Искупление»', 'redemption');
    view.fxText(ally, '+1 Воля', 'heal');
  } else {
    ev(`<span class="dim">Искупление: у ${esc(ally.name)} нет подходящих ран и бонус Воли уже получен</span>`);
  }
}

export function mortifyAreas(u: Unit): Area[] {
  return STIGMA_AREAS.filter(ar => {
    const w = u.wounds && u.wounds[ar];
    if (w && w.deg >= 4 && !vital(ar)) return false;
    return true;
  });
}

export async function doLazarMortify(u: Unit) {
  const areas = mortifyAreas(u);
  if (!areas.length) return;
  let ar: Area = areas[0];
  if (isHuman(u.side)) {
    const opts = areas.map(a => {
      const w: any = u.wounds && u.wounds[a];
      const warn = a === 'torso' && w && w.open && w.deg >= 3 ? ' · ОПАСНО: 4-я рана смертельна!' : '';
      return {
        v: a,
        label: AREA_RU[a],
        sub: w ? `${WDEG_RU[w.deg]}, ${w.open ? 'открыта → степень вырастет' : 'закрыта'}${warn}` : 'чистая часть тела',
      };
    });
    ar = ((await view.askChoice('Умерщвление плоти', '<p>В какую часть тела нанести рану-стигмат? (1 Боль сквозь броню, +1 Стигмат)</p>', opts)) as Area) || ar;
  } else {
    /* ИИ избегает смертельной раны корпуса; предпочитает левую руку/ноги/корпус без раны */
    const safe = areas.filter(a => !(a === 'torso' && u.wounds?.torso?.open && u.wounds.torso.deg >= 3));
    const pref: Area[] = ['armL', 'legL', 'legR', 'torso', 'armR'];
    ar = pref.find(a => safe.includes(a) && !(u.wounds && u.wounds[a])) || pref.find(a => safe.includes(a)) || safe[0] || areas[0];
  }
  ev(`🩸 Умерщвление плоти: ${uName(u)} истязает себя (${AREA_RU[ar]}) — 1 Боль сквозь броню и Стигмат`);
  applyDamage(u, 1, null);
  if (u.down) return;
  addWound(u, ar);
  if (u.wounds[ar]) {
    const w: any = u.wounds[ar];
    w.stigma = Math.min(3, (w.stigma || 0) + 1);
    ev(`✝ ${uName(u)}: Стигматов теперь <b>${stigmataOf(u)}</b>/3`);
  }
}

/* ==================== Бернхард: Личный пример, Выпад, Дуэльная стойка ==================== */

export function canSeeExample(viewer: Unit, bernhard: Unit): boolean {
  if (!viewer || !bernhard || viewer.down || bernhard.down) return false;
  if (viewer.id === bernhard.id) return true;
  if (hasEff(viewer, 'blind2')) return false;
  if (SET.darkRules && unitLight(bernhard) === 0 && !viewer.nv && !hasEff(viewer, 'magsight')) return false;
  return los(viewer, bernhard, viewer, { noUnits: true, light: true }).ok;
}

export function exampleBonus(u: Unit): number {
  if (!S || !S.units || !u || u.down) return 0;
  let best = 0;
  for (const b of S.units) {
    if (b.down || b.side !== u.side || b.prone || onEdge(b)) continue;
    const e = getEff(b, 'example');
    if (!e || !(e.mag > best)) continue;
    if (canSeeExample(u, b)) best = e.mag;
  }
  return best;
}

export function triggerExample(att: Unit, act: Action, deg: { t: number }, opt: Opts = {}) {
  if (!att || att.down || att.prone || onEdge(att) || !tplFlag(att, 'personalExample')) return;
  const isMelee = (act.kind === 'attack' || act.kind === 'pair') && !act.ranged && !act.magic;
  if (!isMelee) return;
  let mag = 0;
  if (deg.t === 3) mag = 2;
  else if (deg.t === 2 || (opt.counter && deg.t >= 1)) mag = 1;
  if (!mag) return;
  const cur = getEff(att, 'example');
  const nextMag = cur ? Math.max(cur.mag || 0, mag) : mag;
  removeEff(att, 'example');
  att.effects.push({
    type: 'example',
    mag: nextMag,
    by: att.id,
    until: att.id,
    end: 1e9,
  });
  ev(`⭐ Личный пример (${uName(att)}): все видящие его на свету союзники получают <b>+${nextMag} к атакам и активной защите</b> до начала его следующего хода`);
  view.fxText(att, `Пример +${nextMag}`, 'heal');
}

export function breakExample(u: Unit, why: string) {
  if (!u || !hasEff(u, 'example')) return;
  removeEff(u, 'example');
  ev(`⭐ Личный пример ${uName(u)} сорван (${esc(why)})`);
}

export function duelTargetId(u: Unit): number | null {
  const e = u && getEff(u, 'duelStance');
  return e ? e.tgt : null;
}

export function isDuelVs(def: Unit, att: Unit): boolean {
  if (!def || !att) return false;
  return duelTargetId(def) === att.id;
}

/* Выпад: враг ровно в 2 гексах по прямой, промежуточный гекс свободен и проходим. */
export function lungeMidCell(u: Unit, t: Unit, from?: { x: number; y: number }): { x: number; y: number } | null {
  if (!t || t.down || t.side === u.side) return null;
  const f = from || u;
  if (hiddenFrom(u, t, f)) return null;
  const A0 = hcube(f.x, f.y);
  for (const tc of cellsOf(t)) {
    if (hd(f.x, f.y, tc.x, tc.y) !== 2) continue;
    const B0 = hcube(tc.x, tc.y);
    const dq = B0[0] - A0[0],
      dr = B0[1] - A0[1],
      ds = B0[2] - A0[2];
    if (dq !== 0 && dr !== 0 && ds !== 0) continue;
    const mq = (A0[0] + B0[0]) / 2,
      mr = (A0[1] + B0[1]) / 2;
    const mx = mq + (mr - (mr & 1)) / 2,
      my = mr;
    const mid = { x: mx, y: my, size: sz(u) };
    if (footFree(u, mx, my) && adjOk(f, mid) && adjOk(mid, t)) return { x: mx, y: my };
  }
  return null;
}

export function canBernhardLunge(u: Unit, t: Unit, from?: { x: number; y: number }): boolean {
  return !!lungeMidCell(u, t, from);
}

export async function doBernhardLunge(u: Unit, t: Unit) {
  const mid = lungeMidCell(u, t);
  if (!mid) return;
  ev(`🤺 Выпад: ${uName(u)} делает шаг вплотную к ${uName(t)} (без удара из зоны контроля) и бьёт рапирой`);
  await walk(u, [[mid.x, mid.y]], { noZoc: true });
  if (u.down || S.over || u.prone || t.down || !near1(u, t)) return;
  const strike = Object.assign(Object.create(A.bernhardRapier), {
    name: 'Выпад (рапира)',
    complex: true,
  });
  await resolveAttack(u, strike, t, {});
}

export function doBernhardDuel(u: Unit, t: Unit) {
  removeEff(u, 'duelStance');
  u.effects.push({
    type: 'duelStance',
    tgt: t.id,
    by: u.id,
    until: u.id,
    end: 1e9,
  });
  ev(`🤺 Дуэльная стойка: ${uName(u)} вызывает ${uName(t)} — до следующего хода рапира без штрафа веса при парировании, контратака с перевеса 1+`);
  view.fxText(u, 'Дуэль', 'info');
}

/* Вспомогательная проверка: есть ли оружие для оружейного действия, учитывая обезоруживание */
const WEAPON_KINDS = new Set(['attack', 'pair', 'prisonCircle', 'ragnaCharge', 'ragnaCut', 'bernhardLunge', 'bernhardDuel']);
export function hasWeaponAvailable(u: Unit, a: Action): boolean {
  if (!a || !WEAPON_KINDS.has(a.kind) || a.magic || a.unarmed || a.fixed != null || a.lasso) return true;
  if (u.disarmed) return false;
  if (a.twoArms && (u.droppedSwords || 0) > 0) return false;
  return true;
}

/* Неиспользуемые импорты проверяются tsc; оставим чистый экспорт утилит */
export const _heroMeta = { T, tplOf, weaponsOf, actId, immobile, key };
