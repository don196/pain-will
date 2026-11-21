import type { Unit } from '../types';
import { checkRoll, isHuman } from './actions';
import { addSt, partSt } from './combat';
import { ev, log, uName } from './log';
import { missThr } from './reactions';
import { atkMods, getEff, hasEff, removeEff, stat } from './stats';
import { byId } from '../state';
import { cheb, pct, sum } from '../util';
import { view } from '../view';

export const LASSO_R = 3;

export function lassoSnap(t) {
  if (t.down) return;
  const e = getEff(t, 'lasso'),
    h = e && byId(e.by);
  if (h && cheb(h, t) > LASSO_R) {
    releaseLasso(h, 'цель отбросили дальше длины силка');
    addSt(t, 'unst', 1, 'сорванный силок');
  }
}

export const lassoPart = (u: Unit) => {
  const e = getEff(u, 'lasso');
  return e ? e.part : null;
};

export const immobile = (u: Unit) => hasEff(u, 'snare') || hasEff(u, 'lasso') || false;

export function lassoTarget(u: Unit) {
  if (!u.lassoT) return null;
  const t = byId(u.lassoT);
  if (!t || t.down || !hasEff(t, 'lasso')) {
    u.lassoT = null;
    return null;
  }
  return t;
}

export function releaseLasso(h, why) {
  const t = lassoTarget(h);
  h.lassoT = null;
  if (t) {
    removeEff(t, 'lasso');
    ev(`➰ Силок: ${uName(t)} свободен${why ? ' (' + why + ')' : ''}, силок возвращается к ${uName(h)}`);
  }
}

export function doEscapeLasso(u: Unit) {
  const e = getEff(u, 'lasso'),
    h = byId(e.by);
  if (!h || h.down) {
    removeEff(u, 'lasso');
    return;
  }
  const ts = partSt(u, 'torso');
  if (ts >= 3) {
    ev(`${uName(u)} не может вырваться: корпус повреждён`);
    return;
  }
  const mods = [
    {
      l: 'Сила',
      v: stat(u, 'str'),
    },
  ];
  if (ts)
    mods.push({
      l: 'рана корпуса',
      v: -2 * ts,
    });
  const c = checkRoll(u, mods, 10 + stat(h, 'str'), {
    noSad: true,
  });
  log(`<div class="lh">${uName(u)}: вырваться из силка (держит ${uName(h)})</div>` + c.html, 'atk');
  if (c.dg.ok) releaseLasso(h, 'вырвался');
}

export const SNARE_PART = {
  leg: {
    l: 'нога',
    v: 0,
  },
  armR: {
    l: 'рука с оружием',
    v: -3,
  },
  armL: {
    l: 'рука со щитом',
    v: -3,
  },
  head: {
    l: 'голова',
    v: -2,
  },
};

export function snareP(u: Unit, a, t, pen) {
  const M = sum(atkMods(u, a, t)) + (pen || 0),
    dc = 8 + stat(t, 'dex'),
    th = missThr(u, a, t);
  let n = 0;
  for (let r = 1; r <= 20; r++) if (r > th.v && r + M >= dc) n++;
  return n / 20;
}

export async function chooseSnarePart(u: Unit, a, t) {
  u._snarePart = 'leg';
  if (!isHuman(u.side)) return;
  const opts = ['leg', 'armR']
    .concat(t.shield > 0 ? ['armL'] : [])
    .concat(['head'])
    .map(k => ({
      v: k,
      label:
        SNARE_PART[k].l[0].toUpperCase() +
        SNARE_PART[k].l.slice(1) +
        (SNARE_PART[k].v ? ` (${SNARE_PART[k].v})` : ' (без штрафа)'),
      sub: `успех ${pct(snareP(u, a, t, SNARE_PART[k].v))}${k === 'head' ? ' · Кашель и 2 урона в конце каждого хода цели' : k === 'leg' ? ' · обездвиживание' : k === 'armR' ? ' · обездвиживание, оружием в этой руке не ударить' : ' · обездвиживание, щитом не закрыться'}`,
    }));
  const v = await view.askChoice(
    'Силок: куда целиться',
    `<p>${uName(u)} → ${uName(t)}. d20 + мастерство дальнего боя против 8 + Ловкость цели (${8 + stat(t, 'dex')}).</p>`,
    opts,
  );
  u._snarePart = SNARE_PART[v] ? v : 'leg';
}
