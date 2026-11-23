/* Экспедиция: серия боёв подряд, герои переносят состояние из боя в бой.
   Между боями — привал, его щедрость настраивается:
   A «Короткий привал» (по умолчанию): Боль −N, потерявшие сознание приходят в себя, кровь останавливают;
     раны, Воля, бинты и факелы — как есть;
   B «Долгий отдых»: Боль сбрасывается, остальное как в A;
   C «Без привала»: всё как есть, даже кровотечение и обмороки. */
import { SCN } from '../data/scenarios';
import { log } from '../rules/log';
import { limOf, painOf } from '../rules/pain';
import { S, parseScenario } from '../state';
import { $, esc } from '../util';
import { startGame } from './game';
import { closeModal, openModal } from './modals';
import { HOOKS, render } from './panels';

type Rest = { mode: 'A' | 'B' | 'C'; n: number };
export const EXP = {
  on: false,
  list: [] as string[],
  i: 0,
  rest: { mode: 'A', n: 2 } as Rest,
  party: null as any[] | null,
  fallen: [] as string[],
};
const DEF_LIST = ['dummies', 'heights', 'dummies6'];
const KEEP = [
  'maxHp',
  'hp',
  'lim',
  'armorPts',
  'ko',
  'dead',
  'deathSteps',
  'wounds',
  'bleed',
  'will',
  'bandages',
  'torches',
  'traps',
  'ammo',
  'fract',
  'disorder',
  'torch',
  'down',
];
/* Боль, броня и обморок восстанавливаются при подготовке к бою (painPrep) из u._carry */
const VIA_PREP = ['maxHp', 'hp', 'lim', 'armorPts', 'ko', 'dead', 'deathSteps'];

try {
  const o = JSON.parse(localStorage.getItem('polygon2-exp') || 'null');
  if (o && o.rest) Object.assign(EXP.rest, o.rest);
  if (o && Array.isArray(o.list) && o.list.every(id => SCN[id])) EXP.list = o.list;
} catch (e) {}
const save = () => {
  try {
    localStorage.setItem('polygon2-exp', JSON.stringify({ rest: EXP.rest, list: EXP.list }));
  } catch (e) {}
};

const REST_TXT = {
  A: n =>
    `Короткий привал: Боль −${n}, потерявшие сознание приходят в себя, кровь остановлена; раны, Воля, бинты и факелы — как есть`,
  B: () =>
    'Долгий отдых: Боль сбрасывается, потерявшие сознание приходят в себя, кровь остановлена; раны, Воля, бинты и факелы — как есть',
  C: () => 'Без привала: всё как есть, даже кровотечение и обмороки',
};
export const restText = (r: Rest = EXP.rest) => REST_TXT[r.mode](r.n);

/* Привал над сохранённым состоянием героя. Возвращает строку для журнала. */
export function applyRest(h, r: Rest) {
  if (h.dead || r.mode === 'C') return '';
  const p0 = painOf(h);
  if (r.mode === 'B') h.hp = h.maxHp;
  else h.hp = Math.min(h.maxHp, h.hp + Math.max(0, r.n));
  h.bleed = 0;
  let woke = false;
  if (h.down) {
    h.down = false;
    h.ko = false;
    woke = true;
    /* очнувшийся — не за порогом: Боль не выше предела минус один */
    const L = limOf(h);
    if (painOf(h) >= L) h.hp = h.maxHp - (L - 1);
  }
  const d = p0 - painOf(h);
  return [d > 0 ? `Боль −${d}` : '', woke ? 'пришёл в себя' : ''].filter(Boolean).join(', ');
}

function heroState(u) {
  const o: any = { tpl: u.tpl, name: u.name };
  for (const k of KEEP) if (u[k] !== undefined) o[k] = JSON.parse(JSON.stringify(u[k]));
  return o;
}

