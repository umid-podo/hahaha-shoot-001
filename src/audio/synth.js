// 짧은 Web Audio 합성 효과음. 첫 사용자 입력 이후 unlock()으로 켠다.
import { ARENA_WIDTH } from '../game/config.js';
import { updateMusic, duckMusic, setMusicMuted, restartMusic } from './music.js';

export { restartMusic };

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
  setMusicMuted(value);
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
  smg: { filter: 2000, decay: 0.06, thump: 170, volume: 0.6 },
  grenade: { filter: 350, q: 0.4, decay: 0.15, thump: 80, volume: 0.5 }, // 던지는 휙 소리
  dagger: { filter: 3000, q: 0.6, decay: 0.12, thump: 0, volume: 0.45 }, // 돌진하며 휙
  shotgun: { filter: 700, q: 0.5, decay: 0.3, thump: 70, volume: 1.4 }, // 묵직한 쾅
  crossbow: { filter: 2600, q: 1.2, decay: 0.07, thump: 0, volume: 0.45 }, // 시위 튕기는 탁
  jet: { filter: 700, q: 0.5, decay: 0.35, thump: 110, volume: 1.1 },
  // 공중전: 라이트닝 기관포(빠르고 가벼움), 미사일(쉬익), 건쉽 기관포, 데스스타 산탄포
  lightning: { filter: 2200, decay: 0.07, thump: 150, volume: 0.6 },
  missile: { filter: 600, q: 0.5, decay: 0.5, thump: 90, volume: 1.1 },
  gunship: { filter: 1100, decay: 0.12, thump: 140, volume: 0.8 },
  flak: { filter: 450, q: 0.4, decay: 0.4, thump: 100, volume: 1.3 },
};

/** 레이저: 높은 음에서 빠르게 떨어지는 톱니파 '피융' */
function laserZap() {
  if (!ctx || muted) return;
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1800, start);
  osc.frequency.exponentialRampToValueAtTime(500, start + 0.08);
  gain.gain.setValueAtTime(GAIN * 0.7, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.09);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.1);
}

/** 전투 배경음악: 매 프레임 호출. on이면 재생(경기·카운트다운·컷씬), 아니면 줄여서 멈춤. */
export function updateBattleMusic(on) {
  updateMusic(ctx, on);
}

/** 경고 사이렌: 높낮이가 오르내리는 경보음을 cycles번. 그동안 배경음악은 작아진다. */
function alarm(cycles = 3) {
  if (!ctx || muted) return;
  const cycle = 0.7;
  duckMusic(cycles * cycle + 0.6);
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  for (let i = 0; i < cycles; i++) {
    osc.frequency.setValueAtTime(620, start + i * cycle);
    osc.frequency.linearRampToValueAtTime(980, start + i * cycle + cycle * 0.5);
    osc.frequency.linearRampToValueAtTime(620, start + (i + 1) * cycle);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(GAIN * 1.1, start + 0.05);
  gain.gain.setValueAtTime(GAIN * 1.1, start + cycles * cycle - 0.1);
  gain.gain.linearRampToValueAtTime(0.0001, start + cycles * cycle);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  osc.connect(lp).connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + cycles * cycle + 0.05);
}

/** 미끄러지는 음(휙·으아아): from에서 to Hz로 duration초 */
function slide(from, to, duration, type = 'sine', volume = 1) {
  if (!ctx || muted) return;
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + duration);
  gain.gain.setValueAtTime(GAIN * volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration);
}

