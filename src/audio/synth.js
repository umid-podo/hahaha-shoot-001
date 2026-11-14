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
  renderAll();
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
  dualrpg: { filter: 900, q: 0.6, decay: 0.3, thump: 90, volume: 1.1 }, // 쌍 RPG: 작은 로켓 발사음
  jet: { filter: 700, q: 0.5, decay: 0.35, thump: 110, volume: 1.1 },
  // 공중전: 라이트닝 기관포(빠르고 가벼움), 미사일(쉬익), 건쉽 기관포, 데스스타 산탄포
  lightning: { filter: 2200, decay: 0.07, thump: 150, volume: 0.6 },
  missile: { filter: 600, q: 0.5, decay: 0.5, thump: 90, volume: 1.1 },
  gunship: { filter: 1100, decay: 0.12, thump: 140, volume: 0.8 },
  flak: { filter: 450, q: 0.4, decay: 0.4, thump: 100, volume: 1.3 },
  dsmissile: { filter: 380, q: 0.4, decay: 0.6, thump: 80, volume: 1.4 },
  // 대교: 존슨 요원의 저격총(여러 발이 한꺼번에, 날카롭고 큼)
  jsniper: { filter: 2600, q: 1.3, decay: 0.45, thump: 240, volume: 1.7 },
};

// ── 실감 효과음: 실제 총성·장전·칼날 소리를 여러 겹으로 합성한다 ──
// 소리 하나하나를 실시간으로 합성하면 연사 때 노드가 수백 개씩 생겨 오디오가 끊긴다.
// 그래서 처음 한 번만 OfflineAudioContext로 녹음(렌더링)해 두고, 경기 중에는 녹음본만 재생한다.
// 아래 레시피 함수들은 렌더링 중인 컨텍스트 ac에 0초부터 소리를 깐다.
let ac = null;
let bus = null;
let room = null;
let irBuf = null;
const T0 = 0.005;

/** 잔향 임펄스: 지수적으로 줄어드는 소음(실내·골목 메아리). 한 번 만들어 모든 렌더링이 같이 쓴다. */
function impulse() {
  if (irBuf) return irBuf;
  const len = Math.floor(ctx.sampleRate * 1.4);
  irBuf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = irBuf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const early = t < 0.06 && Math.random() < 0.004 ? 3 : 0; // 초기 반사
      d[i] = (Math.random() * 2 - 1) * (Math.exp(-t * 3.6) + early) * 0.5;
    }
  }
  return irBuf;
}

/** 렌더링 출력: 압축기 + 잔향 */
function realBus() {
  return bus;
}

function setupRender(c) {
  ac = c;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 6;
  comp.ratio.value = 6;
  comp.attack.value = 0.002;
  comp.release.value = 0.15;
  comp.connect(c.destination);
  const verb = c.createConvolver();
  verb.buffer = impulse();
  const verbLow = c.createBiquadFilter();
  verbLow.type = 'lowpass';
  verbLow.frequency.value = 3500;
  verb.connect(verbLow).connect(comp);
  room = verb;
  bus = comp;
}

let drive = null;
/** 화약 폭발의 거친 질감: 소리를 살짝 찌그러뜨리는 곡선 */
function driveCurve() {
  if (drive) return drive;
  drive = new Float32Array(1024);
  for (let i = 0; i < drive.length; i++) {
    const x = (i / (drive.length - 1)) * 2 - 1;
    drive[i] = Math.tanh(x * 3.5);
  }
  return drive;
}

/** 소음 한 덩이를 filters를 거쳐 env 모양으로 낸다. wet은 잔향으로 보낼 양 */
function noiseHit(start, filters, peak, attack, decay, wet = 0, out = realBus()) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer();
  let node = src;
  for (const f of filters) {
    const b = ac.createBiquadFilter();
    b.type = f.type;
    b.frequency.setValueAtTime(f.freq, start);
    if (f.to) b.frequency.exponentialRampToValueAtTime(f.to, start + (f.time ?? decay));
    if (f.q) b.Q.value = f.q;
    node = node.connect(b);
  }
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  node.connect(g).connect(out);
  if (wet > 0) {
    const send = ac.createGain();
    send.gain.value = wet;
    g.connect(send).connect(room);
  }
  src.start(start, Math.random() * 0.7);
  src.stop(start + attack + decay + 0.05);
  return g;
}

