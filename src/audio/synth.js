// 짧은 Web Audio 합성 효과음. 첫 사용자 입력 이후 unlock()으로 켠다.
import { ARENA_WIDTH } from '../game/config.js';

const GAIN = 0.08;
const ENGINE_GAIN = 0.12;
let ctx = null;
let muted = false;
let noise = null;
let engine = null;

export function unlock() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx ??= new AudioCtx();
  ctx.resume();
}

export function setMuted(value) {
  muted = value;
  if (muted) updateEngine(null);
}

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

/** 1초 길이 백색 소음 버퍼. 총성·엔진이 함께 쓴다. */
function noiseBuffer() {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/**
 * 총성: 대역 통과한 소음 폭발(탕) + 아래로 떨어지는 저음(쿵).
 * filter는 음색, decay는 여운, thump는 저음 시작 주파수, volume은 상대 크기.
 */
function gunshot({ filter, q = 0.8, decay, thump, volume = 1 }, delay = 0) {
  if (!ctx || muted) return;
  const start = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = filter;
  band.Q.value = q;
  const crack = ctx.createGain();
  crack.gain.setValueAtTime(GAIN * 3 * volume, start);
  crack.gain.exponentialRampToValueAtTime(0.001, start + decay);
  src.connect(band).connect(crack).connect(ctx.destination);
  src.start(start, Math.random() * 0.5);
  src.stop(start + decay);

  const osc = ctx.createOscillator();
  const body = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(thump, start);
  osc.frequency.exponentialRampToValueAtTime(40, start + decay * 0.8);
  body.gain.setValueAtTime(GAIN * 2.5 * volume, start);
  body.gain.exponentialRampToValueAtTime(0.001, start + decay * 0.8);
  osc.connect(body).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + decay);
}

const SHOT = {
  rifle: { filter: 1800, decay: 0.09, thump: 160, volume: 0.8 },
  pistol: { filter: 1300, decay: 0.14, thump: 190 },
  dual: { filter: 1500, decay: 0.12, thump: 180, volume: 0.9 },
  rpg: { filter: 500, q: 0.5, decay: 0.45, thump: 110, volume: 1.2 },
  sniper: { filter: 2400, q: 1.2, decay: 0.35, thump: 230, volume: 1.4 },
  jet: { filter: 700, q: 0.5, decay: 0.35, thump: 110, volume: 1.1 },
};

export function playEvents(events) {
  // 돌격소총 연사처럼 한 틱에 같은 소리가 겹치면 한 번만 낸다.
  const played = new Set();
  for (const e of events) {
    const key = e.type === 'fire' ? `fire-${e.weapon}` : e.type;
    if (played.has(key)) continue;
    played.add(key);
    if (e.type === 'fire') gunshot(SHOT[e.weapon] ?? SHOT.pistol);
    if (e.type === 'jet-fire') gunshot(SHOT.jet); // 미사일 발사음
    if (e.type === 'swap') { tone(1200, 0.03, 'square'); tone(900, 0.04, 'square', 0.05); } // 철컥
    if (e.type === 'hit') tone(880, 0.07, 'square');
    if (e.type === 'block') tone(300, 0.05, 'triangle');
    if (e.type === 'explode') { gunshot({ filter: 250, q: 0.4, decay: 0.6, thump: 90, volume: 1.4 }); tone(60, 0.4, 'square', 0.05); }
    if (e.type === 'cover-hit') tone(180, 0.04, 'triangle');
    if (e.type === 'cover-break') { gunshot({ filter: 400, q: 0.5, decay: 0.5, thump: 70, volume: 1.3 }); tone(120, 0.2, 'sawtooth', 0.04); }
    if (e.type === 'down') [660, 440, 220].forEach((f, i) => tone(f, 0.12, 'square', i * 0.1));
    if (e.type === 'result') [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.13 + 0.3));
  }
}

/** 전투기 엔진: 저음 톱니파 두 개(웅웅) + 저역 소음(쉬익)을 계속 켜 두고 볼륨·좌우 위치만 바꾼다. */
function startEngine() {
  const out = ctx.createGain();
  out.gain.value = 0;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) out.connect(pan).connect(ctx.destination);
  else out.connect(ctx.destination);

  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 500;
  low.connect(out);
  const oscs = [68, 71.5].map((f) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.connect(low);
    osc.start();
    return osc;
  });

  const roar = ctx.createBufferSource();
  roar.buffer = noiseBuffer();
  roar.loop = true;
  const hiss = ctx.createBiquadFilter();
  hiss.type = 'bandpass';
  hiss.frequency.value = 900;
  hiss.Q.value = 0.6;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 1.6;
  roar.connect(hiss).connect(hissGain).connect(out);
  roar.start();

  return { out, pan, sources: [...oscs, roar], oscs };
}

/**
 * 매 프레임 호출. jet이 있으면 엔진을 켜고 화면 위치에 따라 좌우·크기를 맞춘다.
 * null이면(전투기 없음·일시정지·결과·음소거) 부드럽게 끈다.
 */
export function updateEngine(jet) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (!jet || muted) {
    if (!engine) return;
    const { out, sources } = engine;
    out.gain.cancelScheduledValues(now);
    out.gain.setTargetAtTime(0, now, 0.08);
    for (const s of sources) s.stop(now + 0.5);
    engine = null;
    return;
  }
  engine ??= startEngine();
  const center = (jet.x / ARENA_WIDTH) * 2 - 1; // -1 왼쪽 끝 ~ 1 오른쪽 끝
  const volume = ENGINE_GAIN * Math.max(0.25, 1 - Math.abs(center) * 0.6);
  engine.out.gain.setTargetAtTime(volume, now, 0.1);
  if (engine.pan) engine.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, center)), now, 0.1);
  // 다가올 때 약간 높고 멀어질 때 낮아지는 도플러 흉내
  const approaching = Math.sign(jet.dir) === -Math.sign(center);
  const pitch = approaching ? 1.08 : 0.94;
  engine.oscs.forEach((o, i) => o.frequency.setTargetAtTime((i ? 71.5 : 68) * pitch, now, 0.3));
}
