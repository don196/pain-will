/* Раскладка экрана. Телефон вертикально — поле на весь экран, панель снизу;
   телефон горизонтально — поле слева, действия колонкой справа. Совпадает с медиазапросами в styles.css. */
export const phoneV = () =>
  typeof window !== 'undefined' && window.innerWidth <= 700 && window.innerHeight >= window.innerWidth;
export const phoneH = () =>
  typeof window !== 'undefined' && window.innerHeight <= 500 && window.innerWidth > window.innerHeight;
export const phoneAny = () => phoneV() || phoneH();
