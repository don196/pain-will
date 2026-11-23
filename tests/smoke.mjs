// Проверка собранной страницы в браузере: node tests/smoke.mjs (сначала npm run build)
// Открывает dist/index.html, проверяет, что нет ошибок, и прогоняет ключевые механики Боли, окна и ход ИИ.
// К внутренностям страницы тесты обращаются через P — отладочный объект со всеми модулями (src/debug.ts).
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
    await page.waitForFunction(() => typeof P === 'object' && P.S && P.S.units && P.S.units.length > 0, null, { timeout: 15000 });
    // Любой вопрос игроку (защита, прикрытие) — первый вариант, чтобы проверка не зависала.
    await page.evaluate(() => setInterval(() => { const pr = document.querySelector('#prompt'); if (pr && !pr.hidden) { const b = document.querySelector('#pbox button'); if (b) b.click(); } }, 100));
    ok(true, `страница открылась (${vp.name})`);

    if (vp.name === 'компьютер') {
      const st = await page.evaluate(() => ({ units: P.S.units.map(u => [u.tpl, P.limOf(u), u.hp, u.maxHp, P.armorNow(u)]) }));
            const lim = Object.fromEntries(st.units.map(u => [u[0], u[1]]));
      ok(lim.conrad === 7 && lim.walter === 6 && lim.helga === 5 && lim.dummy === 4 && lim.dummyBow === 3 && lim.dummyElite === 6,
        'пределы Боли по правилам', JSON.stringify(lim));

      // Удар Конрада по болванчику с подкрученным броском: в журнале расчёт Боли, броня изнашивается.
      const hit = await page.evaluate(async () => {
        P.S.phase = 'pc'; const c = P.S.units.find(u => u.tpl === 'conrad'), d = P.S.units.find(u => u.tpl === 'dummy');
        outer: for (let y = 0; y < P.S.h; y++) for (let x = 0; x < P.S.w; x++) if (P.footFree(c, x, y) && P.hd(x, y, d.x, d.y) === 1) { c.x = x; c.y = y; break outer; }
        c.od = 3; P.renderTokens();
        const old = Math.random; let k = 0; Math.random = () => [0.97, 0.1, 0.5][k++ % 3];
        try { await P.perform(c, 'csword', d); } finally { Math.random = old; }
        return { pain: P.painOf(d), armor: P.armorNow(d), log: [...document.querySelectorAll('#log > *')].slice(-6).map(e => e.innerText).join(' ') };
      });
      ok(hit.pain > 0 && /Боль:/.test(hit.log), 'удар даёт Боль и пишет расчёт в журнал', `Боль ${hit.pain}, броня ${hit.armor}`);

      // Хельга: на пороге → без сознания → шаг к смерти → перевязка и «Привести в чувство» через интерфейс.
      const edge = await page.evaluate(() => {
        const h = P.S.units.find(u => u.tpl === 'helga'); h.od = 3; P.applyDamage(h, 99, null);
        return { edge: P.onEdge(h), prone: h.prone, od: h.od, fire: P.actState(h, 'firebolt2').ok, move: P.okAct(h, 'move') };
      });
      ok(edge.edge && edge.prone && edge.od <= 1 && !edge.fire && edge.move, 'на пороге: лежит, 1 ОД, ползти можно, колдовать нельзя', JSON.stringify(edge));
      const ko = await page.evaluate(() => { const h = P.S.units.find(u => u.tpl === 'helga'); h.bleed = 2; P.applyDamage(h, 1, null); P.koTick(h); return { down: h.down, ko: h.ko, steps: h.deathSteps, dead: !!h.dead }; });
      ok(ko.down && ko.ko && ko.steps === 1 && !ko.dead, 'новая Боль — без сознания, кровотечение даёт шаг к смерти', JSON.stringify(ko));
      await page.evaluate(async () => {
        P.S.phase = 'pc'; P.S.busy = false; const h = P.S.units.find(u => u.tpl === 'helga'), w = P.S.units.find(u => u.tpl === 'walter');
        for (const [dx, dy] of P.nbrDirs(h.x, h.y)) if (P.inB(h.x + dx, h.y + dy) && P.footFree(w, h.x + dx, h.y + dy)) { w.x = h.x + dx; w.y = h.y + dy; break; }
        w.od = 3; P.renderTokens(); await P.perform(w, 'bandage', h); P.S.sel = w.id; P.S.act = null; P.render();
      });
      await page.click('[data-act="revive"]');
      const cell = await page.evaluate(() => { const h = P.S.units.find(u => u.tpl === 'helga'); const r = document.querySelector(`.c[data-x="${h.x}"][data-y="${h.y}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.click(cell.x, cell.y); await page.waitForTimeout(400);
      const rev = await page.evaluate(() => { const h = P.S.units.find(u => u.tpl === 'helga'); return { down: h.down, edge: P.onEdge(h), bleed: h.bleed }; });
      ok(!rev.down && rev.edge && rev.bleed === 0, 'перевязка лежащей и «Привести в чувство» с поля', JSON.stringify(rev));

      // Окна и вкладки открываются без ошибок
      const modals = await page.evaluate(async () => {
        const out = [];
        const tryIt = async (name, fn) => { try { await fn(); out.push(name + ':ok'); } catch (e) { out.push(name + ': ' + e.message); } };
        await tryIt('правила', () => { P.openRules(); P.closeModal(); });
        await tryIt('как считает', () => { P.openNotes(); P.closeModal(); });
        await tryIt('шансы', () => { document.querySelector('#btnOdds').click(); const n = document.querySelectorAll('.odds td').length; P.closeModal(); if (!n) throw new Error('пустая таблица'); });
        await tryIt('бойцы', () => { document.querySelector('#btnData').click(); for (const b of document.querySelectorAll('#mbox [data-tab]')) b.click(); P.closeModal(); });
        await tryIt('редактор', () => { document.querySelector('#btnEditor').click(); document.querySelector('#btnEditor').click(); });
        await tryIt('симуляция', async () => { document.querySelector('#btnSim').click(); await P.runSim(20); const t = document.querySelector('#simOut').innerText; P.closeModal(); if (!/победа/i.test(t)) throw new Error('нет итогов'); });
        return out;
      });
      ok(modals.every(m => m.endsWith(':ok')), 'окна и вкладки', modals.join(' · '));

      // 4.0: область перемещения видна сразу, карточка прогноза у цели
      await page.evaluate(() => P.loadScenario('dummies'));
      await page.waitForTimeout(300);
      const ui4 = await page.evaluate(() => {
        const S = P.S, c = S.units.find(u => u.tpl === 'conrad');
        S.sel = c.id; S.act = null; P.render();
        const mv = document.querySelectorAll('#hl .c.mv1').length;
        const e = S.units.find(u => u.name === 'Болванчик 1');
        c.x = e.x - 1; c.y = e.y; S.act = 'csword'; S.hover = { x: e.x, y: e.y }; P.render(); P.renderHL();
        const box = document.querySelector('#fcard'), fc = !box.hidden && /Болванчик 1/.test(box.innerText) && /Усиленный/.test(box.innerText);
        S.hover = null; S.act = null; P.render();
        const keys = [...document.querySelectorAll('#acts [data-key]')].map(b => b.dataset.key).join('');
        return { mv, fc, keys };
      });
      ok(ui4.mv > 0 && ui4.fc && /^1/.test(ui4.keys), 'перемещение по умолчанию, карточка прогноза, клавиши действий', JSON.stringify(ui4));

      // 4.1: отмена с теми же кубиками, лента событий, прогноз с защитой
      await page.evaluate(() => P.loadScenario('dummies'));
      await page.waitForTimeout(300);
      const u41 = await page.evaluate(async () => {
        const S0 = P.S, c = S0.units.find(u => u.tpl === 'conrad'), e = S0.units.find(u => u.name === 'Щитоносец');
        c.x = e.x - 1; c.y = e.y; P.render();
        const sig = () => JSON.stringify(P.S.units.map(u => [u.id, u.hp, u.od, u.x, u.y]));
        const hit = () => P.run(() => P.perform(P.S.units.find(u => u.tpl === 'conrad'), 'csword', P.S.units.find(u => u.name === 'Щитоносец')));
        const before = sig(); await hit(); const a1 = sig(); P.undo(); const back = sig() === before; await hit(); const same = sig() === a1;
        const rib = document.querySelectorAll('#ribbon .rbi').length;
        P.S.act = 'csword'; P.S.hover = { x: P.S.units.find(u => u.name === 'Щитоносец').x, y: P.S.units.find(u => u.name === 'Щитоносец').y }; P.renderHL();
        const fc = document.querySelector('#fcard').innerText;
        P.S.act = null; P.S.hover = null; P.render();
        return { back, same, rib, def: /защищается/.test(fc), ko: /Вывести из боя/.test(fc) };
      });
      ok(u41.back && u41.same && u41.rib > 0 && u41.def && u41.ko, 'отмена с теми же кубиками, лента событий, прогноз с защитой', JSON.stringify(u41));

      // 4.0: высоты — лестница, уступ, падение, +2 сверху
      await page.evaluate(() => P.loadScenario('heights'));
      await page.waitForTimeout(300);
      const hg = await page.evaluate(() => {
        const S = P.S, c = S.units.find(u => u.tpl === 'conrad');
        c.x = 8; c.y = 2;
        const d = P.bfs(c, { max: 6 }), up = d.get('10,2');
        const cliff = P.stepCost(9, 3, 10, 3, 3) === Infinity;
        const a = S.units.find(u => u.tpl === 'dummy' && P.hAt(u.x, u.y) === 2), p0 = P.painOf(a);
        P.fall(a, 2);
        const top = S.units.find(u => u.tpl === 'dummyBow'), h = S.units.find(u => u.tpl === 'helga');
        return { lvl: P.hAt(11, 2), stairs: P.isStairs(9, 2), up: up && up.d, cliff, adj: P.adjOk({ x: 10, y: 3 }, { x: 9, y: 3 }),
          fall: P.painOf(a) - p0, prone: a.prone, above: P.atkMods(top, P.A.dxbow, h).some(m => m.l === 'сверху') };
      });
      ok(hg.lvl === 2 && hg.stairs && hg.up === 2 && hg.cliff && !hg.adj && hg.fall === 2 && hg.prone && hg.above, 'высоты: лестница, уступ, падение, +2 сверху', JSON.stringify(hg));

    }

    if (vp.name === 'телефон') {
      const ph = await page.evaluate(() => ({ dock: getComputedStyle(document.querySelector('#dock')).position, tr: document.querySelector('#board').style.transform }));
      ok(ph.dock === 'fixed' && /scale/.test(ph.tr), 'телефон: действия в нижней панели, поле масштабируется', JSON.stringify(ph));
    }
    // Ход противников под ИИ, герои отвечают первым вариантом.
    await page.evaluate(() => { P.SET.anim = 'fast'; });
    const ai = await page.evaluate(async () => { try { P.S.phase = 'en'; P.S.busy = true; await P.runSideAI('en'); P.S.busy = false; P.render(); return 'ok'; } catch (e) { return 'ERR ' + e.message; } });
    ok(ai === 'ok', `ход противников под ИИ (${vp.name})`, ai);
    ok(errors.length === 0, `нет ошибок на странице (${vp.name})`, errors.join(' | '));
    await page.close();
  }
} finally { await browser.close(); }
if (failed) { console.error(`\nНе прошло проверок: ${failed}`); process.exit(1); }
console.log('\nВсе проверки прошли');
