import type { Unit } from '../types';
import { AREA_RU, ST_ICON, ST_RU } from '../data/labels';
import { STRONG, fullDef, stOf, v2DefOptions } from '../rules/combat';
import { LASSO_R, lassoTarget } from '../rules/lasso';
import { weakMag } from '../rules/magic';
import { armorNow, limOf, onEdge, painOf } from '../rules/pain';
import { adLeft, dexFree, odMax } from '../rules/reactions';
import { getEff, hasEff } from '../rules/stats';
import { openWounds } from '../rules/wounds';
import { byId } from '../state';
import { openModal } from './modals';
import { UI, render, saveUI } from './panels';
import { $, esc } from '../util';

export function v2CardLines(u: Unit) {
  const o = [];
  if (u.prone) o.push('⤵ сбит с ног: −5 к обычным атакам и активной защите, ползёт на 1 гекс, встать — 1 ОД');
  const desc = {
    ripple: n =>
      `−${2 * n} к атакам по цели и активной защите` + `; атаки промахиваются на натуральных 1–${n >= 2 ? 7 : 5}`,
    cough: n => `−${2 * n} к способностям с речью`,
    disor: n => `−${2 * n} к сложным действиям; на 3 стаках — потеря сознания`,
    unst: () => 'второй стак сбивает с ног; толкнуть легче на 3',
    heat: n => `на 3 стаках — 6 урона сквозь броню (сейчас ${n})`,
  };
  for (const k in ST_RU)
    if (stOf(u, k))
      o.push(
        `${ST_ICON[k]} ${ST_RU[k]} ×${u.st[k]}: ${desc[k](u.st[k])}${STRONG[k] && hasEff(u, STRONG[k]) ? ' (пока действует сильная степень — без штрафа)' : ''}`,
      );
  if (hasEff(u, 'blind2')) o.push('🕶 Слепота: −8 к активной защите, удар — в случайный гекс, движение 1 гекс за ОД');
  if (hasEff(u, 'mute')) o.push('🤐 Немота: способности с речью недоступны');
  if (hasEff(u, 'vuln2'))
    o.push('🎯 Уязвимость: следующее воздействие удвоено (урон после брони ×2, стаки ×2, толчок ×2)');
  if (hasEff(u, 'weak2'))
    o.push(
      `🥀 Слабость: −${weakMag(u)} к атакам, способностям и Стойкости (не к заклинаниям), ходов осталось ${getEff(u, 'weak2').left}`,
    );
  if (hasEff(u, 'fmark')) o.push('🔥 Метка пламени: попадание обычной атакой союзника Хельги даст 1 Нагрев');
  const l = getEff(u, 'lasso');
  if (l) o.push(`➰ в силке (${AREA_RU[l.part]}): не двигается, −3 к уклонению`);
  const lt = u.lassoT && lassoTarget(u);
  if (lt) o.push(`➰ держит силком: ${esc(lt.name)} — сам ходит не дальше ${LASSO_R} гексов от цели`);
  const sp = getEff(u, 'spots');
  if (sp) o.push(`⌖ слабые места: ${sp.areas.map(a => AREA_RU[a]).join(', ')}`);
  const on = getEff(u, 'ordnow');
  if (on) {
    const e = byId(on.tgt);
    o.push(`📣 приказ «Сейчас!»: ударить ${e ? esc(e.name) : ''}`);
  }
  if (u.prep) o.push(`⏱ подготовка: ${u.prep.kind === 'push' ? 'толчок' : 'удар'} по первому врагу в досягаемости`);
  if (hasEff(u, 'magsight')) o.push(`👁 магическое зрение, ходов осталось ${getEff(u, 'magsight').left}`);
  if (u.side === 'pc' || fullDef(u))
    o.push(
      `<span class="dim">Активная защита: ${v2DefOptions(
        u,
        u,
        {
          name: '',
          cost: 1,
          kind: 'attack',
          reach: 1,
        },
        {},
      )
        .map(x => x.name.toLowerCase())
        .join(', ')} · осталось ${adLeft(u)}</span>`,
    );
  else o.push('<span class="dim">Активная защита: только уклонение</span>');
  return o;
}

/* Подписи для интерфейса. */
export function hpFrac(u: Unit) {
  if (u.down) return 0;
  const L = limOf(u);
  return Math.max(0, (L - painOf(u)) / L);
}

export function downTxt(u: Unit) {
  return u.dead
    ? 'мёртв'
    : u.ko
      ? `без сознания${u.deathSteps ? ' · шаг к смерти ' + u.deathSteps + '/3' : ''}`
      : 'выбыл';
}

export function hpNum(u: Unit) {
  return `${Math.min(limOf(u), painOf(u))}<i>/${limOf(u)}</i>`;
}

export function hpVal(u: Unit) {
  if (u.down) return `<i>${downTxt(u)}</i>`;
  return `${painOf(u)}<i>/${limOf(u)} Боль${onEdge(u) ? ' · на пороге' : ''}</i>`;
}

