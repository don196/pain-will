import { A } from '../data/actions';
import { T } from '../data/fighters';
import { SCN } from '../data/scenarios';
import { hitCalc } from '../rules/stats';
import { limOf, onEdge, painOf, painPrep } from '../rules/pain';
import { resist } from '../rules/reactions';
import { SIM_CAP, initCombat, phaseLoop } from '../rules/turns';
import { S, SIMULATING, buildState, mkUnit, parseScenario, setS, setSIMULATING, snapshotNow } from '../state';
import { openModal } from './modals';
import { render } from './panels';
import { $, esc, fmtN, pct } from '../util';
import { SET } from '../settings';
import { rngState, seedRng, setRngState } from '../rng';

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
/* Варианты правил из параллельной ветки 4.5 — для сравнения A/B. */
export const VARIANTS: [string, string][] = [
  ['edgeLast', 'Последний ход на пороге (4.5.1)'],
  ['parryDiff', 'Парирование по разнице весов, дубина толстяка — средняя (4.5)'],
  ['lightBonus', 'Лёгкое оружие +2 к атаке (4.5)'],
  ['voiceOnly', 'Голос и жесты: на пороге только голосовые заклинания (4.5.2)'],
  ['allyFire', 'Стрельба через плечо союзника (свод 2.4)'],
  ['natRolls', 'Натуральные 1 и 20 (свод 2.4)'],
];
export function openSim() {
  openModal(
    `<h2>Симуляция боёв</h2><p class="dim">Текущая расстановка разыгрывается много раз без анимации, ИИ ведёт обе стороны. Каждый бой со своим зерном; при сравнении A и B бои идут с одинаковыми зёрнами, разница — только в правилах. Бой дольше ${SIM_CAP} раундов считается ничьей.</p>
    <div class="simctl"><label for="simN">Боёв</label><select id="simN"><option>50</option><option selected>200</option><option>500</option></select><button type="button" class="primary" id="simGo">Запустить</button><span id="simProg" class="dim"></span></div>
    <details class="simab"><summary>Сравнить правила: A — текущие, B — с вариантами</summary>
      <div class="abvar">${VARIANTS.map(([k, l]) => `<label><input type="checkbox" data-var="${k}" ${SET[k] ? '' : 'checked'}> ${SET[k] ? 'без: ' : ''}${esc(l)}</label>`).join('')}</div>
      <p class="dim">Отмеченные варианты переключаются только для B, относительно текущих «Правил».</p>
      <button type="button" id="simAB">Сравнить A и B</button></details>
    <div id="simOut" class="simres"></div>`,
    () => {
      $('#simGo').onclick = () => runSim(+$('#simN').value);
      $('#simAB').onclick = () => {
        const over = {};
        $('#mbox')
          .querySelectorAll('[data-var]')
          .forEach(i => {
            if (i.checked) over[i.dataset.var] = !SET[i.dataset.var];
          });
        runSim(+$('#simN').value, over);
      };
    },
  );
}

/* Пачка боёв с одинаковыми зёрнами 9000+i; over — временно изменённые «Правила». */
async function simBatch(n, over, prog) {
  const real = S,
    snap = S.editor ? snapshotNow() : real.initial,
    keep = rngState(),
    prev = {};
  for (const k in over) {
    prev[k] = SET[k];
    SET[k] = over[k];
  }
  const res = {
    n,
    pc: 0,
    en: 0,
    draw: 0,
    rounds: 0,
    lenHist: {} as Record<number, number>,
    units: {} as Record<string, any>,
    allAlive: 0,
    allDead: 0,
    long: 0,
    wounds: 0,
    painHist: {} as Record<number, number>,
    downs: [] as any[],
    map: { w: snap.w, h: snap.h, walls: new Set(snap.walls) },
  };
  const reparse = !S.editor && SCN[real.scn] && SCN[real.scn].pool;
  try {
    for (let i = 0; i < n; i++) {
      seedRng(9000 + i);
      setS(buildState(reparse ? parseScenario(real.scn) : snap));
      S.sim = true;
      S.stat = { wounds: 0, torch: 0, band: 0 };
      initCombat();
      await phaseLoop();
      res[S.over || 'draw']++;
      res.rounds += S.round;
      res.lenHist[S.round] = (res.lenHist[S.round] || 0) + 1;
      if (S.round > 8) res.long++;
      res.wounds += S.stat.wounds;
      for (const d of S.stat.downAt || []) res.downs.push(d);
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
              edge: 0,
              pain: 0,
              ko: 0,
              dead: 0,
              lim: limOf(u),
            });
        r.n++;
        if (!u.down) {
          if (onEdge(u)) r.edge++;
          else r.alive++;
          r.pain += painOf(u);
          if (u.side === 'pc')
            res.painHist[Math.min(limOf(u), painOf(u))] = (res.painHist[Math.min(limOf(u), painOf(u))] || 0) + 1;
        } else if (u.ko) r.ko++;
        else if (u.dead) r.dead++;
      }
      if (i % 10 === 9) {
        setS(real);
        if (prog) prog(i + 1);
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } catch (e) {
    console.error(e);
  }
  for (const k in prev) SET[k] = prev[k];
  setS(real);
  setRngState(keep);
  return res;
}

