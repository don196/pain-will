/* ================= 3.0: ИЗОМЕТРИЯ ================= */
const KY=.62,TOPM=()=>CELL*1.05;
const floorAt=(x,y)=>inB(x,y)&&!S.walls.has(key(x,y));
/* Срез стен: стена, за которой может кто-то стоять, рисуется низкой, остальные — в полный рост. */
function wallH(x,y){const ul=x+((y&1)?0:-1),ur=x+((y&1)?1:0);return (floorAt(ul,y-1)||floorAt(ur,y-1))?CELL*.2:CELL*.8;}
function prism(g,c,h,top,fl,fr,k){
  const p=hexPts(c.x,c.y,k||1),q=p.map(a=>[a[0],a[1]-h]);
  const face=(i,j,col)=>{g.beginPath();g.moveTo(q[i][0],q[i][1]);g.lineTo(q[j][0],q[j][1]);g.lineTo(p[j][0],p[j][1]);g.lineTo(p[i][0],p[i][1]);g.closePath();g.fillStyle=col;g.fill();g.strokeStyle='rgba(0,0,0,.55)';g.lineWidth=1;g.stroke();};
  face(5,4,fl);face(2,1,fr);face(4,3,fl);face(3,2,fr);
  g.beginPath();g.moveTo(q[0][0],q[0][1]);for(let i=1;i<6;i++)g.lineTo(q[i][0],q[i][1]);g.closePath();g.fillStyle=top;g.fill();g.strokeStyle='rgba(0,0,0,.6)';g.stroke();
  return{p,q};
}
function drawFloor(){
  if(!S||S.sim)return;
  const g=sizeCanvas($('#floor')),cs=CELL,W=boardW(),H=boardH();
  g.clearRect(0,0,W,H);
  for(let y=0;y<S.h;y++)for(let x=0;x<S.w;x++){
    if(S.walls.has(key(x,y)))continue;
    const h=hash(x,y),c=hc(x,y),v=58+h*20|0;
    hexPath(g,c.x,c.y,1.01);g.fillStyle=`rgb(${v-10},${v-4},${v+6})`;g.fill();
    hexPath(g,c.x,c.y,1);g.strokeStyle='rgba(0,0,0,.5)';g.lineWidth=1;g.stroke();
    hexPath(g,c.x,c.y-cs*.02,.8);g.fillStyle='rgba(255,240,210,.035)';g.fill();
    if(h>.84){g.strokeStyle='rgba(0,0,0,.4)';g.beginPath();g.moveTo(c.x-cs*.25,c.y+cs*.08);g.lineTo(c.x,c.y);g.lineTo(c.x+cs*.15,c.y+cs*.14);g.stroke();}
  }
  for(const tr of S.traps||[]){const c=hc(tr.x,tr.y);g.save();g.translate(c.x,c.y);g.scale(1,KY);g.strokeStyle='#aab2bb';g.lineWidth=Math.max(1.5,cs*.05);g.beginPath();g.arc(0,0,cs*.26,0,7);g.stroke();g.beginPath();for(let i=0;i<10;i++){const an=i*Math.PI/5;g.moveTo(Math.cos(an)*cs*.26,Math.sin(an)*cs*.26);g.lineTo(Math.cos(an)*cs*.38,Math.sin(an)*cs*.38);}g.stroke();g.restore();}
  for(const t of S.torches)if(t.floor){const c=hc(t.x,t.y);g.save();g.translate(c.x,c.y+cs*.1);g.rotate(-.4);g.fillStyle='#4a3520';g.fillRect(-cs*.22,-cs*.03,cs*.36,cs*.06);g.restore();}
  /* стены, двери и решётки — от дальних рядов к ближним */
  for(let y=0;y<S.h;y++)for(let x=0;x<S.w;x++){
    const k=key(x,y),c=hc(x,y),h=hash(x,y);
    if(S.walls.has(k)){
      const wh=wallH(x,y),t=74+h*14|0;
      const pr=prism(g,c,wh,`rgb(${t},${t+8},${t+20})`,`rgb(${t-30},${t-25},${t-14})`,`rgb(${t-44},${t-40},${t-30})`);
      if(wh>cs*.5){g.strokeStyle='rgba(0,0,0,.35)';g.beginPath();for(const f of[.35,.68]){g.moveTo(pr.p[4][0],pr.p[4][1]-wh*f);g.lineTo(pr.p[3][0],pr.p[3][1]-wh*f);g.lineTo(pr.p[2][0],pr.p[2][1]-wh*f);}g.stroke();}
      const tc=torchAt(x,y);if(tc&&!tc.floor){g.fillStyle='#2b2018';g.fillRect(c.x-cs*.04,c.y-wh*.5,cs*.08,cs*.22);g.fillStyle='#6b4a28';g.fillRect(c.x-cs*.1,c.y-wh*.5-cs*.03,cs*.2,cs*.07);}
    }else if(S.doors[k]){
      const d=S.doors[k];
      if(d.open){prism(g,{x:c.x-cs*.36,y:c.y},cs*.55,'#6b4726','#4a3018','#3a2412',.22);prism(g,{x:c.x+cs*.36,y:c.y},cs*.55,'#6b4726','#4a3018','#3a2412',.22);}
      else{const pr=prism(g,c,cs*.6,'#7a5230','#5a3d22','#48301a',.96);g.strokeStyle='#22150a';g.lineWidth=1.5;g.beginPath();g.moveTo(pr.p[3][0],pr.p[3][1]);g.lineTo(pr.q[3][0],pr.q[3][1]);g.stroke();if(d.locked){g.fillStyle='#e2b93b';g.beginPath();g.arc(c.x,c.y-cs*.12,cs*.08,0,7);g.fill();}}
    }else if(S.bars[k]){
      const b=S.bars[k];g.strokeStyle=b.shoot?'#9aa3ad':'#5a646e';g.lineWidth=Math.max(2,cs*.05);g.beginPath();
      for(let i=0;i<5;i++){const fx=c.x-cs*.4+i*cs*.2;g.moveTo(fx,c.y+cs*.08);g.lineTo(fx,c.y-cs*.6);}
      g.moveTo(c.x-cs*.44,c.y-cs*.6);g.lineTo(c.x+cs*.44,c.y-cs*.6);g.moveTo(c.x-cs*.44,c.y-cs*.2);g.lineTo(c.x+cs*.44,c.y-cs*.2);g.stroke();
    }
  }
}
/* Каждый эффект — свой значок на цветной плашке; названия — при наведении, в меню и в листе. */
const FX_FULL={prone:'Сбит с ног',out:'Без сознания',blind:'Слепота',ripple:'Рябь',mute:'Немота',cough:'Кашель',disor:'Дезориентация',unst:'Неустойчивость',heat:'Нагрев',bleed:'Кровотечение',wound:'Открытая рана',vuln:'Уязвимость',weak:'Слабость',fmark:'Метка пламени',lasso:'В силке',hold:'Держит цель',snare:'В капкане',grab:'В захвате',spots:'Слабые места выявлены',ord:'Приказ «Сейчас!»',prep:'Подготовка',cover:'Под Перехватом',msight:'Магическое зрение'};
const FX_ICON={heat:'f:M8 1C10 4 13 6 13 10a5 5 0 0 1-10 0C3 7 6 6 8 1Z',bleed:'f:M8 1L12 8a4.5 4.5 0 1 1-8 0Z',wound:'M3 13L13 3M5 5l3 3M8 8l3 3',
  blind:'M1 8Q8 2 15 8Q8 14 1 8ZM2 14L14 2',ripple:'M1 6q2-3 4 0t4 0t4 0M1 11q2-3 4 0t4 0t4 0',mute:'M2 3h12v7H8l-3 3v-3H2ZM6 5l4 3M10 5l-4 3',cough:'M2 3h12v7H8l-3 3v-3H2ZM5 6.5h.01M8 6.5h.01M11 6.5h.01',
  disor:'M8 7a1 1 0 1 1-1 1a3 3 0 1 1 3 3a5 5 0 1 1-5-5',out:'M2 3h6l-6 7h6M10 9h4l-4 5h4',unst:'M3 4Q0 8 3 12M13 4Q16 8 13 12M8 3v10',prone:'M1 13h14M3 8.5a1.5 1.5 0 1 0 .01 0M6 10h8',
  vuln:'M8 2a6 6 0 1 0 .01 0M8 6a2 2 0 1 0 .01 0M8 0v3M8 13v3M0 8h3M13 8h3',weak:'M8 2v10M3.5 8L8 13L12.5 8',fmark:'M8 4C9 6 11 7 11 9.5a3 3 0 0 1-6 0C5 8 7 7 8 4ZM8 1a7 7 0 1 0 .01 0',
  lasso:'M8 2a5 3.5 0 1 0 .01 0M12 8L15 15',hold:'M4 7h8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM6 7V4M8 7V3M10 7V4',snare:'M2 13a6 6 0 0 1 12 0M4 13l1-3l1.5 3l1.5-3l1.5 3l1.5-3l1 3',
  spots:'M8 3v10M3 8h10M8 5.5a2.5 2.5 0 1 0 .01 0',ord:'M4 15V2h8l-2 3l2 3H4',prep:'M4 2h8M4 14h8M5 2c0 5 6 5 6 12M11 2c0 5-6 5-6 12',cover:'M8 1L14 3v5c0 4-3 6-6 7c-3-1-6-3-6-7V3Z',
  msight:'M1 8Q8 2 15 8Q8 14 1 8ZM8 6a2 2 0 1 0 .01 0',x:'M8 5a3 3 0 1 0 .01 0'};
