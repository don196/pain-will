import type { Unit } from '../types';
import { DISP, DIS_ICON } from '../data/disorders';
import { changeWill, disOf, guiltWatch } from './disorders';
import { releaseLasso } from './lasso';
import { ev, log, uName } from './log';
import { enterEdge } from './pain';
import { openWounds } from './wounds';
import { S, byId, friends } from '../state';
import { cheb } from '../util';
import { view } from '../view';
export function applyDamage(u: Unit, dmg, src) {
  if (u.down || dmg <= 0) return;
  view.fxText(u, '+' + dmg + ' Боль', 'dmg');
  view.flash(u);
  if (u.side === 'pc') {
    if (u.hp > 1) {
      u.hp = Math.max(1, u.hp - dmg);
      if (u.hp === 1) enterEdge(u);
      return;
    }
    u.hp = 0;
    downUnit(u, src);
    return;
  }
  u.hp -= dmg;
  if (u.hp <= 0) {
    u.hp = 0;
    downUnit(u, src);
  }
  return;
}
export function downUnit(u: Unit, src?) {
  u.down = true;
  u.od = 0;
  u.prep = null;
  u.charge = null;
  u.prone = false;
  u.st = {};
  if (u.lassoT) releaseLasso(u, 'выбыл');
  guiltWatch(u);
  if (src && src._striking && src.side !== u.side && disOf(src, 'cruel') === 2 && !src.down) {
    const P = DISP.cruel,
      ws = friends(src).filter(o => cheb(src, o) <= P.r && o.will != null);
    const own = S.phase === src.side;
    ev(`${DIS_ICON.cruel} ${uName(src)} — Садизм: жестокое добивание ${uName(u)}${own ? ', ход заканчивается' : ''}`);
    if (own) {
      src.od = 0;
      src._endTurn = true;
    }
    for (const o of ws) changeWill(o, -P.will, 'Жестокое добивание');
  }
  if (S.stat) {
    (S.stat.kills = S.stat.kills || []).push([u.side, S.round, u.tpl]);
    (S.stat.downAt = S.stat.downAt || []).push([u.x, u.y, u.side]);
  }
  if (u.side === 'pc' && !u.dead) {
    u.ko = true;
    u.deathSteps = u.deathSteps || 0;
    if (S.stat) S.stat.ko = (S.stat.ko || 0) + 1;
    ev(
      `💤 ${uName(u)} теряет сознание от боли${u.bleed > 0 || openWounds(u).length ? ' и истекает кровью: в начале каждого хода героев — шаг к смерти, третий шаг — смерть. Перевязка останавливает' : ' — кровотечения нет, состояние стабильно'}`,
      { k: 'down', u: u.id, by: src ? src.id : null },
    );
  } else
    ev(u.dead ? `✝ ${uName(u)} погибает` : `✝ ${uName(u)} выбывает из боя — Боль дошла до предела`, {
      k: u.dead ? 'dead' : 'down',
      u: u.id,
      by: src ? src.id : null,
    });
  u.effects = [];
  if (!u.ko) u.bleed = 0;
  if (u.torch) {
    u.torch = false;
    S.torches.push({
      x: u.x,
      y: u.y,
      lit: true,
      floor: true,
    });
    S.lv = (S.lv || 0) + 1;
    ev(`🔥 Факел ${uName(u)} падает на пол и продолжает гореть`);
  }
  if (S.sel === u.id && S.act) S.act = null;
  checkOver();
}
export function checkOver() {
  if (S.over) return;
  const pc = S.units.some(u => !u.down && u.side === 'pc'),
    en = S.units.some(u => !u.down && u.side === 'en');
  if (!pc) S.over = 'en';
  else if (!en) S.over = 'pc';
  if (S.over)
    log(`<div class="lb">${S.over === 'pc' ? 'Победа героев' : 'Герои пали'} · раунд ${S.round}</div>`, 'sys');
}
export function release(g, quiet?) {
  const t = byId(null);
  if (t) {
  }
  if (!quiet && t) ev(`${uName(t)} — захват снят`);
}