export async function runSim(n, over?: Record<string, boolean>) {
  if (SIMULATING) return;
  setSIMULATING(true);
  $('#simGo').disabled = true;
  if ($('#simAB')) $('#simAB').disabled = true;
  const prog = tag => k => ($('#simProg').textContent = `${tag}${k} / ${n}`);
  const A_ = await simBatch(n, {}, prog(over ? 'A: ' : ''));
  const B_ = over ? await simBatch(n, over, prog('B: ')) : null;
  setSIMULATING(false);
  $('#simGo').disabled = false;
  if ($('#simAB')) $('#simAB').disabled = false;
  $('#simProg').textContent = '';
  $('#simOut').innerHTML = B_ ? abView(A_, B_, over) : soloView(A_);
  render();
}

const pp = (r, k) => r[k] / r.n;
function soloView(r) {
  const p = k => pct(pp(r, k));
  return `<div class="big3"><div><b>${p('allAlive')}</b>победа, все герои на ногах</div><div><b>${p('pc')}</b>победа героев</div><div><b>${p('allDead')}</b>все герои выбыли</div></div>
    <p>Средняя длина боя: <b>${fmtN(r.rounds / r.n)}</b> раунда, дольше 8 раундов: ${p('long')} · ран за бой: ${fmtN(r.wounds / r.n)} · ничьих ${p('draw')} · ${r.n} боёв · ${SCN[S.scn] ? SCN[S.scn].name : 'своя расстановка'}</p>
    ${unitTable(r)}
    <div class="charts">
      ${chartCard('Длина боя, раундов', lenChart([r]))}
      ${chartCard('Чем закончили бой герои', outcomeChart([r]))}
      ${chartCard('Боль к концу боя у стоявших героев', painChart([r]))}
      ${chartCard('Где падали', fallMaps(r))}
    </div>`;
}
function abView(A_, B_, over) {
  const names = Object.keys(over)
    .map(k => (VARIANTS.find(v => v[0] === k) || [k, k])[1] + (over[k] ? '' : ' — выкл.'))
    .join('; ');
  const row = (l, a, b, isPct = true, better = 1) => {
    const d = b - a,
      good = d * better > 0.0001,
      bad = d * better < -0.0001;
    return `<tr><td>${l}</td><td>${isPct ? pct(a) : fmtN(a)}</td><td>${isPct ? pct(b) : fmtN(b)}</td><td class="${good ? 'dgood' : bad ? 'dbad' : ''}">${d >= 0 ? '+' : '−'}${isPct ? Math.abs(Math.round(d * 100)) + ' п.п.' : fmtN(Math.abs(d))}</td></tr>`;
  };
  const heroRows = Object.keys(A_.units)
    .filter(k => k.startsWith('pc:'))
    .map(k => {
      const a = A_.units[k],
        b = B_.units[k] || a;
      return (
        row(`${esc(a.name)}: погиб`, a.dead / a.n, b.dead / b.n, true, -1) +
        row(`${esc(a.name)}: без сознания`, a.ko / a.n, b.ko / b.n, true, -1)
      );
    })
    .join('');
  return `<p><span class="lgA"></span> <b>A</b> — текущие правила · <span class="lgB"></span> <b>B</b> — ${esc(names)}. ${A_.n} боёв, одинаковые зёрна.</p>
    <table class="abt"><tr><th></th><th>A</th><th>B</th><th>B − A</th></tr>
    ${row('Победа героев', pp(A_, 'pc'), pp(B_, 'pc'))}
    ${row('Победа, все на ногах', pp(A_, 'allAlive'), pp(B_, 'allAlive'))}
    ${row('Все герои выбыли', pp(A_, 'allDead'), pp(B_, 'allDead'), true, -1)}
    ${row('Средняя длина боя, раундов', A_.rounds / A_.n, B_.rounds / B_.n, false, 0)}
    ${row('Ран за бой', A_.wounds / A_.n, B_.wounds / B_.n, false, 0)}
    ${heroRows}</table>
    <div class="charts">
      ${chartCard('Длина боя, раундов', lenChart([A_, B_]))}
      ${chartCard('Чем закончили бой герои: A и B', outcomeChart([A_, B_]))}
      ${chartCard('Боль к концу боя у стоявших героев', painChart([A_, B_]))}
      ${chartCard('Где падали · A', fallMaps(A_))}
    </div>`;
}
function unitTable(r) {
  return `<table><tr><th>Боец</th><th>На ногах</th><th>На пороге</th><th>Без сознания</th><th>Погиб</th><th>Боль стоящих</th></tr>${Object.values(
    r.units,
  )
    .map(
      (u: any) =>
        `<tr><td><span class="nm ${u.side}">${u.name}</span>${u.n < r.n ? ` <span class="dim">(в ${pct(u.n / r.n)} боёв)</span>` : ''}</td><td>${pct(u.alive / u.n)}</td><td>${u.side === 'pc' ? pct(u.edge / u.n) : '—'}</td><td>${u.side === 'pc' ? pct(u.ko / u.n) : '—'}</td><td>${u.side === 'pc' ? pct(u.dead / u.n) : '—'}</td><td>${u.alive + u.edge ? fmtN(u.pain / (u.alive + u.edge)) + ' / ' + u.lim : '—'}</td></tr>`,
    )
    .join('')}</table>`;
}

