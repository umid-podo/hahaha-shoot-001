// 전투 배경음악: 파일 없이 Web Audio로 합성하는 신나는 배틀 음악(150 BPM, Am–F–C–G 반복).
// 매 화면 프레임 updateMusic(playing)을 부르면 조금 앞(LOOKAHEAD)까지 음을 예약한다.

const BPM = 150;
const STEP = 60 / BPM / 4;      // 16분음표 길이(초)
const LOOKAHEAD = 0.25;
const MUSIC_GAIN = 0.55;        // 음악 전체 크기(효과음 기준 GAIN과 곱해지는 상대값)
const DUCK_GAIN = 0.18;         // 경고음이 울리는 동안 음악 크기 비율
const BASE = 0.08;

// 코드 진행(마디마다): 근음 MIDI 번호와 장·단조
const CHORDS = [[57, 'minor'], [53, 'major'], [48, 'major'], [55, 'major']];
const TONES = { minor: [0, 3, 7, 12], major: [0, 4, 7, 12] };
// 리드 아르페지오: 코드 음 번호(16분음표마다), 마디 후반은 한 옥타브 위로 끌어올린다
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 3, 2, 3, 2, 1, 2];
// 베이스: 8분음표마다 근음·옥타브 번갈아(통통 튀는 느낌)
const BASS = [0, null, 12, null, 0, null, 12, 0, 0, null, 12, null, 0, 12, 0, 12];

const midi = (m) => 440 * 2 ** ((m - 69) / 12);

let ctx = null;
let master = null;
let noise = null;
let muted = false;
let playing = false;
let step = 0;
let nextTime = 0;
let duckUntil = 0;

function noiseBuffer() {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

function setup(audioCtx) {
  if (ctx === audioCtx) return;
  ctx = audioCtx;
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
}

function voice(type, freq, start, duration, volume, filter) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(BASE * volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);
  let node = osc;
  if (filter) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filter;
    node = osc.connect(lp);
  }
  node.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function kick(start) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(150, start);
  osc.frequency.exponentialRampToValueAtTime(45, start + 0.12);
  gain.gain.setValueAtTime(BASE * 3.2, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + 0.2);
}

function hiss(start, duration, freq, type, volume) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(BASE * volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  src.connect(filter).connect(gain).connect(master);
  src.start(start, Math.random() * 0.5);
  src.stop(start + duration);
}

/** 16분음표 한 칸(s: 0~63, 4마디)의 드럼·베이스·리드 */
function schedule(s, t) {
  const pos = s % 16;
  const [root, quality] = CHORDS[Math.floor(s / 16) % CHORDS.length];
  const tones = TONES[quality];
  if (pos % 4 === 0) kick(t);
  if (pos === 4 || pos === 12) hiss(t, 0.14, 1800, 'bandpass', 2.2);            // 스네어
  if (pos === 15 && Math.floor(s / 16) % 2 === 1) hiss(t, 0.08, 1800, 'bandpass', 1.4); // 필인
  hiss(t, pos % 2 ? 0.03 : 0.05, 7000, 'highpass', pos % 2 ? 0.5 : 0.9);        // 하이햇
  const b = BASS[pos];
  if (b !== null) voice('sawtooth', midi(root - 24 + b), t, STEP * 1.8, 1.6, 600);
  const lift = pos >= 8 && Math.floor(s / 16) % 2 === 1 ? 12 : 0;
  voice('square', midi(root + 12 + lift + tones[ARP[pos]]), t, STEP * 0.9, 0.45, 2600);
  // 마디 첫 박에 코드 받침(두꺼운 톱니파)
  if (pos === 0) for (const tone of tones.slice(0, 3)) voice('sawtooth', midi(root + tone), t, STEP * 14, 0.28, 1200);
}

function targetGain() {
  if (!playing || muted) return 0;
  return MUSIC_GAIN * (ctx.currentTime < duckUntil ? DUCK_GAIN : 1);
}

/** 새 경기: 음악을 처음부터 */
export function restartMusic() {
  step = 0;
  nextTime = 0;
  duckUntil = 0;
}

/**
 * 매 프레임 호출. audioCtx는 효과음과 같은 AudioContext(없으면 아무 일 없음).
 * on이 참이면(경기 중·카운트다운·컷씬) 음을 예약하고, 거짓이면(일시정지·결과·메뉴) 부드럽게 줄인다.
 */
export function updateMusic(audioCtx, on) {
  if (!audioCtx) return;
  setup(audioCtx);
  const now = ctx.currentTime;
  const wasPlaying = playing;
  playing = on && !muted;
  master.gain.setTargetAtTime(targetGain(), now, playing ? 0.12 : 0.25);
  if (!playing) return;
  if (!wasPlaying || nextTime < now) nextTime = now + 0.05; // 다시 켜질 때 밀린 음은 건너뛴다
  while (nextTime < now + LOOKAHEAD) {
    schedule(step, nextTime);
    step = (step + 1) % (CHORDS.length * 16);
    nextTime += STEP;
  }
}

/** 경고음이 울리는 동안 seconds초 음악을 작게 */
export function duckMusic(seconds) {
  if (!ctx) return;
  duckUntil = Math.max(duckUntil, ctx.currentTime + seconds);
  master.gain.setTargetAtTime(targetGain(), ctx.currentTime, 0.08);
}

export function setMusicMuted(value) {
  muted = value;
}
