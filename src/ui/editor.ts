import { T } from '../data/fighters';
import { footFree, inFoot, torchAt, unitAt } from '../rules/geometry';
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
    <p class="help">Нажимайте на клетки поля. Крупного бойца (3 гекса) ставьте за его левый верхний гекс. Выбранного бойца можно править в карточке ниже.</p>
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
    S.torches = S.torches.filter(t => !(t.x === x && t.y === y));
  };
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
