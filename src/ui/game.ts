import { SCN } from '../data/scenarios';
import { log } from '../rules/log';
import { initCombat, phaseLoop } from '../rules/turns';
import { GEN, S, SIMULATING, buildState, parseScenario, setGEN, setS } from '../state';
import { layoutBoard } from './board';
import { hideTip } from './input';
import { render } from './panels';
import { closePrompt } from './prompt';
import { $, CANCEL } from '../util';

export function startGame(snap) {
  setGEN(GEN + 1);
  closePrompt(null);
  hideTip();
  setS(buildState(snap));
  $('#log').innerHTML = '';
  $('#fx').innerHTML = '';
  $('#banner').hidden = true;
  $('#banner').dataset.closed = '';
  $('#banner').dataset.over = '';
  $('#btnEditor').classList.remove('on');
  layoutBoard();
  const sc = SCN[S.scn];
  log(`<div class="lb">Сценарий: ${sc ? sc.name : 'своя расстановка'}</div>`, 'sys');
  initCombat();
  const first = S.units.find(u => u.side === 'pc');
  S.sel = first ? first.id : null;
  render();
  S.busy = true;
  phaseLoop().catch(e => {
    if (e !== CANCEL) console.error(e);
  });
}

export function loadScenario(id) {
  $('#scn').value = id;
  startGame(parseScenario(id));
}

export function restart() {
  if (SIMULATING) return;
  startGame(S.initial);
}