/* ===== графики: тонкие столбцы, одна ось, подписи текстом, всплывающие значения ===== */
const SER = ['#3987e5', '#d95926'];
const chartCard = (t, body) => `<figure class="chart"><figcaption>${t}</figcaption>${body}</figure>`;
function bars(groups: { label: string; vals: number[]; tips: string[] }[], seriesN, yMax, yFmt = v => pct(v)) {
  const W = 340,
    H = 150,
    L = 34,
    B = 22,
    T = 8,
    pw = W - L - 6,
    ph = H - B - T,
    gw = pw / Math.max(1, groups.length),
    bw = Math.max(3, Math.min(16, (gw - 4) / seriesN - 2));
  const y = v => T + ph - (ph * v) / (yMax || 1);
  let g = '';
  for (const f of [0, 0.5, 1]) {
    const yy = y(yMax * f);
    g += `<line class="grid" x1="${L}" x2="${W - 6}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/><text class="ax" x="${L - 5}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${yFmt(yMax * f)}</text>`;
  }
  groups.forEach((gr, i) => {
    const x0 = L + gw * i + (gw - (bw + 2) * seriesN + 2) / 2;
    gr.vals.forEach((v, s) => {
      const x = x0 + s * (bw + 2),
        top = y(v),
        h = Math.max(0, T + ph - top);
      if (h > 0)
        g += `<path class="bar" fill="${SER[s]}" d="M${x.toFixed(1)},${(T + ph).toFixed(1)}V${(top + Math.min(4, h)).toFixed(1)}q0,-${Math.min(4, h).toFixed(1)} ${Math.min(bw / 2, 4).toFixed(1)},-${Math.min(4, h).toFixed(1)}H${(x + bw - Math.min(bw / 2, 4)).toFixed(1)}q${Math.min(bw / 2, 4).toFixed(1)},0 ${Math.min(bw / 2, 4).toFixed(1)},${Math.min(4, h).toFixed(1)}V${(T + ph).toFixed(1)}Z"><title>${esc(gr.tips[s])}</title></path>`;
      g += `<rect class="hit" x="${x.toFixed(1)}" y="${T}" width="${bw + 2}" height="${ph}"><title>${esc(gr.tips[s])}</title></rect>`;
    });
    if (groups.length <= 16 || i % 2 === 0)
      g += `<text class="ax" x="${(L + gw * i + gw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(gr.label)}</text>`;
  });
  g += `<line class="base" x1="${L}" x2="${W - 6}" y1="${T + ph}" y2="${T + ph}"/>`;
  return `<svg class="cht" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function legendAB(rs) {
  return rs.length > 1
    ? `<div class="clg"><span><i style="background:${SER[0]}"></i>A — текущие</span><span><i style="background:${SER[1]}"></i>B — варианты</span></div>`
    : '';
}
function lenChart(rs) {
  const keys = new Set<number>();
  rs.forEach(r => Object.keys(r.lenHist).forEach(k => keys.add(+k)));
  const ks = [...keys].sort((a, b) => a - b);
  if (!ks.length) return '<p class="dim">нет данных</p>';
  const lo = ks[0],
    hi = ks[ks.length - 1],
    groups = [];
  let mx = 0;
  for (let k = lo; k <= hi; k++) {
    const vals = rs.map(r => (r.lenHist[k] || 0) / r.n);
    mx = Math.max(mx, ...vals);
    groups.push({
      label: String(k),
      vals,
      tips: rs.map(
        (r, s) => `${rs.length > 1 ? (s ? 'B' : 'A') + ': ' : ''}${k} раундов — ${pct((r.lenHist[k] || 0) / r.n)} боёв`,
      ),
    });
  }
  return bars(groups, rs.length, Math.ceil(mx * 20) / 20 || 0.05) + legendAB(rs);
}
function painChart(rs) {
  const keys = new Set<number>();
  rs.forEach(r => Object.keys(r.painHist).forEach(k => keys.add(+k)));
  if (!keys.size) return '<p class="dim">стоявших героев не было</p>';
  const hi = Math.max(...keys),
    groups = [];
  let mx = 0;
  for (let k = 0; k <= hi; k++) {
    const vals = rs.map(r => {
      const tot = Object.values(r.painHist).reduce((a: number, b: number) => a + b, 0) as number;
      return (r.painHist[k] || 0) / (tot || 1);
    });
    mx = Math.max(mx, ...vals);
    groups.push({
      label: String(k),
      vals,
      tips: rs.map(
        (r, s) => `${rs.length > 1 ? (s ? 'B' : 'A') + ': ' : ''}Боль ${k} — ${pct(vals[s])} стоявших героев`,
      ),
    });
  }
  return bars(groups, rs.length, Math.ceil(mx * 20) / 20 || 0.05) + legendAB(rs);
}
/* Исходы героев: на ногах / на пороге / без сознания / погиб — сегменты с зазором, подписи в легенде. */
const OUT = [
  ['alive', 'на ногах', '#0ca30c'],
  ['edge', 'на пороге', '#fab219'],
  ['ko', 'без сознания', '#ec835a'],
  ['dead', 'погиб', '#d03b3b'],
];
function outcomeChart(rs) {
  const heroes = Object.keys(rs[0].units).filter(k => k.startsWith('pc:'));
  let rows = '';
  for (const k of heroes)
    rs.forEach((r, s) => {
      const u = r.units[k];
      if (!u) return;
      let segs = '';
      for (const [key, l, c] of OUT) {
        const v = u[key] / u.n;
        if (v > 0)
          segs += `<i style="width:${(v * 100).toFixed(1)}%;background:${c}" title="${esc(u.name)}${rs.length > 1 ? (s ? ' · B' : ' · A') : ''}: ${l} ${pct(v)}"></i>`;
      }
      rows += `<div class="orow"><span class="on">${s === 0 ? esc(u.name) : ''}${rs.length > 1 ? `<em>${s ? 'B' : 'A'}</em>` : ''}</span><span class="obar">${segs}</span><span class="ov">${pct(u.dead / u.n)} ✝</span></div>`;
    });
  return `<div class="ochart">${rows}</div><div class="clg">${OUT.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
}
/* Карта: где выбывали герои и противники. Чем ярче клетка, тем чаще там падали. */
function fallMaps(r) {
  const one = (side, col, title) => {
    const cnt = {};
    let mx = 0;
    for (const [x, y, sd] of r.downs)
      if (sd === side) {
        const k = x + ',' + y;
        cnt[k] = (cnt[k] || 0) + 1;
        mx = Math.max(mx, cnt[k]);
      }
    const R = 9,
      w = Math.sqrt(3) * R,
      W = r.map.w * w + w / 2 + 4,
      H = r.map.h * R * 1.5 + R + 4;
    let g = '';
    for (let y = 0; y < r.map.h; y++)
      for (let x = 0; x < r.map.w; x++) {
        const cx = 2 + w * (x + 0.5 * (y & 1)) + w / 2,
          cy = 2 + R + y * R * 1.5,
          k = x + ',' + y,
          wall = r.map.walls.has(k),
          v = cnt[k] || 0;
        const pts = [0, 1, 2, 3, 4, 5]
          .map(i => {
            const an = (Math.PI / 180) * (60 * i - 90);
            return (cx + R * 0.96 * Math.cos(an)).toFixed(1) + ',' + (cy + R * 0.96 * Math.sin(an)).toFixed(1);
          })
          .join(' ');
        g += `<polygon points="${pts}" fill="${wall ? '#2a313b' : v ? col : '#171c23'}" fill-opacity="${wall || !v ? 1 : (0.25 + (0.75 * v) / mx).toFixed(2)}">${v ? `<title>${title}: ${v} раз (${pct(v / r.n)} боёв)</title>` : ''}</polygon>`;
      }
    return `<div class="fmap"><div class="fmt">${title}</div><svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="${title}">${g}</svg></div>`;
  };
  return `<div class="fmaps">${one('pc', '#d95926', 'Герои')}${one('en', '#3987e5', 'Противники')}</div><p class="dim">Ярче — чаще. Наведите на клетку — сколько раз.</p>`;
}
