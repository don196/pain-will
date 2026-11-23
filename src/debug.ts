// Отладка и проверки: в консоли браузера P.S — состояние боя, P.perform(...) — любое действие, P.SET — настройки.
// Объект собирает все модули; значения живые (P.S всегда текущее состояние).
import * as actions from './data/actions';
import * as fighters from './data/fighters';
import * as scenarios from './data/scenarios';
import * as disorders from './data/disorders';
import * as labels from './data/labels';
import * as settings from './settings';
import * as state from './state';
import * as util from './util';
import * as geometry from './rules/geometry';
import * as light from './rules/light';
import * as stats from './rules/stats';
import * as dis from './rules/disorders';
import * as log from './rules/log';
import * as damage from './rules/damage';
import * as combat from './rules/combat';
import * as lasso from './rules/lasso';
import * as magic from './rules/magic';
import * as wounds from './rules/wounds';
import * as reactions from './rules/reactions';
import * as attack from './rules/attack';
import * as act from './rules/actions';
import * as turns from './rules/turns';
import * as pain from './rules/pain';
import * as ai from './ai/ai';
import * as board from './ui/board';
import * as status from './ui/status';
import * as panels from './ui/panels';
import * as modals from './ui/modals';
import * as game from './ui/game';
import * as sim from './ui/sim';
import * as editor from './ui/editor';
import * as dataEditor from './ui/data-editor';
import * as ctxmenu from './ui/ctxmenu';
import * as prompt from './ui/prompt';
import * as hints from './ui/hints';
import * as input from './ui/input';
import * as height from './rules/height';
import * as anim from './ui/anim';
import * as zoom from './ui/zoom';
import * as history from './ui/history';
import * as rng from './rng';
import * as sound from './ui/sound';
import * as phone from './ui/phone';
import * as expedition from './ui/expedition';

const all: any[] = [
  sound,
  phone,
  expedition,
  actions,
  fighters,
  scenarios,
  disorders,
  labels,
  settings,
  state,
  util,
  geometry,
  light,
  stats,
  dis,
  log,
  damage,
  combat,
  lasso,
  magic,
  wounds,
  reactions,
  attack,
  act,
  turns,
  pain,
  ai,
  board,
  status,
  panels,
  modals,
  input,
  game,
  sim,
  editor,
  dataEditor,
  ctxmenu,
  prompt,
  hints,
  height,
  anim,
  zoom,
  history,
  rng,
];
const P = new Proxy({} as any, {
  get(_t, k) {
    for (const m of all) if (k in m) return m[k as string];
    return undefined;
  },
  has(_t, k) {
    return all.some(m => k in m);
  },
});
(globalThis as any).P = P;
export default P;