export function hpTxt(u: Unit) {
  if (u.down) return downTxt(u);
  return `Боль ${painOf(u)}/${limOf(u)}${onEdge(u) ? ', на пороге' : ''}`;
}

export const armorTxt = (u: Unit) => `${armorNow(u)}/${u.armor || 0}`;

export function odPipsHTML(u: Unit) {
  if (u.down) return '';
  const n = Math.max(odMax(u), u.od || 0);
  let h = '';
  for (let i = 0; i < n; i++) h += `<b class="${i < u.od ? '' : 'off'}"></b>`;
  if (dexFree(u)) h += '<b class="ad" title="бесплатное уклонение (Ловкость 7+)"></b>';
  return h;
}

/* Каждый эффект — свой значок на цветной плашке; названия — при наведении, в меню и в листе. */
export const FX_FULL = {
  prone: 'Сбит с ног',
  out: 'Без сознания',
  blind: 'Слепота',
  ripple: 'Рябь',
  mute: 'Немота',
  cough: 'Кашель',
  disor: 'Дезориентация',
  unst: 'Неустойчивость',
  heat: 'Нагрев',
  bleed: 'Кровотечение',
  wound: 'Открытая рана',
  vuln: 'Уязвимость',
  weak: 'Слабость',
  fmark: 'Метка пламени',
  lasso: 'В силке',
  hold: 'Держит цель',
  snare: 'В капкане',
  grab: 'В захвате',
  spots: 'Слабые места выявлены',
  ord: 'Приказ «Сейчас!»',
  prep: 'Подготовка',
  covered: 'В полном укрытии: стрелять сквозь укрытие нельзя',
  wet: 'Мокрый: Нагрев снят и не копится (1 ход)',
  oily: 'Горючий: от огня вспыхнет — ещё 2 Нагрева',
  cover: 'Под Перехватом',
  msight: 'Магическое зрение',
};

export const FX_ICON = {
  heat: 'f:M8 1C10 4 13 6 13 10a5 5 0 0 1-10 0C3 7 6 6 8 1Z',
  bleed: 'f:M8 1L12 8a4.5 4.5 0 1 1-8 0Z',
  wound: 'M3 13L13 3M5 5l3 3M8 8l3 3',
  blind: 'M1 8Q8 2 15 8Q8 14 1 8ZM2 14L14 2',
  ripple: 'M1 6q2-3 4 0t4 0t4 0M1 11q2-3 4 0t4 0t4 0',
  mute: 'M2 3h12v7H8l-3 3v-3H2ZM6 5l4 3M10 5l-4 3',
  cough: 'M2 3h12v7H8l-3 3v-3H2ZM5 6.5h.01M8 6.5h.01M11 6.5h.01',
  disor: 'M8 7a1 1 0 1 1-1 1a3 3 0 1 1 3 3a5 5 0 1 1-5-5',
  out: 'M2 3h6l-6 7h6M10 9h4l-4 5h4',
  unst: 'M3 4Q0 8 3 12M13 4Q16 8 13 12M8 3v10',
  prone: 'M1 13h14M3 8.5a1.5 1.5 0 1 0 .01 0M6 10h8',
  vuln: 'M8 2a6 6 0 1 0 .01 0M8 6a2 2 0 1 0 .01 0M8 0v3M8 13v3M0 8h3M13 8h3',
  weak: 'M8 2v10M3.5 8L8 13L12.5 8',
  fmark: 'M8 4C9 6 11 7 11 9.5a3 3 0 0 1-6 0C5 8 7 7 8 4ZM8 1a7 7 0 1 0 .01 0',
  lasso: 'M8 2a5 3.5 0 1 0 .01 0M12 8L15 15',
  hold: 'M4 7h8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM6 7V4M8 7V3M10 7V4',
  snare: 'M2 13a6 6 0 0 1 12 0M4 13l1-3l1.5 3l1.5-3l1.5 3l1.5-3l1 3',
  spots: 'M8 3v10M3 8h10M8 5.5a2.5 2.5 0 1 0 .01 0',
  ord: 'M4 15V2h8l-2 3l2 3H4',
  prep: 'M4 2h8M4 14h8M5 2c0 5 6 5 6 12M11 2c0 5-6 5-6 12',
  covered: 'M8 1.5l5.5 2v4.5c0 3.2-2.4 5.6-5.5 6.5-3.1-.9-5.5-3.3-5.5-6.5V3.5z',
  wet: 'M8 2c2.5 3.4 4.5 6 4.5 8.2A4.5 4.5 0 0 1 3.5 10.2C3.5 8 5.5 5.4 8 2z',
  oily: 'f:M8 2c2.5 3.4 4.5 6 4.5 8.2A4.5 4.5 0 0 1 3.5 10.2C3.5 8 5.5 5.4 8 2z',
  cover: 'M8 1L14 3v5c0 4-3 6-6 7c-3-1-6-3-6-7V3Z',
  msight: 'M1 8Q8 2 15 8Q8 14 1 8ZM8 6a2 2 0 1 0 .01 0',
  x: 'M8 5a3 3 0 1 0 .01 0',
};

