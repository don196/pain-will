import type { Unit } from '../types';
import { A } from '../data/actions';
import {
  actCost,
  canControl,
  canTarget,
  perform,
  performMove,
  validCell,
  validThrow,
  validTrap,
} from '../rules/actions';
import { backstab, stOf } from '../rules/combat';
import { bfs, pairOptions, pathTo, torchAt } from '../rules/geometry';
import { curseCalc, validFlash, weakOf } from '../rules/magic';
import { openT } from '../rules/reactions';
import { hitCalc, pContest, speedOf, stat } from '../rules/stats';
import { S, selUnit } from '../state';
import { CELL, hc, tokPos } from './board';
import { IMMEDIATE, hideTip, run } from './input';
import { actMeta, actState, render, visibleActs, zocPreview } from './panels';
import { fxNames } from './status';
import { $, esc, fmtN, key, pct } from '../util';
export let CTX = null;
export function closeCtx() {
  CTX = null;
  const m = $('#ctxm');
  if (m) m.hidden = true;
}

/* Что выбранный герой может сделать с этим гексом, союзником или врагом. */
export function ctxOptions(u: Unit, p, t) {
  const out = [];
  if (!canControl(u)) return out;
  const self = t && t.id === u.id;
  for (const id of visibleActs(u)) {
    const a = A[id];
    if (!a || !actState(u, id).ok) continue;
    let tg = null,
      meta = '',
      warn = false;
    if (a.kind === 'move') {
      if (t) continue;
      const sp = speedOf(u),
        dist = bfs(u, {
          max: sp * Math.min(2, u.od),
        }),
        v = dist.get(key(p.x, p.y));
      if (!v || !v.d) continue;
      const zp = typeof zocPreview === 'function' ? zocPreview(u, pathTo(dist, p.x, p.y)) : [];
      out.push({
        id,
        name: 'Идти сюда',
        cost: v.d <= sp ? 1 : 2,
        meta: `${v.d} гекс.` + (zp.length ? ` · ⚠ ударит ${zp.map(z => z.e.name).join(', ')}` : ''),
        warn: zp.length > 0,
        run: () => performMove(u, p.x, p.y),
      });
      continue;
    }
    if (IMMEDIATE.includes(a.kind) || a.kind === 'wswap') {
      if (self)
        out.push({
          id,
          name: a.name,
          cost: actCost(u, id),
          meta: actMeta(u, id, a),
          run: () => perform(u, id),
        });
      continue;
    }
    switch (a.kind) {
      case 'pair':
        if (t && pairOptions(u).some(q => q.includes(t))) {
          tg = t;
          meta = 'по двоим, −3';
        }
        break;
      case 'throw':
        if (validThrow(u, a, p) && (!t || self)) tg = p;
        break;
      case 'trap':
        if (!t && validTrap(u, p)) tg = p;
        break;
      case 'flash':
        if (validFlash(u, p)) {
          tg = p;
          meta = 'в 1 гексе — слепота, в 2–3 — рябь, своих тоже';
          warn = true;
        }
        break;
      case 'door':
        if (validCell(u, a, p.x, p.y)) tg = p;
        break;
      default:
        if (t && canTarget(u, a, t)) {
          tg = t;
          if (a.kind === 'attack') {
            const h = hitCalc(u, a, t);
            meta =
              (a.lasso
                ? `успех ${pct(h.hit)} (нога)`
                : (h.hit < 1 ? `промах ${pct(1 - h.hit)} · ` : '') + `крит ${pct(h.p[3])}`) +
              (openT(t) ? ' · открыт: защититься нечем' : ` · у цели ${t.od} очк. реакции`) +
              (a.fixed == null ? ` · ≈${fmtN(h.Eact)} урона` : '') +
              (backstab(u, a, t) ? ' · в спину +3' : '');
          } else if (a.kind === 'push') {
            meta =
              'успех ' +
              pct(
                pContest(
                  stat(u, 'str') + (u.shield > 0 ? 2 : 0) + (stOf(t, 'unst') ? 3 : 0) - (u.prone ? 5 : 0),
                  stat(t, 'str'),
                  false,
                ),
              ) +
              (stOf(t, 'unst') ? ' · упадёт' : '');
          } else if (a.kind === 'curse2') {
            const c = curseCalc(u, a, t);
            meta =
              (c.land < 1 ? `ложится ${pct(c.land)}` : 'ложится всегда') +
              (id === 'curseWeak' ? ` · штраф ${[1, 2, 3].map(k => weakOf(u, k)).join('/')}, крит ${pct(c.p[3])}` : '');
          } else meta = actMeta(u, id, a);
        }
    }
    if (tg)
      out.push({
        id,
        name: a.name,
        cost: actCost(u, id),
        meta,
        warn,
        run: () => perform(u, id, tg),
      });
  }
  return out;
}
export function openCtx(e, p, t) {
  const u = selUnit(),
    m = $('#ctxm');
  hideTip();
  if (S.editor || S.busy || S.over) {
    if (t) {
      S.sel = t.id;
      S.act = null;
      render();
    }
    return;
  }
  const ops = ctxOptions(u, p, t);
  if (!ops.length) {
    closeCtx();
    if (t) {
      S.sel = t.id;
      S.act = null;
      render();
    } else if (S.act) {
      S.act = null;
      render();
    }
    return;
  }
  const self = t && u && t.id === u.id,
    title = t ? esc(t.name) : `Гекс ${p.x}:${p.y}`,
    who = t ? (self ? 'сам' : t.side === u.side ? 'союзник' : 'противник') : torchAt(p.x, p.y) ? 'факел' : 'пусто';
  let html = `<div class="cmh"><span><b>${title}</b> · ${who}</span><button type="button" data-x aria-label="Закрыть">✕</button></div>`;
  if (t) {
    const fn = fxNames(t);
    if (fn) html += `<div class="cmf">${fn}</div>`;
  }
  ops.forEach((o, i) => {
    html += `<button type="button" class="cmi" data-i="${i}"><span>${esc(o.name)}</span><span class="c">${o.cost ? '<b></b>'.repeat(o.cost) : '<b class="z"></b>'}</span>${o.meta ? `<span class="m${o.warn ? ' w' : ''}">${esc(o.meta)}</span>` : ''}</button>`;
  });
  if (t && !self)
    html += `<button type="button" class="cmi sec" data-sel="${t.id}"><span>${t.side === u.side && t.side === S.phase ? 'Выбрать этого героя' : 'Осмотреть'}</span></button>`;
  m.innerHTML = html;
  m.hidden = false;
  CTX = {
    p,
    t: t ? t.id : null,
  };
  const c0 = t ? tokPos(t) : hc(p.x, p.y),
    br = $('#board').getBoundingClientRect(),
    c = {
      x: br.left + c0.x,
      y: br.top + c0.y,
    },
    W = window.innerWidth,
    H = window.innerHeight,
    mw = m.offsetWidth,
    mh = m.offsetHeight;
  let x = c.x + CELL * 0.55,
    y = c.y - CELL * 0.9;
  if (x + mw > W - 6) x = c.x - CELL * 0.55 - mw;
  if (x < 6) x = Math.max(6, Math.min(W - mw - 6, c.x - mw / 2));
  if (y + mh > H - 6) y = H - mh - 6;
  if (y < 6) y = 6;
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  m.querySelector('[data-x]').onclick = closeCtx;
  m.querySelectorAll('[data-i]').forEach(
    b =>
      (b.onclick = () => {
        const o = ops[+b.dataset.i];
        closeCtx();
        run(o.run);
      }),
  );
  const sb = m.querySelector('[data-sel]');
  if (sb)
    sb.onclick = () => {
      S.sel = +sb.dataset.sel;
      S.act = null;
      closeCtx();
      render();
    };
  const f = m.querySelector('.cmi');
  if (f && f.focus && !('ontouchstart' in window)) f.focus();
}