/** 금속 부품이 부딪히는 '딸깍·철컥': 높은 공진음 몇 개 + 짧은 소음 */
function metalClick(start, { pitch = 1, volume = 1, ring = 0.05 } = {}) {
  const out = realBus();
  noiseHit(start, [{ type: 'highpass', freq: 1800 * pitch }, { type: 'peaking', freq: 4200 * pitch, q: 2 }], GAIN * 5 * volume, 0.0008, 0.018, 0.08);
  for (const [f, a] of [[2350, 1], [3870, 0.7], [5630, 0.5], [7410, 0.3]]) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f * pitch * (0.98 + Math.random() * 0.04);
    g.gain.setValueAtTime(GAIN * 0.9 * a * volume, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + ring * (1.2 - a * 0.4));
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + ring + 0.02);
  }
  // 묵직한 몸통 '턱'
  noiseHit(start, [{ type: 'lowpass', freq: 900 }], GAIN * 2.2 * volume, 0.001, 0.035);
}

/** 금속이 미끄러지는 '스르륵'(노리쇠·슬라이드 당김) */
function metalSlide(start, duration, volume = 1) {
  noiseHit(start, [{ type: 'bandpass', freq: 2500, to: 5000, q: 3, time: duration }], GAIN * 1.6 * volume, duration * 0.4, duration * 0.6);
}

/**
 * 실제 총성: ① 초음속 탄의 날카로운 '딱'(crack) ② 화약 폭발 '탕'(필터가 빠르게 닫히는 찌그러진 소음)
 * ③ 가슴을 치는 저음 '쿵' ④ 주변에 부딪혀 돌아오는 메아리 ⑤ 권총은 슬라이드가 돌아오는 '찰칵'.
 */
const REAL = {
  pistol: { body: 5200, decay: 0.16, boom: 150, crack: 0.8, wet: 0.5, volume: 1, mech: 0.045 },
  dual: { body: 5000, decay: 0.15, boom: 145, crack: 0.8, wet: 0.45, volume: 0.95, mech: 0.04 },
  // 에너지 쌍권총: 진짜 권총 총성(아주 빠른 연사라 짧고 조금 작게)
  energydual: { body: 5400, decay: 0.09, boom: 150, crack: 0.9, wet: 0.3, volume: 0.7 },
  rifle: { body: 6500, decay: 0.12, boom: 120, crack: 1.2, wet: 0.45, volume: 0.9 },
  smg: { body: 5800, decay: 0.08, boom: 140, crack: 0.7, wet: 0.3, volume: 0.65 },
  sniper: { body: 7000, decay: 0.38, boom: 85, crack: 1.6, wet: 0.9, volume: 1.4, mech: 0.32 },
  jsniper: { body: 7000, decay: 0.42, boom: 80, crack: 1.7, wet: 1, volume: 1.5 },
  shotgun: { body: 3600, decay: 0.32, boom: 70, crack: 0.6, wet: 0.8, volume: 1.5, mech: 0.38, pump: true },
  lightning: { body: 5500, decay: 0.08, boom: 110, crack: 0.9, wet: 0.3, volume: 0.6 },
  gunship: { body: 4200, decay: 0.12, boom: 95, crack: 0.8, wet: 0.4, volume: 0.8 },
  turret: { body: 3800, decay: 0.22, boom: 90, crack: 0.9, wet: 0.6, volume: 1 },
};

