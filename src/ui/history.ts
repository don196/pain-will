import { S, SIMULATING, setS } from '../state';
import { newSeed, rngState, seedRng, setRngState } from '../rng';
import { $ } from '../util';
import { appendLog, layoutBoard } from './board';
import { render } from './panels';
import { zoomReset } from './zoom';

/* Отмена и повтор: перед каждым действием игрока и завершением хода запоминаем всё состояние боя
   вместе с состоянием генератора случайности. Отмена → те же кубики; «Другие кубики» — новое зерно с этого места. */
const UNDO = [],
  REDO = [];
const LIMIT = 80;

function snap() {
  return { s: structuredClone(S), rng: rngState() };
}
function restore(x) {
  setS(structuredClone(x.s));
  setRngState(x.rng);
  S.busy = false;
  S.act = null;
  S.pendT = null;
  S.hover = null;
  const lg = $('#log');
  lg.innerHTML = '';
  for (const e of S.log) appendLog(e);
  $('#fx').innerHTML = '';
  $('#banner').hidden = true;
  $('#banner').dataset.over = '';
  $('#banner').dataset.closed = '';
  layoutBoard();
  zoomReset(false, true);
  render();
}
export function remember() {
  if (!S || S.sim || SIMULATING || S.editor) return;
  try {
    UNDO.push(snap());
    if (UNDO.length > LIMIT) UNDO.shift();
    REDO.length = 0;
  } catch (e) {
    console.warn('история: не удалось сохранить', e);
  }
}
export const canUndo = () => UNDO.length > 0 && !!S && !S.busy && !S.editor;
export const canRedo = () => REDO.length > 0 && !!S && !S.busy && !S.editor;
export function undo() {
  if (!canUndo()) return;
  REDO.push(snap());
  restore(UNDO.pop());
}
export function redo() {
  if (!canRedo()) return;
  UNDO.push(snap());
  restore(REDO.pop());
}
/* Новое зерно с текущего места: следующие броски будут другими. Отмена его не возвращает. */
export function reroll() {
  if (!S || S.busy) return;
  const s = newSeed();
  seedRng(s);
  S.seedNote = s;
  REDO.length = 0;
  render();
}
export function clearHistory() {
  UNDO.length = 0;
  REDO.length = 0;
}
