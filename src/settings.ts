/* Настройки правил, которые ещё проверяются. Меняются в окне «Правила» и хранятся в браузере. */
export const SET_VERSION = 7;
export const DEFAULT_SET = {
  v: SET_VERSION,
  dexMode: 'dodge', // Ловкачи (Ловкость 7+): dodge — бесплатное уклонение за раунд, od — +1 ОД в ход, none — ничего
  spellDC: 12, // сложность заклинаний без цели
  enemyFullDef: false, // все противники защищаются как герои
  party: ['conrad', 'helga', 'walter'],
  paranoiaOD: false, // внеочередная атака при Паранойе тратит ОД
  critWill: true, // критические броски меняют Волю
  darkRules: true,
  zoc: true,
  enemyCtrl: 'ai', // ai или manual — противниками управляет ведущий
  ambush: false,
  anim: 'normal',
  lighting: true,
};

export function loadSet() {
  try {
    const s = JSON.parse(localStorage.getItem('polygon-set') || '{}');
    // Настройки старых версий поля (HP, 2 ОД, система 12.11) не переносим.
    if (s.v !== SET_VERSION) return JSON.parse(JSON.stringify(DEFAULT_SET));
    const r = Object.assign({}, DEFAULT_SET, s);
    if (!Array.isArray(r.party)) r.party = DEFAULT_SET.party.slice();
    return r;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_SET));
  }
}

export function saveSet() {
  try {
    localStorage.setItem('polygon-set', JSON.stringify(SET));
  } catch (e) {}
}

export let SET: typeof DEFAULT_SET & Record<string, any> = loadSet();
