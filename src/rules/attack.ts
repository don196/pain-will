import type { Action, Opts, Unit } from '../types';
import { DIS, DISP, DIS_ICON } from '../data/disorders';
import { canTarget } from './actions';
import { addSt, cauterize, interrupt, v2Counter, v2Defend, v2Extra, v2OnHit } from './combat';
import { applyDamage } from './damage';
import { critWill, disForm, disOf, madSwap, oddRoll, sadFail } from './disorders';
import { isWall, near1, unitAt } from './geometry';
import { lassoSnap } from './lasso';
import { ev, log, sleep, uName } from './log';
import { backlash, selfHateHit } from './magic';
import { painAfterTxt, painInfo, painTxt, painWear, painWound } from './pain';
import { ap3Degree, canActiveDefend, missThr, resist, spendReact, tryCover } from './reactions';
import { actId, atkMods, hasEff, modsStr, stat } from './stats';
import { AREAS, addWound } from './wounds';
import { S, friends, hostiles } from '../state';
import { HXD, d20, esc, hpx, pick, sgn, sum, sz } from '../util';
import { view } from '../view';
export async function resolveAttack(att: Unit, act: Action, target: Unit, opt: Opts = {}) {
  let def = target;
  if (!opt.area && !opt.noCover) {
  }
  if (def === target) def = await tryCover(def, att, act, opt);
  let noAD = false;
  if (!opt.area && !opt.noCover && def.side !== att.side) {
    const g = S.units.find(
      o =>
        !o.down &&
        o !== def &&
        o !== att &&
        o.side === def.side &&
        disOf(o, 'guilt') === 2 &&
        near1(o, def) &&
        canTarget(att, act, o),
    );
    if (g) {
      ev(
        `${DIS_ICON.guilt} Саморазрушение: атаку по цели ${uName(def)} принимает на себя ${uName(g)}, без активной защиты`,
      );
      def = g;
      noAD = true;
    }
  }
  const mods = atkMods(att, act, def),
    pas = act.lasso ? 8 + stat(def, 'dex') : resist(def);
  oddRoll(att, mods);
  let M = sum(mods);
  let r = d20(),
    total = r + M,
    reTxt = '';
  const th = missThr(att, act, def),
    cf = act.magic && selfHateHit(att) && r === 1;
  if (cf || (th.v && r <= th.v)) {
    log(
      `<div class="lh">${uName(att)} → ${uName(def)} · ${act.name}${opt.free ? ' <span class="dim">вне очереди</span>' : ''}</div><div class="lr">натуральные d20 <b>${r}</b>${th.v ? ` · порог промаха <b>${th.v}</b> (${th.src})` : ''}</div><div class="lo"><span class="chip fail">${cf ? 'критический провал' : 'промах'}</span></div>`,
      'atk',
    );
    view.fxLine(att, def, act.fx || (act.ranged ? 'bolt' : 'melee'));
    view.fxText(def, 'мимо', 'miss');
    S.lastAtk = {
      hit: false,
      dmg: 0,
      def: def.id,
    };
    if (S.stat) S.stat.thrMiss = (S.stat.thrMiss || 0) + 1;
    if (cf) backlash(att, act);
    return;
  }
  let defVal = pas,
    defTxt = act.lasso ? `8 + Ловкость цели = <b>${pas}</b>` : `Стойкости <b>${pas}</b>`,
    adUsed = false;
  let v2def = null;
  if (!(act.lasso && total < pas) && !noAD && !opt.area && canActiveDefend(def)) {
    v2def = await v2Defend(def, att, act, total, pas, opt);
    if (v2def) {
      spendReact(def, v2def.mode);
      adUsed = true;
      defTxt += `. ${v2def.name}: d20 <b>${v2def.r}</b>${modsStr(v2def.mods)} = <b>${v2def.tot}</b> — ${v2def.ok ? 'отбито' : v2def.thrFail ? 'сорвалась: натуральные ' + v2def.r + ' в темноте' : 'не отбито'}`;
    }
  }
  let diff = total - defVal;
  const fa = disOf(att, 'indec');
  if (fa && diff >= 10) {
    const p = DISP.indec.re[fa - 1],
      r0 = r;
    mods.push({
      l: DIS.indec[fa - 1] + ': переброс',
      v: -p,
    });
    M = sum(mods);
    r = d20();
    total = r + M;
    diff = total - defVal;
    reTxt += `<div class="ld">${DIS_ICON.indec} ${DIS.indec[fa - 1]}: критический успех (d20 ${r0}) перебрасывается с −${p}</div>`;
    if (fa === 2 && diff < 1 && att.side === S.phase && !opt.free) {
      att._endTurn = true;
      reTxt += `<div class="ld">Ступор: повторный бросок — промах, ход завершается</div>`;
    }
  }
  let deg = act.lasso
    ? diff >= 0
      ? {
          t: 1,
          txt: 'силок долетел',
          c: 'ok',
        }
      : {
          t: 0,
          txt: 'мимо',
          c: 'fail',
        }
    : ap3Degree(diff);
  if (v2def && v2def.ok)
    deg = {
      t: 0,
      txt: `отбито, перевес ${v2def.margin}${v2def.counter ? ' · контратака +' + v2def.counter : ''}`,
      c: 'minor',
    };
  if (deg.t >= 1 && deg.t < 3 && act.finisher)
    deg = {
      t: 3,
      txt: deg.txt + ' → критический (Добивание)',
      c: 'crit',
    };
  const hit = deg.t >= 1;
  critWill(att, deg);
  sadFail(att, diff);
  let html = `<div class="lh">${uName(att)} → ${uName(def)} · ${act.name}${opt.part ? ` <span class="dim">бросок ${opt.part}</span>` : ''}${opt.free ? ' <span class="dim">вне очереди</span>' : ''}</div>`;
  html += `<div class="lr">d20 <b>${r}</b>${modsStr(mods)} = <b>${total}</b> против ${defTxt}</div>`;
  html += `<div class="lo"><span class="chip ${deg.c}">разница ${sgn(diff)} · ${deg.txt}</span></div>` + reTxt;
  if (hit && !opt.area && madSwap(att) && def.side !== att.side) {
    const al = friends(att)
      .filter(o => canTarget(att, act, o, null, true))
      .sort((a, b) => b.hp - a.hp);
    const en = hostiles(att)
      .filter(o => o !== def && canTarget(att, act, o))
      .sort((a, b) => a.hp - b.hp);
    const nt = al[0] || en[0];
    if (nt) {
      html += `<div class="ld">${DIS_ICON.odd} Безумие (d6 ${att._d6}): после броска удар уходит на ${uName(nt)}</div>`;
      def = nt;
    }
  }
  const v2x = v2Extra(att, act, def, hit);
  let dmg = 0,
    kb = null,
    pinfo = null;
  if (hit) {
    let calc;
    if (act.fixed != null) {
      const m = kb && kb.collide ? 2 : 1;
      dmg = act.fixed * m;
      calc =
        act.fixed === 0
          ? 'нет'
          : `фиксированный ${act.fixed}${m > 1 ? ` × 2 (удар о ${kb.what})` : ''} = <b>${dmg}</b>`;
    } else {
      pinfo = painInfo(att, act, def, deg.t, {
        bs: v2x.bs > 0,
        collide: !!(kb && kb.collide),
        vd: !!v2x.vd,
      });
      dmg = pinfo.net;
      calc = painTxt(pinfo, deg.t);
    }
    html += `<div class="ld">${pinfo ? '' : 'Боль: '}${calc} · ${painAfterTxt(def, dmg)}</div>`;
  }
  log(html, 'atk');
  view.fxLine(att, def, act.fx || (act.ranged ? 'bolt' : 'melee'));
  if (!hit) view.fxText(def, adUsed ? 'отбил' : 'мимо', 'miss');
  S.lastAtk = {
    hit,
    dmg,
    def: def.id,
  };
  if (hit) {
    if (kb) applyKnock(def, kb);
    let hb = null;
    painWear(def, pinfo);
    hb = act.cauter
      ? deg.t === 3 && !def.down
        ? cauterize(def, act.cauter === 'head' ? 'head' : null)
        : null
      : painWound(att, act, def, deg, pinfo);
    att._striking = true;
    applyDamage(def, dmg, att);
    att._striking = false;
    if (!def.down) {
      await v2OnHit(att, act, def, deg, dmg, v2x, hb, opt);
      if (act.critWound && deg.t === 3 && hb !== 'wound' && !def.down) {
        ev(`🗡 ${esc(act.name)}: критический успех — рана`);
        addWound(def, pick(AREAS));
      }
      if (act.numb && !def.down) {
        def.numb = true;
        ev(`🫥 Удар в точку: ${uName(def)} онемел — в следующий ход только 1 ОД`);
        view.fxText(def, 'онемение', 'info');
      }
    }
  } else {
    const f = disForm(att),
      k = att.disorder;
    if (f && k === 'fear') {
      if (hasEff(att, 'shake') && act.ranged && actId(act) && (att.ammo || {})[actId(act)] > 0) {
        att.ammo[actId(act)]--;
        ev(
          `${DIS_ICON.fear} Тряска: ${uName(att)} промахивается и роняет ещё один снаряд (осталось ${att.ammo[actId(act)]})`,
        );
      }
    }
    if (f && k === 'aggr' && !opt.free && !att.mustAttack) {
      att.mustAttack = true;
      ev(
        `${DIS_ICON.aggr} ${uName(att)} — ${DIS.aggr[f - 1]}: после промаха следующее действие — атака оружием${f === 2 ? ' по случайному противнику' : ''}`,
      );
    }
  }
  if (S.over) return;
  if (v2def && v2def.counter && !opt.free && !act.ranged && !act.magic) await v2Counter(def, att, v2def.counter);
  if (S.over) return;
  await sleep(120);
}
export function knockPlan(att: Unit, def: Unit) {
  if (sz(def) > 1)
    return {
      held: true,
      big: true,
    };
  if (hasEff(def, 'snare'))
    return {
      held: true,
    };
  const ax = att.x + (sz(att) - 1) / 2,
    ay = att.y + (sz(att) - 1) / 2;
  let dx = Math.sign(def.x - ax),
    dy = Math.sign(def.y - ay),
    nx = def.x + dx,
    ny = def.y + dy;
  const [px, py] = hpx(att.x, att.y),
    [qx, qy] = hpx(def.x, def.y),
    vx = qx - px,
    vy = qy - py;
  let b = null;
  for (const [ddx, ddy] of HXD[def.y & 1]) {
    const [rx, ry] = hpx(def.x + ddx, def.y + ddy),
      d = (rx - qx) * vx + (ry - qy) * vy;
    if (!b || d > b.d)
      b = {
        x: def.x + ddx,
        y: def.y + ddy,
        d,
      };
  }
  nx = b.x;
  ny = b.y;
  dx = 0;
  dy = 0;
  if (isWall(nx, ny) || (dx && dy && isWall(def.x + dx, def.y) && isWall(def.x, def.y + dy)))
    return {
      collide: true,
      what: 'стену',
    };
  const o = unitAt(nx, ny);
  if (o)
    return {
      collide: true,
      stop: true,
      what: 'персонажа (' + o.name + ')',
      o,
    };
  return {
    to: {
      x: nx,
      y: ny,
    },
  };
}
export function applyKnock(def: Unit, kb) {
  if (kb.held) {
    ev(kb.big ? `${uName(def)} невосприимчив к перемещению` : `${uName(def)} удерживается и не сдвигается`);
    return;
  }
  if (kb.to) {
    def.x = kb.to.x;
    def.y = kb.to.y;
    ev(`Отбрасывание: ${uName(def)} сдвигается на 1 клетку`);
    view.renderTokens();
    interrupt(def, 'отброшен');
    addSt(def, 'unst', 1, 'отбрасывание');
    lassoSnap(def);
    return;
  }
  ev(`Отбрасывание: ${uName(def)} врезается в ${kb.what} — урон удвоен`);
  addSt(def, 'unst', 2, 'удар о преграду');
}
