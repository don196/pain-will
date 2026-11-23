import { coverBetween } from './terrain';
import type { Action, Unit } from '../types';
import { tplOf } from '../data/fighters';
import { canTarget, isHuman } from './actions';
import { stOf } from './combat';
import { near1 } from './geometry';
import { darkPen } from './light';
import { ev, uName } from './log';
import { weakMag } from './magic';
import { hasEff, stat } from './stats';
import { SET } from '../settings';
import { S } from '../state';
import { cheb, esc, sz } from '../util';
import { view } from '../view';

/* Проклятия Ведьмы: Уязвимость против базовой защиты + Интуиции цели (как атака: ничья — провал), Затуманенный разум — проверка против сложности. */
/* Проклятия и «метки»: d20 + характеристика против сложности или против базовой защиты + Интуиции цели (vs:'def', ничья — провал). */
/* --- Монах --- */
/* Голос по площади (Псалом, Глас, Песенка): проверка Харизмы против сложности, действует сквозь стены. */
/* --- Странник --- */
/* --- Разбойница --- */
/* --- Рыцарь (Харизма) --- */
export function adLeft(d) {
  return (d.od || 0) + (dexFree(d) ? 1 : 0);
}
export function canActiveDefend(d) {
  return !d.down && true && !d.stunned && adLeft(d) > 0;
}

/* Неистраченные в свой ход ОД — запас реакций до начала своего следующего хода. Попадание всегда, бросок решает только степень. */
export const RBASE = () => (SET.rbase == null ? 8 : SET.rbase);
export const RANGE_OPT = 6;
export function conOf(u: Unit) {
  const b = u.base && u.base.con;
  if (b != null) return b;
  const t = tplOf(u);
  return t.con == null ? 4 : t.con;
}
export function resist(u: Unit) {
  return RBASE() + conOf(u) - weakMag(u);
}
export function odMax(u: Unit) {
  const t = tplOf(u);
  return (t.od || 3) + (SET.dexMode === 'od' && stat(u, 'dex') >= 7 ? 1 : 0);
}
export function dexFree(u: Unit) {
  return SET.dexMode === 'dodge' && stat(u, 'dex') >= 7 && !u.fdUsed;
}
export function spendReact(d, mode) {
  if (mode === 'dodge' && dexFree(d)) {
    d.fdUsed = true;
    return;
  }
  d.od = Math.max(0, (d.od || 0) - 1);
}
export const openT = t => (t.od || 0) <= 0 && !dexFree(t);
export function ap3Degree(diff) {
  return diff >= 10
    ? {
        t: 3,
        txt: 'критический успех',
        c: 'crit',
      }
    : diff >= 5
      ? {
          t: 2,
          txt: 'усиленный успех',
          c: 'enh',
        }
      : {
          t: 1,
          txt: 'обычный успех',
          c: 'ok',
        };
}

/* Внеочередная атака и толчок щитом стоят очко реакции: решает игрок, у ИИ — по паттерну. */
export async function reactWants(e, u: Unit, what) {
  if ((e.od || 0) <= 0) return false;
  if (isHuman(e.side)) {
    const v = await view.askChoice(
      what === 'push' ? 'Контроль щитом' : 'Зона контроля',
      `<p>${uName(u)} ${what === 'push' ? 'движется в зоне' : 'выходит из зоны контроля'} ${uName(e)}.</p><p>Ответ тратит 1 очко реакции (осталось ${e.od}); оно же нужно на защиту до следующего хода.</p>`,
      [
        {
          v: 1,
          label: what === 'push' ? 'Толкнуть щитом' : 'Ударить',
          sub: '1 очко реакции',
        },
        {
          v: 0,
          label: 'Пропустить',
          sub: 'очко останется на защиту',
        },
      ],
    );
    return !!v;
  }
  const t = tplOf(e);
  if (t.zocAlways) return true;
  return e.od >= 2 || u.hp <= 2;
}

/* ---------- Прикрыть союзника: реакция из запаса ---------- */
/* Соседний союзник атакован (не по площади и не реакцией) — можно принять удар на себя, если атакующий достаёт и тебя.
   Стоит 1 очко реакции, защита от этого удара — отдельно. Конрад (Перехват) прикрывает бесплатно, но нужно хотя бы 1 очко на защиту. */
