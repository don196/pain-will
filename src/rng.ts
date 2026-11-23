/* Случайность боя с зерном: одинаковое зерно и одинаковые действия — одинаковый бой.
   Состояние генератора сохраняется вместе с отменой хода. Интерфейс своей случайностью этот поток не трогает. */
let st = 0;
export function rngNext() {
  st = (st + 0x6d2b79f5) | 0;
  let t = Math.imul(st ^ (st >>> 15), 1 | st);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function seedRng(s: number) {
  st = s | 0;
  Math.random = rngNext;
}
export const rngState = () => st;
export function setRngState(v: number) {
  st = v | 0;
}
export const newSeed = () => (Date.now() ^ (performance.now() * 1000)) >>> 0 || 1;