export function fxIcon(k) {
  const d = FX_ICON[k] || FX_ICON.x,
    f = d.startsWith('f:');
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${f ? d.slice(2) : d}" ${f ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
}

export const fxTitle = e => (FX_FULL[e.k] || e.l) + (e.n ? ' ×' + e.n : '');

export function fxChips(u: Unit) {
  return fxList(u)
    .map(
      e => `<span class="fxc k-${e.k}" title="${esc(fxTitle(e))}">${fxIcon(e.k)}${e.n ? `<b>${e.n}</b>` : ''}</span>`,
    )
    .join('');
}

export function fxNames(u: Unit) {
  return fxList(u)
    .map(e => `<span class="fxr"><span class="fxc k-${e.k}">${fxIcon(e.k)}</span>${esc(fxTitle(e))}</span>`)
    .join('');
}

export function openLegend() {
  openModal(
    '<h2>Значки эффектов</h2><label class="fxtg"><input type="checkbox" id="fxVis"' +
      (UI.fxVis !== false ? ' checked' : '') +
      '> Показывать состояния на самих фигурах (лежит, качается, повязка, свечение, капли, кольцо, верёвка силка). Без галочки остаются только значки.</label><p class="dim">На поле над фигурой — только значки со счётчиком стаков. Названия видны при наведении на фигуру, в меню цели и в листе бойца.</p><div class="fxleg">' +
      Object.keys(FX_FULL)
        .map(k => `<span class="fxr"><span class="fxc k-${k}">${fxIcon(k)}</span>${FX_FULL[k]}</span>`)
        .join('') +
      '</div>',
    () => {
      $('#fxVis').onchange = e => {
        UI.fxVis = e.target.checked;
        saveUI();
        render();
      };
    },
  );
}

export function fxList(u: Unit) {
  const o = [],
    add = (k, l, n?) =>
      o.push({
        k,
        l,
        n: n > 1 ? n : 0,
      });
  if (u.prone) add('prone', 'сбит');
  if (u.covered) add('covered', 'в укрытии');
  if (hasEff(u, 'wet')) add('wet', 'мокрый');
  if (hasEff(u, 'oily')) add('oily', 'горючий');
  if (u.stunned) add('out', 'без сознания');
  if (hasEff(u, 'blind2')) add('blind', 'слеп');
  if (stOf(u, 'ripple')) add('ripple', 'рябь', u.st.ripple);
  if (hasEff(u, 'mute')) add('mute', 'нем');
  if (stOf(u, 'cough')) add('cough', 'кашель', u.st.cough);
  if (stOf(u, 'disor')) add('disor', 'дезор', u.st.disor);
  if (stOf(u, 'unst')) add('unst', 'неуст', u.st.unst);
  if (stOf(u, 'heat')) add('heat', 'нагрев', u.st.heat);
  if (u.bleed) add('bleed', 'кровь', u.bleed);
  const ow = openWounds(u).length;
  if (ow) add('wound', 'рана', ow);
  if (hasEff(u, 'vuln2')) add('vuln', 'уязв');
  if (hasEff(u, 'weak2')) add('weak', 'слаб');
  if (hasEff(u, 'fmark')) add('fmark', 'метка');
  if (hasEff(u, 'lasso')) add('lasso', 'силок');
  if (u.lassoT && lassoTarget(u)) add('hold', 'держит');
  if (hasEff(u, 'snare')) add('snare', 'капкан');
  if (hasEff(u, 'spots')) add('spots', 'места');
  if (hasEff(u, 'ordnow')) add('ord', 'приказ');
  if (u.prep) add('prep', u.prep.kind === 'push' ? 'ждёт: толчок' : 'ждёт: удар');
  if (hasEff(u, 'magsight')) add('msight', 'зрение');
  return o;
}

export const roman = (n: number) => {
  let s = '';
  for (const [v, r] of [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ] as [number, string][])
    while (n >= v) {
      s += r;
      n -= v;
    }
  return s || '0';
};

export const hpCol = p => (p > 0.5 ? 'var(--good)' : p > 0.25 ? 'var(--warn)' : 'var(--bad)');

/* Шкала Боли делениями: по делению на единицу предела; заполнено столько, сколько Боли. */
export function painSegs(u: Unit, cls = '') {
  if (u.down) return `<span class="segs ${cls} down"></span>`;
  const L = limOf(u),
    p = Math.min(L, painOf(u));
  let h = '';
  for (let i = 0; i < L; i++) h += `<i class="${i < p ? 'on' : ''}"></i>`;
  return `<span class="segs ${cls}${onEdge(u) ? ' edge' : ''}" title="Боль ${p} из ${L}${onEdge(u) ? ' · на пороге' : ''}">${h}</span>`;
}
