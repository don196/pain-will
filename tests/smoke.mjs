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
        const r = { edge: P.onEdge(h), prone: h.prone, od0: h.od };
        /* следующий свой ход — последний: все ОД, ползти и голосовая магия, огонь руками нельзя */
        h.od = 3; h._lastTurn = true;
        Object.assign(r, { fire: P.okAct(h, 'firebolt2'), voice: P.okAct(h, 'curseWeak'), move: P.okAct(h, 'move') });
        return r;
      });
      ok(edge.edge && edge.prone && edge.od0 === 0 && !edge.fire && edge.voice && edge.move, 'на пороге (4.5): ход потерян, следующий — последний: ползти и голос, руками нельзя', JSON.stringify(edge));
      const ko = await page.evaluate(() => { const h = P.S.units.find(u => u.tpl === 'helga'); h.wounds = { armL: { deg: 2, open: true, age: 0 } }; P.syncBleed(h); P.applyDamage(h, 1, null); P.koTick(h); return { down: h.down, ko: h.ko, steps: h.deathSteps, dead: !!h.dead, bleed: h.bleed }; });
      ok(ko.down && ko.ko && ko.steps === 1 && !ko.dead && ko.bleed === 2, 'новая Боль — без сознания; серьёзная открытая рана кровоточит — шаг к смерти', JSON.stringify(ko));
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

      // 4.2: таблицы правил, ведущий, сравнение A/B
      const t42 = await page.evaluate(async () => {
        P.SET.tbl = JSON.parse(JSON.stringify(P.DEFAULT_TBL)); P.SET.tbl.pcls.med[2] = 5; P.applyTables();
        const tbl = P.PCLS.med[3] === 5; P.SET.tbl = null; P.applyTables();
        const c = P.S.units.find(u => u.tpl === 'conrad'), p0 = P.painOf(c);
        P.gmAct(c, 'pain+'); const gm = P.painOf(c) === p0 + 1; P.undo();
        P.FORCED.push(20); const r = P.d20() === 20;
        P.openSim(); await P.runSim(10, { lightBonus: true }); const ab = /B − A/.test(document.querySelector('#simOut').innerText); P.closeModal();
        return { tbl, gm, back: P.painOf(P.S.units.find(u => u.tpl === 'conrad')) === p0, r, ab };
      });
      ok(t42.tbl && t42.gm && t42.back && t42.r && t42.ab, 'таблицы правил, вмешательство ведущего, сравнение A/B', JSON.stringify(t42));

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

      // Экспедиция: победа → привал (Боль −2, очнулся) → следующий бой с теми же ранами; кровь на полу; звук не ломает страницу.
      const ex = await page.evaluate(async () => {
        P.EXP.rest = { mode: 'A' };
        P.startExpedition(['dummies', 'heights']);
        const [k, h] = P.S.units.filter(u => u.side === 'pc');
        k.hp = k.maxHp - 5; k.wounds = { arm: { deg: 1 } }; P.bloodAt(k, 2);
        h.hp = h.maxHp - 8; h.down = true; h.ko = true;
        for (const u of P.S.units.filter(u => u.side === 'en')) { u.down = true; u.dead = true; }
        P.S.over = 'pc'; P.render();
        const blood = (P.S.blood || []).length;
        const btn = !!document.querySelector('#bnNext'), kp = P.painOf(k);
        P.nextStage();
        const k2 = P.S.units.find(u => u.tpl === 'conrad'), h2 = P.S.units.find(u => u.tpl === 'helga');
        const r = { scn: P.S.scn, btn, blood, closed: !k2.wounds.arm.open, k: kp - P.painOf(k2), w: Object.keys(k2.wounds).length, h: P.painOf(h2), hdown: h2.down, badge: /Экспедиция 2\/2/.test(document.querySelector('#rnd').textContent) };
        P.stopExpedition();
        P.setSound(true); P.sfx('hit'); P.sfx('crit'); P.setSound(false);
        return r;
      });
      ok(ex.scn === 'heights' && ex.btn && ex.blood > 0 && ex.k === 3 && ex.w === 1 && ex.h === 3 && ex.closed && !ex.hdown && ex.badge, 'экспедиция: отдых по своду (половина Боли, перевязка, в чувство с помощью), перенос ран; кровь на полу; звук', JSON.stringify(ex));

      // Окружение 4.5: укрытие, вода, удар и толчок бочки, разлив масла и огонь, обрушение пола, обзор сверху.
      const tr = await page.evaluate(async () => {
        const r = {};
        P.loadScenario('dummies'); P.S.terrain = {};
        const w = P.S.units.find(u => u.tpl === 'walter'), k = P.S.units.find(u => u.tpl === 'conrad');
        const d = P.S.units.find(u => u.tpl === 'dummy');
        w.x = 3; w.y = 4; d.x = 9; d.y = 4; k.x = 3; k.y = 2;
        for (const u of P.S.units) if (u !== w && u !== d && u !== k) { u.x = 13; u.y = 1 + (u.id % 6); }
        const mid = P.hexLine({ x: w.x, y: w.y }, { x: d.x, y: d.y }, 1e-6)[2];
        P.placeTerr(mid.x, mid.y, 'table');
        r.cover = /укрытие/.test(P.missThr(w, P.A.hxbow, d).src);
        d.covered = true; r.hidden = !P.canTarget(w, P.A.hxbow, d); d.covered = false;
        P.placeTerr(d.x, d.y, 'water2');
        r.deep = P.atkMods(d, P.A.club || P.A.improv, w).some(m => m.l === 'глубокая вода');
        P.addSt(d, 'heat', 2, 'тест'); r.noHeat = !(d.st && d.st.heat);
        // бочка с маслом рядом с Конрадом: два сильных удара — разбита, масло разлито; огонь поджигает
        const nb = P.nbrDirs(k.x, k.y).map(([dx, dy]) => ({ x: k.x + dx, y: k.y + dy })).filter(c => P.isFloor(c.x, c.y) && !P.unitAt(c.x, c.y));
        const b = nb[0]; P.placeTerr(b.x, b.y, 'oilbarrel');
        const old = Math.random; Math.random = () => 0.97;
        try { P.objectStrike(k, b); P.objectStrike(k, b); } finally { Math.random = old; }
        r.broken = !P.terrAt(b.x, b.y) || P.terrAt(b.x, b.y).type === 'oil';
        r.oil = Object.values(P.S.terrain).some(t => t.type === 'oil');
        const oc = Object.keys(P.S.terrain).find(kk => P.S.terrain[kk].type === 'oil');
        const [ox, oy] = oc.split(',').map(Number); P.igniteTerr(ox, oy); r.fire = P.terrAt(ox, oy).type === 'burning';
        // полная бочка катится от толкающего
        const b2 = nb[1]; P.placeTerr(b2.x, b2.y, 'fullbarrel'); P.objectPush(k, b2); r.pushed = !P.terrAt(b2.x, b2.y) || P.terrAt(b2.x, b2.y).type !== 'fullbarrel';
        // обрушение: шаг на провальный пол
        P.loadScenario('brokenhall');
        const h = P.S.units.find(u => u.tpl === 'conrad');
        for (const u of P.S.units) if (u !== h && (u.y === 6 || u.y === 5)) u.x = 1;
        h.x = 6; h.y = 6; const p0 = P.painOf(h);
        await P.walk(h, [[7, 6]]);
        r.collapse = P.hAt(7, 6) === -1 && P.isStairs(7, 6) && h.prone && P.painOf(h) - p0 === 1 && !P.terrAt(8, 5);
        // обзор: сверху вниз виден, снизу через обрыв — нет
        P.loadScenario('stairwell');
        const top = P.S.units.find(u => u.side === 'en'), low = P.S.units.find(u => u.tpl === 'walter');
        for (const u of P.S.units) if (u !== top && u !== low) { u.x = 1; u.y = 1 + (u.id % 9); }
        /* обзор симметричен: с края площадки видно всё внизу и наоборот; из глубины площадки — нет */
        top.x = 12; top.y = 5; low.x = 12; low.y = 8;
        r.downOk = P.los(top, low, top).ok && P.los(low, top, low).ok;
        top.y = 2;
        r.upBlocked = !P.los(low, top, low).ok && !P.los(top, low, top).ok;
        // редактор: стол на клетку
        return r;
      });
      ok(tr.cover && tr.hidden && tr.deep && tr.noHeat && tr.broken && tr.oil && tr.fire && tr.pushed && tr.collapse && tr.downOk && tr.upBlocked,
        'окружение: укрытие, вода, бочки, масло и огонь, обрушение, обзор с высоты', JSON.stringify(tr));

      // Свод 2.4: броня таблицей, натуральные 1 и 20, огонь через союзника, кровотечение, раны головы, Нагрев, Воля,
      // повадки, прижигание, стул, шипы, спуск, двухгексовая мебель, горючий, догорание.
      const sv = await page.evaluate(async () => {
        const r = {};
        P.SET.anim = 'fast';
        r.armor = [P.armorCut(1, 4), P.armorCut(2, 3), P.armorCut(3, 1), P.armorCut(0, 2)].join(',');
        P.loadScenario('dummies'); P.S.terrain = {};
        const U = t => P.S.units.find(u => u.tpl === t);
        const c = U('conrad'), h = U('helga'), w = U('walter'), d = P.S.units.find(u => u.tpl === 'dummy');
        for (const u of P.S.units) if (![c, h, w, d].includes(u)) { u.x = 13; u.y = 1 + (u.id % 7); }
        w.x = 2; w.y = 2; h.x = 3; h.y = 2; d.x = 8; d.y = 2; c.x = 7; c.y = 2; P.S.phase = 'pc';
        // натуральная 1: промах и Неустойчивость атакующему
        const d0 = P.painOf(d); P.FORCED.length = 0; P.FORCED.push(1);
        await P.resolveAttack(c, P.A.csword, d); r.nat1 = P.painOf(d) === d0 && P.stOf(c, 'unst') === 1;
        c.st = {};
        // натуральная 20 повышает степень (защита цели — натуральная 1)
        P.FORCED.push(20, 1, 1, 1);
        await P.resolveAttack(c, P.A.csword, d);
        const m = [...P.S.log].reverse().find(e => e.meta && e.meta.k === 'atk' && e.meta.r === 20);
        r.nat20 = !!m && m.meta.t >= 2;
        P.FORCED.length = 0;
        // огонь через плечо: Хельга вплотную перед Вальтером, натуральная 2 — болт в неё
        w.loaded = true; w.wield = 'xbow'; c.x = 1; c.y = 6;
        r.canShoot = P.canTarget(w, P.A.hxbow, d);
        const hp0 = P.painOf(h), dp = P.painOf(d); P.FORCED.push(2);
        await P.resolveAttack(w, P.A.hxbow, d);
        r.ff = P.painOf(h) > hp0 && P.painOf(d) === dp;
        P.FORCED.length = 0;
        // кровотечение по суммарной тяжести
        c.wounds = { armL: { deg: 1, open: true, age: 0 } }; P.syncBleed(c); const b1 = c.bleed;
        c.wounds.legL = { deg: 1, open: true, age: 0 }; P.syncBleed(c); r.bleed = b1 === 0 && c.bleed === 2;
        // рана головы: серьёзная — −1 Харизма и −1 Интуиция
        const i0 = P.stat(h, 'int'), ch0 = P.stat(h, 'cha'); h.wounds.head = { deg: 2, open: false, age: 0 };
        r.head = P.stat(h, 'int') === i0 - 1 && P.stat(h, 'cha') === ch0 - 1; delete h.wounds.head;
        // Нагрев: 3 стака — 1 Боль
        const ph = P.painOf(d); P.addSt(d, 'heat', 3, 'тест'); r.heat = P.painOf(d) - ph === 1;
        // Воля: 30 на старте, пороги 20 и 10, союзник без сознания −2, гибель — всего −5
        r.will0 = h.will === 30;
        P.applyDamage(c, 99, null); P.applyDamage(c, 99, null);
        const wk = h.will; c.dead = true; P.witnessDown(c);
        r.will = wk === 28 && h.will === 25;
        h.will = 15; const f1 = P.disForm(h); h.will = 5; const f2 = P.disForm(h); h.will = 30;
        r.willForm = f1 === 1 && f2 === 2;
        // Выявление повадок: натуральная 20 — 3 метки
        P.FORCED.push(20); P.doHabits(w, d); r.habits = P.getEff(d, 'spots').areas.length === 3; P.FORCED.length = 0;
        // Прижигание: 1 Боль и закрытая рана
        w.wounds = { armR: { deg: 1, open: true, age: 0 } }; P.syncBleed(w); h.od = 3; h.x = 3; h.y = 3; w.x = 3; w.y = 2;
        const pw = P.painOf(w); await P.perform(h, 'cauterHeal', w);
        r.cauter = !w.wounds.armR.open && P.painOf(w) - pw === 1;
        // стул: вход ещё 1 ОД; спуск на 1 уровень без доплаты
        P.placeTerr(5, 6, 'chair'); r.chair = P.slowAt(5, 6, 3) === 3;
        P.S.hgt = { '5,7': 1 }; r.down = P.stepCost(5, 7, 5, 8, 3) === 1 && P.stepCost(5, 8, 5, 7, 3) === 4; P.S.hgt = {};
        // кровать — два гекса, общая прочность
        P.placeTerr(10, 6, 'bed'); const pt = P.terrAt(10, 6).part;
        r.bed = !!pt && P.isTerrSolid(pt[0], pt[1]);
        P.terrainDamage(pt[0], pt[1], 4, 'тест'); r.bedHp = P.terrAt(10, 6).hp === 6;
        // горючий: огонь даёт ещё 2 Нагрева
        const e2 = P.S.units.find(u => u.tpl === 'dummy' && u !== d); e2.x = 11; e2.y = 2; e2.st = {};
        P.spreadLiquid(11, 2, 'oil'); r.oily = P.hasEff(e2, 'oily');
        P.addSt(e2, 'heat', 1, 'огонь'); r.ignite = !P.hasEff(e2, 'oily') && (e2.down || P.painOf(e2) >= 1);
        // огонь на полу гаснет через 3 раунда
        P.placeTerr(12, 7, 'burning'); P.terrainRound(); P.terrainRound(); P.terrainRound(); r.burnOut = !P.terrAt(12, 7);
        // шипы: два гекса за толчок — рана
        P.loadScenario('dummies'); P.S.terrain = {};
        const k2 = P.S.units.find(u => u.tpl === 'conrad'), t2 = P.S.units.find(u => u.tpl === 'dummy');
        for (const u of P.S.units) if (u !== k2 && u !== t2) { u.x = 13; u.y = 1 + (u.id % 7); }
        k2.x = 3; k2.y = 4; t2.x = 4; t2.y = 4; P.placeTerr(5, 4, 'spikesSteel'); P.placeTerr(6, 4, 'spikesSteel');
        await P.shove(k2, t2, 2);
        r.spikes = t2.down || Object.keys(t2.wounds).length === 1;
        return r;
      });
      ok(sv.armor === '3,2,0,2' && sv.nat1 && sv.nat20 && sv.canShoot && sv.ff && sv.bleed && sv.head && sv.heat && sv.will0 && sv.will && sv.willForm && sv.habits && sv.cauter && sv.chair && sv.down && sv.bed && sv.bedHp && sv.oily && sv.ignite && sv.burnOut && sv.spikes,
        'свод 2.4: броня, натуральные 1/20, огонь через союзника, кровь, голова, Нагрев, Воля, повадки, прижигание, окружение', JSON.stringify(sv));

      // Тюремный блок: захват руки держит и не даёт тюремщику ходить; круговой удар задевает всех вокруг; отскок раз за ход.
      const pr = await page.evaluate(async () => {
        const r = {};
        P.loadScenario('prison3');
        const U = t => P.S.units.find(u => u.tpl === t);
        const j = U('jailer'), g = U('prisonerChain'), n = U('prisonerKnife'), c = U('conrad'), w = U('walter');
        r.units = !!(j && g && n);
        for (const u of P.S.units) if (![j, g, n, c, w].includes(u)) { u.x = 16; u.y = 5; }
        j.x = 9; j.y = 4; c.x = 10; c.y = 4; j.od = 3; P.S.phase = 'en';
        P.FORCED.length = 0; P.FORCED.push(20, 1, 1);
        await P.perform(j, 'armGrab', c);
        const e = P.getEff(c, 'lasso');
        r.grip = !!e && e.grip && e.part === 'armR' && !P.okAct(j, 'move') && P.immobile(c);
        P.FORCED.length = 0;
        g.x = 5; g.y = 5; n.x = 4; n.y = 5; w.x = 6; w.y = 5; g.od = 3;
        const pn = P.painOf(n), pw = P.painOf(w);
        P.FORCED.push(15, 1, 15, 1, 15, 1);
        await P.perform(g, 'chainSweep');
        r.sweep = P.painOf(n) > pn || n.down; r.sweepHero = P.painOf(w) > pw || w.down;
        P.FORCED.length = 0;
        n.od = 3; n.turnNo = 5; n.x = 2; n.y = 5;
        const cell = P.ringCells(n).find(q => P.validCell(n, P.A.hop, q.x, q.y));
        r.hop = !!cell && (await P.perform(n, 'hop', cell)) !== false && !P.okAct(n, 'hop');
        return r;
      });
      ok(pr.units && pr.grip && pr.sweep && pr.sweepHero && pr.hop, 'тюремный блок: захват руки, круговой удар по всем, отскок', JSON.stringify(pr));

    }

    if (vp.name === 'компьютер') {
      // Панель действий свёрнута в одну строку, поле получает высоту; разворачивается по кнопке.
      const dk = await page.evaluate(async () => {
        P.loadScenario('dummies'); await new Promise(r => setTimeout(r, 300));
        const tops = () => new Set([...document.querySelectorAll('#acts .agroups > .ag .act')].map(b => b.offsetTop)).size;
        const r = { min: document.body.classList.contains('dock-min'), rows: tops(), wrap: document.querySelector('#wrap').offsetHeight, dock: document.querySelector('#dock').offsetHeight };
        document.querySelector('#dockTog').click(); await new Promise(r => setTimeout(r, 200));
        r.full = !document.body.classList.contains('dock-min') && tops() > 1;
        document.querySelector('#dockTog').click();
        return r;
      });
      ok(dk.min && dk.rows === 1 && dk.wrap > dk.dock * 3 && dk.full, 'компьютер: действия одной строкой, поле выше, разворот по кнопке', JSON.stringify(dk));
    }
    if (vp.name === 'телефон') {
      const ph = await page.evaluate(() => ({ dock: getComputedStyle(document.querySelector('#dock')).position, tr: document.querySelector('#board').style.transform }));
      ok(ph.dock === 'fixed' && /scale/.test(ph.tr), 'телефон: действия в нижней панели, поле масштабируется', JSON.stringify(ph));
      // Поворот поля в портрете, сворачиваемая панель, карточка листом.
      const pr = await page.evaluate(async () => {
        const r = {};
        r.rot = P.ROT; r.tall = P.boardH() > P.boardW();
        document.querySelector('#dockTog').click(); r.min = document.body.classList.contains('dock-min');
        r.top = [...document.querySelectorAll('#acts .act')].filter(b => getComputedStyle(b).display !== 'none').length;
        document.querySelector('#dockTog').click(); r.max = !document.body.classList.contains('dock-min');
        document.querySelector('#btnCardSheet').click(); r.sheet = getComputedStyle(document.querySelector('.side')).position;
        document.querySelector('#sheetClose').click(); r.closed = !document.body.classList.contains('sheet-open');
        document.querySelector('#btnRot').click(); r.off = !P.ROT; document.querySelector('#btnRot').click(); r.on = P.ROT;
        return r;
      }).catch(e => ({ err: e.message }));
      ok(pr.rot && pr.tall && pr.min && pr.top <= 3 && pr.max && pr.sheet === 'fixed' && pr.closed && pr.off && pr.on, 'телефон: поворот поля, свёрнутая панель, карточка листом', JSON.stringify(pr));
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
