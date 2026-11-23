/* Телефон: сворачиваемая панель действий, карточка бойца листом, поворот поля. */
import { S } from '../state';
import { $ } from '../util';
import { layoutBoard, ROT } from './board';
import { UI, closeCardSheet, openCardSheet, saveUI } from './panels';
import { LP, zoomReset } from './zoom';

function setDock(min: boolean) {
  UI.dockMin = min;
  saveUI();
  document.body.classList.toggle('dock-min', min);
  $('#dockTog').setAttribute('aria-expanded', String(!min));
  if (S) {
    layoutBoard();
    zoomReset();
  }
}

function syncRotBtn() {
  const b = $('#btnRot');
  if (!b) return;
  b.classList.toggle('on', ROT);
  b.title = ROT ? 'Поле повёрнуто — вернуть как было' : 'Повернуть поле вертикально';
  b.setAttribute('aria-pressed', String(ROT));
}

export function initPhone() {
  document.body.classList.toggle('dock-min', !!UI.dockMin);
  $('#dockTog').setAttribute('aria-expanded', String(!UI.dockMin));
  $('#dockTog').onclick = () => setDock(!UI.dockMin);
  /* смахнуть панель вниз — свернуть, вверх — развернуть */
  const dock = $('#dock');
  let y0 = null;
  dock.addEventListener(
    'touchstart',
    e => {
      const t = e.target as HTMLElement;
      y0 = t.closest('#dockTog,#ctx') ? e.touches[0].clientY : null;
    },
    { passive: true },
  );
  dock.addEventListener(
    'touchend',
    e => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      y0 = null;
      if (dy > 40 && !UI.dockMin) setDock(true);
      else if (dy < -40 && UI.dockMin) setDock(false);
    },
    { passive: true },
  );
  $('#sheetClose').onclick = closeCardSheet;
  $('#sheetBg').onclick = closeCardSheet;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) closeCardSheet();
  });
  LP.cb = id => openCardSheet(id);
  $('#btnRot').onclick = () => {
    UI.rot = ROT ? 'off' : 'on';
    saveUI();
    layoutBoard();
    zoomReset(true);
    syncRotBtn();
  };
  syncRotBtn();
  window.addEventListener('resize', () => setTimeout(syncRotBtn, 200));
}
