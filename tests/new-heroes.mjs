/* Тесты новых героев 1-го этажа: Рагна, Лазарь, Бернхард.
   Запуск после сборки: node tests/new-heroes.mjs */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => typeof P === 'object' && P.S && P.S.units.length > 0, null, { timeout: 15000 });

  /* 1. Выбор новой тройки в Правилах, параметры и редактор */
  const setup = await page.evaluate(() => {
    P.openRules();
    const btn = document.querySelector('button[data-preset="ragna,lazar,bernhard"]');
    if (!btn) throw new Error('нет кнопки пресета новой тройки');
    btn.click();
    P.closeModal();
    const pcs = P.S.units.filter(u => u.side === 'pc');
    const byTpl = Object.fromEntries(
      pcs.map(u => [
        u.tpl,
        {
          glyph: u.glyph,
          resist: P.resist(u),
          speed: P.speedOf(u),
          armor: u.armor,
          lim: P.limOf(u),
          will: u.will,
          disorder: u.disorder,
          mm: P.mast(u),
          mr: P.mast(u, true),
          mg: P.mastMg(u),
          freeDodge: P.dexFree(u),
        },
      ]),
    );
    const hasInEditor = ['ragna', 'lazar', 'bernhard'].every(k => !!P.T[k]);
    return { byTpl, hasInEditor };
  });
  assert.equal(setup.hasInEditor, true);
  assert.deepEqual(setup.byTpl.ragna, {
    glyph: 'Р',
    resist: 15,
    speed: 3,
    armor: 2,
    lim: 7,
    will: 30,
    disorder: 'aggr',
    mm: 7,
    mr: 2,
    mg: 3,
    freeDodge: false,
  });
  assert.deepEqual(setup.byTpl.lazar, {
    glyph: 'Л',
    resist: 13,
    speed: 3,
    armor: 0,
    lim: 6,
    will: 30,
    disorder: 'obsess',
    mm: 3,
    mr: 1,
    mg: 7,
    freeDodge: false,
  });
  assert.deepEqual(setup.byTpl.bernhard, {
    glyph: 'Б',
    resist: 12,
    speed: 4,
    armor: 1,
    lim: 5,
    will: 30,
    disorder: 'sad',
    mm: 7,
    mr: 3,
    mg: 5,
    freeDodge: true,
  });
  console.log('✓ Пресет новой тройки, параметры, Стойкость, Скорость, Предел Боли, Ловкач');

  /* 2. Рагна: Берсерк, Кровавый надрез, 2 меча при ране руки, Сдвоенный удар, Ножницы (обезоруживание + подбор), Встречный прорыв */
  const ragnaRes = await page.evaluate(async () => {
    P.SET.party = ['ragna', 'lazar', 'bernhard'];
    P.SET.anim = 'fast';
    P.loadScenario('dummies');
    await new Promise(r => setTimeout(r, 60));
    P.S.sim = true;
    P.S.phase = 'pc';
    const r = P.S.units.find(u => u.tpl === 'ragna');
    const e1 = P.S.units.find(u => u.tpl === 'dummyElite');
    const e2 = P.S.units.find(u => u.tpl === 'dummy');
    for (const u of P.S.units) if (![r, e1, e2].includes(u)) { u.x = 1; u.y = 1 + (u.id % 6); }
    r.x = 5; r.y = 4; e1.x = 6; e1.y = 4; e2.x = 12; e2.y = 6;
    r.od = 3; e1.od = 2;

    /* Боль 3: ещё не Берсерк, штраф Боли = 1, уклонение доступно */
    P.applyDamage(r, 3, null);
    r.wounds.armL = { deg: 2, open: false, age: 0 };
    r.wounds.legL = { deg: 3, open: false, age: 0 }; // 2 стака раны ноги
    const beforeB = {
      berserk: P.isBerserk(r),
      painPen: P.painPen(r),
      legSp: P.legSpeedPen(r),
      hasDodge: P.v2DefOptions(r, e1, P.A.sword, {}).some(o => o.mode === 'dodge'),
    };

    /* Кровавый надрез: +1 Боль сквозь броню (без новой раны) → Боль 4 → Берсерк + Кровавый надрез (+2) */
    const wCountBefore = Object.keys(r.wounds).length;
    await P.perform(r, 'ragnaCut');
    const afterCut = {
      pain: P.painOf(r),
      noNewWound: Object.keys(r.wounds).length === wCountBefore,
      berserk: P.isBerserk(r),
      painPen: P.painPen(r),
      legSp: P.legSpeedPen(r),
      hasBloodCut: P.hasEff(r, 'bloodCut'),
      atkMods: P.atkMods(r, P.A.ragnaSword, e1),
      defModes: P.v2DefOptions(r, e1, P.A.sword, {}).map(o => o.mode),
    };
    /* 3 стака раны ноги (ампутация) работают даже в Берсерке */
    r.wounds.legL = { deg: 4, open: false, age: 0 };
    const leg3InBerserk = P.legSpeedPen(r);
    delete r.wounds.legL;

    /* Потеря правой руки: ragnaSword доступен (левая рука), ragnaDouble и ragnaScissors недоступны */
    r.wounds.armR = { deg: 4, open: false, age: 0 };
    delete r.wounds.armL;
    r.od = 3;
    const oneArm = {
      sword: P.okAct(r, 'ragnaSword'),
      dbl: P.okAct(r, 'ragnaDouble'),
      scis: P.okAct(r, 'ragnaScissors'),
    };
    delete r.wounds.armR;

    /* Сдвоенный удар: 2 удара по одной цели с −3, сжигает реакции */
    r.od = 3; e1.od = 2; e1.hp = e1.maxHp;
    P.FORCED.length = 0;
    P.FORCED.push(15, 1, 15, 1); // 2 удара, 2 неудачные защиты врага (выжжены оба ОД реакций)
    await P.perform(r, 'ragnaDouble', e1);
    const dblRes = {
      odLeft: r.od,
      enemyReactLeft: e1.od,
      bloodCutConsumed: !P.hasEff(r, 'bloodCut'),
      enemyPain: P.painOf(e1),
    };

    /* Ножницы: 2 ОД, нельзя парировать, при Боли > 0 обезоруживает врага; враг может подобрать оружие за 1 ОД */
    e1.down = false; e1.wounds = {}; e1.bleed = 0; e1.hp = e1.maxHp; e1.disarmed = false;
    const scisDefModes = P.v2DefOptions(e1, r, P.A.ragnaScissors, {}).map(o => o.mode);
    r.od = 3; e1.od = 0;
    P.FORCED.length = 0;
    P.FORCED.push(18);
    await P.perform(r, 'ragnaScissors', e1);
    e1.od = 2; // чтобы проверять запрет меча именно от обезоруживания, а не от 0 ОД
    const disarmRes = {
      noParry: !scisDefModes.includes('parry'),
      disarmed: !!e1.disarmed,
      droppedCount: (P.S.dropped || []).filter(d => d.owner === e1.id).length,
      enemyCantSword: !P.okAct(e1, 'sword'),
      enemyCantParry: !P.v2DefOptions(e1, r, P.A.ragnaSword, {}).some(o => o.mode === 'parry'),
    };
    /* Подбор оружия за 1 ОД */
    P.S.phase = 'en';
    e1.od = 2;
    const canPick = P.okAct(e1, 'pickupWeapon');
    await P.perform(e1, 'pickupWeapon');
    const afterPick = {
      canPick,
      disarmed: !!e1.disarmed,
      od: e1.od,
      canSwordAgain: P.okAct(e1, 'sword'),
    };

    /* Встречный прорыв: пробегает мимо врага с ZoC, удар из ZoC не останавливает (если не обморок), бьёт цель мечом */
    P.S.phase = 'pc';
    r.x = 3; r.y = 4; r.hp = r.maxHp; r.od = 3; r.prone = false; r.wounds = {};
    e1.x = 3; e1.y = 3; e1.od = 2; e1.zocRound = 0; e1.hp = e1.maxHp; e1.disarmed = false; // соседний с (3,4) и (4,4), даст ZoC при шаге в (5,4)
    e2.x = 6; e2.y = 4; e2.od = 0; e2.hp = e2.maxHp; // цель в 3 гексах
    const canCh = P.canTarget(r, P.A.ragnaCharge, e2);
    P.FORCED.length = 0;
    P.FORCED.push(15, 1, 18); // ZoC попадает по Рагне, затем Рагна бьёт e2
    await P.perform(r, 'ragnaCharge', e2);
    const chargeRes = {
      canCh,
      reachedAdj: P.near1(r, e2),
      e2Pain: P.painOf(e2),
      zocTriggered: e1.zocRound === P.S.round,
    };

    return { beforeB, afterCut, leg3InBerserk, oneArm, dblRes, disarmRes, afterPick, chargeRes };
  });
  assert.deepEqual(ragnaRes.beforeB, { berserk: false, painPen: 1, legSp: 2, hasDodge: true });
  assert.equal(ragnaRes.afterCut.pain, 4);
  assert.equal(ragnaRes.afterCut.noNewWound, true);
  assert.equal(ragnaRes.afterCut.berserk, true);
  assert.equal(ragnaRes.afterCut.painPen, 0);
  assert.equal(ragnaRes.afterCut.legSp, 0);
  assert.equal(ragnaRes.afterCut.hasBloodCut, true);
  assert.ok(ragnaRes.afterCut.atkMods.some(m => m.l === 'Берсерк' && m.v === 2));
  assert.ok(ragnaRes.afterCut.atkMods.some(m => m.l === 'Кровавый надрез' && m.v === 2));
  assert.ok(!ragnaRes.afterCut.defModes.includes('dodge') && ragnaRes.afterCut.defModes.includes('parry'));
  assert.equal(ragnaRes.leg3InBerserk, 2);
  assert.deepEqual(ragnaRes.oneArm, { sword: true, dbl: false, scis: false });
  assert.equal(ragnaRes.dblRes.odLeft, 2);
  assert.equal(ragnaRes.dblRes.enemyReactLeft, 0);
  assert.equal(ragnaRes.dblRes.bloodCutConsumed, true);
  assert.ok(ragnaRes.dblRes.enemyPain > 0);
  assert.deepEqual(ragnaRes.disarmRes, {
    noParry: true,
    disarmed: true,
    droppedCount: 1,
    enemyCantSword: true,
    enemyCantParry: true,
  });
  assert.deepEqual(ragnaRes.afterPick, { canPick: true, disarmed: false, od: 1, canSwordAgain: true });
  assert.deepEqual(ragnaRes.chargeRes, { canCh: true, reachedAdj: true, e2Pain: ragnaRes.chargeRes.e2Pain, zocTriggered: true });
  assert.ok(ragnaRes.chargeRes.e2Pain > 0);
  console.log('✓ Рагна: Берсерк, Кровавый надрез, 2 меча, Сдвоенный удар, Ножницы/обезоруживание/подбор, Встречный прорыв');

  /* 3. Лазарь: Литургия, 3 слова (Гнев/Милость/Вера), работа на Пороге, Стигматы, Чудо «Искупление» */
  const lazarRes = await page.evaluate(async () => {
    P.SET.party = ['ragna', 'lazar', 'bernhard'];
    P.SET.anim = 'fast';
    P.loadScenario('dummies');
    await new Promise(r => setTimeout(r, 60));
    P.S.sim = true;
    P.S.phase = 'pc';
    const l = P.S.units.find(u => u.tpl === 'lazar');
    const r = P.S.units.find(u => u.tpl === 'ragna');
    const b = P.S.units.find(u => u.tpl === 'bernhard');
    const e = P.S.units.find(u => u.tpl === 'dummy');
    for (const u of P.S.units) if (![l, r, b, e].includes(u)) { u.x = 13; u.y = 1 + (u.id % 6); }
    l.x = 4; l.y = 4; r.x = 5; r.y = 4; b.x = 4; b.y = 5; e.x = 6; e.y = 4;
    l.od = 3;

    /* Умерщвление плоти: обычная рана-стигмат пропадает после перевязки; серьёзная (повторно) держится даже после бинта */
    await P.perform(l, 'lazarMortify');
    const stig1Open = P.stigmataOf(l);
    const ar1 = Object.keys(l.wounds)[0];
    l.wounds[ar1].open = false;
    const stig1Closed = P.stigmataOf(l);
    l.wounds[ar1].open = true; // открываем обратно и усугубляем до серьёзной
    l.wounds = { armL: { deg: 2, open: true, age: 0, stigma: 2 } };
    P.syncBleed(l);
    l.wounds.armL.open = false; // перевязана!
    const stig2Bandaged = P.stigmataOf(l);
    /* Оставляем 2 Стигмата и добавляем открытую рану-стигмат, чтобы проверить: Чудо не закрывает собственный стигмат */
    l.wounds.armL.open = true;
    l.hp = l.maxHp;

    /* Слово «Гнев»: Неустойчивость на врага, кладёт 'wrath' */
    l.od = 3;
    P.FORCED.length = 0;
    P.FORCED.push(15);
    await P.perform(l, 'lazarWrath', e);
    const afterWrath = { unst: P.stOf(e, 'unst'), lit: l.liturgy.slice() };

    /* Слово «Милость»: останавливает кровотечение союзника на раунд, кладёт 'mercy' */
    r.wounds = { legL: { deg: 2, open: true, age: 0 } }; // серьёзная открытая рана -> кровотечение 2
    P.syncBleed(r);
    await P.perform(l, 'lazarMercy', r);
    const rPainBeforeEnd = P.painOf(r);
    const hasBleedStop = P.hasEff(r, 'bleedStop');
    /* Сдвигающееся окно из 3 слов: ещё одна Милость не запускает чудо и оставляет 3 последних */
    l.od = 3;
    await P.perform(l, 'lazarMercy', b);
    await P.perform(l, 'lazarMercy', b);
    const windowLit = l.liturgy.slice(); // должно быть ['mercy','mercy','mercy'] (wrath вытеснен!)

    /* Теперь собираем Гнев + Милость + Вера с 2 Стигматами → автоматически Чудо «Искупление»! */
    l.liturgy = [];
    l.od = 3;
    e.hp = e.maxHp;
    b.wounds = {};
    b.will = 28;
    P.FORCED.length = 0;
    P.FORCED.push(15); // Гнев
    await P.perform(l, 'lazarWrath', e);
    await P.perform(l, 'lazarMercy', b);
    /* Перед Верой убедимся, что у Рагны открытая серьёзная рана — при 2 Стигматах Искупление закроет её! */
    P.FORCED.length = 0;
    P.FORCED.push(15); // бросок Искупления по врагу
    await P.perform(l, 'lazarFaith', r);
    const afterRedemption = {
      litCleared: l.liturgy.length === 0,
      faithBonus: P.v2DefOptions(r, e, P.A.sword, {}).some(o => o.mods.some(m => m.l === 'Слово «Вера»' && m.v === 2)),
      enemyPainFromMiracle: P.painOf(e), // 2 Боли сквозь броню при 2+ Стигматах!
      ragnaSeriousClosed: !r.wounds.legL.open,
      lazarOwnStigmaStillOpen: l.wounds.armL.open === true,
    };

    /* Повторное Искупление, когда нет открытых ран у союзников: +1 Воля раз за бой (второй раз не растёт) */
    l.liturgy = ['wrath', 'mercy'];
    l.od = 3;
    r.will = 30;
    b.will = 28;
    l.will = 30;
    P.FORCED.length = 0;
    P.FORCED.push(15);
    await P.perform(l, 'lazarFaith', b); // замкнёт на b (низшая Воля 28 → 29)
    const willAfter1 = b.will;
    /* Ещё раз, у всех остальных 35, кроме b — на b уже сработало */
    r.will = 35; l.will = 35;
    l.liturgy = ['wrath', 'mercy'];
    l.od = 3;
    P.FORCED.length = 0;
    P.FORCED.push(15);
    await P.perform(l, 'lazarFaith', b);
    const willAfter2 = b.will;

    /* Проверка Порога Боли: голосовые слова работают на Пороге, Посох и Умерщвление — нет */
    P.applyDamage(l, 99, null);
    l.od = 3;
    l._lastTurn = true;
    const onEdgeActs = {
      edge: P.onEdge(l),
      wrath: P.okAct(l, 'lazarWrath'),
      mercy: P.okAct(l, 'lazarMercy'),
      faith: P.okAct(l, 'lazarFaith'),
      staff: P.okAct(l, 'lazarStaff'),
      mortify: P.okAct(l, 'lazarMortify'),
    };

    return {
      stig1Open,
      stig1Closed,
      stig2Bandaged,
      afterWrath,
      hasBleedStop,
      rPainBeforeEnd,
      windowLit,
      afterRedemption,
      willAfter1,
      willAfter2,
      onEdgeActs,
    };
  });
  assert.equal(lazarRes.stig1Open, 1);
  assert.equal(lazarRes.stig1Closed, 0);
  assert.equal(lazarRes.stig2Bandaged, 2);
  assert.deepEqual(lazarRes.afterWrath, { unst: 1, lit: ['wrath'] });
  assert.equal(lazarRes.hasBleedStop, true);
  assert.deepEqual(lazarRes.windowLit, ['mercy', 'mercy', 'mercy']);
  assert.deepEqual(lazarRes.afterRedemption, {
    litCleared: true,
    faithBonus: true,
    enemyPainFromMiracle: 2,
    ragnaSeriousClosed: true,
    lazarOwnStigmaStillOpen: true,
  });
  assert.equal(lazarRes.willAfter1, 29);
  assert.equal(lazarRes.willAfter2, 29);
  assert.deepEqual(lazarRes.onEdgeActs, {
    edge: true,
    wrath: true,
    mercy: true,
    faith: true,
    staff: false,
    mortify: false,
  });
  console.log('✓ Лазарь: Литургия, 3 слова, Стигматы, Чудо «Искупление», работа на Пороге');

  /* 4. Бернхард: Рапира (+2 лёгкое, броня −1), Личный пример (усиленный/крит/срыв/свет), Выпад, Финт, Дуэльная стойка */
  const bernRes = await page.evaluate(async () => {
    P.SET.party = ['ragna', 'lazar', 'bernhard'];
    P.SET.anim = 'fast';
    P.loadScenario('dummies');
    await new Promise(r => setTimeout(r, 60));
    P.S.sim = true;
    P.S.phase = 'pc';
    const b = P.S.units.find(u => u.tpl === 'bernhard');
    const r = P.S.units.find(u => u.tpl === 'ragna');
    const l = P.S.units.find(u => u.tpl === 'lazar');
    const e = P.S.units.find(u => u.tpl === 'dummyElite'); // броня 2
    const e2 = P.S.units.find(u => u.tpl === 'dummy');
    for (const u of P.S.units) if (![b, r, l, e, e2].includes(u)) { u.x = 13; u.y = 1 + (u.id % 6); }
    b.x = 4; b.y = 4; r.x = 3; r.y = 4; l.x = 1; l.y = 1; e.x = 6; e.y = 4; e2.x = 4; e2.y = 3;
    b.od = 3; e.od = 0; e2.od = 2; e2.zocRound = 0;

    /* Рапира: +2 лёгкое оружие (+9 суммарно), броня врага 2 считается как 1 */
    const rapMods = P.atkMods(b, P.A.bernhardRapier, e);
    const rapPain = P.painInfo(b, P.A.bernhardRapier, e, 2, {});

    /* Выпад: враг e ровно в 2 гексах по прямой (4,4 → 5,4 → 6,4), шаг без ZoC от e2 и удар рапирой */
    const canLungeStraight = P.canTarget(b, P.A.bernhardLunge, e);
    const canLungeAdj = P.canTarget(b, P.A.bernhardLunge, e2);
    P.FORCED.length = 0;
    P.FORCED.push(10); // 10 + 9 = 19 против Стойкости 13 = +6 → усиленный успех → Личный пример +1!
    await P.perform(b, 'bernhardLunge', e);
    const lungeRes = {
      canLungeStraight,
      canLungeAdj,
      movedToMid: b.x === 5 && b.y === 4,
      noZocFromE2: e2.zocRound !== P.S.round,
      exampleOnB: P.exampleBonus(b),
      exampleOnLitRagna: P.exampleBonus(r),
      ragnaAtkHasExample: P.atkMods(r, P.A.ragnaSword, e).some(m => m.l === 'Личный пример' && m.v === 1),
      ragnaDefHasExample: P.v2DefOptions(r, e, P.A.sword, {}).some(o => o.mods.some(m => m.l === 'Личный пример' && m.v === 1)),
    };

    /* Финт: без Боли, нельзя парировать, накладывает Рябь; крит Финта поднимает Личный пример до +2! */
    const feintDefModes = P.v2DefOptions(e, b, P.A.bernhardFeint, {}).map(o => o.mode);
    const ePain0 = P.painOf(e);
    P.FORCED.length = 0;
    P.FORCED.push(18); // крит Финта
    await P.perform(b, 'bernhardFeint', e);
    const feintRes = {
      noParry: !feintDefModes.includes('parry'),
      noPain: P.painOf(e) === ePain0,
      ripple: P.stOf(e, 'ripple'),
      exampleUpgradedTo2: P.exampleBonus(b) === 2 && P.exampleBonus(r) === 2,
    };

    /* Срыв Личного примера: промах (натуральная 1) сразу снимает эффект */
    P.FORCED.length = 0;
    P.FORCED.push(1);
    await P.perform(b, 'bernhardRapier', e);
    const brokenByNat1 = P.exampleBonus(b) === 0 && P.exampleBonus(r) === 0;

    /* Дуэльная стойка: против цели с тяжёлым оружием нет штрафа веса при парировании, контратака с перевеса 1+ */
    b.od = 3; b.st = {}; b.prone = false;
    const fat = P.mkUnit('dummyFat', 'en', 5, 3);
    P.painPrep(fat);
    P.S.units.push(fat);
    fat.od = 2;
    const parryModsBefore = P.v2DefOptions(b, fat, P.A.club, {}).find(o => o.mode === 'parry').mods;
    await P.perform(b, 'bernhardDuel', fat);
    const parryModsAfter = P.v2DefOptions(b, fat, P.A.club, {}).find(o => o.mode === 'parry').mods;
    /* Контратака при перевесе ровно +1 (10 + 7 = 17 против атаки 16 → перевес 1) и запуск Личного примера от контратаки! */
    P.S.phase = 'en';
    b.od = 2; b.fdUsed = true; // чтобы выбрал парирование, не уклонение
    const fatPain0 = P.painOf(fat);
    P.FORCED.length = 0;
    // атака Толстяка: d20=14 (+ mm 2 = 16); защита Бернхарда (parry): d20=10 (+ mm 7 = 17, перевес +1!); контратака Бернхарда: d20=10 (+9+5=24)
    P.FORCED.push(14, 10, 10, 1);
    await P.resolveAttack(fat, P.A.club, b);
    const duelRes = {
      hadWeightPenBefore: parryModsBefore.some(m => /вес/.test(m.l)),
      noWeightPenAfter: !parryModsAfter.some(m => /вес/.test(m.l)),
      counterHitFat: P.painOf(fat) > fatPain0,
      exampleFromCounter: P.exampleBonus(b) >= 1,
    };

    /* Срыв Личного примера при падении (сбит с ног) */
    P.setProne(b, 'тест');
    const brokenByProne = P.exampleBonus(b) === 0;

    return { rapMods, rapPain, lungeRes, feintRes, brokenByNat1, duelRes, brokenByProne };
  });
  assert.ok(bernRes.rapMods.some(m => m.l === 'лёгкое оружие' && m.v === 2));
  assert.equal(bernRes.rapPain.ap0, 2);
  assert.equal(bernRes.rapPain.ap, 1);
  assert.deepEqual(bernRes.lungeRes, {
    canLungeStraight: true,
    canLungeAdj: false,
    movedToMid: true,
    noZocFromE2: true,
    exampleOnB: 1,
    exampleOnLitRagna: 1,
    ragnaAtkHasExample: true,
    ragnaDefHasExample: true,
  });
  assert.deepEqual(bernRes.feintRes, {
    noParry: true,
    noPain: true,
    ripple: 1,
    exampleUpgradedTo2: true,
  });
  assert.equal(bernRes.brokenByNat1, true);
  assert.deepEqual(bernRes.duelRes, {
    hadWeightPenBefore: true,
    noWeightPenAfter: true,
    counterHitFat: true,
    exampleFromCounter: true,
  });
  assert.equal(bernRes.brokenByProne, true);
  console.log('✓ Бернхард: Рапира, Личный пример, Выпад, Финт, Дуэльная стойка и контратака с перевеса 1+');

  assert.deepEqual(errors, [], 'ошибки на странице: ' + errors.join(' | '));
  console.log('\nВсе проверки новых героев прошли');
  await page.close();
} finally {
  await browser.close();
}
