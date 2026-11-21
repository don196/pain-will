import { wtOf } from '../rules/combat';
import type { Template } from '../types';
import { resist } from '../rules/reactions';
import { PCLS, limOf, wClass, wType } from '../rules/pain';
import { A, ATTACK_KINDS } from '../data/actions';
import { DIS } from '../data/disorders';
import { T } from '../data/fighters';
import { AI_RU, KIND_RU, PCLS_RU, PTYP_RU } from '../data/labels';
import { BUILTIN, weaponsOf } from '../rules/actions';
import { log } from '../rules/log';
import { speedOf } from '../rules/stats';
import { S, ammoOf } from '../state';
import { startGame } from './game';
import { openModal } from './modals';
import { render } from './panels';
import { tmpUnit } from './sim';
import { $, clone, esc } from '../util';
export const DEF_T = clone(T),
  DEF_A = clone(A);
export const isDmgKind = a => ['attack'].includes(a.kind);

/* Поля карточки действия: что показывать и для каких действий. */
/** Поле карточки действия в редакторе. */
interface Field {
  k: string;
  l: string;
  t?: 'bool' | 'opt' | 'numOpt';
  opts?: Record<string, string>;
  step?: number;
  on: (a: any, id?: string) => boolean;
}
const WT_OPT = {
  '0': '0 — лёгкое',
  '2': '2 — среднее',
  '4': '4 — тяжёлое',
};
export const AF: Field[] = [
  {
    k: 'cost',
    l: 'ОД',
    on: a => true,
  },
  {
    k: 'cd',
    l: 'Перезарядка, раундов',
    on: a => !['move', 'escape'].includes(a.kind),
  },
  {
    k: 'pcls',
    l: 'Класс оружия',
    t: 'opt',
    opts: PCLS_RU,
    on: a => isDmgKind(a) && a.fixed == null,
  },
  {
    k: 'ptyp',
    l: 'Тип удара',
    t: 'opt',
    opts: PTYP_RU,
    on: a => isDmgKind(a) && a.fixed == null,
  },
  {
    k: 'wt',
    l: 'Вес (минус к блоку и парированию)',
    t: 'opt',
    opts: WT_OPT,
    on: a => a.kind === 'attack' && !a.ranged && !a.magic,
  },
  {
    k: 'fixed',
    l: 'Фиксированная Боль',
    t: 'numOpt',
    on: a => isDmgKind(a),
  },
  {
    k: 'xbleed',
    l: 'Доп. стаки кровотечения',
    on: a => isDmgKind(a) && a.fixed == null,
  },
  {
    k: 'penalty',
    l: 'Модификатор атаки',
    on: a => ATTACK_KINDS.includes(a.kind),
  },
  {
    k: 'reach',
    l: 'Досягаемость, гексов',
    on: a => a.kind === 'attack' && !a.ranged,
  },
  {
    k: 'range',
    l: 'Дальность, гексов',
    on: a => a.range != null || a.ranged,
  },
  {
    k: 'ammo',
    l: 'Штук на бой',
    on: a => a.ammo != null,
  },
  {
    k: 'pts',
    l: 'Лечебных пунктов за бинт',
    on: a => a.kind === 'bandage',
  },
  {
    k: 'dc',
    l: 'Сложность',
    on: a => a.kind === 'trap',
  },
  {
    k: 'ranged',
    l: 'Дальнобойное (линия видимости)',
    t: 'bool',
    on: a => a.kind === 'attack',
  },
  {
    k: 'noAdj',
    l: 'Нельзя вплотную',
    t: 'bool',
    on: a => a.kind === 'attack' && a.ranged,
  },
  {
    k: 'needLoad',
    l: 'Перезарядка после выстрела',
    t: 'bool',
    on: a => a.kind === 'attack' && a.ranged,
  },
  {
    k: 'complex',
    l: 'Сложное действие (мешает Дезориентация)',
    t: 'bool',
    on: a => a.kind === 'attack',
  },
  {
    k: 'ignoreArmor',
    l: 'Игнорирует броню',
    t: 'bool',
    on: a => isDmgKind(a) && a.fixed == null,
  },
];
export const AF_DEF = {
  penalty: 0,
  reach: 1,
  cd: 0,
  xbleed: 0,
  pcls: 'med',
  ptyp: 'cut',
};
export const REFRESH_FIELDS = ['ranged', 'fixed'];
export let DTAB = 'chars',
  DATA_DIRTY = new Set(),
  DATA_ALL = false;
