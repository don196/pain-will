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
