/* Телефон и ноутбук: сворачиваемая панель действий, карточка бойца листом, поворот поля.
   Панель свёрнута — на телефоне три главных действия, на компьютере все действия одной строкой;
   на компьютере она свёрнута по умолчанию, чтобы поле получило высоту. */
import { S } from '../state';
import { $ } from '../util';
import { layoutBoard, ROT } from './board';
import { UI, closeCardSheet, openCardSheet, saveUI } from './panels';
import { LP, zoomReset } from './zoom';

const PH = () => window.innerWidth <= 700;
export const dockMin = () => (PH() ? !!UI.dockMin : UI.dockMinD !== false);
function syncDock() {
  const m = dockMin();
  document.body.classList.toggle('dock-min', m);
  const t = $('#dockTog');
  t.setAttribute('aria-expanded', String(!m));
  t.title = m ? 'Развернуть панель действий по группам' : 'Свернуть панель действий в одну строку';
}
function setDock(min: boolean) {
  if (PH()) UI.dockMin = min;
  else UI.dockMinD = min;
  saveUI();
  syncDock();
  if (S) {
    layoutBoard();
    zoomReset(false, true);
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
  syncDock();
  $('#dockTog').onclick = () => setDock(!dockMin());
  window.addEventListener('resize', syncDock);
  /* поменялась высота панели или ленты событий (другой боец, свернули, появились события) —
     поле пересчитывает свой размер */
  if ('ResizeObserver' in window) {
    let k0 = '',
      tm = 0;
    const sizes = () =>
      ['#dock', '#ribbon', '#wrap'].map(s => Math.round(($(s) as HTMLElement).offsetHeight / 6)).join(':');
    const ro = new ResizeObserver(() => {
      clearTimeout(tm);
      tm = window.setTimeout(() => {
        const k = sizes() + ':' + Math.round(($('#wrap') as HTMLElement).offsetWidth / 6);
        if (!S || k === k0) return;
        k0 = k;
        layoutBoard();
        zoomReset(false, true);
        k0 = sizes() + ':' + Math.round(($('#wrap') as HTMLElement).offsetWidth / 6);
      }, 60);
    });
    for (const s of ['#dock', '#ribbon', '#wrap']) ro.observe($(s));
  }
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
      if (dy > 40 && !dockMin()) setDock(true);
      else if (dy < -40 && dockMin()) setDock(false);
    },
    { passive: true },
  );
  /* на компьютере строку действий можно листать колесом */
  dock.addEventListener(
    'wheel',
    e => {
      const row = (e.target as HTMLElement).closest('.agroups') as HTMLElement;
      if (!row || PH() || !dockMin() || row.scrollWidth <= row.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
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
