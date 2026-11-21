export const STAT_RU = {
  str: 'Сила',
  dex: 'Ловкость',
  int: 'Интуиция',
  cha: 'Харизма',
  con: 'Телосложение',
};
export const STAT_DAT = {
  str: 'Силе',
  dex: 'Ловкости',
  int: 'Интуиции',
  cha: 'Харизме',
  con: 'Телосложению',
};
export const LIGHT_RU = ['темнота', 'полутьма', 'свет'];
export const EFF_RU = {
  shake: 'Тряска',
  vuln: 'Уязвимость',
  cloud: 'Затуманенный разум',
  cover: 'Прикрытие',
  bound: 'Вязка',
  blind: 'Ослепление',
  inspire: 'Воодушевление',
  mark: 'Слабое место',
  taunt: 'Насмешка',
  psalm: 'Псалом стойкости',
  dread: 'Глас',
  ditty: 'Песенка',
  prone: 'сбит с ног',
  rage: 'Ярость',
  evade: 'Ускользание',
  snare: 'Капкан',
};

/* Режим включается настройкой SET.v2. Три готовых героя (Конрад, Хельга, Вальтер) и болванчики. */
export const ST_RU = {
  ripple: 'Рябь',
  cough: 'Кашель',
  disor: 'Дезориентация',
  unst: 'Неустойчивость',
  heat: 'Нагрев',
};
export const ST_ICON = {
  ripple: '〰',
  cough: '🗯',
  disor: '😵',
  unst: '🌀',
  heat: '♨',
};
Object.assign(EFF_RU, {
  blind2: 'Слепота',
  mute: 'Немота',
  weak2: 'Слабость',
  vuln2: 'Уязвимость',
  fmark: 'Метка пламени',
  magsight: 'Магическое зрение',
  lasso: 'Силок',
  spots: 'Слабые места',
  ordnow: 'Приказ «Сейчас!»',
});
export const DIR_RU = ['→ восток', '↗ северо-восток', '↖ северо-запад', '← запад', '↙ юго-запад', '↘ юго-восток'];
export const AREA_RU = {
  head: 'голова',
  torso: 'тело',
  armL: 'левая рука',
  armR: 'правая рука',
  legL: 'левая нога',
  legR: 'правая нога',
};
export const WDEG_RU = ['', 'обычная', 'серьёзная', 'тяжёлая', 'ампутация'];
export const WNAME = {
  sword: 'меч',
  mace: 'булава',
  cleaver: 'тесак',
  boarspear: 'рогатина',
  xbow: 'арбалет',
  lspear: 'длинное копьё',
  bastard: 'полуторный меч',
  bow: 'лук',
  dagger: 'кинжал',
};
export const PCLS_RU = {
    light: 'лёгкое',
    med: 'среднее',
    heavy: 'тяжёлое',
  },
  PTYP_RU = {
    cut: 'режущее',
    pierce: 'колющее',
    blunt: 'дробящее',
    fire: 'огонь',
  };
export const DEG_RU = ['', 'обычный', 'усиленный', 'критический'];
export const AI_RU = {
  pcMonk: 'Как Монах',
  pcHunter: 'Как Охотник',
  pcWanderer: 'Как Странник',
  pcRogue: 'Как Разбойница',
  pcNorthman: 'Как Воитель Севера',
  pcJester: 'Как Шут',
  pcKnightC: 'Как Рыцарь (Харизма)',
  pcInquisitor: 'Как Инквизитор',
  pcBaron: 'Как Барон',
  dumb: 'Глупый: ближайшая цель',
  smart: 'Умный: раненые и стрелки',
  shooter: 'Стрелок: держит дистанцию',
  guard: 'Как Страж',
  jailer: 'Как Тюремщик',
  veteran: 'Как Ветеран',
  owl: 'Как Филин: сначала свет',
  pcKnight: 'Как Рыцарь',
  pcWitch: 'Как Ведьма',
};
export const KIND_RU = {
  throw: 'факел',
  bandage: 'перевязка',
  bind: 'контроль',
  aura: 'вокруг себя',
  buff: 'усиление союзника',
  smash: 'разрушение',
  swap: 'перемещение',
  door: 'дверь',
  breakbind: 'освобождение',
  unbind: 'отмена',
  attack: 'атака',
  arc: 'удар по дуге',
  circle: 'круговой удар',
  grab: 'захват',
  debuff: 'проклятие',
  cover: 'поддержка',
  self: 'на себя',
  torch: 'свет',
  move: 'движение',
  escape: 'побег',
};