export function playEvents(events) {
  // 돌격소총 연사처럼 한 틱에 같은 소리가 겹치면 한 번만 낸다.
  const played = new Set();
  for (const e of events) {
    const key = e.type === 'fire' ? `fire-${e.weapon}` : e.type;
    if (played.has(key)) continue;
    played.add(key);
    if (e.type === 'megalaser') { gunshot({ filter: 300, q: 0.4, decay: 1.2, thump: 50, volume: 1.8 }); [880, 660, 440, 220].forEach((f, i) => tone(f, 0.25, 'sawtooth', i * 0.06)); }
    if (e.type === 'fire' && e.weapon === 'instakill') { /* 소리는 megalaser에서 */ }
    else if (e.type === 'fire' && e.weapon === 'laser') laserZap();
    else if (e.type === 'fire') gunshot(SHOT[e.weapon] ?? SHOT.pistol);
    if (e.type === 'overheat') [700, 500, 300].forEach((f, i) => tone(f, 0.08, 'sawtooth', i * 0.07)); // 과열 경고
    if (e.type === 'jet-fire') gunshot(SHOT.jet); // 미사일 발사음
    if (e.type === 'swap') { tone(1200, 0.03, 'square'); tone(900, 0.04, 'square', 0.05); } // 철컥
    if (e.type === 'hit') tone(880, 0.07, 'square');
    if (e.type === 'block') tone(300, 0.05, 'triangle');
    if (e.type === 'explode') { gunshot({ filter: 250, q: 0.4, decay: 0.6, thump: 90, volume: 1.4 }); tone(60, 0.4, 'square', 0.05); }
    if (e.type === 'cover-hit') tone(180, 0.04, 'triangle');
    if (e.type === 'cover-break') { gunshot({ filter: 400, q: 0.5, decay: 0.5, thump: 70, volume: 1.3 }); tone(120, 0.2, 'sawtooth', 0.04); }
    if (e.type === 'down') [660, 440, 220].forEach((f, i) => tone(f, 0.12, 'square', i * 0.1));
    // 스토리 모드: 웨이브 클리어(올라가는 음), 새 웨이브(경고음)
    if (e.type === 'wave-clear') [523, 784, 1047].forEach((f, i) => tone(f, 0.14, 'triangle', i * 0.1));
    if (e.type === 'wave') [440, 330, 440, 330].forEach((f, i) => tone(f, 0.12, 'square', i * 0.14));
    // 스토리 모드: 요원·보스 등장 경고(음악이 작아짐), 엔딩 컷씬의 피하기·발차기·추락
    if (e.type === 'alarm') alarm(e.boss ? 4 : 3);
    if (e.type === 'dodge') slide(900, 300, 0.15, 'triangle', 0.8);
    if (e.type === 'kick') { gunshot({ filter: 300, q: 0.4, decay: 0.35, thump: 120, volume: 1.6 }); tone(90, 0.25, 'square', 0.02); }
    if (e.type === 'scream') slide(700, 120, 1.6, 'sawtooth', 0.7);
    // 처치 컷씬(킬캠): 쿵 + 휙, 무전 잡음, 스미스 요원의 낮고 불길한 목소리, 주인공의 반짝
    if (e.type === 'killcam') { gunshot({ filter: 200, q: 0.4, decay: 0.5, thump: 90, volume: 1.2 }); slide(1400, 200, 0.4, 'triangle', 0.6); }
    if (e.type === 'radio') { duckMusic(e.wave === 2 ? 3.2 : 2.6); gunshot({ filter: 2500, q: 3, decay: 0.5, thump: 0, volume: 0.6 }); }
    if (e.type === 'smith-voice') [110, 104, 98, 92].forEach((f, i) => tone(f, 0.35, 'sawtooth', i * 0.3));
    if (e.type === 'hero-pose') [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'triangle', i * 0.07));
    // 스토리 2스테이지(복도): 엘리베이터 딩동, 포탑 포성, 천장 울림·붕괴, R-10 착지·도발, 스테이지 전환·회복
    if (e.type === 'elevator') { tone(1319, 0.35, 'sine'); tone(1047, 0.5, 'sine', 0.3); }
    if (e.type === 'turret-fire') gunshot({ filter: 500, q: 0.6, decay: 0.3, thump: 110, volume: 1 });
    if (e.type === 'rumble') { gunshot({ filter: 120, q: 0.3, decay: 1.2, thump: 45, volume: 1.6 }); tone(40, 0.9, 'square', 0.05); }
    if (e.type === 'ceiling-break') { gunshot({ filter: 350, q: 0.4, decay: 0.9, thump: 70, volume: 1.8 }); tone(120, 0.3, 'sawtooth', 0.05); }
    if (e.type === 'land') gunshot({ filter: 200, q: 0.4, decay: 0.4, thump: 80, volume: 1.3 });
    if (e.type === 'taunt') [988, 1319, 988, 1319, 740].forEach((f, i) => tone(f, 0.09, 'square', i * 0.11));
    if (e.type === 'sigh') slide(500, 260, 0.6, 'triangle', 0.7);
    if (e.type === 'what') [659, 880].forEach((f, i) => tone(f, 0.12, 'triangle', i * 0.12));
    if (e.type === 'stage') [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'triangle', i * 0.11));
    if (e.type === 'heal') slide(400, 1200, 0.5, 'sine', 0.8);
    if (e.type === 'result') [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.13 + 0.3));
    // 건 카타: 시작(챙!), 버튼이 빛날 때(삐), 대응 성공(높은 화음), 피격(낮은 버저), 10번 완료
    if (e.type === 'gunkata') { slide(200, 1600, 0.35, 'sawtooth', 0.6); [1319, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.35 + i * 0.1)); }
    if (e.type === 'kata-warn') tone(1760, 0.08, 'square');
    // 과냉각: 차갑게 내려가는 소리 + 높은 삐
    if (e.type === 'overcool') { slide(1800, 600, 0.35, 'triangle', 0.7); tone(2200, 0.1, 'sine', 0.3); }
    if (e.type === 'kata-counter') [1047, 1568].forEach((f, i) => tone(f, 0.09, 'triangle', i * 0.06));
    if (e.type === 'kata-hit') { tone(110, 0.25, 'sawtooth'); tone(98, 0.25, 'square', 0.05); }
    if (e.type === 'kata-clear') [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.14, 'triangle', i * 0.09));
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