export function coverCost(o) {
  const t = tplOf(o);
  return t.guardian || (t.guardianLite && o.guardUsedRound !== S.round) ? 0 : 1;
}
export function canCoverFor(o, def: Unit, att: Unit, act: Action) {
  if (o.down || o === def || o === att || o.side !== def.side || o.prone || o.stunned || sz(o) > 1) return false;
  if ((o.od || 0) < 1 || !near1(o, def)) return false;
  return canTarget(att, act, o);
}
export async function coverWants(o, def: Unit, att: Unit, act: Action) {
  const c = coverCost(o);
  if (isHuman(o.side)) {
    const v = await view.askChoice(
      'Прикрыть союзника',
      `<p>Атака: ${uName(att)} → ${uName(def)} (${esc(act.name)}).</p><p>${uName(o)} может принять удар на себя${c ? ` за 1 очко реакции (осталось ${o.od})` : ' бесплатно (Перехват)'}. Защита от этого удара оплачивается как обычно.</p>`,
      [
        {
          v: 1,
          label: 'Прикрыть',
          sub: c ? '1 очко реакции' : 'бесплатно, защита — из запаса',
        },
        {
          v: 0,
          label: 'Не прикрывать',
          sub: '',
        },
      ],
    );
    return !!v;
  }
  const t = tplOf(o),
    dt = tplOf(def);
  if (o.side === 'en')
    return !!t.coverAlly && !dt.coverAlly && o.hp > o.maxHp * 0.3 && (o.od >= 2 || def.hp <= def.maxHp * 0.5);
  if (o.hp < o.maxHp * 0.35) return false;
  if (t.guardian)
    return resist(def) < resist(o) || (def.armor || 0) < (o.armor || 0) || !!dt.fragile || def.hp <= def.maxHp * 0.4;
  return o.od >= 2 && (def.hp <= def.maxHp * 0.3 || (!!dt.fragile && openT(def)));
}
export async function tryCover(def: Unit, att: Unit, act: Action, opt) {
  if (opt.area || opt.noCover || opt.free || def.side === att.side) return def;
  const cands = S.units
    .filter(o => canCoverFor(o, def, att, act))
    .sort((a, b) => coverCost(a) - coverCost(b) || (b.od || 0) - (a.od || 0));
  for (const o of cands) {
    if (!(await coverWants(o, def, att, act))) continue;
    const c = coverCost(o);
    if (c) o.od--;
    else if (tplOf(o).guardianLite) o.guardUsedRound = S.round;
    ev(
      `🛡 Прикрыть: ${uName(o)} принимает удар вместо союзника (${uName(def)})${c ? ` — 1 очко реакции, осталось ${o.od}` : ' — Перехват, бесплатно'}`,
    );
    if (S.stat) {
      S.stat.cov = S.stat.cov || {};
      S.stat.cov[o.tpl] = (S.stat.cov[o.tpl] || 0) + 1;
    }
    return o;
  }
  return def;
}

/* ---------- 18.11: пороги промаха, заклинания, Самоненависть ---------- */
export const THR_CAP = 15;
export const isSpell = a => !!a && (a.magic || a.spell);
export function missThr(att: Unit, act: Action, def: Unit) {
  const s = [];
  if (act.ranged && !act.magic && def && cheb(att, def) > RANGE_OPT) s.push(['дальность', 5]);
  const rp = hasEff(att, 'blind2') ? 0 : stOf(att, 'ripple');
  if (rp) s.push(['Рябь ×' + rp, rp >= 2 ? 7 : 5]);
  if (!act.magic && !act.spell && darkPen(att)) s.push(['темнота', 5]);
  if (act.ranged && def && coverBetween(att, def)) s.push(['укрытие', 2]);
  const v = Math.min(
    THR_CAP,
    s.reduce((a, x) => a + x[1], 0),
  );
  return {
    v,
    src: s.map(x => x[0] + ' ' + x[1]).join(' + '),
  };
}
export function defThr(def: Unit, act: Action) {
  return !isSpell(act) && darkPen(def) ? 5 : 0;
}
