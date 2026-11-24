/* Настройки правил, которые ещё проверяются. Меняются в окне «Правила» и хранятся в браузере. */
export const SET_VERSION = 8;
export const DEFAULT_SET = {
  v: SET_VERSION,
  dexMode: 'dodge', // Ловкачи (Ловкость 7+): dodge — бесплатное уклонение за раунд, od — +1 ОД в ход, none — ничего
  spellDC: 12, // сложность заклинаний без цели
  enemyFullDef: false, // все противники защищаются как герои
  party: ['conrad', 'helga', 'walter'],
  paranoiaOD: false, // внеочередная атака при Паранойе тратит ОД
  critWill: false, // критические броски меняют Волю (старое правило 2.0; в своде 2.4 Воля меняется только событиями)
  darkRules: true,
  zoc: true,
  enemyCtrl: 'ai', // ai или manual — противниками управляет ведущий
  ambush: false,
  anim: 'normal',
  lighting: true,
  // Правила 4.5 — утверждены в своде 2.4, включены по умолчанию; выключаются для сравнения в симуляции
  edgeLast: true, // «последний ход» на пороге: следующий свой ход со всеми ОД, затем без сознания
  parryDiff: true, // парирование: штраф по разнице весов оружия (1/3/5); дубина толстяка — среднее оружие
  lightBonus: true, // +2 к атаке лёгким оружием
  voiceOnly: true, // на пороге — только речь и голосовые заклинания
  // Свод 2.4: огонь через плечо союзника и натуральные 1/20
  allyFire: true,
  natRolls: true,
  // Таблицы правил (правятся в «Правилах»); null — значения по умолчанию
  tbl: null as any,
};

/* Таблицы правил по умолчанию: Боль по классу оружия и степени, броня, штраф от Боли, пределы, веса для парирования. */
export const DEFAULT_TBL = {
  pcls: { light: [1, 1, 2], med: [1, 2, 3], heavy: [1, 2, 4] },
  /* Броня по своду 2.4: Боль после брони 1/2/3 для сырой Боли 1–4; колющее и дробящее считают броню на 1 меньше; броня не изнашивается */
  armorT: { 1: [1, 2, 2, 3], 2: [1, 1, 2, 2], 3: [0, 1, 1, 2] },
  painStep: 2,
  limBase: 5,
  limHero: 1,
  limTough: 1,
  limFragile: -1,
  limMook: -1,
  parryW: { light: 1, med: 3, heavy: 5 },
};
export const TBL = () => (SET && SET.tbl ? SET.tbl : DEFAULT_TBL);

export function loadSet() {
  try {
    const s = JSON.parse(localStorage.getItem('polygon-set') || '{}');
    // Настройки старых версий поля (HP, 2 ОД, система 12.11) не переносим.
    /* 7 → 8: правила 4.5 утверждены, Воля только событиями; остальные настройки сохраняем */
    if (s.v === 7) {
      Object.assign(s, { v: 8, edgeLast: true, parryDiff: true, lightBonus: true, voiceOnly: true, critWill: false });
      if (s.tbl) s.tbl = null;
    }
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
