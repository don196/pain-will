#!/usr/bin/env python3
"""Сборка полигона в один файл dist/index.html.

src/core.html — ядро: правила, поле, ИИ, старый интерфейс.
Ступень 1 (src/ui2) заменяет панели, ступень 2 (src/ui3) — поле и токены.
Ступени вставляют интерфейс заменой точных кусков ядра. Если кусок не нашёлся
(ядро поменяли), сборка падает и показывает, какой кусок пропал.
Запуск из корня репозитория: python3 build/build.py
"""
import os, sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
def read(p):
    with open(os.path.join(ROOT,p),encoding='utf8') as f:return f.read()
if True:
    sys.excepthook=lambda t,e,tb:print(f'Сборка остановлена: кусок ядра не найден или встретился не один раз: {e!r}',file=sys.stderr) if t in(AssertionError,ValueError) else sys.__excepthook__(t,e,tb)

# ---------- ступень 1: интерфейс 2 (панели) ----------
s=read('src/core.html')
def rep(old,new,cnt=1):
    global s
    n=s.count(old); assert n==cnt,(n,old[:120]); s=s.replace(old,new)
def cut(a,b):
    i=s.index(a);j=s.index(b,i);return i,j
# head and body
i,j=cut('<title>','</head>');s=s[:i]+read('src/ui2/head.html')+s[j:]
i,j=cut('<div class="app">','<div id="tip"');s=s[:i]+read('src/ui2/body.html')+s[j:]
# pieces of the old panel code that are reused as is
i,j=cut("  const effs=[];","  const disSel=");EFFS=s[i:j]
i=s.index("    let hint=hintOf(id,a);");j=s.index("\n",s.index("\n",i)+1);LONG=s[i:j+1]
ui=read('src/ui2/ui.js').replace('/*EFFS*/',EFFS).replace('/*LONGHINT*/',LONG)
i,j=cut("function renderTurn(){","function renderBanner(){");s=s[:i]+ui+s[j:]
# tokens: HP ring, spent state
rep("'<div class=\"disc\"><span></span></div><div class=\"od\"></div><div class=\"hp\"><i></i></div><div class=\"bd\"></div>'","'<div class=\"ring\"></div><div class=\"disc\"><span></span></div><div class=\"od\"></div><div class=\"hp\"><i></i></div><div class=\"bd\"></div>'")
rep("${sz(u)>1?' s2':u.maxHp>=40?' big':''}`;","${sz(u)>1?' s2':u.maxHp>=40?' big':''}${!u.down&&!S.over&&!S.editor&&u.side===S.phase&&u.od===0?' spent':''}`;")
rep("bar.style.width=p*100+'%';","bar.style.width=p*100+'%';d.style.setProperty('--hp',p.toFixed(3));d.style.setProperty('--hpc',p>.5?'var(--good)':p>.25?'var(--warn)':'var(--bad)');")
# highlight layer: selection, zones of control, risky steps, forecast
rep("for(const [k,v] of dist){if(!v.d)continue;const [x,y]=unkey(k);add(x,y,v.d<=sp?'mv1':'mv2');}","for(const [k,v] of dist){if(!v.d)continue;const [x,y]=unkey(k);add(x,y,v.d<=sp?'mv1':'mv2');if(SET.zoc&&zocPreview(u,pathTo(dist,x,y)).length)add(x,y,'zw');}")
rep("  for(let i=0;i<cells.length;i++){const c='c'+cls[i];if(cells[i].getAttribute('class')!==c)cells[i].setAttribute('class',c);}",
"""  if(!S.editor&&u&&!u.down)addU(u,'selc');
  if(!S.editor&&!S.over&&UI.zoc&&SET.zoc){const side=u&&!u.down?u.side:'pc';for(const e of S.units){if(e.down||e.side===side||e.stunned||e.binding||e.zocRound===S.round)continue;for(const c of ringCells(e))if(inB(c.x,c.y)&&isFloor(c.x,c.y)&&adjOk(e,c))add(c.x,c.y,'zoc');}}
  for(let i=0;i<cells.length;i++){const c='c'+cls[i];if(cells[i].getAttribute('class')!==c)cells[i].setAttribute('class',c);}
  renderForecast();""")
rep("function computeCell(){\n  const wrap=$('#wrap');const wide=window.innerWidth>1180;\n  const aw=wrap.clientWidth-6,ah=wide?wrap.clientHeight-6:99999;\n  return Math.max(26,",
    "function computeCell(){\n  const wrap=$('#wrap');const wide=window.innerWidth>1180;\n  const aw=wrap.clientWidth-22,ah=wide?wrap.clientHeight-22:99999;\n  return Math.max(wide?26:30,")
