import { SCN } from '../data/scenarios';
import { log } from '../rules/log';
import { initCombat, phaseLoop } from '../rules/turns';
import { GEN, S, SIMULATING, buildState, parseScenario, setGEN, setS } from '../state';
import { layoutBoard } from './board';
import { zoomReset } from './zoom';
import { clearHistory } from './history';
import { newSeed, seedRng } from '../rng';
import { hideTip } from './input';
import { render } from './panels';
import { closePrompt } from './prompt';
import { $, CANCEL } from '../util';

export function startGame(snap, seed?: number) {
  setGEN(GEN + 1);
  clearHistory();
  const sd = seed || newSeed();
  seedRng(sd);
  closePrompt(null);
  hideTip();
  setS(buildState(snap));
  S.seed = sd;
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
  zoomReset();
  S.busy = true;
  phaseLoop().catch(e => {
    if (e !== CANCEL) console.error(e);
  });
}

export function loadScenario(id) {
  $('#scn').value = id;
  startGame(parseScenario(id));
}

export function restart(sameSeed = false) {
  if (SIMULATING) return;
  startGame(S.initial, sameSeed ? S.seed : undefined);
}
