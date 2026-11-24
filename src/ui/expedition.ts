/* Экспедиция: серия боёв подряд, герои переносят состояние из боя в бой.
   Отдых по своду 2.4 (§5.1):
   A «После боя» (по умолчанию): сразу снимается половина Боли (снятое округляется вверх: 5 → 2, 4 → 2, 1 → 0);
     открытые раны перевязывают бинтами отряда; потерявший сознание приходит в себя только с помощью союзника
     и только когда кровотечение остановлено;
   B «После боя и передышка» (30 минут): то же, затем снимается вся оставшаяся Боль; раны и кровотечение передышка не лечит;
   C «Без отдыха»: всё как есть. */
import { SCN } from '../data/scenarios';
import { log } from '../rules/log';
import { limOf, painOf } from '../rules/pain';
import { S, parseScenario } from '../state';
import { $, esc } from '../util';
import { startGame } from './game';
import { closeModal, openModal } from './modals';
import { HOOKS, render } from './panels';

type Rest = { mode: 'A' | 'B' | 'C'; n?: number };
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
  'bleedX',
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
  A: () => 'После боя: снята половина Боли, раны перевязаны бинтами отряда, потерявших сознание привели в чувство',
  B: () =>
    'После боя и передышка 30 минут: Боль снята вся, раны перевязаны бинтами отряда, потерявших сознание привели в чувство',
  C: () => 'Без отдыха: всё как есть',
};
export const restText = (r: Rest = EXP.rest) => (REST_TXT[r.mode] || REST_TXT.A)();

const openW = h => Object.values(h.wounds || {}).filter((w: any) => w && w.open) as any[];
const sev = h => (h.bleedX || 0) + openW(h).reduce((s, w) => s + w.deg, 0);

/* Отдых отряда над сохранёнными состояниями героев. Возвращает заметки для журнала по имени. */
export function restParty(party: any[], r: Rest) {
  const notes = {};
  const add = (h, t) => (notes[h.name] = (notes[h.name] ? notes[h.name] + ', ' : '') + t);
  const alive = party.filter(h => !h.dead);
  if (r.mode === 'C') return notes;
  /* 1. сразу после боя — половина Боли, снятое округляется вверх */
  for (const h of alive) {
    const p = painOf(h),
      off = Math.ceil(p / 2);
    if (off) {
      h.hp = Math.min(h.maxHp, Math.max(0, h.hp) + off);
      add(h, `Боль −${off}`);
    }
  }
  /* 2. перевязка бинтами отряда: сначала кровоточащие и без сознания, бинт закрывает до трёх открытых ран */
  const need = alive
    .filter(h => openW(h).length || h.bleedX)
    .sort((a, b) => (b.down ? 9 : 0) + sev(b) - ((a.down ? 9 : 0) + sev(a)));
  for (const h of need) {
    const donor =
      h.bandages > 0 ? h : alive.filter(o => o.bandages > 0 && !o.down).sort((a, b) => b.bandages - a.bandages)[0];
    if (!donor) break;
    donor.bandages--;
    let pts = 3,
      n = 0;
    for (const w of openW(h).sort((a, b) => b.deg - a.deg)) {
      if (pts <= 0) break;
      w.open = false;
      pts--;
      n++;
    }
    if (pts > 0 && h.bleedX) h.bleedX = 0;
    add(h, `перевязан${donor !== h ? ' (бинт ' + donor.name + ')' : ''}: закрыто ран ${n}`);
  }
  for (const h of alive) {
    const s = sev(h);
    h.bleed = s >= 2 ? s : 0;
  }
  /* 3. без сознания — приходит в себя только с помощью союзника в сознании и если кровь остановлена (5 минут) */
  const helper = alive.find(h => !h.down);
  for (const h of alive)
    if (h.down && !h.dead) {
      if (helper && !h.bleed) {
        h.down = false;
        h.ko = false;
        h.deathSteps = 0;
        const L = limOf(h);
        if (painOf(h) >= L) h.hp = h.maxHp - (L - 1);
        add(h, `приведён в чувство (${helper.name})`);
      } else add(h, helper ? 'кровотечение не остановить — остаётся без сознания' : 'привести в чувство некому');
    }
  /* 4. передышка 30 минут — вся оставшаяся Боль */
  if (r.mode === 'B')
    for (const h of alive)
      if (!h.down && painOf(h) > 0) {
        h.hp = h.maxHp;
        add(h, 'передышка: Боль снята вся');
      }
  return notes;
}
/* Совместимость: отдых одного героя (без бинтов отряда). */
export function applyRest(h, r: Rest) {
  const n = restParty([h], r);
  return n[h.name] || '';
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
  for (const h of EXP.party) if (h.dead && !EXP.fallen.includes(h.name)) EXP.fallen.push(h.name);
  const nt = restParty(EXP.party, EXP.rest),
    notes = Object.entries(nt).map(([k, v]) => `${esc(k)}: ${v}`);
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
    <h3>Отдых между боями (свод 2.4)</h3>
    <div class="radios" role="radiogroup" aria-label="Отдых">
      <label><input type="radio" name="rest" value="A"${r.mode === 'A' ? ' checked' : ''}> <b>Только после боя</b> <span class="dim">— снимается половина Боли (снятое вверх: 5 → 2, 4 → 2, 1 → 0); открытые раны перевязывают бинтами отряда; без сознания — приходит в себя с помощью союзника, если кровь остановлена. По умолчанию</span></label>
      <label><input type="radio" name="rest" value="B"${r.mode === 'B' ? ' checked' : ''}> <b>После боя и передышка 30 минут</b> <span class="dim">— то же, затем снимается вся Боль; раны и кровотечение передышка не лечит</span></label>
      <label><input type="radio" name="rest" value="C"${r.mode === 'C' ? ' checked' : ''}> <b>Без отдыха</b> <span class="dim">— всё как есть</span></label>
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
        EXP.rest = { mode: m || 'A' };
        save();
      };
      document.querySelectorAll('input[name="rest"]').forEach(i => i.addEventListener('change', sync));
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