/* Подставить героев из прошлого боя в расстановку следующего. */
function carry(snap) {
  if (!EXP.party) return snap;
  const used = new Set();
  snap.units = snap.units.filter(u => {
    if (u.side !== 'pc') return true;
    const h = EXP.party.find((o, i) => o.tpl === u.tpl && !used.has(i) && (used.add(i), true));
    if (!h || h.dead) return false;
    for (const k of KEEP) if (h[k] !== undefined && !VIA_PREP.includes(k)) u[k] = JSON.parse(JSON.stringify(h[k]));
    u._carry = {
      pain: Math.max(0, h.maxHp - h.hp),
      armorPts: h.armorPts,
      ko: h.ko,
      dead: h.dead,
      deathSteps: h.deathSteps,
    };
    u.stunned = false;
    u.prone = !!u.down;
    return true;
  });
  /* носитель факела, как в начале любого боя: если ни у кого не горит, зажигают из запаса */
  const pcs = snap.units.filter(u => u.side === 'pc' && !u.down);
  if (!pcs.some(u => u.torch)) {
    const b = pcs.find(u => u.torches > 0);
    if (b) {
      b.torch = true;
      b.torches--;
    }
  }
  return snap;
}

function startStage() {
  const id = EXP.list[EXP.i];
  $('#scn').value = id;
  startGame(carry(parseScenario(id)));
}

export function startExpedition(list = EXP.list.length ? EXP.list : DEF_LIST) {
  EXP.on = true;
  EXP.list = list.slice();
  EXP.i = 0;
  EXP.party = null;
  EXP.fallen = [];
  save();
  startStage();
}
export function stopExpedition() {
  EXP.on = false;
  EXP.party = null;
  render();
}

/* После победы: собрать героев, устроить привал, перейти к следующему бою. */
export function nextStage() {
  if (!EXP.on || S.over !== 'pc') return;
  const heroes = S.units.filter(u => u.side === 'pc');
  EXP.party = heroes.map(heroState);
  const notes = [];
  for (const h of EXP.party) {
    if (h.dead) {
      if (!EXP.fallen.includes(h.name)) EXP.fallen.push(h.name);
      continue;
    }
    const t = applyRest(h, EXP.rest);
    if (t) notes.push(`${esc(h.name)}: ${t}`);
  }
  EXP.i++;
  startStage();
  log(
    `<div class="lb">Экспедиция, бой ${EXP.i + 1} из ${EXP.list.length}. ${esc(restText())}.${notes.length ? ' ' + notes.join('; ') + '.' : ''}${EXP.fallen.length ? ' Павшие: ' + EXP.fallen.map(esc).join(', ') + '.' : ''}</div>`,
    'sys',
  );
}

/* Строка над полем и кнопки в итогах боя. */
HOOKS.badge = () =>
  EXP.on ? `<span class="expb" title="${esc(restText())}">Экспедиция ${EXP.i + 1}/${EXP.list.length}</span>` : '';

HOOKS.bannerHtml = () => {
  if (!EXP.on) return '';
  const last = EXP.i >= EXP.list.length - 1;
  if (S.over === 'pc' && !last) {
    const nx = SCN[EXP.list[EXP.i + 1]];
    return `<div class="expn"><b>Экспедиция: бой ${EXP.i + 1} из ${EXP.list.length} пройден.</b> <span class="dim">${esc(restText())}.</span></div>
      <div class="bbtn"><button type="button" class="primary" id="bnNext">Привал и дальше: ${esc(nx ? nx.name : '')}</button><button type="button" id="bnExpStop">Закончить экспедицию</button></div>`;
  }
  if (S.over === 'pc')
    return `<div class="expn"><b>Экспедиция пройдена: ${EXP.list.length} из ${EXP.list.length}.</b>${EXP.fallen.length ? ` <span class="dim">Павшие: ${EXP.fallen.map(esc).join(', ')}.</span>` : ''}</div>`;
  return `<div class="expn"><b>Экспедиция окончена на бою ${EXP.i + 1} из ${EXP.list.length}.</b> <span class="dim">«Переиграть» повторит этот бой с теми же ранами.</span></div>`;
};
HOOKS.bannerMount = () => {
  const n = $('#bnNext');
  if (n) n.onclick = nextStage;
  const s = $('#bnExpStop');
  if (s)
    s.onclick = () => {
      stopExpedition();
      $('#banner').hidden = true;
    };
};

