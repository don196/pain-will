// Связь правил с интерфейсом. Правила вызывают эти функции, а интерфейс при запуске подставляет свои.
// В симуляции и тестах без браузера остаются пустышки: правила работают сами по себе.
export const view = {
  render(): void {},
  renderTokens(): void {},
  drawFloor(): void {},
  drawLight(_t?: number): void {},
  fxText(_u: any, _txt: string, _cls: string): void {},
  fxLine(_a: any, _b: any, _cls: string): void {},
  flash(_u: any): void {},
  hideTip(): void {},
  appendLog(_e: any): void {},
  async askChoice(_title: string, _html: string, _opts: any[]): Promise<any> {
    return null;
  },
};