# floor in cold slate
rep("g.fillStyle='#0a0807';g.fillRect(0,0,W,H);","g.fillStyle='#06080b';g.fillRect(0,0,W,H);")
rep("hexPath(g,c.x,c.y,1.02);g.fillStyle='#0e0c0b';g.fill();","hexPath(g,c.x,c.y,1.02);g.fillStyle='#090b0e';g.fill();")
rep("g.fillStyle=`rgb(${92+h*14|0},${82+h*12|0},${70+h*10|0})`;g.fill();","g.fillStyle=`rgb(${72+h*12|0},${79+h*12|0},${90+h*12|0})`;g.fill();")
rep("g.fillStyle=`rgb(${v},${v-8},${v-16})`;g.fill();","g.fillStyle=`rgb(${v-17},${v-12},${v-4})`;g.fill();")
# names in the log select the fighter
rep("function uName(u){return `<span class=\"nm ${u.side}\">${esc(u.name)}</span>`;}","function uName(u){return `<span class=\"nm ${u.side}\" data-uid=\"${u.id}\">${esc(u.name)}</span>`;}")
# tooltips
rep("if(a.kind==='move'){const sp=speedOf(u),v=bfs(u,{max:sp*Math.min(2,u.od)}).get(key(p.x,p.y));if(!v||!v.d){hideTip();return;}html=`Путь ${v.d} кл. · <b>${v.d<=sp?1:2} ОД</b>${u.binding?'<div class=\"dim\">движение снимет Вязку</div>':''}`;}",
    "if(a.kind==='move'){const sp=speedOf(u),dist=bfs(u,{max:sp*Math.min(2,u.od)}),v=dist.get(key(p.x,p.y));if(!v||!v.d){hideTip();return;}const zp=zocPreview(u,pathTo(dist,p.x,p.y));html=`Путь ${v.d} гекс. · <b>${v.d<=sp?1:2} ОД</b>${u.binding?'<div class=\"dim\">движение снимет Вязку</div>':''}${zp.map(z=>`<div class=\"zw\">Выход из зоны: ${esc(z.e.name)} ударит (${esc(A[z.id].name)}), попадёт в ${pct(z.p)}</div>`).join('')}`;}")
s=s.replace("ромб света радиуса ${TORCH_R}","свет на ${SET.torchR||3} гекса")
rep("Бойца 2×2 ставьте за левую верхнюю клетку.","Крупного бойца (3 гекса) ставьте за его левый верхний гекс.")
s=s.replace("${(T[k].size||1)>1?' (2×2)':''}","${(T[k].size||1)>1?' (3 гекса)':''}")
rep("<p class=\"dim\">Раунд ${S.round}. Ход боя — в журнале справа.</p>","<p class=\"dim\">Раунд ${S.round}. Весь ход боя — в журнале.</p>")
# keyboard and boot
rep("if(/^[1-9]$/.test(e.key)){const b=$('#acts').querySelectorAll('[data-act]')[+e.key-1];if(b&&!b.disabled)b.click();}",
    "if(e.key==='Tab'&&S&&!S.editor&&!S.busy&&isHuman(S.phase)){const hs=alive(S.phase).filter(o=>o.od>0);if(hs.length){const k=hs.findIndex(o=>o.id===S.sel);S.sel=hs[(k+(e.shiftKey?hs.length-1:1))%hs.length].id;S.act=null;render();}e.preventDefault();return;}\n    if(/^[1-9]$/.test(e.key)){const b=$('#acts').querySelectorAll('[data-act]')[+e.key-1];if(b)b.click();}")
rep("  $('#btnClearLog').onclick=()=>{$('#log').innerHTML='';S.log=[];};","  $('#btnClearLog').onclick=()=>{$('#log').innerHTML='';S.log=[];};\n  initUI2();")

# ---------- ступень 2: интерфейс 3 (поле и токены) ----------
def rep(old,new,cnt=1):
    global s
    n=s.count(old); assert n==cnt,(n,old[:110]); s=s.replace(old,new)
def cutout(a,b,new=''):
    global s
    i=s.index(a);j=s.index(b,i);s=s[:i]+new+s[j:]
rep("function hc(x,y){return{x:(x+.5+((y&1)?.5:0))*CELL,y:y*CELL*SQ3/2+CELL/SQ3};}","function hc(x,y){return{x:(x+.5+((y&1)?.5:0))*CELL,y:TOPM()+(y*CELL*SQ3/2+CELL/SQ3)*KY};}")
rep("boardH=()=>(S.h-1)*CELL*SQ3/2+CELL*2/SQ3;","boardH=()=>TOPM()+((S.h-1)*CELL*SQ3/2+CELL*2/SQ3)*KY+CELL*.45;")
rep("function hexPts(cx,cy,k=1){const r=CELL/SQ3*k,w=CELL/2*k;","function hexPts(cx,cy,k=1){const r=CELL/SQ3*k*KY,w=CELL/2*k;")
cutout("function computeCell(){","function layoutBoard(){","function computeCell(){\n  const wrap=$('#wrap');const wide=window.innerWidth>1180;\n  const aw=wrap.clientWidth-22,ah=wide?wrap.clientHeight-22:99999;\n  return Math.max(wide?30:34,Math.min(78,Math.floor(Math.min(aw/(S.w+.5),ah/(((S.h-1)*SQ3/2+2/SQ3)*KY+2.0)))));\n}\n")
cutout("function renderTokens(){","function renderHL(){")
cutout("function drawFloor(){","function drawLight(t){",read('src/ui3/v3.js')+"\n")
rep("const gr=g.createRadialGradient(cx,cy,0,cx,cy,R);gr.addColorStop(0,'rgba(224,144,63,.16)');gr.addColorStop(1,'rgba(224,144,63,0)');g.fillStyle=gr;g.beginPath();g.arc(cx,cy,R,0,7);g.fill();}",
    "g.save();g.translate(cx,cy);g.scale(1,KY);const gr=g.createRadialGradient(0,0,0,0,0,R);gr.addColorStop(0,'rgba(224,144,63,.2)');gr.addColorStop(1,'rgba(224,144,63,0)');g.fillStyle=gr;g.beginPath();g.arc(0,0,R,0,7);g.fill();g.restore();}")
