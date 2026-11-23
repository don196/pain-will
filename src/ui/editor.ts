import { TERRAIN, TERRAIN_TOOLS } from '../data/terrain';
import { placeTerr } from '../rules/terrain';
import { T } from '../data/fighters';
import { footFree, inFoot, torchAt, unitAt } from '../rules/geometry';
import { H_MAX, H_MIN } from '../rules/height';
import { log } from '../rules/log';
import { GEN, S, SIMULATING, UID, byId, mkUnit, nameUnit, setGEN, setUID, snapshotNow } from '../state';
import { drawFloor, drawLight } from './board';
import { startGame } from './game';
import { render } from './panels';
import { closePrompt } from './prompt';
import { $, esc, key } from '../util';

export function renderEditor(box) {
  const tools = [
    ['unit', 'Поставить бойца'],
    ['moveu', 'Переставить'],
    ['erase', 'Убрать бойца'],
    ['wall', 'Стена'],
    ['floor', 'Пол (убрать всё)'],
    ['torch', 'Факел на стене'],
    ['door', 'Дверь: поставить / открыть'],
    ['lock', 'Дверь: запереть / отпереть'],
    ['bars', 'Решётка'],
    ['barsShoot', 'Решётка: бить сквозь неё / нет'],
    ['hup', 'Высота +1'],
    ['hdown', 'Высота −1'],
    ['stairs', 'Лестница: поставить / убрать'],
    ...TERRAIN_TOOLS.map(([t, l]) => ['t:' + t, l]),
    ['terase', 'Убрать предмет или воду'],
  ];
  box.innerHTML = `<div class="panel"><h2 class="ph">Редактор поля</h2>
    <div class="ed-tools">${tools.map(([k, l]) => `<button type="button" data-tool="${k}" class="${S.etool === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="edrow"><label for="eTpl">Боец</label><select id="eTpl">${Object.keys(T)
      .map(
        k =>
          `<option value="${k}" ${S.etpl === k ? 'selected' : ''}>${esc(T[k].name)}${(T[k].size || 1) > 1 ? ' (3 гекса)' : ''}</option>`,
      )
      .join('')}</select>
    <select id="eSide" aria-label="Сторона"><option value="pc" ${S.eside === 'pc' ? 'selected' : ''}>герои</option><option value="en" ${S.eside === 'en' ? 'selected' : ''}>противники</option></select></div>
    <p class="help">Нажимайте на клетки поля. Крупного бойца (3 гекса) ставьте за его левый верхний гекс. Высота клетки — от 0 до 6; лестница убирает доплату за подъём на соседний уровень. Выбранного бойца можно править в карточке.</p>
    <div class="row" style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="primary" id="eStart">Начать бой с этой расстановкой</button><button type="button" id="eClear">Очистить поле</button></div></div>`;
  box.querySelectorAll('[data-tool]').forEach(
    b =>
      (b.onclick = () => {
        S.etool = b.dataset.tool;
        S.emove = null;
        render();
      }),
  );
  $('#eTpl').onchange = e => {
    S.etpl = e.target.value;
    S.eside = T[S.etpl].side;
    S.etool = 'unit';
    render();
  };
  $('#eSide').onchange = e => {
    S.eside = e.target.value;
  };
  $('#eStart').onclick = () => toggleEditor(false);
  $('#eClear').onclick = () => {
    S.units = [];
    S.walls = new Set();
    S.doors = {};
    S.bars = {};
    for (let x = 0; x < S.w; x++) {
      S.walls.add(key(x, 0));
      S.walls.add(key(x, S.h - 1));
    }
    for (let y = 0; y < S.h; y++) {
      S.walls.add(key(0, y));
      S.walls.add(key(S.w - 1, y));
    }
    S.torches = [];
    S.hgt = {};
    S.stairs = {};
    S.terrain = {};
    S.lv = (S.lv || 0) + 1;
    drawFloor();
    drawLight(performance.now());
    render();
  };
}

export function editorClick(x, y) {
  const k = key(x, y),
    u = unitAt(x, y) || S.units.find(o => inFoot(o, x, y));
  const clearCell = () => {
    S.walls.delete(k);
    delete S.doors[k];
    delete S.bars[k];
    if (S.terrain) delete S.terrain[k];
    S.torches = S.torches.filter(t => !(t.x === x && t.y === y));
  };
  /* окружение 4.5: сплошной предмет не ставится под бойца */
  if (S.etool.startsWith('t:') || S.etool === 'terase') {
    if (S.etool === 'terase') {
      if (S.terrain) delete S.terrain[k];
    } else {
      const type = S.etool.slice(2),
        def = TERRAIN[type];
      if (def && !(def.solid && u)) {
        clearCell();
        placeTerr(x, y, type);
      }
    }
    S.lv = (S.lv || 0) + 1;
    drawFloor();
    drawLight(performance.now());
    render();
    return;
  }
  switch (S.etool) {
    case 'unit': {
      if (u) {
        S.sel = u.id;
        break;
      }
      const n = mkUnit(S.etpl, S.eside, x, y);
      if (footFree(n, x, y)) {
        nameUnit(n, S.units);
        S.units.push(n);
        S.sel = n.id;
      } else {
        setUID(UID - 1);
      }
      break;
    }
    case 'erase':
      if (u) {
        S.units = S.units.filter(o => o !== u);
        if (S.sel === u.id) S.sel = null;
      }
      break;
    case 'moveu':
      if (S.emove != null) {
        const m = byId(S.emove);
        if (m && footFree(m, x, y)) {
          m.x = x;
          m.y = y;
        }
        S.emove = null;
      } else if (u) {
        S.emove = u.id;
        S.sel = u.id;
      }
      break;
    case 'wall':
      if (!u) {
        clearCell();
        S.walls.add(k);
      }
      break;
    case 'floor':
      clearCell();
      if (S.hgt) delete S.hgt[k];
      if (S.stairs) delete S.stairs[k];
      break;
    case 'hup':
    case 'hdown': {
      if (S.walls.has(k) || S.doors[k] || S.bars[k]) break;
      S.hgt = S.hgt || {};
      const v = Math.max(H_MIN, Math.min(H_MAX, (S.hgt[k] || 0) + (S.etool === 'hup' ? 1 : -1)));
      if (v) S.hgt[k] = v;
      else delete S.hgt[k];
      break;
    }
    case 'stairs':
      if (S.walls.has(k) || S.doors[k] || S.bars[k]) break;
      S.stairs = S.stairs || {};
      if (S.stairs[k]) delete S.stairs[k];
      else S.stairs[k] = true;
      break;
    case 'torch': {
      const t = torchAt(x, y);
      if (t) S.torches = S.torches.filter(o => o !== t);
      else if (!u) {
        delete S.doors[k];
        delete S.bars[k];
        S.walls.add(k);
        S.torches.push({
          x,
          y,
          lit: true,
        });
      }
      break;
    }
    case 'door': {
      const d = S.doors[k];
      if (d) {
        if (d.open && u) break;
        d.open = !d.open;
        if (d.open) d.locked = false;
      } else if (!u) {
        clearCell();
        S.doors[k] = {
          open: false,
          locked: false,
        };
      }
      break;
    }
    case 'lock': {
      const d = S.doors[k];
      if (d) {
        d.locked = !d.locked;
        if (d.locked) d.open = false;
      } else if (!u) {
        clearCell();
        S.doors[k] = {
          open: false,
          locked: true,
        };
      }
      break;
    }
    case 'bars':
      if (!u) {
        if (S.bars[k]) delete S.bars[k];
        else {
          clearCell();
          S.bars[k] = {
            shoot: false,
          };
        }
      }
      break;
    case 'barsShoot':
      if (S.bars[k]) S.bars[k].shoot = !S.bars[k].shoot;
      else if (!u) {
        clearCell();
        S.bars[k] = {
          shoot: true,
        };
      }
      break;
  }
  S.lv = (S.lv || 0) + 1;
  drawFloor();
  drawLight(performance.now());
  render();
}

export function toggleEditor(on) {
  if (SIMULATING) return;
  if (on) {
    if (S.busy && !S.over) return;
    setGEN(GEN + 1);
    closePrompt(null);
    S.editor = true;
    S.act = null;
    S.busy = false;
    $('#btnEditor').classList.add('on');
    log('<div class="lb">Редактор поля включён</div>', 'sys');
    render();
    return;
  }
  const snap = snapshotNow();
  startGame(snap);
}
