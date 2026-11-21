/* ================= ИНТЕРФЕЙС 2: ПАНЕЛИ ================= */
const UI=(()=>{const d={zoc:true,fc:true,logF:'all',det:{}};try{return Object.assign(d,JSON.parse(localStorage.getItem('polygon2-ui')||'{}'));}catch(e){return d;}})();
function saveUI(){try{localStorage.setItem('polygon2-ui',JSON.stringify(UI));}catch(e){}}
let HINT_ID=null,HINT_PIN=null;
const roman=n=>{let s='';for(const [v,r] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(n>=v){s+=r;n-=v;}return s||'0';};
const hpCol=p=>p>.5?'var(--good)':p>.25?'var(--warn)':'var(--bad)';
function peek(id){document.querySelectorAll('#toks .tok.peek').forEach(d=>d.classList.remove('peek'));if(id!=null){const d=$(`#toks [data-id="${id}"]`);if(d)d.classList.add('peek');}}
/* Группы действий на панели: шаг, удар, умение, вещи. */
function actGroup(id,a){
  if(['move','step','evade','dash','jump','swap','door','smash','escape','breakbind','standup'].includes(a.kind)||id==='breakbind')return 0;
  if(a.kind==='prep'||a.kind==='cover')return 4;
  if(a.kind==='push')return 1;
  if(a.kind==='unlasso')return 3;
  if(['throw','bandage','torch','trap','wswap','revive'].includes(a.kind)||id==='reload')return 3;
  if((ATTACK_KINDS.includes(a.kind)||a.kind==='pair'||a.kind==='flare')&&!a.magic)return 1;
  return 2;
}
function actMeta(u,id,a){
  const left=a.ammo?' · ×'+((u.ammo||{})[id]||0):'';
  if(['attack','arc','circle','pair'].includes(a.kind)&&a.fixed==null&&(a.K||a.base!=null))return (PAIN()?'Боль '+[1,2,3].map(t=>PCLS[wClass(u,a)][t]).join('·')+' · '+PTYP_RU[wType(a)]:'урон '+[1,2,3].map(t=>rawDmg(u,a,t)).join('·'))+(a.ranged?' · '+a.range+' г.':(a.reach||1)>1?' · дост. '+a.reach:'')+left;
  if(a.kind==='attack'&&a.fixed!=null)return a.fixed?'урон '+a.fixed+(a.knock?' · отброс':''):'без урона';
  if(a.kind==='move')return speedOf(u)+' гекс. за ОД';
  if(a.kind==='push')return 'Сила '+stat(u,'str')+(u.shield>0?' + щит 2':'');
  if(a.kind==='prep')return 'до своего хода';
  if(a.kind==='cover')return 'соседний союзник';
  if(a.kind==='standup')return 'снимает «сбит»';
  if(a.kind==='flash')return 'источник огня';
  if(a.kind==='habits')return '2 слабых места';
  if(a.kind==='curse2'||a.kind==='ordnow'||a.kind==='ordback')return 'дальность '+(a.range||3)+(a.speech?' · речь':'');
  if(a.lasso)return 'без урона · '+a.range+' г.';
  if(a.kind==='throw')return a.held?'из рук':'в запасе '+(u.torches||0);
  if(a.kind==='bandage')return 'бинтов '+(u.bandages||0);
  if(a.kind==='revive')return 'сосед без сознания';
  if(a.kind==='trap')return 'осталось '+(u.traps||0);
  if(a.kind==='wswap')return 'в руках '+(WNAME[u.wield]||'—');
  if(a.ammo)return 'осталось '+((u.ammo||{})[id]||0);
  if(a.radius)return 'радиус '+a.radius+(a.cd?' · пауза '+a.cd:'');
  if(a.range)return 'дальность '+a.range+(a.cd?' · пауза '+a.cd:'');
  if(a.cd)return 'пауза '+a.cd;
  return '';
}
function actLong(u,id,a){
/*LONGHINT*/
  return hint||'';
}
/* Кто ударит, если боец пройдёт этим путём (зона контроля). Ничего не меняет в состоянии. */
function zocPreview(u,path){
  if(!SET.zoc||!path||!path.length)return[];
  const out=[],hit=new Set();let cx=u.x,cy=u.y;
  for(const [x,y] of path){
    const ghost=Object.assign({},u,{x:cx,y:cy}),to=posOf(u,x,y);
    for(const e of S.units){
      if(e.down||e.side===u.side||hit.has(e.id)||e.zocRound===S.round||!near1(e,ghost)||near1(e,to))continue;
      const id=zocWeapon(e,ghost);if(!id)continue;hit.add(e.id);out.push({e,id,p:hitCalc(e,A[id],ghost).hit});
    }
    cx=x;cy=y;
  }
  return out;
}
/* Прогноз прямо на поле: шанс и ожидаемый урон над каждой доступной целью. */
function renderForecast(){
  const box=$('#fc');if(!box)return;const u=selUnit();let html='';
  if(UI.fc&&u&&S.act&&canControl(u)){
    const a=A[S.act];
    const put=(t,pr,sub)=>{const p=tokPos(t);html+=`<div class="fcb${pr<.35?' lo':pr>=.7?' hi':''}" style="left:${p.x.toFixed(1)}px;top:${(p.y-CELL*(sz(t)>1?.86:.5)).toFixed(1)}px"><b>${pct(pr)}</b>${sub?`<i>${sub}</i>`:''}</div>`;};
    const chk=(st,dc,extra)=>{const m=stat(u,st)+sum(rollMods(u))+sum(abilMods(u))+(extra||0);let ok=0;for(let r=1;r<=20;r++)if(r+m-dc>=0)ok++;return ok/20;};
    const foes=S.units.filter(o=>!o.down&&o.side!==u.side),mates=S.units.filter(o=>!o.down&&o.side===u.side);
    if(a.kind==='attack'||a.kind==='grab'){for(const t of foes)if(canTarget(u,a,t)){const h=hitCalc(u,a,t);if(AP3()){const p=tokPos(t);html+=`<div class="fcb${h.p[3]>=.25?' hi':''}${openT(t)?' op':''}" style="left:${p.x.toFixed(1)}px;top:${(p.y+CELL*.42).toFixed(1)}px"><b>${a.lasso?pct(h.hit):'≈'+fmtN(h.Eact)}</b><i>${a.lasso?'силок':(h.hit<1?'мимо '+pct(1-h.hit)+' · ':'')+'крит '+pct(h.p[3])}${openT(t)?' · открыт':''}</i></div>`;}else put(t,h.hit,a.kind==='grab'?'':'≈'+fmtN(h.Eact));}}
    else if(a.kind==='push'){for(const t of foes)if(canTarget(u,a,t))put(t,pContest(stat(u,'str')+(u.shield>0?2:0)+(stOf(t,'unst')?3:0)-(u.prone?5:0),stat(t,'str'),false),stOf(t,'unst')?'упадёт':'');}
    else if(a.kind==='curse2'){for(const t of foes)if(canTarget(u,a,t)){if(AP3()){put(t,curseCalc(u,a,t).land);continue;}const m=[{l:'',v:mastMg(u)}];v2AtkMods(u,a,m);const need=passive(t,{magic:true})-sum(m)-sum(rollMods(u));put(t,Math.max(0,Math.min(1,(20-need)/20)));}}
    else if(a.kind==='dash'){const w=A[a.with];for(const t of foes)if(w&&canTarget(u,a,t)){const h=hitCalc(u,w,t);put(t,h.hit,'≈'+fmtN(h.Eact));}}
    else if(a.kind==='pair'){const seen=new Set();for(const pr of pairOptions(u))for(const t of pr){if(seen.has(t.id))continue;seen.add(t.id);const h=hitCalc(u,a,t);put(t,h.hit,'≈'+fmtN(h.E));}}
    else if(a.kind==='arc'&&S.hover&&cheb(u,S.hover)===1&&!inFoot(u,S.hover.x,S.hover.y)){for(const t of arcTargets(u,S.hover)){const h=hitCalc(u,a,t);put(t,h.hit,'≈'+fmtN(h.E));}}
    else if(a.kind==='debuff'){for(const t of foes)if(canTarget(u,a,t))put(t,1-curseOdds(u,t,a).p[0]);}
    else if(a.kind==='bind'){for(const t of foes)if(canTarget(u,a,t)){const pa=stat(u,'str')+sum(rollMods(u))-darkPen(u),pb=stat(t,'str')+sum(rollMods(t,true))-darkPen(t);put(t,pContest(pa,pb,false));}}
    else if(a.kind==='buff'||a.kind==='order'){for(const t of mates)if(canTarget(u,a,t))put(t,chk('cha',a.dc||14,sum(distrustMod(t))));}
    else if(a.kind==='heal'){for(const t of mates)if(canTarget(u,a,t))put(t,chk('int',a.dc||12,t!==u?sum(distrustMod(t)):0));}
  }
  box.innerHTML=html;
}
function renderHint(){
  const box=$('#hint');if(!box)return;const u=selUnit(),id=HINT_ID||S.act||HINT_PIN;
  if(!u||!id||!A[id]||!hasAct(u,id)){box.innerHTML='Выберите действие, затем цель на поле. <kbd>1</kbd>–<kbd>9</kbd> действия · <kbd>Tab</kbd> следующий герой · <kbd>Enter</kbd> конец хода · <kbd>Esc</kbd> отмена';return;}
  const a=A[id],st=actState(u,id),cost=actCost(u,id),long=actLong(u,id,a);
  box.innerHTML=`<b>${esc(a.name)}</b><span class="cost">${cost} ОД</span>${long}${a.pending?' <span class="pend">требует утверждения</span>':''}${!st.ok&&st.why?` <span class="why">Сейчас нельзя: ${st.why}.</span>`:''}`;
}
function renderTurn(){
  const human=isHuman(S.phase),u=selUnit();
  const phase=S.over?(S.over==='pc'?'Победа героев':S.over==='en'?'Герои пали':'Ничья'):S.editor?'Редактор поля':(S.phase==='pc'?'Ход героев':'Ход противников')+(human?'':' · ИИ');
  let prompt;
  if(S.over)prompt='Бой окончен. Весь ход боя — в журнале.';
  else if(S.editor)prompt='Выберите инструмент под полем и нажимайте на гексы.';
  else if(!human)prompt='Противники ходят…';
  else if(S.busy)prompt='Действие выполняется…';
  else if(!u||!canControl(u))prompt='Выберите героя: нажмите на фигуру или на строку в списке.';
  else if(S.act){const a=A[S.act];const what={move:'выберите гекс',arc:'выберите направление удара',throw:'выберите гекс для факела',flare:'выберите гекс',veil:'выберите центр завесы',trap:'выберите гекс для капкана',step:'выберите соседний гекс',evade:'выберите, куда уйти',jump:'выберите тёмный гекс',door:'выберите дверь',smash:'выберите препятствие',torch:'выберите факел',swap:'выберите союзника',cover:'выберите союзника',buff:'выберите союзника',order:'выберите союзника',heal:'выберите, кого лечить',bandage:'выберите, кого перевязать',pair:'выберите одного из пары',push:'выберите соседнего врага',flash:'выберите источник огня',ordnow:'выберите союзника в 2 гексах',ordback:'выберите союзника в 2 гексах',curse2:'выберите врага в 3 гексах',habits:'выберите врага'}[a.kind]||'выберите цель';prompt=`<b>${esc(u.name)}</b> · ${esc(a.name)}: ${what}`;}
  else prompt=`<b>${esc(u.name)}</b>: ${u.od?'выберите действие':'ОД закончились'}${AP3()&&u.side===S.phase?' · не потраченные ОД пойдут на защиту':''}`;
  $('#ctx').innerHTML=`<div class="rnd"><span class="cap">Раунд</span><span class="rn">${roman(S.round)}</span></div><div class="ph ${S.over?'over':S.phase}">${phase}</div><div class="pr">${prompt}</div>
    <div class="tg"><button type="button" id="tgFc" aria-pressed="${!!UI.fc}" title="Шанс и ожидаемый урон над целями">Прогноз</button><button type="button" id="tgZoc" aria-pressed="${!!(UI.zoc&&SET.zoc)}" ${SET.zoc?'':'disabled'} title="${SET.zoc?'Гексы, выход из которых вызовет удар противника':'Зона контроля выключена в правилах'}">Зоны контроля</button></div>
    ${S.over?'<button type="button" class="primary end" id="btnAgain">Начать заново</button>':`<button type="button" class="primary end" id="btnEnd" ${(!human||S.busy||S.editor)?'disabled':''}>Завершить ход<kbd>Enter</kbd></button>`}`;
  $('#tgFc').onclick=()=>{UI.fc=!UI.fc;saveUI();render();};
  $('#tgZoc').onclick=()=>{UI.zoc=!UI.zoc;saveUI();render();};
  if($('#btnEnd'))$('#btnEnd').onclick=onEndTurn;if($('#btnAgain'))$('#btnAgain').onclick=restart;
  const party=(SET.party||[]).filter(k=>T[k]).map(k=>T[k].name).join(', ')||'нет';
  $('#sceneInfo').innerHTML=`<p>${SCN[S.scn]?SCN[S.scn].goal:'Своя расстановка.'}</p><p>${S.initWhy}</p><p>${AP3()?`3 ОД, запас реакций, бросок против Стойкости; ловкачи: ${{dodge:'бесплатное уклонение',od:'+1 ОД',none:'без бонуса'}[SET.dexMode||'dodge']}. `:''}Группа: ${esc(party)}. Модель: ${DEXSTR()?'Ловкость и Сила':'основная характеристика'}${SET.shieldBlock?', блок щитом от Силы':''}${SET.darkRules?', темнота':', темнота выключена'}${SET.zoc?', зона контроля':''}.</p>`;
  $('#btnEditor').classList.toggle('on',!!S.editor);
}
function renderRoster(){
  const box=$('#roster');
  const row=u=>{const p=hpFrac(u),cur=u.side===S.phase&&!S.over&&!S.editor;
    const pips=u.down?'':AP3()?odPipsHTML(u):[0,1].map(i=>`<b class="${i<u.od?'':'off'}"></b>`).join('')+`<b class="ad${adLeft(u)>0?'':' off'}"></b>`;
    return `<button type="button" class="ru ${u.side}${S.sel===u.id?' sel':''}${u.down?' down':''}${cur&&!u.down&&u.od===0?' spent':''}" data-id="${u.id}"><span class="g">${esc(u.glyph)}</span><span class="nm">${esc(u.name)}</span><span class="pips" title="Очки действий и активная защита">${pips}</span><span class="mb"><i style="width:${p*100}%;background:${hpCol(p)}"></i></span><span class="hpn" title="${PAIN()?'Боль / предел':'HP'}">${hpNum(u)}</span><span class="st">${u.down?downTxt(u):badges(u).map(x=>`<span title="${x[1]}">${x[0]}</span>`).join('')}</span></button>`;};
  const grp=(side,title)=>{const us=S.units.filter(u=>u.side===side);if(!us.length)return '';const al=us.filter(u=>!u.down).length;return `<div class="rg ${side}"><div class="rgh"><span>${title}</span><span class="cnt">${al}/${us.length}</span>${S.phase===side&&!S.over&&!S.editor?'<span class="now">ходят</span>':''}</div>${us.map(row).join('')}</div>`;};
  box.innerHTML=grp('pc','Герои')+grp('en','Противники');
  box.querySelectorAll('[data-id]').forEach(b=>{b.onclick=()=>{S.sel=+b.dataset.id;S.act=null;render();};b.onmouseenter=()=>peek(+b.dataset.id);b.onmouseleave=()=>peek(null);});
}
function renderActs(){
  const box=$('#acts');
  if(S.editor){renderEditor(box);return;}
  const u=selUnit();
  if(!u||u.down){box.innerHTML=`<div class="dock-empty">${u?esc(u.name)+' вне боя.':'Нажмите на бойца на поле или в списке, чтобы увидеть его действия.'}</div>`;return;}
  const ids=visibleActs(u),ctrl=!S.busy&&!S.over&&u.side===S.phase&&isHuman(u.side);
  const G=[[],[],[],[],[]];ids.forEach(id=>{if(A[id])G[actGroup(id,A[id])].push(id);});
  const GN=['Шаг','Удар','Умение','Вещи','Реакция'];let n=0,html='';
  [0,1,2,4,3].forEach(gi=>{const g=G[gi];if(!g.length)return;html+=`<div class="ag"><div class="agt">`;
    g.forEach((id,k)=>{n++;const a=A[id],st=actState(u,id),cost=actCost(u,id);
      const btn=`<button type="button" class="act${S.act===id?' sel':''}${st.ok?'':' off'}${a.pending?' pd':''}" data-act="${id}" aria-disabled="${st.ok?'false':'true'}"><span class="n">${esc(a.name)}</span><span class="c" title="${cost} ОД">${cost?'<b></b>'.repeat(cost):'<b class="z"></b>'}</span><span class="m">${!st.ok&&ctrl&&st.why?`<em>${st.why}</em>`:actMeta(u,id,a)}</span><span class="k">${n<=9?n:''}</span></button>`;
      html+=k?btn:`<span class="agh"><div class="agn">${GN[gi]}</div>${btn}</span>`;});
    html+='</div></div>';});
  const left=ctrl?alive(S.phase).filter(o=>o.od>0&&!o.skipped):[];
  box.innerHTML=html+'<div class="hint" id="hint"></div>'+(ctrl?`<div class="dockft">${left.length?`<span>ОД остались: ${left.map(o=>`<button type="button" class="lk" data-go="${o.id}">${esc(o.name)}</button>`).join(', ')}</span>`:'<span>Все потратили ОД — можно завершать ход.</span>'}${canControl(u)?'<button type="button" id="btnAiOne" class="ghost">Пусть за него сходит ИИ</button>':''}</div>`:'');
  box.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{S.sel=+b.dataset.go;S.act=null;render();});
  const ai=$('#btnAiOne');if(ai)ai.onclick=()=>run(()=>aiTurn(u));
  box.querySelectorAll('[data-act]').forEach(b=>{const id=b.dataset.act;
    b.onclick=()=>{if(b.getAttribute('aria-disabled')==='true'){HINT_PIN=id;renderHint();return;}HINT_PIN=null;onAction(id);};
    b.onmouseenter=b.onfocus=()=>{HINT_ID=id;renderHint();};b.onmouseleave=b.onblur=()=>{HINT_ID=null;renderHint();};});
  renderHint();
}
function renderCard(){
  const u=selUnit(),box=$('#card');
  if(!u){box.innerHTML='<div class="sheet-empty"><h2>Лист бойца</h2><p>Нажмите на фигуру на поле или на строку в списке слева: здесь появятся характеристики, раны и эффекты.</p></div>';return;}
  const p=hpFrac(u),best=bestDefStat(u),f=disForm(u);
  const SHORT={str:'Сила',dex:'Ловк.',int:'Инт.',cha:'Хар.'};
  const statBox=s=>{const v=stat(u,s),b=u.base[s];return `<div class="${v<b?'low':''}" title="${STAT_RU[s]}${v!==b?': без штрафов '+b:''}"><b>${v}</b><span>${SHORT[s]}</span></div>`;};
/*EFFS*/
  const disSel=`<select id="disSel" aria-label="Личное расстройство"><option value="">нет расстройства</option>${Object.keys(DIS).map(k=>`<option value="${k}" ${u.disorder===k?'selected':''}>${DIS[k][0]} → ${DIS[k][1]}</option>`).join('')}</select>`;
  const am=activeMods(u),amv=sum(am),adN=u.adr==null?1:u.adr;
  const pips=AP3()?odPipsHTML(u):[0,1].map(i=>`<b class="${i<u.od?'':'off'}"></b>`).join(''),adp=AP3()?'':Array.from({length:adN},(_,i)=>`<b class="ad${i<adLeft(u)?'':' off'}"></b>`).join('');
  const WSH={head:'Гол.',torso:'Тело',armL:'Л.рука',armR:'П.рука',legL:'Л.нога',legR:'П.нога'};
  const wcell=ar=>{const w=(u.wounds||{})[ar],fr=u.fract.includes(ar);return `<div class="wc d${w?w.deg:0}${w&&w.open?' open':''}${fr?' fr':''}" title="${AREA_RU[ar]}: ${w?WDEG_RU[w.deg]+' рана, '+(w.open?'открыта':'закрыта'):'цела'}${fr?', перелом':''}"><span>${WSH[ar]}</span><b>${w?w.deg:fr?'×':'·'}</b></div>`;};
  const inv=[`факелы <b>${u.torches||0}</b>${u.torch?' и один в руке':''}`,`бинты <b>${u.bandages||0}</b>`];
  if(u.traps)inv.push(`капканы <b>${u.traps}</b>`);
  for(const [id,n] of Object.entries(u.ammo||{}))if(A[id])inv.push(`${esc(A[id].name.toLowerCase())} <b>${n}</b>`);
  const open=id=>(UI.det[id]||(id==='dGm'&&S.editor))?'open':'';
  let html=`<div class="sh-hd"><div class="gl ${u.side}">${esc(u.glyph)}</div><div><div class="nm">${esc(u.name)}</div><div class="sd">${u.side==='pc'?'герой':'противник'}${sz(u)>1?' · занимает 3 гекса':''}${u.wield&&weaponsOf(u).length>1?' · в руках '+(WNAME[u.wield]||u.wield):''}${u.down?' · вне боя':''}</div></div>
    <div class="sh-od"><span class="pips" title="${AP3()?`Очки действий: ${u.od} из ${odMax(u)}. Не потраченные в свой ход — запас реакций до следующего хода`:`Очки действий: ${u.od} из 2`}">${pips}</span><span class="pips" title="Активная защита: осталось ${adLeft(u)} из ${adN}">${adp}</span></div></div>
    <div class="hpline"><div class="bar"><i style="width:${p*100}%;background:${hpCol(p)}"></i></div><span class="v" title="${PAIN()?'Боль / предел. Каждые 2 Боли — −1 к атакам и способностям. Герой на пределе — «на пороге», дальше без сознания; противник на пределе выбывает':'HP'}">${hpVal(u)}</span></div>
    <div class="stats">${['str','dex','int','cha'].map(statBox).join('')}
      ${AP3()?`<div title="Телосложение: из него считается Стойкость"><b>${conOf(u)}</b><span>Тел.</span></div><div class="der" title="Стойкость = ${RBASE()} + Телосложение. Атака попадает всегда; разница броска со Стойкостью решает степень: +5 — усиленный, +10 — критический"><b>${resist(u)}</b><span>Стойкость</span></div><div title="${PAIN()?'Прочность брони сейчас / в начале боя. Режущее и огонь гасит целиком, колющее и дробящее — не больше 1 за удар; каждый погашенный пункт стирает пункт прочности':'Броня'}"><b>${armorTxt(u)}</b><span>Броня</span></div><div title="Гексов за 1 ОД"><b>${speedOf(u)}</b><span>Скорость</span></div></div>`:`<div class="der" title="Пассивная защита"><b>${passive(u)}</b><span>Защита</span></div><div title="Броня"><b>${u.armor}</b><span>Броня</span></div><div title="Гексов за 1 ОД"><b>${speedOf(u)}</b><span>Скорость</span></div><div class="${f?'low':''}" title="Воля: слабая форма расстройства с −10, сильная с −20"><b>${u.will==null?'—':u.will}</b><span>Воля</span></div></div>`}

    <div class="wounds">${AREAS.map(wcell).join('')}<div class="wc bl${u.bleed?' open':''}" title="${PAIN()?'Стаки кровотечения: в начале своего хода 1 Боль и −1 стак; открытая рана даёт +1 стак':'Стаки кровотечения: столько HP теряет в конце раунда'}"><span>Кровь</span><b>${u.bleed||'·'}</b></div></div>
    ${V2()?`<div class="inv">мастерство: ближний бой <b>${mast(u)}</b> · дальний бой <b>${mast(u,true)}</b> · магия <b>${mastMg(u)}</b></div>`:''}
    <div class="inv">${inv.join(' · ')} · ${LIGHT_RU[unitLight(u)]}${u.nv?', ночное зрение':darkPen(u)?' (−5 к атакам и защите)':''}</div>`;
  if(effs.length)html+=`<div class="chips">${effs.map(e=>`<span class="chip st">${e}</span>`).join('')}</div>`;
  if(u.disorder&&u.will!=null&&(f||hasEff(u,'inspire')&&u.will<=-10))html+=`<div class="dis">${f?`${DIS_ICON[u.disorder]} ${DIS[u.disorder][f-1]} (${f===1?'слабая':'сильная'} форма): ${disDesc(u.disorder,f)}`:'Расстройство подавлено Воодушевлением.'}</div>`;
  html+=`<details class="sec" id="dDet" ${open('dDet')}><summary>Расчёт защиты и атаки</summary><dl class="kv">
    ${AP3()?`<dt>Стойкость</dt><dd><b>${resist(u)}</b> <span class="dim">= ${RBASE()} + Телосложение ${conOf(u)}${hasEff(u,'weak2')?' − Слабость '+weakMag(u):''}; против неё бросают атаку</span></dd><dt>Запас реакций</dt><dd><b>${u.side===S.phase?'—':u.od}</b> <span class="dim">не потраченные в свой ход ОД: защита, удар из зоны, подготовка${SET.dexMode==='dodge'&&stat(u,'dex')>=7?'; плюс одно бесплатное уклонение за раунд':''}</span></dd>`:''}<dt>Пассивная защита</dt><dd><b>${passive(u)}</b> <span class="dim">= ${bdefOf(u)} + ${V2()&&SET.strDef?'Сила ':DEXSTR()?'Ловкость ':''}${best}${V2()&&hasEff(u,'weak2')?' − Слабость 3':''}${u.shield?' + щит '+u.shield:''}${effMag(u,'vuln')?' − Уязвимость '+effMag(u,'vuln'):''}${boundPen(u)?' − Вязка '+boundPen(u):''}${darkPen(u)?' − темнота 5':''}${sum(defFx(u))?' '+sgn(sum(defFx(u)))+' эффекты':''}</span></dd>
    <dt>Активная защита</dt><dd>${V2()?v2DefOptions(u,u,{kind:'attack',K:1,reach:1,wt:0},{}).map(o=>`${o.name} d20 <b>${sgn(sum(o.mods))}</b>`).join(' · ')+' <span class="dim">(блок и парирование — минус вес оружия атакующего: 0 / 2 / 4)</span>':`d20 <b>${sgn(amv)}</b> <span class="dim">(${am.map(x=>x.l).join(', ')})</span>`}</dd>
    ${DEXSTR()?`<dt>Попадание</dt><dd>${V2()?`d20 + мастерство: ближний бой <b>${mast(u)}</b>, дальний <b>${mast(u,true)}</b>, магия <b>${mastMg(u)}</b>`:`d20 + Ловкость <b>${stat(u,'dex')}</b>`}</dd><dt>Урон</dt><dd>от Силы <b>${stat(u,'str')}</b>, делится на K оружия</dd>`:`<dt>Основная</dt><dd>${STAT_RU[mainKey(u)]} <b>${stat(u,mainKey(u))}</b></dd>`}
    <dt>Скорость</dt><dd><b>${speedOf(u)}</b> <span class="dim">= 3 + 1 за каждые 2 Ловкости сверх 5</span></dd></dl></details>`;
  html+=`<details class="sec" id="dGm" ${open('dGm')}><summary>Ведущему: Воля, расстройство, правка</summary>`;
  if(u.will==null)html+=`<div class="willrow">Воли нет: эффекты Воли не действуют.</div>`;
  else html+=`<div class="willrow">Воля <b style="font-family:var(--mono)">${u.will}</b>
    <button type="button" data-w="-5">−5</button><button type="button" data-w="-1">−1</button><button type="button" data-w="1">+1</button><button type="button" data-w="5">+5</button></div>
    <div class="willrow">${disSel}</div>${u.disorder&&!f?'<div class="help">Порог не достигнут: слабая форма с −10, сильная с −20.</div>':''}`;
  html+=`<div class="willrow"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="torchChk" ${u.torch?'checked':''}> несёт горящий факел</label></div>`;
  if(S.editor&&!u.down){
    html+=`<div class="edstats">
      ${[['hp','HP'],['maxHp','макс. HP'],['armor','Броня'],['shield','Щит'],['bdef','Баз. защита'],['adr','Акт. защит за раунд']].map(([k,l])=>`<label for="ed_${k}">${l}</label><input type="number" id="ed_${k}" data-k="${k}" value="${k==='bdef'?bdefOf(u):k==='adr'?(u.adr==null?1:u.adr):u[k]}">`).join('')}
      ${['str','dex','int','cha'].map(s=>`<label for="ed_${s}">${STAT_RU[s]}</label><input type="number" id="ed_${s}" data-s="${s}" value="${u.base[s]}">`).join('')}
      <label for="ed_side">Сторона</label><select id="ed_side"><option value="pc" ${u.side==='pc'?'selected':''}>герои</option><option value="en" ${u.side==='en'?'selected':''}>противники</option></select></div>`;
  }
  html+='</details>';
  box.innerHTML=html;
  box.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{changeWill(u,+b.dataset.w,'Ведущий');render();});
  const ds=$('#disSel');if(ds)ds.onchange=()=>{u.disorder=ds.value||null;ev(`${uName(u)}: расстройство — ${u.disorder?DIS[u.disorder].join(' → '):'нет'}`);render();};
  $('#torchChk').onchange=e=>{u.torch=e.target.checked;drawLight(performance.now());render();};
  box.querySelectorAll('[data-k]').forEach(i=>i.onchange=()=>{u[i.dataset.k]=+i.value;if(i.dataset.k==='maxHp'&&u.hp>u.maxHp)u.hp=u.maxHp;render();});
  box.querySelectorAll('[data-s]').forEach(i=>i.onchange=()=>{u.base[i.dataset.s]=+i.value;render();});
  const sd=$('#ed_side');if(sd)sd.onchange=()=>{u.side=sd.value;render();};
}
function initUI2(){
  const lf=$('#logf'),setF=f=>{UI.logF=f;saveUI();$('#log').dataset.f=f;lf.querySelectorAll('button[data-f]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.f===f)));};
  lf.querySelectorAll('button[data-f]').forEach(b=>b.onclick=()=>setF(b.dataset.f));setF(UI.logF||'all');
  $('#log').addEventListener('click',e=>{const n=e.target.closest('[data-uid]');if(!n||!S)return;const u=byId(+n.dataset.uid);if(u){S.sel=u.id;S.act=null;render();}});
  $('#log').addEventListener('mouseover',e=>{const n=e.target.closest('[data-uid]');peek(n?+n.dataset.uid:null);});
  $('#log').addEventListener('mouseleave',()=>peek(null));
  $('#card').addEventListener('toggle',e=>{const d=e.target;if(d.id&&d.tagName==='DETAILS'){UI.det[d.id]=d.open;saveUI();}},true);
}
