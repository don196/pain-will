import type { Unit } from '../types';
import { SET } from '../settings';
import { GEN, S } from '../state';
import { CANCEL, esc } from '../util';
import { view } from '../view';

export function uName(u: Unit) {
  return `<span class="nm ${u.side}" data-uid="${u.id}">${esc(u.name)}</span>`;
}

export function log(html, cls = '') {
  if (S.sim) return;
  const e = {
    html,
    cls,
  };
  S.log.push(e);
  if (S.log.length > 600) S.log.shift();
  view.appendLog(e);
}

export function ev(html) {
  log(html, 'ev');
}

export function sleep(ms) {
  if (!S || S.sim) return Promise.resolve();
  const g = GEN;
  const f = SET.anim === 'fast' ? 0.3 : 1;
  return new Promise<void>((res, rej) => setTimeout(() => (g === GEN ? res() : rej(CANCEL)), ms * f));
}

/* Показать событие боя и дождаться анимации. В симуляции — ничего. */
export async function show(e) {
  if (!S || S.sim) return;
  const g = GEN;
  await view.play(e);
  if (g !== GEN) throw CANCEL;
}
