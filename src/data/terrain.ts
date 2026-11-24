/* Окружение боя (перенесено из полигона 4.5): мебель, бочки, шипы, вода, обрушаемый пол, разливы.
   hp — прочность предмета (не Боль бойца); null — неразрушим. */
export interface TerrDef {
  name: string;
  hp: number | null;
  solid?: boolean; // нельзя встать и пройти
  cover?: boolean; // укрытие от стрельбы
  opaque?: boolean; // закрывает обзор и свет
  slow?: boolean; // шаг стоит 2 клетки
  slowOD?: boolean; // вход стоит ещё 1 ОД (стул)
  two?: boolean; // занимает 2 гекса (кровать, скамья)
  push?: boolean; // можно толкнуть
  liquid?: 'wet' | 'oil'; // разливается, когда разбита
  solidCargo?: boolean; // разбитая оставляет завал
  spikes?: boolean;
  water?: number; // глубина: 0 — лужа, 1 — мелко, 2 — глубоко
  stairs?: boolean;
  collapse?: boolean;
  fire?: boolean;
  tint: string;
  tall?: number; // высота предмета на поле, доля клетки
}

export const TERRAIN: Record<string, TerrDef> = {
  table: { name: 'Перевёрнутый стол', hp: 12, solid: true, cover: true, tint: '#aa8754', tall: 0.34 },
  chair: { name: 'Стул', hp: 4, slowOD: true, push: true, tint: '#ae8055', tall: 0.3 },
  bed: { name: 'Кровать', hp: 10, solid: true, cover: true, two: true, tint: '#7c6b62', tall: 0.26 },
  bench: { name: 'Скамья', hp: 8, solid: true, cover: true, two: true, tint: '#96805d', tall: 0.22 },
  cupboard: { name: 'Шкаф', hp: 14, solid: true, opaque: true, tint: '#755641', tall: 0.95 },
  rotten: { name: 'Гнилая бочка', hp: 8, solid: true, push: true, tint: '#9b7047', tall: 0.42 },
  waterbarrel: { name: 'Бочка с водой', hp: 16, solid: true, push: true, liquid: 'wet', tint: '#5597ba', tall: 0.42 },
  oilbarrel: { name: 'Бочка с маслом', hp: 16, solid: true, push: true, liquid: 'oil', tint: '#bc8741', tall: 0.42 },
  fullbarrel: {
    name: 'Бочка с грузом',
    hp: 16,
    solid: true,
    push: true,
    solidCargo: true,
    tint: '#91817a',
    tall: 0.42,
  },
  spikesSteel: { name: 'Стальные шипы', hp: null, spikes: true, tint: '#9aabb5' },
  spikesWood: { name: 'Деревянные шипы', hp: 6, spikes: true, tint: '#b39970' },
  spikesFlesh: { name: 'Органические шипы', hp: 3, spikes: true, tint: '#a35b62' },
  water1: { name: 'Вода (мелко)', hp: null, water: 1, slow: true, tint: '#396b95' },
  water2: { name: 'Вода (глубоко)', hp: null, water: 2, slow: true, tint: '#284e87' },
  collapse: { name: 'Обрушаемый пол', hp: null, collapse: true, tint: '#876a57' },
  wet: { name: 'Разлив воды', hp: null, water: 0, tint: '#518da4' },
  oil: { name: 'Разлив горючей жидкости', hp: null, tint: '#95754b' },
  burning: { name: 'Горящая поверхность', hp: null, fire: true, tint: '#c86029' }, // горит 3 раунда
  rubble: { name: 'Твёрдый завал', hp: 8, solid: true, tint: '#777777', tall: 0.36 },
};

/* Порядок в редакторе поля. */
export const TERRAIN_TOOLS: [string, string][] = [
  ['table', 'Стол'],
  ['chair', 'Стул'],
  ['bed', 'Кровать'],
  ['bench', 'Скамья'],
  ['cupboard', 'Шкаф'],
  ['rotten', 'Гнилая бочка'],
  ['waterbarrel', 'Бочка с водой'],
  ['oilbarrel', 'Бочка с маслом'],
  ['fullbarrel', 'Бочка с грузом'],
  ['spikesSteel', 'Шипы: сталь'],
  ['spikesWood', 'Шипы: дерево'],
  ['spikesFlesh', 'Шипы: органика'],
  ['water1', 'Мелкая вода'],
  ['water2', 'Глубокая вода'],
  ['collapse', 'Обрушаемый пол'],
  ['oil', 'Разлив масла'],
  ['burning', 'Огонь на полу'],
];

/* Подсказка при наведении: что делает клетка. */
export function TERRAIN_HINT(d: TerrDef) {
  const out = [];
  if (d.solid) out.push('не пройти');
  if (d.cover) out.push('укрытие: стрельба сквозь него — порог промаха +2; рядом можно «Скрыться за укрытием»');
  if (d.opaque) out.push('закрывает обзор и свет');
  if (d.push) out.push('можно толкнуть');
  if (d.liquid)
    out.push(d.liquid === 'wet' ? 'разбита — разольётся вода' : 'разбита — разольётся масло, огонь его подожжёт');
  if (d.water === 1) out.push('шаг стоит 2 клетки, −3 к уклонению, гасит Нагрев');
  if (d.water === 2) out.push('шаг стоит 2 клетки, −8 к действиям (кроме голоса) и к защите, гасит Нагрев');
  if (d.water === 0) out.push('лужа: Нагрев не копится');
  if (d.slow && d.water == null) out.push('шаг стоит 2 клетки');
  if (d.slowOD) out.push('встать сюда — ещё 1 ОД; толкается: d20 + Сила против 15');
  if (d.two) out.push('занимает 2 гекса');
  if (d.cover) out.push('закрывает свет');
  if (d.spikes)
    out.push('протащенный по шипам: +1 Боль сквозь броню за гекс, с 2 гексов за одно перемещение — ещё и рана');
  if (d.collapse) out.push('наступишь — связный участок обрушится ямой с пологими краями');
  if (d.fire) out.push('Нагрев +2, когда встаёшь сюда и в конце своего хода; гаснет через 3 раунда или от воды');
  if (d === TERRAIN.oil) out.push('огонь по стоящему здесь поджигает пол');
  return out.join('; ');
}