/* Окно настройки: порядок боёв и щедрость привала. */
export function openExpedition() {
  const ids = Object.keys(SCN).filter(id => id !== 'sandbox');
  const list = EXP.list.length ? EXP.list.slice() : DEF_LIST.slice();
  const draw = () => {
    $('#expList').innerHTML = list
      .map(
        (id, i) =>
          `<li><span class="n">${i + 1}</span><select data-i="${i}" aria-label="Бой ${i + 1}">${ids.map(s => `<option value="${s}"${s === id ? ' selected' : ''}>${esc(SCN[s].name)}</option>`).join('')}</select><button type="button" class="ghost" data-del="${i}" aria-label="Убрать бой ${i + 1}"${list.length < 2 ? ' disabled' : ''}>✕</button></li>`,
      )
      .join('');
    $('#expList')
      .querySelectorAll('select')
      .forEach((s: HTMLSelectElement) => (s.onchange = () => (list[+s.dataset.i] = s.value)));
    $('#expList')
      .querySelectorAll('[data-del]')
      .forEach((b: HTMLElement) => (b.onclick = () => (list.splice(+b.dataset.del, 1), draw())));
  };
  const r = EXP.rest;
  openModal(
    `<h2>Экспедиция</h2><p class="dim">Несколько боёв подряд. Герои переходят из боя в бой со своей Болью, ранами, Волей и припасами; павшие не возвращаются. Между боями — привал.</p>
    <h3>Бои по порядку</h3><ol class="expl" id="expList"></ol><button type="button" id="expAdd">Добавить бой</button>
    <h3>Привал между боями</h3>
    <div class="radios" role="radiogroup" aria-label="Привал">
      <label><input type="radio" name="rest" value="A"${r.mode === 'A' ? ' checked' : ''}> <b>Короткий привал</b> <span class="dim">— Боль −<input type="number" class="ni" id="restN" min="0" max="9" value="${r.n}" aria-label="Сколько Боли снимает привал">, потерявшие сознание приходят в себя, кровь остановлена; раны, Воля, бинты и факелы — как есть. По умолчанию</span></label>
      <label><input type="radio" name="rest" value="B"${r.mode === 'B' ? ' checked' : ''}> <b>Долгий отдых</b> <span class="dim">— Боль сбрасывается, остальное как при коротком привале</span></label>
      <label><input type="radio" name="rest" value="C"${r.mode === 'C' ? ' checked' : ''}> <b>Без привала</b> <span class="dim">— всё как есть, даже кровотечение и обмороки</span></label>
    </div>
    <div class="bbtn">${EXP.on ? '<button type="button" id="expStop">Прервать текущую</button>' : ''}<button type="button" class="primary" id="expGo">Начать экспедицию</button></div>`,
    () => {
      draw();
      $('#expAdd').onclick = () => {
        list.push(list[list.length - 1] || DEF_LIST[0]);
        draw();
      };
      const sync = () => {
        const m = (document.querySelector('input[name="rest"]:checked') as HTMLInputElement)?.value as Rest['mode'];
        EXP.rest = { mode: m || 'A', n: Math.max(0, Math.min(9, +($('#restN') as HTMLInputElement).value || 0)) };
        save();
      };
      document.querySelectorAll('input[name="rest"],#restN').forEach(i => i.addEventListener('change', sync));
      const st = $('#expStop');
      if (st)
        st.onclick = () => {
          stopExpedition();
          closeModal();
        };
      $('#expGo').onclick = () => {
        sync();
        closeModal();
        startExpedition(list);
      };
    },
  );
}
