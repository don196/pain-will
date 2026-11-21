// Один прогон: node sim/sim.js '{"scn":"dummies","n":100,"set":{"pain":false}}'
// Ядро правил (src/core.html) исполняется без браузера; обе стороны ведёт ИИ. Печатает JSON со статистикой.
// job: scn — сценарий, n — число боёв, set — настройки правил, over — правки героев (T) и действий (A), pre — код для экспериментов.
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(process.env.CORE||path.join(__dirname,'..','src','core.html'),'utf8');
let code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).pop().replace(/if\(window\.claude&&window\.claude\.hot&&window\.claude\.hot\.snapshot\)[\s\S]*$/,'');
const d=new Proxy(function(){},{get(t,p){if(p===Symbol.toPrimitive)return()=>'';if(p==='children')return[];if(['hidden','value','textContent','innerHTML'].includes(p))return '';return d;},set(){return true},apply(){return d}});
const store={};
const ctx={console,Math,JSON,Date,Promise,setTimeout,clearTimeout,Set,Map,Uint8Array,Object,Array,Number,String,Error,window:{matchMedia:()=>({matches:false}),innerWidth:1400,devicePixelRatio:1,addEventListener(){},claude:null},document:{querySelector:()=>d,querySelectorAll:()=>[],createElement:()=>d,getElementById:()=>null,addEventListener(){},documentElement:{style:{setProperty(){}}}},localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v}},performance:{now:()=>0},requestAnimationFrame(){},matchMedia:()=>({matches:false}),addEventListener(){},innerWidth:1400,innerHeight:900,navigator:{}};
ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(code,ctx,{filename:'polygon.js'});
const runner=`(async function(job){
  if(job.set)Object.assign(SET,job.set);if(job.pre)eval(job.pre);
  if(job.over){for(const [k,v] of Object.entries(job.over.A||{}))A[k]=Object.assign(A[k]||{},v);for(const [k,v] of Object.entries(job.over.T||{}))T[k]=Object.assign(T[k]||{},v);}
  if(job.scnDef)SCN[job.scn]=job.scnDef;
  let F=null;
  const _aw=addWound;addWound=function(u,ar,o){const r=_aw(u,ar,o);if(r&&F&&u.side==='pc'){const w=u.wounds[ar];F.hw.push(w?w.deg:4);}return r;};
  const _ra=resolveAttack;resolveAttack=async function(att,act,t,opt){if(F){const k=att.tpl;F.atk[k]=(F.atk[k]||0)+1;if(att.side==='en'){const q=k+'→'+t.tpl+(openT(t)?' (открыт)':'');F.tg[q]=(F.tg[q]||0)+1;}}return _ra(att,act,t,opt);};
  const _ad=applyDamage;applyDamage=function(u,dmg,src){if(F&&dmg>0&&!u.down){const k=src?src.tpl:'(кровь/огонь)';F.dmg[k]=(F.dmg[k]||0)+Math.min(dmg,Math.max(0,u.hp));if(u.side==='pc')F.hdmg+=dmg;}return _ad(u,dmg,src);};
  const _du=downUnit;downUnit=function(u,src){if(F&&!u.down){(F.kill[u.tpl]=F.kill[u.tpl]||[]).push(S.round);}return _du(u,src);};
  const snap=parseScenario(job.scn);
  const out={n:0,over:{pc:0,en:0,draw:0},rounds:[],downs:{},hw:[],wbins:[0,0,0,0],wdeg:[0,0,0,0,0],atk:{},dmg:{},kill:{},alive:{},hdmg:[],def:{},zoc:0,tg:{},cov:{},thr:0,ps:{}};
  for(let i=0;i<job.n;i++){
    S=buildState(snap);S.sim=true;S.stat={wounds:0,torch:0,band:0};F={hw:[],atk:{},dmg:{},kill:{},hdmg:0,tg:{}};
    initCombat();await phaseLoop();
    out.n++;out.over[S.over||'draw']++;out.rounds.push(S.round);
    for(const u of S.units){if(u.side==='pc'&&u.down)out.downs[u.tpl]=(out.downs[u.tpl]||0)+1;if(u.side==='en'&&!u.down)out.alive[u.tpl]=(out.alive[u.tpl]||0)+1;}
    out.hw.push(F.hw.length);out.wbins[Math.min(3,F.hw.length===0?0:F.hw.length<=3?1:F.hw.length<=5?2:3)]++;for(const g of F.hw)out.wdeg[g]++;
    for(const k in F.atk)out.atk[k]=(out.atk[k]||0)+F.atk[k];for(const k in F.dmg)out.dmg[k]=(out.dmg[k]||0)+F.dmg[k];
    for(const k in F.kill)(out.kill[k]=out.kill[k]||[]).push(...F.kill[k]);out.hdmg.push(F.hdmg);
    for(const k in (S.stat.v2def||{}))out.def[k]=(out.def[k]||0)+S.stat.v2def[k];out.zoc+=S.stat.zoc||0;out.thr+=S.stat.thrMiss||0;for(const k of ['edge','ko','dead','revive','band','trap'])out.ps[k]=(out.ps[k]||0)+(S.stat[k]||0);for(const k in (S.stat.cov||{}))out.cov[k]=(out.cov[k]||0)+S.stat.cov[k];for(const k in F.tg)out.tg[k]=(out.tg[k]||0)+F.tg[k];
  }
  return out;})`;
const fn=vm.runInContext(runner,ctx);
fn(JSON.parse(process.argv[2]||'{}')).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e);process.exit(1);});
