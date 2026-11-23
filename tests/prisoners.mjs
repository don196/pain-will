/* Регрессионные проверки переноса карточек на Боли и двух карт 4.5.6.
   Запуск после сборки: node tests/prisoners.mjs */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url=pathToFileURL(path.join(root,'dist','index.html')).href;
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>typeof P==='object' && P.S && P.S.units.length>0, null, {timeout:15000});

  const scenes=await page.evaluate(()=>{
    P.loadScenario('prison33');
    const s33={
      units:P.S.units.filter(u=>u.side==='en').map(u=>u.tpl).sort(),
      lim:Object.fromEntries(P.S.units.filter(u=>u.side==='en').map(u=>[u.tpl,P.limOf(u)])),
      pc:Object.fromEntries(P.S.units.filter(u=>u.side==='pc').map(u=>[u.tpl,[u.x,u.y]])),
      doors:Object.keys(P.S.doors).length,
    };
    P.loadScenario('prison34');
    return {s33,s34:P.S.units.filter(u=>u.side==='en').map(u=>u.tpl).sort()};
  });
  assert.deepEqual(scenes.s33.units,['prisonChain','prisonJailer','prisonKnife']);
  assert.deepEqual(scenes.s34,['prisonChain','prisonJailer','prisonKnife','prisonKnife']);
  assert.deepEqual(scenes.s33.lim,{prisonKnife:4,prisonChain:5,prisonJailer:6});
  assert.deepEqual(scenes.s33.pc,{conrad:[11,7],walter:[11,8],helga:[13,8]});
  assert.ok(scenes.s33.doors>0);
  console.log('✓ Обе тюремные карты, двери, расстановка, противники и лимиты Боли');

  const stepback=await page.evaluate(async()=>{
    P.loadScenario('prison33');await new Promise(r=>setTimeout(r,80));P.S.sim=true;P.S.phase='en';
    const u=P.S.units.find(u=>u.tpl==='prisonKnife');u.od=3;
    const c=[...P.bfs(u,{max:1}).entries()].find(([k,v])=>v.d===1);
    const [x,y]=c[0].split(',').map(Number);
    const before={x:u.x,y:u.y};
    const odBefore=u.od;
    const ok=await P.performMove(u,x,y,'prisonBackstep');
    return {ok,odBefore,od:u.od,down:u.down,over:P.S.over,prone:u.prone,pos:[u.x,u.y],d:P.hd(before.x,before.y,u.x,u.y),second:P.okAct(u,'prisonBackstep'),events:P.S.log?.slice(-3)};
  });
  assert.equal(stepback.ok,true);
  assert.equal(stepback.od,2);
  assert.equal(stepback.d,1);
  assert.equal(stepback.second,false);
  console.log('✓ Отскок: 1 гекс, 1 ОД, повтор запрещён');

  const grab=await page.evaluate(async()=>{
    P.loadScenario('prison33');await new Promise(r=>setTimeout(r,80));P.S.sim=true;P.S.phase='en';
    const j=P.S.units.find(u=>u.tpl==='prisonJailer'), c=P.S.units.find(u=>u.tpl==='conrad');
    j.x=8;j.y=7;c.x=9;c.y=7;j.od=3;c.od=3;
    const pain0=P.painOf(c);
    P.FORCED.push(20,1);
    await P.perform(j,'prisonJailerGrab',c);
    const held={held:c.grabbedBy===j.id,arm:c.grabbedArm,move:P.okAct(c,'move'),sword:P.okAct(c,'csword'),pain:P.painOf(c)-pain0};
    P.S.phase='pc';P.FORCED.push(20,1);
    await P.perform(c,'escape');
    return {held,freed:c.grabbedBy==null && j.hold==null};
  });
  assert.deepEqual(grab.held,{held:true,arm:'armR',move:false,sword:false,pain:0});
  assert.equal(grab.freed,true);
  console.log('✓ Захват руки: без Боли, запрещён меч и движение, освобождение встречной Силой');

  const circle=await page.evaluate(async()=>{
    P.loadScenario('prison33');await new Promise(r=>setTimeout(r,80));P.S.sim=true;P.S.phase='en';
    const ch=P.S.units.find(u=>u.tpl==='prisonChain'), j=P.S.units.find(u=>u.tpl==='prisonJailer'), c=P.S.units.find(u=>u.tpl==='conrad');
    ch.x=8;ch.y=7;j.x=9;j.y=7;c.x=7;c.y=7;ch.od=3;
    const p0=P.painOf(j),p1=P.painOf(c);
    P.FORCED.push(20,20,20,20);
    await P.perform(ch,'prisonChainCircle');
    return {od:ch.od,enemy:P.painOf(c)-p1,ally:P.painOf(j)-p0};
  });
  assert.equal(circle.od,1);
  assert.ok(circle.enemy>0 && circle.ally>0,JSON.stringify(circle));
  console.log('✓ Круговой удар цепью: 2 ОД, независимые удары по своему и чужому');

  const intercept=await page.evaluate(async()=>{
    P.loadScenario('prison33');await new Promise(r=>setTimeout(r,80));P.S.sim=true;P.S.phase='en';
    const ch=P.S.units.find(u=>u.tpl==='prisonChain'),c=P.S.units.find(u=>u.tpl==='conrad');
    ch.x=8;ch.y=7;c.x=10;c.y=7;ch.od=3;
    await P.perform(ch,'prisonChainReady');
    const ready=ch.charge?.kind==='prisonChain' && ch.od===2;
    P.S.phase='pc';P.FORCED.push(1);
    await P.walk(c,[[9,7]]);
    return {ready,spent:ch.od===1,consumed:ch.charge==null,used:(P.S.stat?.skillEvents?.prisonChainIntercept||0)>0};
  });
  assert.deepEqual(intercept,{ready:true,spent:true,consumed:true,used:true});
  console.log('✓ Раскрутка цепи: перехват при входе, 1 реакция, подготовка расходуется');
  assert.deepEqual(errors,[]);
  await page.close();
} finally {await browser.close();}