function realShot(p, delay = 0) {
  if (!ctx || muted) return;
  const out = realBus();
  const start = T0 + delay;
  const v = p.volume * (0.92 + Math.random() * 0.16);
  const tune = 0.94 + Math.random() * 0.12;
  // ① crack: 아주 짧고 밝은 충격
  noiseHit(start, [{ type: 'highpass', freq: 2500 * tune }], GAIN * 6 * p.crack * v, 0.0005, 0.012, 0.2);
  // ② blast: 찌그러뜨린 광대역 소음, 저역 통과 필터가 빠르게 닫힘
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(p.body * tune, start);
  lp.frequency.exponentialRampToValueAtTime(260, start + p.decay);
  lp.Q.value = 0.7;
  const pre = ac.createGain();
  pre.gain.value = 2.5;
  const shaper = ac.createWaveShaper();
  shaper.curve = driveCurve();
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(GAIN * 5 * v, start + 0.001);
  env.gain.exponentialRampToValueAtTime(GAIN * 1.2 * v, start + p.decay * 0.25);
  env.gain.exponentialRampToValueAtTime(0.0001, start + p.decay);
  src.connect(pre).connect(shaper).connect(lp).connect(env).connect(out);
  const send = ac.createGain();
  send.gain.value = p.wet;
  env.connect(send).connect(room);
  src.start(start, Math.random() * 0.5);
  src.stop(start + p.decay + 0.05);
  // ③ boom: 아래로 떨어지는 저음
  const osc = ac.createOscillator();
  const body = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(p.boom * tune, start);
  osc.frequency.exponentialRampToValueAtTime(35, start + p.decay * 1.2);
  body.gain.setValueAtTime(GAIN * 5 * v, start);
  body.gain.exponentialRampToValueAtTime(0.0001, start + p.decay * 1.3);
  osc.connect(body).connect(out);
  osc.start(start);
  osc.stop(start + p.decay * 1.3 + 0.05);
  // ⑤ 기계음: 권총 슬라이드 복귀, 저격총 볼트, 샷건 펌프(철-컥)
  if (p.mech) {
    if (p.pump) {
      metalSlide(start + p.mech, 0.09, 0.8);
      metalClick(start + p.mech + 0.1, { pitch: 0.8, volume: 0.6 });
      metalSlide(start + p.mech + 0.16, 0.07, 0.7);
      metalClick(start + p.mech + 0.24, { pitch: 0.9, volume: 0.75 });
    } else {
      metalClick(start + p.mech, { pitch: 1.15, volume: 0.25, ring: 0.03 });
    }
  }
}

/**
 * 실제 탄창 교환 소리 재료. 장난감 같은 순음 대신, 소음을 좁은 대역(높은 Q)으로 걸러 금속·강화 플라스틱 부품의
 * 공진(울림)을 만들고, 미끄러지는 소리는 아주 짧은 마찰 알갱이를 불규칙하게 이어 붙인다.
 */
/** 공진 타격: modes = [[주파수, Q, 세기, 여운초]…] + 넓은 대역의 짧은 충격 + 몸통 저음 */
function partHit(t, { modes, click = 1, thump = 0, thumpFreq = 420, volume = 1, wet = 0.15 }) {
  if (click) noiseHit(t, [{ type: 'highpass', freq: 1200 }], GAIN * 4 * click * volume, 0.0004, 0.01, wet);
  for (const [f, q, amp, decay] of modes) {
    noiseHit(t, [{ type: 'bandpass', freq: f * (0.97 + Math.random() * 0.06), q }], GAIN * 7 * amp * volume * Math.sqrt(q), 0.0006, decay, wet);
  }
  if (thump) noiseHit(t, [{ type: 'lowpass', freq: thumpFreq }], GAIN * 6 * thump * volume, 0.001, 0.05, wet);
}
/** 마찰: 탄창이 탄창 구멍 안을 긁고 지나가거나 장전 손잡이가 미끄러질 때의 '스윽'(불규칙한 알갱이) */
function scrape(t, duration, { freq = 1800, to = freq, q = 3, volume = 1 } = {}) {
  let x = 0;
  while (x < duration) {
    const k = x / duration;
    const f = freq * Math.pow(to / freq, k);
    noiseHit(t + x, [{ type: 'bandpass', freq: f, q }], GAIN * 2.2 * volume * (0.5 + Math.random()) * Math.sin(Math.PI * (0.15 + k * 0.85)), 0.0008, 0.006 + Math.random() * 0.008);
    x += 0.003 + Math.random() * 0.006;
  }
}
/** 탄창 속 탄들이 흔들려 '자르륵' */
function rattle(t, count, volume = 1) {
  for (let i = 0; i < count; i++) {
    partHit(t + Math.random() * 0.07, { modes: [[3400 + Math.random() * 2400, 18, 0.25, 0.025]], click: 0.3, volume: volume * (0.4 + Math.random() * 0.6) });
  }
}

