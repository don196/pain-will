/* Звук боя: всё синтезируется на лету через WebAudio, без файлов.
   По умолчанию выключен; переключатель в «Инструментах», выбор хранится в браузере.
   Случайность здесь своя — поток бросков боя звук не трогает. */
import { S } from '../state';
import { onEdge } from '../rules/pain';

let ctx: AudioContext | null = null,
  master: GainNode | null = null,
  noiseBuf: AudioBuffer | null = null;
let on = false;
try {
  on = localStorage.getItem('polygon2-sound') === '1';
} catch (e) {}

export const soundOn = () => on;
export function setSound(v: boolean) {
  on = v;
  try {
    localStorage.setItem('polygon2-sound', v ? '1' : '0');
  } catch (e) {}
  if (v) {
    ac();
    sfx('ui');
  } else stopDrone();
  syncDrone();
}

function ac() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const C = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  let r = 12345;
  for (let i = 0; i < ch.length; i++) {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    ch[i] = (r / 0x3fffffff - 1) * 0.9;
  }
  return ctx;
}

function env(g: GainNode, t: number, a: number, peak: number, d: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine', at = 0) {
  const c = ctx!,
    t = c.currentTime + at,
    o = c.createOscillator(),
    g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, 0.006, vol, dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function noise(dur: number, vol: number, f: number, q = 1, type: BiquadFilterType = 'bandpass', at = 0, f1 = 0) {
  const c = ctx!,
    t = c.currentTime + at,
    s = c.createBufferSource(),
    fl = c.createBiquadFilter(),
    g = c.createGain();
  s.buffer = noiseBuf;
  fl.type = type;
  fl.frequency.setValueAtTime(f, t);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  fl.Q.value = q;
  env(g, t, 0.004, vol, dur);
  s.connect(fl).connect(g).connect(master!);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

let lastStep = 0;
export function sfx(k: string) {
  if (!on || !ac() || !master) return;
  switch (k) {
    case 'swing':
      noise(0.16, 0.25, 900, 0.8, 'bandpass', 0, 2600);
      break;
    case 'shot':
      tone(420, 160, 0.09, 0.18, 'triangle');
      noise(0.22, 0.12, 2400, 2, 'bandpass', 0.02, 4800);
      break;
    case 'hit':
      tone(140, 55, 0.18, 0.5);
      noise(0.08, 0.35, 1400, 1.2);
      break;
    case 'crit':
      tone(110, 38, 0.35, 0.7);
      noise(0.14, 0.45, 900, 0.9);
      tone(70, 40, 0.5, 0.35, 'sine', 0.05);
      break;
    case 'miss':
      noise(0.2, 0.12, 2200, 0.7, 'highpass', 0, 600);
      break;
    case 'parry':
      tone(1320, 1250, 0.35, 0.16, 'triangle');
      tone(1980, 1900, 0.25, 0.08, 'sine');
      noise(0.04, 0.2, 5000, 3, 'bandpass');
      break;
    case 'down':
      tone(90, 45, 0.4, 0.45);
      noise(0.25, 0.2, 300, 0.7, 'lowpass');
      break;
    case 'dead':
      tone(70, 32, 0.9, 0.5);
      tone(140, 70, 0.9, 0.12, 'triangle', 0.05);
      break;
    case 'step': {
      const now = performance.now();
      if (now - lastStep < 140) return;
      lastStep = now;
      noise(0.05, 0.07, 500, 1.5, 'bandpass');
      break;
    }
    case 'bleed':
      tone(900, 380, 0.12, 0.08, 'sine');
      break;
    case 'edge':
      tone(62, 50, 0.22, 0.45);
      tone(60, 48, 0.22, 0.35, 'sine', 0.28);
      break;
    case 'fall':
      noise(0.12, 0.3, 400, 0.7, 'lowpass');
      tone(100, 45, 0.3, 0.4, 'sine', 0.06);
      break;
    case 'turn':
      tone(392, 380, 0.5, 0.09, 'triangle');
      tone(587, 570, 0.6, 0.05, 'sine', 0.04);
      break;
    case 'win':
      [523, 659, 784].forEach((f, i) => tone(f, f, 0.7, 0.12, 'triangle', i * 0.14));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.8, 0.12, 'triangle', i * 0.2));
      break;
    case 'ui':
      tone(660, 660, 0.08, 0.08, 'triangle');
      break;
  }
}

/* Пока кто-то из героев на пороге — тихое сердцебиение. */
let drone: number | null = null;
function stopDrone() {
  if (drone != null) clearInterval(drone);
  drone = null;
}
export function syncDrone() {
  const need = on && S && !S.sim && !S.over && !S.editor && S.units?.some(u => u.side === 'pc' && !u.down && onEdge(u));
  if (need && drone == null) {
    sfx('edge');
    drone = window.setInterval(() => sfx('edge'), 1400);
  } else if (!need) stopDrone();
}

/* Звуки по записям журнала: падение, смерть, кровь, падение с высоты. */
export function sfxLog(e) {
  if (!on || !e || !e.meta) return;
  const k = e.meta.k;
  if (k === 'down') sfx('down');
  else if (k === 'dead') sfx('dead');
  else if (k === 'bleed') sfx('bleed');
  else if (k === 'fall') sfx('fall');
}
