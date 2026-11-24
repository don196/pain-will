import { view } from './view';
import { initPhone } from './ui/phone';
import { EXP, openExpedition, stopExpedition } from './ui/expedition';
import { setSound, sfxLog, soundOn } from './ui/sound';
import { appendLog, drawFloor, drawLight, flash, fxLine, fxText, renderTokens } from './ui/board';
import { askChoice } from './ui/prompt';
import { play } from './ui/anim';
import { LP, initZoom, zoomReset } from './ui/zoom';
import './debug';
import { SCN } from './data/scenarios';
import { isHuman } from './rules/actions';
import { log } from './rules/log';
import { S, SIMULATING, alive } from './state';
import { layoutBoard, loop, renderHL } from './ui/board';
import { CTX, closeCtx } from './ui/ctxmenu';
import { BAL_V, OLD_DATA, loadData, openData } from './ui/data-editor';
import { toggleEditor } from './ui/editor';
import { loadScenario, restart, startGame } from './ui/game';
import { endTurnUI, hideTip, notePointer, onCellClick, onCellHover, showCellTip } from './ui/input';
import { redo, undo } from './ui/history';
import { applyTables } from './rules/pain';
import { closeModal, openNotes, openRules } from './ui/modals';
import { initUI2, render } from './ui/panels';
import { openOdds, openSim } from './ui/sim';
import { $ } from './util';

function init(data) {
  loadData();
  applyTables();
  $('#scn').innerHTML = Object.entries(SCN)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
    .join('');
  $('#scn').onchange = e => {
    if (EXP.on) stopExpedition();
    if (!SIMULATING) loadScenario(e.target.value);
  };
  $('#btnRestart').onclick = () => restart();
  $('#btnRestart2').onclick = () => {
    ($('#tmenu') as HTMLDetailsElement).open = false;
    restart();
  };
  $('#btnEditor').onclick = () => toggleEditor(!S.editor);
  $('#btnOdds').onclick = openOdds;
  $('#btnSim').onclick = openSim;
  $('#btnRules').onclick = openRules;
  $('#btnNotes').onclick = openNotes;
  $('#btnExp').onclick = () => {
    if (!SIMULATING) openExpedition();
  };
  const sb = $('#btnSound');
  const syncSb = () => {
    sb.textContent = soundOn() ? 'Звук: вкл' : 'Звук: выкл';
    sb.setAttribute('aria-pressed', String(soundOn()));
  };
  syncSb();
  sb.onclick = () => {
    setSound(!soundOn());
    syncSb();
  };
  $('#btnData').onclick = () => {
    if (!SIMULATING) openData();
  };
  $('#btnClearLog').onclick = () => {
    $('#log').innerHTML = '';
    S.log = [];
  };
  initUI2();
  document.querySelectorAll('#tmenu nav button').forEach(b =>
    b.addEventListener('click', () => {
      ($('#tmenu') as HTMLDetailsElement).open = false;
    }),
  );
  $('#modal').onclick = e => {
    if (e.target.id === 'modal' && !SIMULATING) closeModal();
  };
  const hl = $('#hl');
  hl.addEventListener('click', onCellClick);
  $('#toks').addEventListener('click', onCellClick);
  $('#toks').addEventListener('mousemove', onCellHover);
  hl.addEventListener('mousemove', onCellHover);
  hl.addEventListener('mouseleave', () => {
    S.hover = null;
    hideTip();
    renderHL();
  });
  hl.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (S.act) {
      S.act = null;
      hideTip();
      render();
    }
  });
  document.addEventListener('keydown', e => {
    if (!$('#prompt').hidden) return;
    if (e.key === 'Escape') {
      if (CTX) {
        closeCtx();
        return;
      }
      if (!$('#modal').hidden && !SIMULATING) {
        closeModal();
        return;
      }
      if (S.pendT != null) {
        S.pendT = null;
        renderHL();
        return;
      }
      if (S.act) {
        S.act = null;
        hideTip();
        render();
      }
      return;
    }
    if (!$('#modal').hidden || (e.target as HTMLElement).matches('input,select')) return;
    if (e.key === 'Enter') {
      endTurnUI();
      e.preventDefault();
      return;
    }
    if ((e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') && !e.altKey) {
      if (e.shiftKey) redo();
      else undo();
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && S && !S.editor && !S.busy && isHuman(S.phase)) {
      const hs = alive(S.phase).filter(o => o.od > 0);
      if (hs.length) {
        const k = hs.findIndex(o => o.id === S.sel);
        S.sel = hs[(k + (e.shiftKey ? hs.length - 1 : 1)) % hs.length].id;
        S.act = null;
        render();
      }
      e.preventDefault();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const b = $('#acts').querySelector(`[data-key="${e.key}"]`);
      if (b) b.click();
    }
  });
  document.addEventListener('pointerdown', notePointer, true);
  document.addEventListener('pointerdown', e => {
    const el = e.target as HTMLElement;
    const tm = $('#tmenu');
    if (tm && tm.open && !el.closest('#tmenu')) tm.open = false;
    if (CTX && !el.closest('#ctxm') && !el.closest('#board')) closeCtx();
  });
  window.addEventListener(
    'scroll',
    () => {
      if (CTX && window.innerWidth > 700) closeCtx();
    },
    true,
  );
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (S) {
        layoutBoard();
        zoomReset();
      }
    }, 120);
  });
  initZoom();
  LP.cell = showCellTip;
  initPhone();
  requestAnimationFrame(loop);
  const lay = data && data.layout && data.layout.units ? data.layout : null;
  if (lay && data.bal === BAL_V) {
    $('#scn').value = lay.scn || 'dummies';
    startGame(lay);
  } else if (lay && SCN[lay.scn]) {
    loadScenario('dummies');
    log('<div class="lb">Баланс обновился: сценарий собран заново с новыми значениями</div>', 'sys');
  } else loadScenario('dummies');
  if (OLD_DATA)
    log(
      '<div class="lb">Сохранённые в браузере значения персонажей и оружия сброшены: баланс обновился. Теперь браузер хранит только ваши изменения, и новые значения свода до них доходят</div>',
      'sys',
    );
}

// Интерфейс подставляет свои функции вместо пустышек правил.
Object.assign(view, {
  render,
  renderTokens,
  drawFloor,
  drawLight,
  fxText,
  fxLine,
  flash,
  hideTip,
  appendLog: e => {
    appendLog(e);
    sfxLog(e);
  },
  askChoice,
  play,
});

init({});