/** 장전 시작(실제 소리): 탄창 멈치 '딸깍' → 빈 탄창이 탄창 구멍에서 '스윽' 빠짐 → 바닥에 떨어져 '퉁, 자르륵' 한 번 튐 */
function reloadOut() {
  if (!ctx || muted) return;
  const t = T0;
  partHit(t, { modes: [[3100, 14, 0.5, 0.02], [5200, 16, 0.3, 0.015]], click: 1.2, volume: 1.3 });      // 멈치 딸깍
  scrape(t + 0.02, 0.1, { freq: 1500, to: 2200, q: 3, volume: 1.2 });                                    // 스윽
  partHit(t + 0.12, { modes: [[1900, 10, 0.4, 0.03]], click: 0.5, volume: 0.7 });                        // 빠져나옴
  partHit(t + 0.5, { modes: [[620, 6, 0.6, 0.06], [1450, 9, 0.5, 0.05], [2700, 12, 0.3, 0.04]], click: 0.8, thump: 1.6, thumpFreq: 260, volume: 1.5, wet: 0.3 }); // 바닥에 퉁
  rattle(t + 0.5, 6, 0.9);
  partHit(t + 0.64, { modes: [[700, 6, 0.3, 0.05], [1600, 9, 0.25, 0.04]], click: 0.3, thump: 0.5, thumpFreq: 260, volume: 0.7, wet: 0.3 }); // 한 번 튐
  rattle(t + 0.64, 3, 0.5);
}

/**
 * 장전 끝(실제 소리): 새 탄창을 '스윽' 밀어 넣고 손바닥으로 쳐서 '착!' 걸림 → 장전 손잡이를 '촤악' 당겼다
 * 놓으면 노리쇠가 앞으로 '철컥!' 닫힘(가장 큰 소리)
 */
function reloadIn() {
  if (!ctx || muted) return;
  const t = T0;
  scrape(t, 0.08, { freq: 1300, to: 2000, q: 3, volume: 1.1 });                                                         // 밀어 넣기
  partHit(t + 0.08, { modes: [[1250, 8, 0.7, 0.05], [2300, 10, 0.6, 0.04], [3700, 12, 0.4, 0.03]], click: 1.3, thump: 1.4, thumpFreq: 380, volume: 1.2, wet: 0.2 }); // 착!
  partHit(t + 0.095, { modes: [[4300, 16, 0.4, 0.015]], click: 0.6, volume: 0.9 });                                    // 멈치 걸림
  scrape(t + 0.36, 0.09, { freq: 1600, to: 3600, q: 4, volume: 1.3 });                                                  // 손잡이 당김(촤악)
  noiseHit(t + 0.36, [{ type: 'bandpass', freq: 950, q: 22 }], GAIN * 3, 0.03, 0.08);                                    // 노리쇠 스프링 '잉'
  partHit(t + 0.45, { modes: [[2600, 12, 0.4, 0.02]], click: 0.6, volume: 0.8 });                                       // 뒤 끝에 닿음
  partHit(t + 0.52, { modes: [[880, 6, 0.9, 0.07], [1700, 9, 0.8, 0.06], [2900, 10, 0.6, 0.05], [4600, 12, 0.35, 0.03]], click: 1.8, thump: 1.6, thumpFreq: 320, volume: 1.4, wet: 0.3 }); // 철컥!
  partHit(t + 0.535, { modes: [[2050, 14, 0.4, 0.04]], click: 0.4, volume: 0.8 });                                      // 노리쇠 잠김
}

/** 무기 교체: 총을 꺼내며 '철컥' */
function weaponSwap() {
  if (!ctx || muted) return;
  const t = T0;
  metalSlide(t, 0.05, 0.5);
  metalClick(t + 0.04, { pitch: 1, volume: 0.8 });
  metalClick(t + 0.09, { pitch: 1.2, volume: 0.5, ring: 0.04 });
}

/** 칼날이 공기를 가르는 '쉭': 공진 주파수가 올라갔다 내려가는 소음 + 날의 '스앵' 울림 */
function knifeSwing() {
  if (!ctx || muted) return;
  const t = T0;
  const out = realBus();
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer();
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 4;
  band.frequency.setValueAtTime(700, t);
  band.frequency.exponentialRampToValueAtTime(3800, t + 0.11);
  band.frequency.exponentialRampToValueAtTime(1200, t + 0.26);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(GAIN * 4.5, t + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  src.connect(band).connect(g).connect(out);
  const pan = ac.createGain();
  pan.gain.value = 0.15;
  g.connect(pan).connect(room);
  src.start(t, Math.random() * 0.6);
  src.stop(t + 0.3);
  // 칼집에서 뽑히듯 날이 우는 '스앵'(비정수배 금속 배음)
  for (const [f, a] of [[3150, 1], [4730, 0.6], [6820, 0.35]]) {
    const osc = ac.createOscillator();
    const og = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 0.9, t);
    osc.frequency.linearRampToValueAtTime(f, t + 0.08);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(GAIN * 0.5 * a, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.37);
  }
}

