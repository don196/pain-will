import { hideTip } from './input';
import { $ } from '../util';

export function askChoice(title, body, opts) {
  return new Promise(res => {
    promptResolve = res;
    hideTip();
    $('#pbox').innerHTML =
      `<h2>${title}</h2>${body}<div class="adopts">` +
      opts
        .map(
          (o, i) =>
            `<button type="button" data-i="${i}"><span>${o.label}</span>${o.sub ? `<span class="p">${o.sub}</span>` : ''}</button>`,
        )
        .join('') +
      `</div>`;
    $('#prompt').hidden = false;
    const bs = $('#pbox').querySelectorAll('button');
    if (bs[0] && bs[0].focus) bs[0].focus();
    bs.forEach(b => (b.onclick = () => closePrompt(opts[+b.dataset.i].v)));
    /* Esc — последний вариант (обычно «вернуться» или «принять удар») */
    const esc = e => {
      if (e.key !== 'Escape' || $('#prompt').hidden) return;
      e.preventDefault();
      document.removeEventListener('keydown', esc, true);
      closePrompt(opts[opts.length - 1].v);
    };
    document.addEventListener('keydown', esc, true);
  });
}

export let promptResolve = null;

export function closePrompt(v) {
  $('#prompt').hidden = true;
  if (promptResolve) {
    const r = promptResolve;
    promptResolve = null;
    r(v);
  }
}
