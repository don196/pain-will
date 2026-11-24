/* Механики трёх противников первого этажа, согласованные в карточках на Боли 1.1.
   Не восстанавливать прежние способности, зависевшие от HP. */
import type { Unit } from '../types';
import { A } from '../data/actions';
import { resolveAttack } from './attack';
import { near1 } from './geometry';
import { ev, log, uName } from './log';
import { stat } from './stats';
import { S, byId } from '../state';
import { d20, esc } from '../util';

export function releasePrisonGrip(holder: Unit, reason = '') {
  if (!holder || !holder.hold || holder.hold.kind !== 'prisonJailer') return;
  const t = byId(holder.hold.t);
  holder.hold = null;
  if (t && t.grabbedBy === holder.id) {
    t.grabbedBy = null;
    t.grabbedArm = null;
    ev(`✋ ${uName(t)}: вооружённая рука освобождена${reason ? ` (${esc(reason)})` : ''}`);
  }
}

/* Если падает пленник или удерживающий, захват больше не существует. */
export function clearPrisonGripOnDown(u: Unit) {
  if (u.hold) releasePrisonGrip(u, 'удержание прекращено');
  if (u.grabbedBy != null) {
    const holder = byId(u.grabbedBy);
    if (holder) releasePrisonGrip(holder, 'цель выбыла');
    u.grabbedBy = null;
    u.grabbedArm = null;
  }
}

export function prisonGripTarget(u: Unit) {
  if (!u.hold || u.hold.kind !== 'prisonJailer') return null;
  const t = byId(u.hold.t);
  if (!t || t.down || t.grabbedBy !== u.id) {
    releasePrisonGrip(u);
    return null;
  }
  return t;
}

/* По общему правилу встречной Силы: ничья оставляет цель свободной. */
export function tryPrisonGrab(u: Unit, t: Unit) {
  if (!t || t.down || u.down || u.hold || t.grabbedBy != null || !near1(u, t)) return false;
  const ua = d20(), ta = d20();
  const a = ua + stat(u, 'str'), b = ta + stat(t, 'str');
  const success = a > b;
  log(
    `<div class="lh">${uName(u)} → ${uName(t)} · Захват руки</div>` +
    `<div class="lr">d20 ${ua} + Сила ${stat(u,'str')} = ${a} против d20 ${ta} + Сила ${stat(t,'str')} = ${b}</div>` +
    `<div class="lo">${success ? 'Захват успешен' : 'Цель высвободилась от захвата'}. Без Боли.</div>`,
    'atk',
  );
  if (S.stat) {
    const m = S.stat.skillHits || (S.stat.skillHits = {});
    const h = m.prisonJailerGrab || (m.prisonJailerGrab = {attempts:0,hits:0,pain:0});
    h.attempts++;
    if (success) h.hits++;
  }
  if (!success) return false;
  u.hold = {kind:'prisonJailer',t:t.id,arm:'armR'};
  t.grabbedBy = u.id;
  t.grabbedArm = 'armR';
  ev(`✊ ${uName(u)} удерживает вооружённую руку ${uName(t)}: перемещение запрещено, уклонение −3, другой рукой можно действовать`);
  return true;
}

export function escapePrisonGrip(u: Unit) {
  if (u.grabbedBy == null) return false;
  const holder = byId(u.grabbedBy);
  if (!holder || holder.down || !holder.hold) {
    u.grabbedBy = null;
    u.grabbedArm = null;
    return true;
  }
  const ur = d20(), hr = d20();
  const a = ur + stat(u,'str'), b = hr + stat(holder,'str');
  const ok = a > b;
  log(
    `<div class="lh">${uName(u)}: освободиться из захвата ${uName(holder)}</div>` +
    `<div class="lr">d20 ${ur} + Сила ${stat(u,'str')} = ${a} против d20 ${hr} + Сила ${stat(holder,'str')} = ${b}</div>` +
    `<div class="lo">${ok ? 'Освободился' : 'Захват продолжается (ничья — в пользу удерживающего)'}</div>`,
    'atk',
  );
  if (ok) releasePrisonGrip(holder, 'вырвался');
  return ok;
}

/* Каждый сосед, включая своих, получает независимую атаку, без активной защиты от площадной атаки. */
export async function prisonChainCircle(u: Unit) {
  const targets = S.units.filter(t => !t.down && t !== u && near1(u, t));
  if (!targets.length) {
    ev(`${uName(u)}: круговой удар — рядом никого нет`);
    return;
  }
  ev(`⛓ ${uName(u)} раскручивает цепь вокруг себя: ${targets.length} целей, включая союзников`);
  for (const t of targets) {
    if (u.down || S.over || t.down) break;
    await resolveAttack(u, A.prisonChainAttack, t, {area:true, noCover:true});
  }
}

/* Срабатывает ровно при ВХОДЕ врага в соседнюю клетку, не при движении внутри зоны. */
export async function prisonChainIntercept(mover: Unit, from: {x:number;y:number}) {
  for (const p of S.units) {
    if (mover.down || S.over) break;
    if (p.down || p.side === mover.side || p.tpl !== 'prisonChain' || p.od < 1 ||
        p.charge?.kind !== 'prisonChain' || near1(p, from) || !near1(p, mover)) continue;
    p.charge = null;
    p.od--;
    if (S.stat) {
      const s = S.stat.skillEvents || (S.stat.skillEvents = {});
      s.prisonChainIntercept = (s.prisonChainIntercept || 0) + 1;
    }
    ev(`⛓ Перехват цепью: ${uName(p)} атакует ${uName(mover)} до дальнейшего движения (1 реакция)`);
    await resolveAttack(p, A.prisonChainAttack, mover, {free:true, prepared:true});
  }
}