FX_ICON.grab=FX_ICON.hold;
function fxIcon(k){const d=FX_ICON[k]||FX_ICON.x,f=d.startsWith('f:');return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${f?d.slice(2):d}" ${f?'fill="currentColor"':'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;}
const fxTitle=e=>(FX_FULL[e.k]||e.l)+(e.n?' ×'+e.n:'');
function fxChips(u){return fxList(u).map(e=>`<span class="fxc k-${e.k}" title="${esc(fxTitle(e))}">${fxIcon(e.k)}${e.n?`<b>${e.n}</b>`:''}</span>`).join('');}
function fxNames(u){return fxList(u).map(e=>`<span class="fxr"><span class="fxc k-${e.k}">${fxIcon(e.k)}</span>${esc(fxTitle(e))}</span>`).join('');}
function openLegend(){openModal('<h2>Значки эффектов</h2><label class="fxtg"><input type="checkbox" id="fxVis"'+(UI.fxVis!==false?' checked':'')+'> Показывать состояния на самих фигурах (лежит, качается, повязка, свечение, капли, кольцо, верёвка силка). Без галочки остаются только значки.</label><p class="dim">На поле над фигурой — только значки со счётчиком стаков. Названия видны при наведении на фигуру, в меню цели и в листе бойца.</p><div class="fxleg">'+Object.keys(FX_FULL).map(k=>`<span class="fxr"><span class="fxc k-${k}">${fxIcon(k)}</span>${FX_FULL[k]}</span>`).join('')+'</div>',()=>{$('#fxVis').onchange=e=>{UI.fxVis=e.target.checked;saveUI();render();};});}
function fxList(u){
  const o=[],add=(k,l,n)=>o.push({k,l,n:n>1?n:0});
  if(u.prone)add('prone','сбит');
  if(u.stunned)add('out',V2()?'без сознания':'оглушён');
  if(hasEff(u,'blind2')||hasEff(u,'blind'))add('blind','слеп');
  if(stOf(u,'ripple'))add('ripple','рябь',u.st.ripple);
  if(hasEff(u,'mute'))add('mute','нем');
  if(stOf(u,'cough'))add('cough','кашель',u.st.cough);
  if(stOf(u,'disor'))add('disor','дезор',u.st.disor);
  if(stOf(u,'unst'))add('unst','неуст',u.st.unst);
  if(stOf(u,'heat'))add('heat','нагрев',u.st.heat);
  if(u.bleed)add('bleed','кровь',u.bleed);
  const ow=openWounds(u).length;if(ow)add('wound','рана',ow);
  if(hasEff(u,'vuln2')||hasEff(u,'vuln'))add('vuln','уязв');
  if(hasEff(u,'weak2'))add('weak','слаб');
  if(hasEff(u,'fmark'))add('fmark','метка');
  if(hasEff(u,'lasso'))add('lasso','силок');
  if(u.lassoT&&lassoTarget(u))add('hold','держит');
  if(hasEff(u,'snare'))add('snare','капкан');
  if(u.grabbedBy)add('grab','захват');
  if(u.hold)add('hold','держит');
  if(hasEff(u,'spots'))add('spots','места');
  if(hasEff(u,'ordnow'))add('ord','приказ');
  if(u.prep)add('prep',u.prep.kind==='push'?'ждёт: толчок':'ждёт: удар');
  if(hasEff(u,'cover'))add('cover','прикрыт');
  if(hasEff(u,'magsight'))add('msight','зрение');
  const known=new Set(['сбит с ног','оглушён','ослеплён','кровотечение','открытая рана','Уязвимость','в захвате','удерживает цель','под Прикрытием','в капкане','несёт факел','в темноте','ночное зрение','Слепота','Немота','Слабость','Метка пламени','в силке','держит силок','слабые места','приказ «Сейчас!»','подготовка','магическое зрение',...Object.values(ST_RU)]);
  const save=SET.v2;let old;SET.v2=false;try{old=badges(u);}finally{SET.v2=save;}
  for(const [ic,t] of old)if(!known.has(t))o.push({k:'x',l:t,n:0});
  return o;
}
const FIG_SVG=`<svg viewBox="0 0 40 60" aria-hidden="true">
<path class="bd2" d="M7 58 Q6 33 20 29 Q34 33 33 58 Z"/><path class="bd1" d="M11 58 Q11 36 20 32 Q29 36 29 58 Z"/><path class="ol" d="M7 58 Q6 33 20 29 Q34 33 33 58 Z"/>
<circle class="bd1" cx="20" cy="17" r="10"/><circle class="ol" cx="20" cy="17" r="10"/>
<g class="x-shield"><path d="M1 34 h12 v10 q0 7 -6 10 q-6 -3 -6 -10 Z" fill="#c9d2dc" stroke="#05070a" stroke-width="1.4"/></g>
<g class="x-torch"><rect x="33" y="24" width="3" height="16" fill="#5a3d22" stroke="#05070a" stroke-width=".8"/><ellipse cx="34.5" cy="19" rx="4" ry="7" fill="#ffcf70"/><ellipse cx="34.5" cy="21" rx="2.4" ry="4.5" fill="#f08a2a"/></g>
<g class="x-rope"><ellipse cx="20" cy="40" rx="15" ry="5" fill="none" stroke="#e8d9a8" stroke-width="2.5"/><ellipse cx="20" cy="46" rx="15" ry="5" fill="none" stroke="#e8d9a8" stroke-width="2.5"/></g>
<g class="x-eyes"><circle cx="16" cy="16" r="2.2" fill="#8ff7ff"/><circle cx="24" cy="16" r="2.2" fill="#8ff7ff"/></g>
<g class="x-rip"><path d="M9 13 q3 -4 6 0 t6 0 t6 0 t6 0 M9 19 q3 -4 6 0 t6 0 t6 0 t6 0" fill="none" stroke="#cfe0ff" stroke-width="1.8"/></g>
<g class="x-band"><rect x="9" y="12" width="22" height="7" fill="#000" stroke="#fff" stroke-width="1"/></g>
<g class="x-mute"><path d="M15 21 l10 6 M25 21 l-10 6" stroke="#ff5a4a" stroke-width="2.6"/></g>
<g class="x-prep"><path d="M36 6 v20 M31 11 h10" stroke="#e8e3d5" stroke-width="2.4"/></g>
<text x="20" y="52"></text></svg>`;
function renderTokens(){
  if(!S||S.sim)return;
  const box=$('#toks'),seen=new Set();
  for(const u of S.units){
    let d=box.querySelector(`[data-id="${u.id}"]`);
    if(!d){d=el('div','tok3','<div class="gr"></div><div class="fig c">'+FIG_SVG+'</div><div class="drip"></div><div class="stars">✦ ✦</div><div class="bar"><i></i></div><div class="od"></div><div class="fxs"></div><div class="fxn"></div>');d.dataset.id=u.id;box.appendChild(d);const fg=d.querySelector('.fig');fg.onmouseenter=()=>d.classList.add('hov');fg.onmouseleave=()=>d.classList.remove('hov');}
    seen.add(String(u.id));
    const heat=stOf(u,'heat');
    const vis=UI.fxVis!==false;
    const cls='tok3 '+u.side+[[u.down,'down'],[S.sel===u.id,'sel'],[sz(u)>1,'s2'],[!u.down&&!S.over&&!S.editor&&u.side===S.phase&&u.od===0,'spent'],[u.torch,'torch'],[u.shield>0,'shield'],[darkPen(u)>0&&!(vis&&heat),'dark'],...(!vis?[]:[
      [u.prone&&!u.down,'prone'],[hasEff(u,'blind2')||hasEff(u,'blind'),'blind'],[stOf(u,'ripple')>0,'ripple'],[hasEff(u,'mute'),'mute'],[stOf(u,'disor')>0,'disor'],[u.stunned,'out'],[stOf(u,'unst')>0&&!u.prone,'unst'],
      [heat===1,'heat1'],[heat>=2,'heat2'],[u.bleed>0,'bleed'],[hasEff(u,'vuln2')||hasEff(u,'vuln'),'vuln'],[hasEff(u,'weak2'),'weak'],[hasEff(u,'fmark'),'fmark'],[hasEff(u,'lasso'),'lasso'],[hasEff(u,'snare'),'snare'],[hasEff(u,'magsight'),'msight'],[!!u.prep,'prep']])].filter(x=>x[0]).map(x=>' '+x[1]).join('');
    const keep=(d.classList.contains('hit')?' hit':'')+(d.classList.contains('peek')?' peek':'')+(d.classList.contains('hov')?' hov':'');
    if(d.className.replace(' hit','').replace(' peek','').replace(' hov','')!==cls)d.className=cls+keep;
    const p=tokPos(u);d.style.left=p.x.toFixed(1)+'px';d.style.top=p.y.toFixed(1)+'px';d.style.zIndex=u.down?1:10+Math.round(p.y);
    const fig=d.querySelector('.fig');fig.setAttribute('data-x',u.x);fig.setAttribute('data-y',u.y);
    const tx=d.querySelector('text');if(tx.textContent!==u.glyph)tx.textContent=u.glyph;
    const hp=hpFrac(u),bar=d.querySelector('.bar i');bar.style.width=hp*100+'%';bar.style.background=hp>.5?'var(--good)':hp>.25?'var(--warn)':'var(--bad)';
    d.querySelector('.od').innerHTML=u.down?'':odPipsHTML(u);
    const fb=d.querySelector('.fxs'),html=u.down?'':fxChips(u);
    if(fb._h!==html){fb._h=html;fb.innerHTML=html;d.querySelector('.fxn').innerHTML=u.down?'':fxNames(u);}
  }
  for(const d of [...box.children])if(!seen.has(d.dataset.id))d.remove();
  /* верёвка силка и линия Перехвата */
  const sv=$('#links');if(sv){let h='';const W=boardW(),H=boardH();sv.setAttribute('width',W);sv.setAttribute('height',H);
    const ln=(a,b,c)=>{const p=tokPos(a),q=tokPos(b);h+=`<line class="${c}" x1="${p.x.toFixed(1)}" y1="${(p.y-CELL*.45).toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${(q.y-CELL*.4).toFixed(1)}"/>`;};
    for(const u of S.units){if(u.down||UI.fxVis===false)continue;const t=u.lassoT&&lassoTarget(u);if(t)ln(u,t,'rope');const cv=getEff(u,'cover');if(cv){const k=byId(cv.by);if(k&&!k.down)ln(k,u,'cov');}}
    sv.innerHTML=h;}
}
/* ================= 3.0: МЕНЮ НА ПОЛЕ ================= */
let CTX=null;
function closeCtx(){CTX=null;const m=$('#ctxm');if(m)m.hidden=true;}
/* Что выбранный герой может сделать с этим гексом, союзником или врагом. */
function ctxOptions(u,p,t){
  const out=[];if(!canControl(u))return out;
  const self=t&&t.id===u.id;
  for(const id of visibleActs(u)){
    const a=A[id];if(!a||!actState(u,id).ok)continue;
    let tg=null,meta='',warn=false;
    if(a.kind==='move'){
      if(t)continue;const sp=speedOf(u),dist=bfs(u,{max:sp*Math.min(2,u.od)}),v=dist.get(key(p.x,p.y));if(!v||!v.d)continue;
      const zp=typeof zocPreview==='function'?zocPreview(u,pathTo(dist,p.x,p.y)):[];
      out.push({id,name:'Идти сюда',cost:v.d<=sp?1:2,meta:`${v.d} гекс.`+(zp.length?` · ⚠ ударит ${zp.map(z=>z.e.name).join(', ')}`:''),warn:zp.length>0,run:()=>performMove(u,p.x,p.y)});continue;}
    if(IMMEDIATE.includes(a.kind)||a.kind==='wswap'){if(self)out.push({id,name:a.name,cost:actCost(u,id),meta:actMeta(u,id,a),run:()=>perform(u,id)});continue;}
    switch(a.kind){
      case 'arc':if(!self&&cheb(u,p)===1&&!inFoot(u,p.x,p.y)&&arcTargets(u,p).length){tg=p;meta='заденет: '+arcTargets(u,p).map(o=>o.name).join(', ');}break;
      case 'pair':if(t&&pairOptions(u).some(q=>q.includes(t))){tg=t;meta='по двоим, −3';}break;
      case 'torch':{const tc=torchAt(p.x,p.y);if(tc&&validTorch(u,a,tc))tg=tc;break;}
      case 'throw':if(validThrow(u,a,p)&&(!t||self))tg=p;break;
      case 'flare':if(validFlare(u,a,p)&&!t)tg=p;break;
      case 'jump':if(!t&&validJump(u,a,p))tg=p;break;
      case 'veil':if(validVeil(u,a,p))tg=p;break;
      case 'trap':if(!t&&validTrap(u,p))tg=p;break;
      case 'flash':if(validFlash(u,p)){tg=p;meta='в 1 гексе — слепота, в 2–3 — рябь, своих тоже';warn=true;}break;
      case 'step':if(!t&&stepCells(u).some(c=>c.x===p.x&&c.y===p.y))tg=p;break;
      case 'evade':if(!t&&evadeOk(u,p))tg=p;break;
      case 'door':case 'smash':if(validCell(u,a,p.x,p.y))tg=p;break;
      default:if(t&&canTarget(u,a,t)){tg=t;
        if(a.kind==='attack'||a.kind==='grab'){const h=hitCalc(u,a,t);meta=(AP3()?(a.lasso?`успех ${pct(h.hit)} (нога)`:(h.hit<1?`промах ${pct(1-h.hit)} · `:'')+`крит ${pct(h.p[3])}`)+(openT(t)?' · открыт: защититься нечем':` · у цели ${t.od} очк. реакции`):`попасть ${pct(h.hit)}`)+(a.fixed==null?` · ≈${fmtN(h.Eact)} урона`:'')+(V2()&&backstab(u,a,t)?' · в спину +3':'');}
        else if(a.kind==='push'){meta='успех '+pct(pContest(stat(u,'str')+(u.shield>0?2:0)+(stOf(t,'unst')?3:0)-(u.prone?5:0),stat(t,'str'),false))+(stOf(t,'unst')?' · упадёт':'');}
        else if(a.kind==='curse2'){if(AP3()){const c=curseCalc(u,a,t);meta=(c.land<1?`ложится ${pct(c.land)}`:'ложится всегда')+(id==='curseWeak'?` · штраф ${[1,2,3].map(k=>weakOf(u,k)).join('/')}, крит ${pct(c.p[3])}`:'');}else{const m=[{l:'',v:mastMg(u)}];v2AtkMods(u,a,m);meta='успех '+pct(Math.max(0,Math.min(1,(20-(passive(t,{magic:true})-sum(m)-sum(rollMods(u))))/20)));}}
        else meta=actMeta(u,id,a);}
    }
    if(tg)out.push({id,name:a.name,cost:actCost(u,id),meta,warn,run:()=>perform(u,id,tg)});
  }
  return out;
}
function openCtx(e,p,t){
  const u=selUnit(),m=$('#ctxm');
  hideTip();
  if(S.editor||S.busy||S.over){if(t){S.sel=t.id;S.act=null;render();}return;}
  const ops=ctxOptions(u,p,t);
  if(!ops.length){closeCtx();if(t){S.sel=t.id;S.act=null;render();}else if(S.act){S.act=null;render();}return;}
  const self=t&&u&&t.id===u.id,title=t?esc(t.name):`Гекс ${p.x}:${p.y}`,who=t?(self?'сам':t.side===u.side?'союзник':'противник'):(torchAt(p.x,p.y)?'факел':'пусто');
  let html=`<div class="cmh"><span><b>${title}</b> · ${who}</span><button type="button" data-x aria-label="Закрыть">✕</button></div>`;
  if(t){const fn=fxNames(t);if(fn)html+=`<div class="cmf">${fn}</div>`;}
  ops.forEach((o,i)=>{html+=`<button type="button" class="cmi" data-i="${i}"><span>${esc(o.name)}</span><span class="c">${o.cost?'<b></b>'.repeat(o.cost):'<b class="z"></b>'}</span>${o.meta?`<span class="m${o.warn?' w':''}">${esc(o.meta)}</span>`:''}</button>`;});
  if(t&&!self)html+=`<button type="button" class="cmi sec" data-sel="${t.id}"><span>${t.side===u.side&&t.side===S.phase?'Выбрать этого героя':'Осмотреть'}</span></button>`;
  m.innerHTML=html;m.hidden=false;CTX={p,t:t?t.id:null};
  const c0=t?tokPos(t):hc(p.x,p.y),br=$('#board').getBoundingClientRect(),c={x:br.left+c0.x,y:br.top+c0.y},W=window.innerWidth,H=window.innerHeight,mw=m.offsetWidth,mh=m.offsetHeight;
  let x=c.x+CELL*.55,y=c.y-CELL*.9;if(x+mw>W-6)x=c.x-CELL*.55-mw;if(x<6)x=Math.max(6,Math.min(W-mw-6,c.x-mw/2));if(y+mh>H-6)y=H-mh-6;if(y<6)y=6;
  m.style.left=x+'px';m.style.top=y+'px';
  m.querySelector('[data-x]').onclick=closeCtx;
  m.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{const o=ops[+b.dataset.i];closeCtx();run(o.run);});
  const sb=m.querySelector('[data-sel]');if(sb)sb.onclick=()=>{S.sel=+sb.dataset.sel;S.act=null;closeCtx();render();};
  const f=m.querySelector('.cmi');if(f&&f.focus&&!('ontouchstart' in window))f.focus();
}
