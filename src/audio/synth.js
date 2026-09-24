// 짧은 Web Audio 합성 효과음. 첫 사용자 입력 이후 unlock()으로 켠다.
const GAIN = 0.08;
let ctx = null;
let muted = false;

export function unlock() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx ??= new AudioCtx();
  ctx.resume();
}

export function setMuted(value) { muted = value; }

function tone(freq, duration, type, delay = 0) {
  if (!ctx || muted) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(GAIN, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

const FIRE_TONE = { rifle: [620, 0.04], pistol: [520, 0.06], dual: [560, 0.05], rpg: [140, 0.25] };

export function playEvents(events) {
  // 돌격소총 연사처럼 한 틱에 같은 소리가 겹치면 한 번만 낸다.
  const played = new Set();
  for (const e of events) {
    const key = e.type === 'fire' ? `fire-${e.weapon}` : e.type;
    if (played.has(key)) continue;
    played.add(key);
    if (e.type === 'fire') { const [f, d] = FIRE_TONE[e.weapon] ?? FIRE_TONE.pistol; tone(f, d, 'square'); }
    if (e.type === 'hit') tone(880, 0.07, 'square');
    if (e.type === 'block') tone(300, 0.05, 'triangle');
    if (e.type === 'explode') { tone(90, 0.35, 'sawtooth'); tone(60, 0.4, 'square', 0.05); }
    if (e.type === 'down') [660, 440, 220].forEach((f, i) => tone(f, 0.12, 'square', i * 0.1));
    if (e.type === 'result') [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.13 + 0.3));
  }
}
