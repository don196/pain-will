/* Модель данных полигона. Поля, которые правила добавляют по ходу боя, тоже описаны здесь;
   индексная подпись оставлена там, где правила хранят служебные пометки (_ai, _once, _striking и т. п.). */

export type Side = 'pc' | 'en';
/** Характеристика: Сила, Ловкость, Интуиция, Харизма, Телосложение. */
export type StatKey = 'str' | 'dex' | 'int' | 'cha' | 'con';
/** Часть тела для ран. */
export type Area = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';
/** Класс оружия задаёт Боль по степеням успеха. */
export type WeaponClass = 'light' | 'med' | 'heavy';
/** Тип удара: от него зависят броня и раны. */
export type WeaponType = 'cut' | 'pierce' | 'blunt' | 'fire';
/** Степень успеха: 0 — промах, 1 — обычный, 2 — усиленный, 3 — критический. */
export type Degree = 0 | 1 | 2 | 3;
export type Opts = Record<string, any>;

/** Действие из свода: оружие, заклинание, приём. */
export interface Action {
  name: string;
  cost: number;
  kind: string;
  hint?: string;
  pcls?: WeaponClass;
  ptyp?: WeaponType;
  /** Вес для блока и парирования: 0 / 2 / 4. */
  wt?: number;
  fixed?: number | null;
  reach?: number;
  range?: number;
  ranged?: boolean;
  magic?: boolean;
  complex?: boolean;
  ammo?: number;
  cd?: number;
  [k: string]: any;
}

/** Шаблон бойца из свода. */
export interface Template {
  name: string;
  glyph: string;
  side: Side;
  str: number;
  dex: number;
  int: number;
  cha: number;
  con?: number;
  /** Мастерство: ближний, дальний бой, магия. */
  mm?: number;
  mr?: number;
  mg?: number;
  will: number | null;
  armor: number;
  shield?: number;
  speed?: number;
  acts: string[];
  ai: string;
  tough?: boolean;
  fragile?: boolean;
  mook?: boolean;
  disorder?: string | null;
  [k: string]: any;
}

export interface Effect {
  type: string;
  by?: number;
  left?: number;
  end?: number;
  mag?: number;
  at?: string;
  [k: string]: any;
}

export interface Wound {
  /** Степень: 1 — обычная, 2 — серьёзная, 3 — тяжёлая, 4 — ампутация. */
  deg: number;
  open: boolean;
  age: number;
}

/** Боец на поле. Боль хранится как hp: сколько ещё Боли можно принять (см. rules/pain.ts). */
export interface Unit {
  id: number;
  tpl: string;
  name: string;
  glyph: string;
  side: Side;
  x: number;
  y: number;
  size: number;
  base: Record<StatKey, number>;
  will: number | null;
  hp: number;
  maxHp: number;
  lim?: number;
  armor: number;
  armorPts?: number;
  shield: number;
  od: number;
  effects: Effect[];
  /** Слабые состояния со стаками: Рябь, Кашель, Дезориентация, Неустойчивость, Нагрев. */
  st: Record<string, number>;
  bleed: number;
  wounds: Partial<Record<Area, Wound>>;
  down: boolean;
  ko?: boolean;
  dead?: boolean;
  prone: boolean;
  stunned: boolean;
  acts: string[];
  ai: string;
  disorder: string | null;
  [k: string]: any;
}

export interface Scenario {
  name: string;
  goal: string;
  map: string[];
  /* Высоты той же формы, что map: цифра — уровень 0–6; буква a–g — лестница на уровне 0–6. */
  hmap?: string[];
  /* Слои 4.5: высоты и окружение прямоугольниками и клетками; последний слой побеждает. */
  heightLayers?: { level: number; rect?: number[]; cells?: number[][] }[];
  terrainLayers?: { type: string; rect?: number[]; cells?: number[][]; depth?: number }[];
  pool?: string[];
  heroOrder?: string[];
}

export interface LogEntry {
  html: string;
  cls: string;
  meta?: any;
}

/** Состояние боя. */
export interface GameState {
  scn: string;
  w: number;
  h: number;
  units: Unit[];
  walls: Set<string>;
  torches: any[];
  doors: Record<string, any>;
  bars: Record<string, any>;
  traps: any[];
  round: number;
  phaseIdx: number;
  order: Side[];
  phase: Side;
  sel: number | null;
  act: string | null;
  over: Side | 'draw' | null;
  sim: boolean;
  busy: boolean;
  editor: boolean;
  log: LogEntry[];
  initial: any;
  stat?: Record<string, any>;
  [k: string]: any;
}
