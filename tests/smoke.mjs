// Проверка собранной страницы в браузере: node tests/smoke.mjs (сначала python3 build/build.py)
// Открывает dist/index.html, проверяет, что нет ошибок, и прогоняет ключевые механики Боли и переключение на HP.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
let failed = 0;
const ok = (cond, what, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${what}${extra ? ' — ' + extra : ''}`); if (!cond) failed++; };

const browser = await chromium.launch();
try {
  for (const vp of [{ width: 1440, height: 900, name: 'компьютер' }, { width: 390, height: 844, name: 'телефон' }]) {
    const page = await browser.newPage({ viewport: vp });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => typeof S === 'object' && S && S.units && S.units.length > 0, null, { timeout: 15000 });
    // Любой вопрос игроку (защита, прикрытие) — первый вариант, чтобы проверка не зависала.
    await page.evaluate(() => setInterval(() => { const pr = document.querySelector('#prompt'); if (pr && !pr.hidden) { const b = document.querySelector('#pbox button'); if (b) b.click(); } }, 100));
    ok(true, `страница открылась (${vp.name})`);

    if (vp.name === 'компьютер') {
      const st = await page.evaluate(() => ({ pain: PAIN(), units: S.units.map(u => [u.tpl, limOf(u), u.hp, u.maxHp, armorNow(u)]) }));
      ok(st.pain, 'по умолчанию включена Боль');
      const lim = Object.fromEntries(st.units.map(u => [u[0], u[1]]));
      ok(lim.conrad === 7 && lim.walter === 6 && lim.helga === 5 && lim.dummy === 4 && lim.dummyBow === 3 && lim.dummyElite === 6,
        'пределы Боли по правилам', JSON.stringify(lim));

      // Удар Конрада по болванчику с подкрученным броском: в журнале расчёт Боли, броня изнашивается.
      const hit = await page.evaluate(async () => {
        S.phase = 'pc'; const c = S.units.find(u => u.tpl === 'conrad'), d = S.units.find(u => u.tpl === 'dummy');
        outer: for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) if (footFree(c, x, y) && hd(x, y, d.x, d.y) === 1) { c.x = x; c.y = y; break outer; }
        c.od = 3; renderTokens();
        const old = Math.random; let k = 0; Math.random = () => [0.97, 0.1, 0.5][k++ % 3];
        try { await perform(c, 'csword', d); } finally { Math.random = old; }
        return { pain: painOf(d), armor: armorNow(d), log: [...document.querySelectorAll('#log > *')].slice(-6).map(e => e.innerText).join(' ') };
      });
      ok(hit.pain > 0 && /Боль:/.test(hit.log), 'удар даёт Боль и пишет расчёт в журнал', `Боль ${hit.pain}, броня ${hit.armor}`);

      // Хельга: на пороге → без сознания → шаг к смерти → перевязка и «Привести в чувство» через интерфейс.
      const edge = await page.evaluate(() => {
        const h = S.units.find(u => u.tpl === 'helga'); h.od = 3; applyDamage(h, 99, null);
        return { edge: onEdge(h), prone: h.prone, od: h.od, fire: actState(h, 'firebolt2').ok, move: okAct(h, 'move') };
      });
      ok(edge.edge && edge.prone && edge.od <= 1 && !edge.fire && edge.move, 'на пороге: лежит, 1 ОД, ползти можно, колдовать нельзя', JSON.stringify(edge));
      const ko = await page.evaluate(() => { const h = S.units.find(u => u.tpl === 'helga'); h.bleed = 2; applyDamage(h, 1, null); koTick(h); return { down: h.down, ko: h.ko, steps: h.deathSteps, dead: !!h.dead }; });
      ok(ko.down && ko.ko && ko.steps === 1 && !ko.dead, 'новая Боль — без сознания, кровотечение даёт шаг к смерти', JSON.stringify(ko));
      await page.evaluate(async () => {
        S.phase = 'pc'; S.busy = false; const h = S.units.find(u => u.tpl === 'helga'), w = S.units.find(u => u.tpl === 'walter');
        for (const [dx, dy] of nbrDirs(h.x, h.y)) if (inB(h.x + dx, h.y + dy) && footFree(w, h.x + dx, h.y + dy)) { w.x = h.x + dx; w.y = h.y + dy; break; }
        w.od = 3; renderTokens(); await perform(w, 'bandage', h); S.sel = w.id; S.act = null; render();
      });
      await page.click('[data-act="revive"]');
      const cell = await page.evaluate(() => { const h = S.units.find(u => u.tpl === 'helga'); const r = document.querySelector(`.c[data-x="${h.x}"][data-y="${h.y}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.click(cell.x, cell.y); await page.waitForTimeout(400);
      const rev = await page.evaluate(() => { const h = S.units.find(u => u.tpl === 'helga'); return { down: h.down, edge: onEdge(h), bleed: h.bleed }; });
      ok(!rev.down && rev.edge && rev.bleed === 0, 'перевязка лежащей и «Привести в чувство» с поля', JSON.stringify(rev));

      // Переключатель здоровья в «Правилах»: HP и обратно.
      const setMode = async v => { await page.evaluate(() => openRules()); await page.evaluate(v => { const i = document.querySelector(`#mbox input[name="pain"][value="${v}"]`); i.checked = true; i.dispatchEvent(new Event('change')); }, v); await page.waitForTimeout(400); };
      await setMode('false');
      const hp = await page.evaluate(() => ({ pain: PAIN(), conrad: S.units.find(u => u.tpl === 'conrad').maxHp }));
      ok(!hp.pain && hp.conrad === 24, 'переключение на HP', JSON.stringify(hp));
      await setMode('true');
      ok(await page.evaluate(() => PAIN() && S.units.find(u => u.tpl === 'conrad').maxHp === 8), 'и обратно на Боль');
    }

    // Ход противников под ИИ, герои отвечают первым вариантом.
    await page.evaluate(() => { SET.anim = 'fast'; });
    const ai = await page.evaluate(async () => { try { S.phase = 'en'; S.busy = true; await runSideAI('en'); S.busy = false; render(); return 'ok'; } catch (e) { return 'ERR ' + e.message; } });
    ok(ai === 'ok', `ход противников под ИИ (${vp.name})`, ai);
    ok(errors.length === 0, `нет ошибок на странице (${vp.name})`, errors.join(' | '));
    await page.close();
  }
} finally { await browser.close(); }
if (failed) { console.error(`\nНе прошло проверок: ${failed}`); process.exit(1); }
console.log('\nВсе проверки прошли');