/** 칼에 베이는 '써걱': 날카롭게 찢는 고음 소음 + 둔탁한 살 소리 */
function knifeSlash() {
  if (!ctx || muted) return;
  const t = T0;
  noiseHit(t, [{ type: 'bandpass', freq: 5200, to: 2200, q: 1.5, time: 0.09 }], GAIN * 5, 0.002, 0.09, 0.2);
  noiseHit(t + 0.01, [{ type: 'highpass', freq: 3000 }, { type: 'lowpass', freq: 9000 }], GAIN * 3, 0.003, 0.05);
  noiseHit(t, [{ type: 'lowpass', freq: 450 }], GAIN * 4, 0.003, 0.11); // 퍽
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  g.gain.setValueAtTime(GAIN * 3, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(g).connect(realBus());
  osc.start(t);
  osc.stop(t + 0.15);
}

/** 장전 소리 크기(녹음본 재생 배율)와 철컥 소리를 내지 않는 무기(탄창이 없는 것) */
const RELOAD_VOLUME = 1.8;
const NO_CLACK = new Set(['throwknives', 'flamethrower']);

/** 녹음해 둘 소리: 이름 → [길이(초), 레시피, 변형 수]. 변형마다 높낮이·세기가 조금씩 다르다. */
const RECIPES = {
  ...Object.fromEntries(Object.entries(REAL).map(([k, p]) => [
    `shot-${k}`, [p.decay * 1.3 + (p.mech ? p.mech + (p.pump ? 0.4 : 0.1) : 0) + 1.2, () => realShot(p), 3],
  ])),
  'reload-out': [1.4, reloadOut, 2],
  'reload-in': [1.8, reloadIn, 2],
  swap: [0.9, weaponSwap, 1],
  'knife-swing': [0.9, knifeSwing, 2],
  'knife-slash': [0.9, knifeSlash, 2],
};
// 기본 무기(권총·쌍권총)·장전부터 먼저 녹음
const RENDER_ORDER = ['shot-pistol', 'shot-dual', 'reload-out', 'reload-in', 'swap', 'shot-rifle', 'shot-smg',
  'knife-swing', 'knife-slash', 'shot-shotgun', 'shot-sniper'];
const recorded = {};
let rendering = false;

async function renderAll() {
  if (rendering || typeof OfflineAudioContext === 'undefined') return;
  rendering = true;
  const keys = [...new Set([...RENDER_ORDER, ...Object.keys(RECIPES)])];
  for (const key of keys) {
    const [seconds, recipe, variants] = RECIPES[key];
    const list = [];
    for (let i = 0; i < variants; i++) {
      try {
        const c = new OfflineAudioContext(2, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
        setupRender(c);
        recipe();
        ac = null;
        list.push(await c.startRendering());
      } catch { ac = null; }
    }
    if (list.length) recorded[key] = list;
  }
}

// 재생: 같은 소리가 다시 나면 앞 소리의 꼬리를 빠르게 줄여(초크) 동시에 울리는 소리 수를 묶어 둔다.
const MAX_VOICES = 14;
const voices = new Set();
const lastVoice = {};
let master = null;

/** 녹음본을 재생. 아직 녹음 전이면 false */
function playRecorded(key, volume = 1) {
  const list = recorded[key];
  if (!ctx || muted) return true;
  if (!list) return false;
  if (!master) {
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -10;
    master.ratio.value = 8;
    master.attack.value = 0.002;
    master.release.value = 0.12;
    master.connect(ctx.destination);
  }
  const now = ctx.currentTime;
  const prev = lastVoice[key];
  if (prev) {
    // 너무 촘촘하면(기관단총 연사) 건너뛴다: 귀로는 구분이 안 되고 처리량만 는다
    if (now - prev.at < 0.045) return true;
    prev.gain.gain.cancelScheduledValues(now);
    prev.gain.gain.setTargetAtTime(0, now, 0.03);
    prev.src.stop(now + 0.15);
  }
  if (voices.size >= MAX_VOICES) {
    const oldest = voices.values().next().value;
    oldest.src.stop();
    voices.delete(oldest);
  }
  const src = ctx.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = 0.97 + Math.random() * 0.06;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(master);
  const v = { src, gain, at: now };
  voices.add(v);
  lastVoice[key] = v;
  src.onended = () => {
    voices.delete(v);
    if (lastVoice[key] === v) delete lastVoice[key];
  };
  src.start();
  return true;
}

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

/** 에너지 무기: 맑은 사인파 '퓻'(쌍권총은 짧고 작게, 돌격소총은 낮게 깔리는 울림까지) */
function energyZap(big) {
  if (!ctx || muted) return;
  const start = ctx.currentTime;
  for (const [type, from, to, vol, len] of big
    ? [['sine', 2600, 700, 0.75, 0.11], ['triangle', 520, 160, 0.5, 0.14]]
    : [['sine', 3200, 1300, 0.38, 0.05]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + len * 0.9);
    gain.gain.setValueAtTime(GAIN * vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + len + 0.02);
  }
}
/** 화염방사기: 쏘는 동안 '화르륵' 바람 소리(불꽃마다 내면 너무 잦아 0.09초에 한 번) */
let lastFlame = -1;
function flameRoar() {
  if (!ctx || muted || ctx.currentTime - lastFlame < 0.09) return;
  lastFlame = ctx.currentTime;
  gunshot({ filter: 700, q: 0.4, decay: 0.16, thump: 0, volume: 0.55 });
}

/** 전투 배경음악: 매 프레임 호출. on이면 재생(경기·카운트다운·컷씬), 아니면 줄여서 멈춤. song은 틀 곡(music.js SONGS). */
export function updateBattleMusic(on, song = 'battle') {
  updateMusic(ctx, on, song);
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
    else if (e.type === 'fire' && e.weapon === 'energyrifle') energyZap(true);
    else if (e.type === 'fire' && e.weapon === 'energyrpg') { energyZap(true); gunshot({ filter: 600, q: 0.5, decay: 0.45, thump: 80, volume: 1.2 }); slide(240, 1400, 0.4, 'sawtooth', 0.4); } // 에너지 로켓: 위이잉 + 쾅
    else if (e.type === 'fire' && e.weapon === 'grenadelauncher') { gunshot({ filter: 500, q: 0.6, decay: 0.22, thump: 140, volume: 1.1 }); tone(140, 0.08, 'square'); } // 유탄: 퉁!
    else if (e.type === 'fire' && e.weapon === 'stunlauncher') { gunshot({ filter: 1400, q: 0.8, decay: 0.18, thump: 60, volume: 0.9 }); slide(1800, 600, 0.25, 'square', 0.35); } // 전기충격기: 퓽
    else if (e.type === 'fire' && e.weapon === 'flamethrower') flameRoar();
    else if (e.type === 'fire' && e.weapon === 'dagger') { if (!playRecorded('knife-swing')) gunshot(SHOT.dagger); }
    else if (e.type === 'fire' && REAL[e.weapon] && playRecorded(`shot-${e.weapon}`)) { /* 녹음본 재생 */ }
    else if (e.type === 'fire') gunshot(SHOT[e.weapon] ?? SHOT.pistol);
    // 탄창 갈아 끼우기(실제 소리): 빼기(딸깍·스윽·퉁) … 꽂기(스윽·착!)·노리쇠(촤악·철컥!). 투척용 단검은 탄창이 없어 소리 없이 돌린다
    if ((e.type === 'reload' || e.type === 'reloaded') && !NO_CLACK.has(e.weapon)) {
      const key = e.type === 'reload' ? 'reload-out' : 'reload-in';
      // 녹음 전(첫 몇 초)에는 간단한 철컥 소리로
      if (!playRecorded(key, RELOAD_VOLUME)) {
        if (e.type === 'reload') { tone(420, 0.05, 'square'); tone(220, 0.07, 'square', 0.05); }
        else { tone(380, 0.05, 'square'); tone(200, 0.07, 'square', 0.05); tone(420, 0.05, 'square', 0.26); tone(190, 0.08, 'square', 0.31); }
      }
    }
    if (e.type === 'overheat') [700, 500, 300].forEach((f, i) => tone(f, 0.08, 'sawtooth', i * 0.07)); // 과열 경고
    if (e.type === 'jet-fire') gunshot(SHOT.jet); // 미사일 발사음
    if (e.type === 'tank-fire') { gunshot({ filter: 400, q: 0.5, decay: 0.5, thump: 130, volume: 1.4 }); tone(70, 0.2, 'square', 0.02); } // 탱크 포성
    if (e.type === 'ship-fire') { gunshot({ filter: 350, q: 0.5, decay: 0.6, thump: 100, volume: 1.5 }); tone(55, 0.3, 'square', 0.02); } // 배 대포
    if (e.type === 'sniper-aim') [1760, 1760].forEach((f, i) => tone(f, 0.05, 'square', i * 0.12)); // 조준선: 삑삑
    if (e.type === 'johnson-shot' && !playRecorded('shot-jsniper')) gunshot(SHOT.jsniper);
    if (e.type === 'bump') { gunshot({ filter: 260, q: 0.4, decay: 0.3, thump: 90, volume: 1.2 }); tone(80, 0.15, 'square'); } // 구멍: 덜컹
    if (e.type === 'drift') gunshot({ filter: 3000, q: 0.3, decay: 0.35, thump: 0, volume: 0.7 }); // 눈더미: 퍽(눈보라)
    if (e.type === 'splash') { gunshot({ filter: 900, q: 0.3, decay: 0.9, thump: 60, volume: 1.4 }); slide(500, 120, 0.6, 'sine', 0.6); } // 풍덩
    if (e.type === 'evade') { gunshot({ filter: 2400, q: 0.6, decay: 0.16, thump: 0, volume: 0.7 }); slide(420, 1200, 0.14, 'triangle', 0.45); } // 회피: 휙
    if (e.type === 'jump') slide(900, 250, 0.6, 'triangle', 0.6); // 뛰어내림
    if (e.type === 'chute') { gunshot({ filter: 1800, q: 0.6, decay: 0.25, thump: 0, volume: 0.8 }); slide(300, 180, 0.4, 'sine', 0.5); } // 낙하산 펴짐(펄럭)
    if (e.type === 'swap' && !playRecorded('swap')) { tone(1200, 0.03, 'square'); tone(900, 0.04, 'square', 0.05); } // 철컥
    if (e.type === 'hit' && e.weapon === 'dagger') { if (!playRecorded('knife-slash')) tone(880, 0.07, 'square'); } // 써걱
    else if (e.type === 'hit') tone(880, 0.07, 'square');
    if (e.type === 'block') tone(300, 0.05, 'triangle');
    if (e.type === 'bounce') tone(1500, 0.04, 'sine'); // 에너지 볼트 튕김: 띵
    if (e.type === 'explode') { gunshot({ filter: 250, q: 0.4, decay: 0.6, thump: 90, volume: 1.4 }); tone(60, 0.4, 'square', 0.05); }
    if (e.type === 'explode' && e.energy) [1800, 2600, 1400, 3000].forEach((f, i) => tone(f, 0.05, 'sawtooth', 0.05 + i * 0.06)); // 전기 지지직
    if (e.type === 'field') { gunshot({ filter: 3200, q: 2, decay: 0.6, thump: 0, volume: 0.8 }); [2200, 3100, 1700].forEach((f, i) => tone(f, 0.05, 'sawtooth', i * 0.08)); }
    if (e.type === 'stun') [2400, 1200, 2800, 900].forEach((f, i) => tone(f, 0.06, 'square', i * 0.07)); // 감전·마비: 찌릿찌릿
    if (e.type === 'pad') slide(200, 1400, 0.45, 'sine', 0.9); // 점프 패드: 뿅
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
    if (e.type === 'turret-fire' && !playRecorded('shot-turret')) gunshot({ filter: 500, q: 0.6, decay: 0.3, thump: 110, volume: 1 });
    if (e.type === 'rumble') { gunshot({ filter: 120, q: 0.3, decay: 1.2, thump: 45, volume: 1.6 }); tone(40, 0.9, 'square', 0.05); }
    if (e.type === 'ceiling-break') { gunshot({ filter: 350, q: 0.4, decay: 0.9, thump: 70, volume: 1.8 }); tone(120, 0.3, 'sawtooth', 0.05); }
    if (e.type === 'jump') tone(320, 0.06, 'triangle'); // 점프: 휙
    if (e.type === 'jump-land') tone(110, 0.07, 'triangle'); // 착지: 툭
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
