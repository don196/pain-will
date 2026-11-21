import { A } from '../data/actions';
import { T } from '../data/fighters';
import { SCN } from '../data/scenarios';
import { hitCalc } from '../rules/stats';
import { limOf, painOf, painPrep } from '../rules/pain';
import { resist } from '../rules/reactions';
import { SIM_CAP, initCombat, phaseLoop } from '../rules/turns';
import { S, SIMULATING, buildState, mkUnit, parseScenario, setS, setSIMULATING, snapshotNow } from '../state';
import { openModal } from './modals';
import { render } from './panels';
import { $, fmtN, pct } from '../util';

/* Таблица шансов: каждая атака каждого бойца против каждого бойца из свода, без ран и эффектов. */
export function oddsRC() {
  const rows = [];
  for (const [tk, t] of Object.entries(T))
    for (const id of t.acts) {
      const a = A[id];
      if (a && a.kind === 'attack' && a.fixed == null) rows.push([tk, id]);
    }
  return {
    ODDS_ROWS: rows,
    ODDS_COLS: Object.keys(T),
  };
}

/* Боец по шаблону вне боя: для таблиц и подсказок редактора. */
export function tmpUnit(tpl) {
  const t = T[tpl];
  const u = mkUnit(tpl, t.side, 0, 0);
  u.noLight = true;
  painPrep(u);
  return u;
}
export function oddsTable(vuln) {
  const { ODDS_ROWS, ODDS_COLS } = oddsRC();
  const head = `<tr><th class="rh">Атака ↓ / цель →</th>${ODDS_COLS.map(c => {
    const u = tmpUnit(c);
    return `<th>${T[c].name}<br><span class="dim">Стойк. ${resist(u)} · бр. ${u.armor} · предел ${limOf(u)}</span></th>`;
  }).join('')}</tr>`;
  let mx = 0;
  const data = ODDS_ROWS.map(([at, ac]) =>
    ODDS_COLS.map(dc => {
      const d = tmpUnit(dc);
      if (vuln)
        d.effects.push({
          type: 'vuln2',
          end: 1e9,
        });
      const h = hitCalc(tmpUnit(at), A[ac], d);
      mx = Math.max(mx, h.Eact);
      return h;
    }),
  );
  const rows = ODDS_ROWS.map(
    ([at, ac], i) =>
      `<tr><th class="rh">${T[at].name} · ${A[ac].name}<br><span class="dim">${A[ac].cost} ОД${A[ac].ranged ? ' · дальность ' + A[ac].range : ''}</span></th>${data[i].map(h => `<td style="background:rgba(224,144,63,${((h.Eact / (mx || 1)) * 0.45).toFixed(3)})"><span class="e">${fmtN(h.Eact)}</span><span class="h">крит ${pct(h.p[3])}</span></td>`).join('')}</tr>`,
  ).join('');
  return `<table class="odds">${head}${rows}</table>`;
}
export function openOdds() {
  openModal(
    `<h2>Таблица шансов</h2><p class="dim">В клетке: ожидаемая Боль за одно действие (с бронёй цели в начале боя и порогами промаха) и шанс критического успеха. Активная защита цели не учитывается. Значения шаблонов из свода, без ран и эффектов.</p>
    <p><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="oddsV"> цель под Уязвимостью (Боль после брони ×2)</label></p>
    <div class="tblwrap" id="oddsBox">${oddsTable(false)}</div>`,
    () => {
      $('#oddsV').onchange = e => {
        $('#oddsBox').innerHTML = oddsTable(e.target.checked);
      };
    },
  );
}
export function openSim() {
  openModal(
    `<h2>Симуляция боёв</h2><p class="dim">Текущая расстановка разыгрывается много раз без анимации, ИИ ведёт обе стороны. Действуют текущие «Настройки правил». ИИ героев простой: Рыцарь прикрывает соседа и оглушает крупных врагов, Инквизитор связывает, если есть шанс, Барон воодушевляет, Ведьма проклинает самого опасного и стреляет с дистанции; все добивают слабых и стрелков, бросают факелы, если стоят в темноте рядом с врагом, и перевязывают кровотечение. В сценарии со случайным противником он выбирается заново в каждом бою. Бой дольше ${SIM_CAP} раундов считается ничьей.</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label for="simN">Боёв</label><select id="simN"><option>50</option><option selected>200</option><option>500</option></select><button type="button" class="primary" id="simGo">Запустить</button><span id="simProg" class="dim"></span></div>
    <div id="simOut" class="simres"></div>`,
    () => {
      $('#simGo').onclick = () => runSim(+$('#simN').value);
    },
  );
}
export async function runSim(n) {
  if (SIMULATING) return;
  setSIMULATING(true);
  $('#simGo').disabled = true;
  const real = S,
    snap = S.editor ? snapshotNow() : real.initial,
    res = {
      pc: 0,
      en: 0,
      draw: 0,
      rounds: 0,
      units: {} as Record<string, any>,
      allAlive: 0,
      allDead: 0,
      long: 0,
      wounds: 0,
    };
  const reparse = !S.editor && SCN[real.scn] && SCN[real.scn].pool;
  try {
    for (let i = 0; i < n; i++) {
      setS(buildState(reparse ? parseScenario(real.scn) : snap));
      S.sim = true;
      S.stat = {
        wounds: 0,
        torch: 0,
        band: 0,
      };
      initCombat();
      await phaseLoop();
      res[S.over || 'draw']++;
      res.rounds += S.round;
      if (S.round > 8) res.long++;
      res.wounds += S.stat.wounds;
      const pcs = S.units.filter(u => u.side === 'pc'),
        dn = pcs.filter(u => u.down).length;
      if (S.over === 'pc' && !dn) res.allAlive++;
      if (pcs.length && dn === pcs.length) res.allDead++;
      for (const u of S.units) {
        const k = u.side + ':' + u.name,
          r =
            res.units[k] ||
            (res.units[k] = {
              name: u.name,
              side: u.side,
              n: 0,
              alive: 0,
              pain: 0,
              ko: 0,
              dead: 0,
              lim: limOf(u),
            });
        r.n++;
        if (!u.down) {
          r.alive++;
          r.pain += painOf(u);
        } else if (u.ko) r.ko++;
        else if (u.dead) r.dead++;
      }
      if (i % 10 === 9) {
        setS(real);
        $('#simProg').textContent = `${i + 1} / ${n}`;
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } catch (e) {
    console.error(e);
  }
  setS(real);
  setSIMULATING(false);
  $('#simGo').disabled = false;
  $('#simProg').textContent = '';
  const p = k => pct(res[k] / n);
  $('#simOut').innerHTML =
    `<div class="big3"><div><b>${p('allAlive')}</b>победа, все герои на ногах</div><div><b>${p('pc')}</b>победа героев</div><div><b>${p('allDead')}</b>все герои выбыли</div></div>
    <p>Средняя длина боя: <b>${fmtN(res.rounds / n)}</b> раунда, дольше 8 раундов: ${p('long')} · ран за бой: ${fmtN(res.wounds / n)} · ничьих ${p('draw')} · ${n} боёв · ${SCN[real.scn] ? SCN[real.scn].name : 'своя расстановка'}</p>
    <table><tr><th>Боец</th><th>В строю к концу</th><th>Без сознания</th><th>Погиб</th><th>Боль стоящих</th></tr>${Object.values(
      res.units,
    )
      .map(
        r =>
          `<tr><td><span class="nm ${r.side}">${r.name}</span>${r.n < n ? ` <span class="dim">(в ${pct(r.n / n)} боёв)</span>` : ''}</td><td>${pct(r.alive / r.n)}</td><td>${r.side === 'pc' ? pct(r.ko / r.n) : '—'}</td><td>${r.side === 'pc' ? pct(r.dead / r.n) : '—'}</td><td>${r.alive ? fmtN(r.pain / r.alive) + ' / ' + r.lim : '—'}</td></tr>`,
      )
      .join('')}</table>`;
  render();
}