export const DATA_V = 3;

/* Версия баланса: при смене восстановленная расстановка пересобирается из шаблонов, чтобы не играть старыми цифрами. */
export const BAL_V = '2026-11-21-a';

/* В браузере храним только отличия от свода: новые значения по умолчанию доходят до всех полей, которые вы не меняли. */
export function diffData() {
  const dT = {},
    dA = {},
    delT = Object.keys(DEF_T).filter(k => !T[k]),
    delA = Object.keys(DEF_A).filter(k => !A[k]);
  for (const [k, v] of Object.entries(T)) {
    const d = DEF_T[k];
    if (!d) {
      dT[k] = clone(v);
      continue;
    }
    const o = {};
    for (const f of new Set([...Object.keys(v), ...Object.keys(d)]))
      if (JSON.stringify(v[f]) !== JSON.stringify(d[f])) o[f] = clone(v[f] === undefined ? null : v[f]);
    if (Object.keys(o).length) dT[k] = o;
  }
  for (const [k, v] of Object.entries(A)) {
    const d = DEF_A[k];
    if (!d) {
      dA[k] = clone(v);
      continue;
    }
    const o = {};
    for (const f of new Set([...Object.keys(v), ...Object.keys(d)]))
      if (JSON.stringify(v[f]) !== JSON.stringify(d[f])) o[f] = clone(v[f] === undefined ? null : v[f]);
    if (Object.keys(o).length) dA[k] = o;
  }
  return {
    v: DATA_V,
    T: dT,
    A: dA,
    _delT: delT,
    _delA: delA,
  };
}
export function saveData() {
  try {
    localStorage.setItem('polygon-data', JSON.stringify(diffData()));
  } catch (e) {}
}
export function mergeData(d) {
  if (!d || typeof d !== 'object' || typeof d.T !== 'object' || typeof d.A !== 'object')
    throw new Error('в тексте нет разделов T и A');
  for (const k of Object.keys(A)) delete A[k];
  for (const [k, v] of Object.entries(clone(DEF_A))) A[k] = v;
  for (const [k, v] of Object.entries(d.A) as [string, any][])
    if (v && typeof v === 'object' && (DEF_A[k] || v.kind)) A[k] = Object.assign(clone(DEF_A[k] || {}), v);
  for (const k of Object.keys(T)) delete T[k];
  for (const [k, v] of Object.entries(clone(DEF_T))) T[k] = v;
  for (const k of d._delA || []) delete A[k];
  for (const k of d._delT || []) delete T[k];
  for (const [k, v] of Object.entries(d.T)) {
    if (!v || typeof v !== 'object') continue;
    const t: Template = Object.assign(
      clone(
        DEF_T[k] ||
          ({
            name: 'Боец',
            glyph: '?',
            side: 'en',
            str: 5,
            dex: 5,
            int: 5,
            cha: 3,
            con: 4,
            will: null,
            armor: 0,
            shield: 0,
            speed: 3,
            torches: 0,
            bandages: 0,
            acts: [],
            ai: 'pStd',
          } as Template),
      ),
      v,
    );
    t.acts = (t.acts || []).filter(id => A[id]);
    if (!t.acts.includes('move')) t.acts.unshift('move');
    if (!t.acts.includes('escape')) t.acts.push('escape');
    T[k] = t;
  }
}
export function loadData() {
  try {
    const raw = localStorage.getItem('polygon-data');
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.v !== DATA_V) {
      localStorage.removeItem('polygon-data');
      OLD_DATA = true;
      return;
    }
    mergeData(d);
  } catch (e) {
    console.warn('Сохранённые значения пропущены', e);
  }
}
export let OLD_DATA = false;
export function openData() {
  openModal(
    `<h2>Персонажи и оружие</h2>
    <p class="dim">Значения сохраняются в этом браузере. Оружие и способности меняются сразу. Изменения персонажей применятся, когда вы закроете окно: бой начнётся заново. Таблица шансов и симуляция берут значения отсюда.</p>
    <div class="tabs" role="tablist">${[
      ['chars', 'Персонажи'],
      ['weap', 'Оружие и способности'],
      ['io', 'Сохранить и загрузить'],
    ]
      .map(
        ([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${DTAB === k ? 'on' : ''}">${l}</button>`,
      )
      .join('')}</div>
    <div id="dataBody"></div>`,
    () => {
      $('#mbox')
        .querySelectorAll('[data-tab]')
        .forEach(
          b =>
            (b.onclick = () => {
              DTAB = b.dataset.tab;
              $('#mbox')
                .querySelectorAll('[data-tab]')
                .forEach(x => x.classList.toggle('on', x === b));
              renderDataTab();
            }),
        );
      renderDataTab();
    },
    {
      wide: true,
      onClose: applyTemplates,
    },
  );
}
export function renderDataTab() {
  const box = $('#dataBody');
  if (!box) return;
  const mb = $('#mbox'),
    sc = mb.scrollTop,
    tw = box.querySelector('.tblwrap'),
    tsc = tw ? [tw.scrollTop, tw.scrollLeft] : null;
  box.innerHTML = DTAB === 'chars' ? charsTab() : DTAB === 'weap' ? weapTab() : ioTab();
  bindDataTab();
  mb.scrollTop = sc;
  const tw2 = box.querySelector('.tblwrap');
  if (tw2 && tsc) {
    tw2.scrollTop = tsc[0];
    tw2.scrollLeft = tsc[1];
  }
}
export function derived(k) {
  const u = tmpUnit(k);
  return {
    def: resist(u),
    sp: speedOf(u),
    main: limOf(u),
  };
}
export function updDerived(k) {
  if (!T[k]) return;
  const d = derived(k);
  const set = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };
  set('dd-' + k, d.def);
  set('ds-' + k, d.sp);
  set('dm-' + k, d.main);
}
export function charsTab() {
  const numIn = (k, f, v, l) =>
    `<input type="number" class="ni" data-t="${k}" data-f="${f}" value="${v == null ? '' : v}" aria-label="${l}: ${esc(T[k].name)}"${f === 'will' ? ' placeholder="нет"' : ''}>`;
  const cols = [
    ['str', 'Сила'],
    ['dex', 'Ловкость'],
    ['int', 'Интуиция'],
    ['cha', 'Харизма'],
    ['con', 'Телосложение'],
    ['mm', 'Мастерство: ближний'],
    ['mr', 'Мастерство: дальний'],
    ['mg', 'Мастерство: магия'],
    ['will', 'Воля'],
    ['armor', 'Броня'],
    ['shield', 'Щит'],
    ['bandages', 'Бинты'],
    ['torches', 'Факелы'],
    ['traps', 'Капканы'],
  ];
  let h = `<div class="tblwrap"><table class="dtab"><thead><tr><th>Боец</th><th>Знак</th><th>Сторона</th><th title="Личное расстройство: включается при Воле −10 и ниже">Расстройство</th>${cols.map(([f, l]) => `<th${f === 'will' ? ' title="Пусто — Воли нет, эффекты Воли не действуют"' : ''}>${l}</th>`).join('')}<th class="der" title="8 + Телосложение">Стойкость</th><th class="der" title="3 + 1 за каждые 2 Ловкости сверх 5">Скорость</th><th class="der" title="5, герой +1, Крепкий +1, Хрупкий −1, рядовой −1">Предел Боли</th><th title="Предел Боли +1">Крепкий</th><th title="Предел Боли −1">Хрупкий</th><th title="Рядовой противник: предел Боли −1">Рядовой</th><th title="Игнорирует темноту">Ночн. зрение</th><th>Поведение ИИ</th><th></th></tr></thead><tbody>`;
  for (const [k, t] of Object.entries(T)) {
    const d = derived(k);
    const chips = t.acts
      .filter(id => A[id] && !['move', 'escape'].includes(id))
      .map(
        id =>
          `<span class="wchip">${esc(A[id].name)}<button type="button" data-rm="${k}" data-id="${id}" aria-label="Убрать: ${esc(A[id].name)}">×</button></span>`,
      )
      .join('');
    const avail = Object.keys(A).filter(
      id => !['move', 'escape'].includes(id) && !BUILTIN.includes(id) && !t.acts.includes(id),
    );
    h += `<tr><td><input type="text" class="ti" data-t="${k}" data-f="name" value="${esc(t.name)}" aria-label="Имя"></td>
      <td><input type="text" class="gi" maxlength="2" data-t="${k}" data-f="glyph" value="${esc(t.glyph)}" aria-label="Знак на поле: ${esc(t.name)}"></td>
      <td><select data-t="${k}" data-f="side" aria-label="Сторона по умолчанию"><option value="pc" ${t.side === 'pc' ? 'selected' : ''}>герой</option><option value="en" ${t.side === 'en' ? 'selected' : ''}>враг</option></select></td>
      <td><select data-t="${k}" data-f="disorder" aria-label="Расстройство: ${esc(t.name)}"><option value="">нет</option>${Object.keys(
        DIS,
      )
        .map(d => `<option value="${d}" ${t.disorder === d ? 'selected' : ''}>${DIS[d][0]} → ${DIS[d][1]}</option>`)
        .join('')}</select></td>
      ${cols
        .map(
          ([f, l]) =>
            `<td>${numIn(
              k,
              f,
              f === 'will'
                ? t[f]
                : (t[f] ??
                    {
                      con: 4,
                      bandages: 0,
                      torches: 0,
                      traps: 0,
                    }[f] ??
                    ''),
              l,
            )}</td>`,
        )
        .join('')}
      <td class="der" id="dd-${k}">${d.def}</td><td class="der" id="ds-${k}">${d.sp}</td><td class="der" id="dm-${k}">${d.main}</td>
      ${[
        ['tough', 'Крепкий'],
        ['fragile', 'Хрупкий'],
        ['mook', 'Рядовой'],
        ['nightVision', 'Ночное зрение'],
      ]
        .map(
          ([f, l]) =>
            `<td style="text-align:center"><input type="checkbox" data-t="${k}" data-f="${f}" ${t[f] ? 'checked' : ''} aria-label="${l}: ${esc(t.name)}"></td>`,
        )
        .join('')}
      <td><select data-t="${k}" data-f="ai" aria-label="Поведение ИИ">${Object.entries(AI_RU)
        .map(([a, l]) => `<option value="${a}" ${t.ai === a ? 'selected' : ''}>${l}</option>`)
        .join('')}</select></td>
      <td>${DEF_T[k] ? `<button type="button" data-rt="${k}" title="Вернуть значения свода">↺ свод</button>` : `<button type="button" data-delt="${k}">Удалить</button>`}</td></tr>
      <tr class="wrow"><td colspan="27" class="wcell"><span class="dim">Оружие и способности:</span> ${chips}<select data-add="${k}" aria-label="Добавить оружие или способность: ${esc(t.name)}"><option value="">+ добавить</option>${avail.map(id => `<option value="${id}">${esc(A[id].name)}</option>`).join('')}</select></td></tr>`;
  }
  return (
    h +
    `</tbody></table></div><div class="drow"><button type="button" id="newChar">+ Новый персонаж</button></div>
    <p class="dim">Попадание — d20 + мастерство против Стойкости цели (8 + Телосложение). Боль удара задаёт класс оружия в его карточке. Скорость = 3 + 1 за каждые 2 Ловкости сверх 5.</p>`
  );
}
export function fieldVal(a, f) {
  if (f === 'wt') return wtOf(a);
  if (f === 'reqStr') return (a.req && a.req.str) || 0;
  return a[f] == null ? AF_DEF[f] : a[f];
}
export function dmgPreview(a, id) {
  if (a.fixed != null) return `Боль: фиксированная ${a.fixed}`;
  const owner = Object.keys(T).find(k => T[k].acts.includes(id));
  const u = owner ? tmpUnit(owner) : tmpUnit(Object.keys(T)[0]);
  const c = wClass(u, a);
  return `Боль по степеням: ${PCLS[c].slice(1).join(' / ')} (${PCLS_RU[c]} ${PTYP_RU[wType(a)]}) до брони${owner ? '' : ' · ни у кого нет'}`;
}
export function weapCard(id) {
  const a = A[id],
    owners = Object.keys(T)
      .filter(k => T[k].acts.includes(id))
      .map(k => esc(T[k].name));
  const fs = AF.filter(f => f.on(a, id))
    .map(f => {
      const v = fieldVal(a, f.k),
        fid = `af-${id}-${f.k}`;
      if (f.t === 'bool')
        return `<label class="fb" for="${fid}"><input type="checkbox" id="${fid}" data-a="${id}" data-f="${f.k}" ${v ? 'checked' : ''}> ${f.l}</label>`;
      if (f.t === 'opt')
        return `<label for="${fid}">${f.l}</label><select id="${fid}" data-a="${id}" data-f="${f.k}">${Object.entries(
          f.opts,
        )
          .map(([s, l]) => `<option value="${s}" ${String(v) === s ? 'selected' : ''}>${l}</option>`)
          .join('')}</select>`;
      return `<label for="${fid}">${f.l}</label><input type="number" id="${fid}" class="ni" step="${f.step || 1}" data-a="${id}" data-f="${f.k}" value="${v == null ? '' : v}"${f.t === 'numOpt' ? ' placeholder="нет"' : ''}>`;
    })
    .join('');
  return `<div class="wcard" data-card="${id}"><div class="wh"><input type="text" class="ti" data-a="${id}" data-f="name" value="${esc(a.name)}" aria-label="Название">${DEF_A[id] ? `<button type="button" data-ra="${id}" title="Вернуть значения свода">↺</button>` : `<button type="button" data-dela="${id}">Удалить</button>`}</div>
    <div class="wk">${KIND_RU[a.kind] || a.kind} · ${owners.length ? owners.join(', ') : 'ни у кого'}${a.pending ? '<div class="pend">требует утверждения</div>' : ''}</div>
    <div class="wf">${fs}</div>${isDmgKind(a) ? `<div class="wd" id="wd-${id}">${dmgPreview(a, id)}</div>` : ''}</div>`;
}
export function weapTab() {
  const ids = Object.keys(A).filter(id => !['move', 'escape'].includes(id) && !BUILTIN.includes(id));
  const atk = ids.filter(id => ATTACK_KINDS.includes(A[id].kind)),
    oth = ids.filter(id => !ATTACK_KINDS.includes(A[id].kind));
  return `<h3>Оружие и атаки</h3><div class="drow"><button type="button" id="newWeap">+ Новое оружие</button><span class="dim">Новое оружие появится в списке «+ добавить» у персонажей. Фиксированная Боль: оставьте поле пустым, чтобы Боль считалась по классу оружия и степени успеха.</span></div>
    <div class="wgrid">${atk.map(weapCard).join('')}</div><h3>Способности</h3><div class="wgrid">${oth.map(weapCard).join('')}</div>`;
}
export function ioTab() {
  return `<p>Скопируйте текст, чтобы сохранить вариант баланса или переслать его. Чтобы загрузить вариант, вставьте текст в поле и нажмите «Загрузить».</p>
    <textarea id="ioText" rows="14" spellcheck="false" aria-label="Значения персонажей и оружия">${esc(
      JSON.stringify({
        v: DATA_V,
        T,
        A,
      }),
    )}</textarea>
    <div class="drow"><button type="button" id="ioCopy">Скопировать</button><button type="button" class="primary" id="ioLoad">Загрузить из поля</button><button type="button" id="ioReset">Вернуть всё к своду</button><span id="ioMsg" class="dim" role="status"></span></div>`;
}
export function setAF(id, f, i) {
  const a = A[id];
  if (!a) return false;
  if (i.type === 'checkbox') {
    a[f] = i.checked;
    if (f === 'ranged' && i.checked) {
      if (a.range == null) a.range = 3;
      if (a.noAdj == null) a.noAdj = true;
      if (!a.fx) a.fx = 'bolt';
    }
    return true;
  }
  if (i.tagName === 'SELECT') {
    a[f] = f === 'wt' ? +i.value : i.value;
    return true;
  }
  if (f === 'name') {
    a.name = i.value.trim() || a.name;
    return true;
  }
  if (i.value === '') {
    if (f === 'fixed') {
      a.fixed = null;
      return true;
    }
    if (f === 'reqStr') {
      a.req = null;
      return true;
    }
    i.value = fieldVal(a, f) ?? '';
    return false;
  }
  let v = parseFloat(String(i.value).replace(',', '.'));
  if (isNaN(v)) {
    i.value = fieldVal(a, f) ?? '';
    return false;
  }
  if (['cost', 'reach', 'range', 'fixed', 'cd', 'dc', 'pts', 'ammo', 'xbleed'].includes(f))
    v = Math.max(0, Math.round(v));
  if (f === 'reqStr') {
    a.req =
      v > 0
        ? {
            str: Math.round(v),
          }
        : null;
    return true;
  }
  if (f === 'penalty') v = Math.round(v);
  a[f] = v;
  i.value = v;
  return true;
}
export function markActOwners(id) {
  for (const [k, t] of Object.entries(T)) if (t.acts.includes(id)) DATA_DIRTY.add(k);
}
export function bindDataTab() {
  const box = $('#dataBody'),
    msg = t => {
      const m = $('#ioMsg');
      if (m) m.textContent = t;
    };
  box.querySelectorAll('[data-t][data-f]').forEach(
    i =>
      (i.onchange = () => {
        const k = i.dataset.t,
          f = i.dataset.f,
          t = T[k];
        if (!t) return;
        if (i.type === 'number') {
          if (i.value === '') {
            if (f === 'will') t.will = null;
            else {
              i.value =
                t[f] ??
                {
                  con: 4,
                  bandages: 0,
                  torches: 0,
                  traps: 0,
                }[f] ??
                '';
              return;
            }
          } else {
            const v = parseFloat(String(i.value).replace(',', '.'));
            if (isNaN(v)) {
              i.value = t[f] ?? '';
              return;
            }
            t[f] = ['bandages', 'torches', 'traps'].includes(f) ? Math.max(0, Math.round(v)) : Math.round(v);
            i.value = t[f];
          }
        } else if (i.type === 'checkbox') t[f] = i.checked;
        else if (f === 'glyph') t.glyph = i.value.trim().slice(0, 2) || '?';
        else if (f === 'name') {
          t.name = i.value.trim() || t.name;
          i.value = t.name;
        } else t[f] = i.value;
        DATA_DIRTY.add(k);
        saveData();
        updDerived(k);
      }),
  );
  box.querySelectorAll('[data-rm]').forEach(
    b =>
      (b.onclick = () => {
        const k = b.dataset.rm;
        T[k].acts = T[k].acts.filter(x => x !== b.dataset.id);
        DATA_DIRTY.add(k);
        saveData();
        renderDataTab();
      }),
  );
  box.querySelectorAll('[data-add]').forEach(
    sel =>
      (sel.onchange = () => {
        const k = sel.dataset.add,
          id = sel.value;
        if (!id) return;
        const acts = T[k].acts.filter(x => x !== 'escape');
        acts.push(id, 'escape');
        T[k].acts = acts;
        DATA_DIRTY.add(k);
        saveData();
        renderDataTab();
      }),
  );
  box.querySelectorAll('[data-rt]').forEach(
    b =>
      (b.onclick = () => {
        const k = b.dataset.rt;
        T[k] = clone(DEF_T[k]);
        T[k].acts = T[k].acts.filter(id => A[id]);
        DATA_DIRTY.add(k);
        saveData();
        renderDataTab();
      }),
  );
  box.querySelectorAll('[data-delt]').forEach(
    b =>
      (b.onclick = () => {
        const k = b.dataset.delt;
        delete T[k];
        DATA_DIRTY.add(k);
        saveData();
        renderDataTab();
      }),
  );
  const nc = $('#newChar');
  if (nc)
    nc.onclick = () => {
      const k = 'c' + Date.now().toString(36);
      T[k] = {
        name: 'Новый боец',
        glyph: '?',
        side: 'en',
        str: 5,
        dex: 5,
        int: 5,
        cha: 3,
        con: 4,
        mm: 3,
        mr: 2,
        will: null,
        armor: 1,
        shield: 0,
        speed: 3,
        torches: 2,
        bandages: 0,
        acts: ['move', 'sword', 'improv', 'standup', 'throwTorch', 'escape'],
        ai: 'pStd',
      };
      saveData();
      renderDataTab();
      const tw = $('#dataBody .tblwrap');
      if (tw) tw.scrollTop = tw.scrollHeight;
    };
  box.querySelectorAll('[data-a][data-f]').forEach(
    i =>
      (i.onchange = () => {
        const id = i.dataset.a,
          f = i.dataset.f;
        if (!setAF(id, f, i)) return;
        saveData();
        if (i.type === 'checkbox' || i.tagName === 'SELECT' || REFRESH_FIELDS.includes(f) || f === 'name') {
          const c = box.querySelector(`[data-card="${id}"]`);
          if (c) {
            c.outerHTML = weapCard(id);
            bindDataTab();
          }
        } else {
          const w = document.getElementById('wd-' + id);
          if (w) w.innerHTML = dmgPreview(A[id], id);
        }
        if (S && !S.sim) render();
      }),
  );
  box.querySelectorAll('[data-ra]').forEach(
    b =>
      (b.onclick = () => {
        const id = b.dataset.ra;
        A[id] = clone(DEF_A[id]);
        saveData();
        renderDataTab();
        render();
      }),
  );
  box.querySelectorAll('[data-dela]').forEach(
    b =>
      (b.onclick = () => {
        const id = b.dataset.dela;
        markActOwners(id);
        for (const t of Object.values(T)) t.acts = t.acts.filter(x => x !== id);
        delete A[id];
        saveData();
        renderDataTab();
        render();
      }),
  );
  const nw = $('#newWeap');
  if (nw)
    nw.onclick = () => {
      const id = 'w' + Date.now().toString(36);
      A[id] = {
        name: 'Новое оружие',
        cost: 1,
        kind: 'attack',
        pcls: 'med',
        ptyp: 'cut',
        reach: 1,
      };
      saveData();
      renderDataTab();
      const c = box.querySelector(`[data-card="${id}"] input`);
      if (c) {
        c.focus();
        c.select();
      }
    };
  const cp = $('#ioCopy');
  if (cp)
    cp.onclick = () => {
      const ta = $('#ioText');
      const ok = () => msg('Скопировано');
      const fb = () => {
        ta.focus();
        ta.select();
        msg('Текст выделен — нажмите Ctrl+C');
      };
      try {
        navigator.clipboard.writeText(ta.value).then(ok, fb);
      } catch (e) {
        fb();
      }
    };
  const ld = $('#ioLoad');
  if (ld)
    ld.onclick = () => {
      try {
        mergeData(JSON.parse($('#ioText').value));
        DATA_ALL = true;
        saveData();
        msg('Загружено. Бой начнётся заново, когда вы закроете окно.');
        render();
      } catch (e) {
        msg('Не удалось загрузить: ' + (e.message || 'текст не похож на сохранённые значения'));
      }
    };
  const rs = $('#ioReset');
  if (rs)
    rs.onclick = () => {
      mergeData({
        T: {},
        A: {},
      });
      DATA_ALL = true;
      saveData();
      $('#ioText').value = JSON.stringify({
        v: DATA_V,
        T,
        A,
      });
      msg('Все значения возвращены к своду. Бой начнётся заново, когда вы закроете окно.');
      render();
    };
}
export function applyTemplates() {
  if (!DATA_DIRTY.size && !DATA_ALL) {
    render();
    return;
  }
  const all = DATA_ALL,
    dirty = new Set(DATA_DIRTY);
  DATA_DIRTY.clear();
  DATA_ALL = false;
  const fix = list =>
    list
      .filter(u => T[u.tpl])
      .map(u => {
        if (!all && !dirty.has(u.tpl)) return u;
        const t = T[u.tpl],
          old = u.tname || t.name,
          suffix = u.name.startsWith(old) ? u.name.slice(old.length) : '';
        Object.assign(u.base, {
          str: t.str,
          dex: t.dex,
          int: t.int,
          cha: t.cha,
        });
        Object.assign(u, {
          size: t.size || 1,
          nv: !!t.nightVision,
          traps: t.traps || 0,
          ammo: ammoOf(t),
          wield: weaponsOf(t)[0] || null,
          freeReload: !!t.freeReload,
          bandages: t.bandages || 0,
          torches: Math.max(0, (t.torches || 0) - (u.torch ? 1 : 0)),
          armor: t.armor,
          shield: t.shield || 0,
          will: t.will,
          glyph: t.glyph,
          acts: t.acts.filter(id => A[id]),
          ai: t.ai,
          name: t.name + suffix,
          tname: t.name,
        });
        return u;
      });
  if (S.editor) {
    S.units = fix(S.units);
    render();
    log('<div class="lb">Значения персонажей обновлены</div>', 'sys');
    return;
  }
  const snap = S.initial;
  snap.units = fix(snap.units);
  startGame(snap);
  log('<div class="lb">Значения персонажей обновлены, бой начат заново</div>', 'sys');
}
