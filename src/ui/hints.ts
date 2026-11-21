import { ATTACK_KINDS } from '../data/actions';
import { PCLS_RU, PTYP_RU } from '../data/labels';
import { wtOf } from '../rules/combat';
import { PCLS, wType } from '../rules/pain';
/* Подсказка к действию: что делает и сколько Боли наносит. */
export function hintOf(id, a) {
  if (id === 'bandage')
    return `1 бинт = ${a.pts} пункта: по 1 на стак кровотечения, потом по 1 на открытую рану. Себе, соседу или соседу без сознания`;
  if (id === 'trap')
    return `Гекс рядом, по линии видимости. Враг, вошедший в него: 1 Боль и стак кровотечения; держит, пока не вырвется (Сила против ${a.dc})`;
  switch (id) {
    case 'throwTorch':
      return `Зажечь факел из запаса и бросить на пол в пределах ${a.range} кл. по линии видимости. Горит, пока не погасят`;
    case 'throwHeld':
      return `Горящий факел из рук — на пол в пределах ${a.range} кл. по линии видимости. Вы перестаёте быть носителем факела`;
    case 'swap':
      return 'Соседний союзник; ОД тратит только тот, кто меняется';
    case 'door':
      return 'Соседняя дверь; запертую не открыть, занятую не закрыть';
  }
  let h = a.hint || '';
  if ((ATTACK_KINDS.includes(a.kind) || a.kind === 'pair') && a.fixed == null) {
    const c = a.pcls || (wtOf(a) >= 4 ? 'heavy' : 'med'),
      ty = wType(a);
    h =
      `Боль ${PCLS[c].slice(1).join(' / ')} (${PCLS_RU[c]} ${PTYP_RU[ty]}${c === 'heavy' ? ', нужна Сила 6' : ''})` +
      (h && !/^Урон/.test(h) ? '; ' + h : '');
  }
  if (a.ammo) h += (h ? '; ' : '') + `запас ${a.ammo} на бой`;
  if (a.cd) h += (h ? '; ' : '') + `перезарядка ${a.cd}`;
  if (a.once) h = 'один раз за ход' + (h ? '; ' + h : '');
  return h;
}