rep("cy=hp.y+(tr.floor?CELL*.12:-CELL*.08);","cy=hp.y+(tr.floor?CELL*.06:-wallH(tr.x,tr.y)*.5-CELL*.06);")
rep("d.style.top=(p.y-CELL*.55)+'px';$('#fx').appendChild(d);","d.style.top=(p.y-CELL*1.25)+'px';$('#fx').appendChild(d);")
rep("d.style.left=p.x+'px';d.style.top=p.y+'px';d.style.width=Math.hypot(dx,dy)+'px';","d.style.left=p.x+'px';d.style.top=(p.y-CELL*.5)+'px';d.style.width=Math.hypot(dx,dy)+'px';")
rep("top:${(p.y-CELL*(sz(t)>1?.86:.5)).toFixed(1)}px","top:${(p.y+CELL*.42).toFixed(1)}px")
rep("document.querySelectorAll('#toks .tok.peek')","document.querySelectorAll('#toks .peek')")
rep("  const any=t||S.units.find(o=>inFoot(o,p.x,p.y));\n  if(any){S.sel=any.id;S.act=null;render();return;}\n  if(S.act){S.act=null;render();}",
    "  if(S.act){S.act=null;closeCtx();render();return;}\n  openCtx(e,p,t||S.units.find(o=>inFoot(o,p.x,p.y)));")
rep("async function run(fn){\n","async function run(fn){\n  closeCtx();\n")
rep("  hl.addEventListener('click',onCellClick);","  hl.addEventListener('click',onCellClick);\n  $('#toks').addEventListener('click',onCellClick);$('#toks').addEventListener('mousemove',onCellHover);")
rep("if(e.key==='Escape'){","if(e.key==='Escape'){if(CTX){closeCtx();return;}")
rep('<div id="toks"></div>','<svg id="links" xmlns="http://www.w3.org/2000/svg"></svg>\n          <div id="toks"></div>')
rep('<div id="tip"','<div id="ctxm" hidden></div>\n<div id="tip"')
rep("<h1>Полигон подземелья</h1>","<h1>Полигон подземелья<span class=\"ver\">3.0</span></h1>")
i=s.index('<title>');j=s.index('</title>');s=s[:i]+'<title>Полигон подземелья 3.0'+s[j:]
rep("</style>\n</head>","\n"+read('src/ui3/v3.css')+"</style>\n</head>")
rep("badges(u).map(x=>`<span title=\"${x[1]}\">${x[0]}</span>`).join('')}</span></button>`;};","fxChips(u)}</span></button>`;};")
rep('      <details class="scene-card" id="sceneCard" open><summary>О сцене</summary><div id="sceneInfo"></div></details>\n','')
rep('      <section class="logbox">','      <details class="scene-card" id="sceneCard"><summary>О сцене</summary><div id="sceneInfo"></div></details>\n      <section class="logbox">')
rep("""<button type="button" id="tgFc" aria-pressed""","""<button type="button" id="tgLeg" title="Что означают значки над фигурами">Значки</button><button type="button" id="tgFc" aria-pressed""")
rep("  $('#tgFc').onclick=()=>{UI.fc=!UI.fc;saveUI();render();};","  $('#tgFc').onclick=()=>{UI.fc=!UI.fc;saveUI();render();};$('#tgLeg').onclick=openLegend;")
rep("    promptResolve=res;\n    $('#pbox').innerHTML=`<h2>${title}</h2>","    promptResolve=res;hideTip();\n    $('#pbox').innerHTML=`<h2>${title}</h2>")
rep("  let rt;window.addEventListener('resize',","  document.addEventListener('pointerdown',e=>{if(CTX&&!e.target.closest('#ctxm')&&!e.target.closest('#board'))closeCtx();});\n  window.addEventListener('scroll',()=>{if(CTX&&window.innerWidth>700)closeCtx();},true);\n  let rt;window.addEventListener('resize',")

os.makedirs('dist',exist_ok=True)
with open('dist/index.html','w',encoding='utf8') as f:f.write(s)
print(f'dist/index.html: {len(s.encode("utf8"))//1024} КБ')
