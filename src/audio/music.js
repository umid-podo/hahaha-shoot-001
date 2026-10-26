// 배경음악: 파일 없이 Web Audio로 합성한다. 매 화면 프레임 updateMusic(playing, song)을 부르면 조금 앞(LOOKAHEAD)까지 음을 예약한다.
// 곡(SONGS): 평소 배틀 음악 + 스토리 장면 음악 4곡(보스전·윌슨 요원 보스전·공중전·데스스타 보스전). 모두 이 게임을 위해 새로 지은 곡이다.
// 곡이 바뀌면 새 곡을 처음부터 튼다.

const LOOKAHEAD = 0.25;
const MUSIC_GAIN = 0.55;        // 음악 전체 크기(효과음 기준 GAIN과 곱해지는 상대값)
const DUCK_GAIN = 0.18;         // 경고음이 울리는 동안 음악 크기 비율
const BASE = 0.08;

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C#5'·'Bb4' 같은 음 이름 → MIDI 번호 */
function noteNum(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
/**
 * 한 마디 악보(16분음표 16칸, 띄어쓰기로 구분): 음 이름이면 그 칸에서 시작, '-'면 앞 음을 이어 끌고, '.'는 쉼.
 * → 칸마다 { note, steps }(그 칸에서 시작하는 음과 길이) 또는 null
 */
function bar(text) {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length !== 16) throw new Error(`한 마디는 16칸: ${text}`);
  return tokens.map((tok, i) => {
    if (tok === '.' || tok === '-') return null;
    let steps = 1;
    while (tokens[i + steps] === '-') steps++;
    return { note: noteNum(tok), steps };
  });
}
/** 드럼 줄: 'x'인 칸에서 친다 */
const hits = (text) => [...text.replace(/\s+/g, '')].map((c) => c === 'x');

let ctx = null;
let master = null;
let drive = null;   // 찌그러뜨린 기타(윌슨 요원 곡)용 출력
let noise = null;
let muted = false;
let playing = false;
let song = 'battle';
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
  // 디스토션: 소리를 세게 눌러 찌그러뜨린 뒤 높은 잡음을 깎는다
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 6);
  }
  shaper.curve = curve;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3200;
  const level = ctx.createGain();
  level.gain.value = 0.28;
  shaper.connect(tone).connect(level).connect(master);
  drive = shaper;
}

/** 음 하나. opts: filter(저역 통과 Hz), attack(초), dest(출력), detune(센트, 두 겹으로 두껍게) */
function voice(type, freq, start, duration, volume, filter, opts = {}) {
  const gain = ctx.createGain();
  const attack = opts.attack ?? 0;
  if (attack) {
    gain.gain.setValueAtTime(0.0005, start);
    gain.gain.linearRampToValueAtTime(BASE * volume, start + attack);
  } else {
    gain.gain.setValueAtTime(BASE * volume, start);
  }
  gain.gain.exponentialRampToValueAtTime(0.0005, start + Math.max(duration, attack + 0.02));
  let out = gain;
  if (filter) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filter;
    gain.connect(lp);
    out = lp;
  }
  out.connect(opts.dest ?? master);
  for (const cents of opts.detune ? [-opts.detune, opts.detune] : [0]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = cents;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }
}

function kick(start, volume = 3.2) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(150, start);
  osc.frequency.exponentialRampToValueAtTime(45, start + 0.12);
  gain.gain.setValueAtTime(BASE * volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + 0.2);
}

/** 봉고·탐: 짧게 떨어지는 사인파 */
function tom(start, freq, volume = 1.6) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, start + 0.15);
  gain.gain.setValueAtTime(BASE * volume, start);
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

const snare = (t, v = 2.2) => hiss(t, 0.14, 1800, 'bandpass', v);
const hat = (t, open = false, v = 0.8) => hiss(t, open ? 0.12 : 0.04, 7000, 'highpass', v);
const crash = (t) => hiss(t, 0.9, 5000, 'highpass', 1.4);

/** 마디 악보 줄을 칸마다 연주: play(note, 시각, 길이(초)) */
function playLine(line, s, t, stepLen, play) {
  const cell = line[Math.floor(s / 16) % line.length][s % 16];
  if (cell) play(cell.note, t, cell.steps * stepLen);
}

/* ───────── 곡 ───────── */

const TONES = { minor: [0, 3, 7, 12], major: [0, 4, 7, 12] };

/** 평소 배틀 음악: 150 BPM, Am–F–C–G 반복. 통통 튀는 베이스와 아르페지오. */
const BATTLE = (() => {
  const CHORDS = [[57, 'minor'], [53, 'major'], [48, 'major'], [55, 'major']];
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 3, 2, 3, 2, 1, 2];
  const BASS = [0, null, 12, null, 0, null, 12, 0, 0, null, 12, null, 0, 12, 0, 12];
  return {
    bpm: 150, bars: 4,
    schedule(s, t, len) {
      const pos = s % 16;
      const [root, quality] = CHORDS[Math.floor(s / 16) % CHORDS.length];
      const tones = TONES[quality];
      if (pos % 4 === 0) kick(t);
      if (pos === 4 || pos === 12) snare(t);
      if (pos === 15 && Math.floor(s / 16) % 2 === 1) hiss(t, 0.08, 1800, 'bandpass', 1.4); // 필인
      hat(t, false, pos % 2 ? 0.5 : 0.9);
      const b = BASS[pos];
      if (b !== null) voice('sawtooth', midi(root - 24 + b), t, len * 1.8, 1.6, 600);
      const lift = pos >= 8 && Math.floor(s / 16) % 2 === 1 ? 12 : 0;
      voice('square', midi(root + 12 + lift + tones[ARP[pos]]), t, len * 0.9, 0.45, 2600);
      // 마디 첫 박에 코드 받침(두꺼운 톱니파)
      if (pos === 0) for (const tone of tones.slice(0, 3)) voice('sawtooth', midi(root + tone), t, len * 14, 0.28, 1200);
    },
  };
})();

/**
 * 보스전(스미스 요원·R-10·존슨 요원): '잉크 파티' — 138 BPM, D단조. 통통 튀는 펑키 베이스, 짧게 끊는 사각파 멜로디가
 * 묻고 답하듯 오가고, 마디 끝마다 "헤이!" 같은 외침 소리. 신나고 장난스러운 전자 힙합 느낌.
 */
const BOSS = (() => {
  const ROOTS = ['D2', 'D2', 'Bb1', 'C2', 'D2', 'D2', 'G1', 'A1'].map(noteNum);
  const QUALITY = ['minor', 'minor', 'major', 'major', 'minor', 'minor', 'minor', 'major'];
  const BASS = [0, null, 12, null, null, 0, null, 10, null, 0, null, 12, 10, null, 7, null];
  const LEAD = [
    'D5 . . D5 . F5 . D5 . . A4 . C5 . D5 .',
    'F5 . E5 . D5 . C5 . D5 - - - . . . .',
    'D5 . . D5 . F5 . G5 . . F5 . D5 . C5 .',
    'E5 . . E5 . G5 . E5 C5 - - - . . . .',
    'A5 . A5 . G5 . F5 . G5 . A5 . . . D5 .',
    'F5 . E5 . D5 . E5 . F5 - - - . . . .',
    'G5 . . G5 . Bb5 . A5 . G5 . F5 . D5 . .',
    'E5 . C#5 . E5 . A5 . A5 - - - - . . .',
  ].map(bar);
  const KICK = hits('x..x..x...x..x..');
  return {
    bpm: 138, bars: 8,
    schedule(s, t, len) {
      const pos = s % 16, b = Math.floor(s / 16) % 8;
      const root = ROOTS[b];
      if (KICK[pos]) kick(t);
      if (pos === 4 || pos === 12) { snare(t); hiss(t, 0.06, 1200, 'bandpass', 1.4); } // 스네어 + 손뼉
      if (pos % 2 === 0) hat(t, pos === 6 || pos === 14, 0.7);
      const off = BASS[pos];
      if (off !== null) voice('square', midi(root + off), t, len * 1.6, 1.3, 700);
      playLine(LEAD, s, t, len, (n, at, dur) => voice('square', midi(n), at, Math.min(dur, len * 3), 0.6, 3200));
      // 화음 받침: 박자 뒤(엇박)에 짧게 끊는 코드
      if (pos === 2 || pos === 10) for (const tone of TONES[QUALITY[b]].slice(0, 3)) voice('triangle', midi(root + 24 + tone), t, len * 1.2, 0.5);
      // "헤이!" 외침: 짝수 마디 끝
      if (b % 2 === 1 && pos === 14) {
        hiss(t, 0.12, 900, 'bandpass', 2.4);
        voice('sawtooth', midi(root + 31), t, len * 1.5, 0.5, 1500);
      }
    },
  };
})();

/**
 * 윌슨 요원 보스전: '네 개의 바퀴' — 172 BPM, E단조 스래시 메탈. 찌그러뜨린 기타 파워코드로 짧게 끊어 치는 리프(팜 뮤트),
 * 뒤 네 마디는 위에서 기타 솔로, 투베이스 북과 마디 첫 박의 심벌.
 */
const WILSON = (() => {
  const RIFF = [
    'E2 . E2 E2 . E2 E2 . F2 - . E2 . E2 G2 .',
    'E2 . E2 E2 . E2 E2 . A2 - G2 - F2 - E2 .',
    'E2 . E2 E2 . E2 E2 . F2 - . E2 . E2 G2 .',
    'E2 . E2 E2 . E2 E2 . Bb2 - - - A2 - - -',
    'G2 - - - . G2 G2 . A2 - - - . A2 A2 .',
    'B2 - - - . B2 B2 . C3 - - - B2 - A2 -',
    'E2 . E2 E2 . E2 E2 . F2 - . E2 . E2 G2 .',
    'E2 E2 E2 E2 E2 E2 E2 E2 F2 - - - E2 - - -',
  ].map(bar);
  const SOLO = [
    '. . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . .',
    'B4 - - - D5 - E5 - G5 - - - F#5 - E5 -',
    'D5 - - - E5 - - - B4 - - - A4 - G4 -',
    'E5 - G5 - A5 - B5 - C6 - B5 - A5 - G5 -',
    'F#5 - - - - - - - E5 - - - - - - -',
  ].map(bar);
  return {
    bpm: 172, bars: 8,
    schedule(s, t, len) {
      const pos = s % 16, b = Math.floor(s / 16) % 8;
      // 투베이스: 8분음표마다, 마지막 마디는 16분음표로 몰아친다
      if (pos % 2 === 0 || b === 7) kick(t, 2.6);
      if (pos === 4 || pos === 12) snare(t, 2.6);
      if (pos === 0 && (b === 0 || b === 4)) crash(t);
      else if (pos % 2 === 0) hiss(t, 0.05, 6000, 'highpass', 0.6); // 라이드
      // 파워코드(근음 + 5도 + 옥타브)를 찌그러뜨려 짧게(팜 뮤트) 또는 길게
      playLine(RIFF, s, t, len, (n, at, dur) => {
        const short = dur <= len;
        for (const iv of [0, 7, 12]) voice('sawtooth', midi(n + iv), at, short ? len * 0.8 : dur, short ? 1.4 : 1.1, short ? 900 : 2400, { dest: drive });
        voice('sawtooth', midi(n - 12), at, dur, 1.2, 300); // 베이스 기타
      });
      playLine(SOLO, s, t, len, (n, at, dur) => voice('sawtooth', midi(n), at, dur, 0.9, 4000, { dest: drive, detune: 8 }));
    },
  };
})();

/**
 * 공중전(3스테이지 하늘): '정글 위를 달려라' — 156 BPM, F장조. 밝게 통통 튀는 멜로디, 엇박 코드, 슬랩 베이스와 봉고.
 * 구름 위를 신나게 날아가는 액션 게임 스테이지 곡 느낌.
 */
const SKY_SONG = (() => {
  const CHORDS = [['F2', [0, 4, 7, 11]], ['E2', [0, 3, 7, 10]], ['D2', [0, 3, 7, 10]], ['C2', [0, 4, 7, 11]],
    ['Bb1', [0, 4, 7, 11]], ['A1', [0, 3, 7, 10]], ['G1', [0, 3, 7, 10]], ['C2', [0, 4, 7, 10]]].map(([r, iv]) => [noteNum(r), iv]);
  const BASS = [0, null, null, 12, null, 0, null, 7, 0, null, 12, null, 10, 12, null, 7];
  const LEAD = [
    'A5 . C6 . . A5 G5 . F5 . G5 . A5 - - .',
    'G5 . . E5 . D5 E5 . G5 - - . . . . .',
    'F5 . A5 . . F5 E5 . D5 . E5 . F5 - - .',
    'E5 . G5 . C6 - - . B5 . G5 . E5 . . .',
    'D6 . . D6 . C6 . A5 . . F5 . A5 - - .',
    'C6 . . C6 . A5 . G5 . . E5 . G5 - - .',
    'Bb5 . A5 . G5 . A5 . Bb5 . C6 . D6 - - .',
    'C6 - - - E6 - - - C6 . . . . . . .',
  ].map(bar);
  const BONGO = hits('..x.x..x..x.xx.x');
  return {
    bpm: 156, bars: 8,
    schedule(s, t, len) {
      const pos = s % 16, b = Math.floor(s / 16) % 8;
      const [root, iv] = CHORDS[b];
      if (pos === 0 || pos === 6 || pos === 10) kick(t, 2.6);
      if (pos === 4 || pos === 12) snare(t, 1.8);
      hat(t, false, pos % 2 ? 0.4 : 0.7);
      if (BONGO[pos]) tom(t, pos % 3 ? 420 : 300, 1.2);
      const off = BASS[pos];
      if (off !== null) {
        voice('sawtooth', midi(root + off), t, len * 1.4, 1.4, pos % 4 === 3 ? 1400 : 700); // 슬랩: 엇박은 밝게
      }
      playLine(LEAD, s, t, len, (n, at, dur) => {
        voice('square', midi(n), at, dur, 0.45, 3600);
        voice('triangle', midi(n + 12), at, Math.min(dur, len * 2), 0.35); // 반짝이는 옥타브 위
      });
      // 엇박 코드(전자 피아노 느낌)
      if (pos % 4 === 2) for (const tone of iv) voice('triangle', midi(root + 24 + tone), t, len * 1.5, 0.4, 2400);
      if (b === 7 && pos >= 12) tom(t, 200 + (pos - 12) * 60, 1.6); // 마지막 마디 필인
    },
  };
})();

/**
 * 데스스타 보스전: '하늘의 요새' — 168 BPM, C단조. 몰아치는 옥타브 베이스와 빠른 아르페지오 위로 금관(톱니파) 멜로디,
 * 마디 첫 박의 오케스트라 히트. 긴박한 최종 보스 느낌.
 */
const DEATHSTAR_SONG = (() => {
  const CHORDS = [['C2', 'minor'], ['C2', 'minor'], ['Ab1', 'major'], ['Bb1', 'major'],
    ['C2', 'minor'], ['C2', 'minor'], ['Db2', 'major'], ['G1', 'major']].map(([r, q]) => [noteNum(r), q]);
  const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 3, 1, 2, 3, 2];
  const BRASS = [
    'C5 - - - - - G4 - C5 - D5 - Eb5 - - -',
    'D5 - - - C5 - - - Bb4 - - - G4 - - -',
    'Ab4 - - - C5 - - - Eb5 - - - Ab5 - - -',
    'G5 - - - F5 - - - D5 - - - Bb4 - - -',
    'C6 - - - Bb5 - - - G5 - - - Eb5 - - -',
    'F5 - - - Eb5 - - - D5 - - - C5 - - -',
    'Db5 - - - F5 - - - Ab5 - - - Db6 - - -',
    'B5 - - - D6 - - - G5 - - - F5 - D5 -',
  ].map(bar);
  return {
    bpm: 168, bars: 8,
    schedule(s, t, len) {
      const pos = s % 16, b = Math.floor(s / 16) % 8;
      const [root, quality] = CHORDS[b];
      const tones = TONES[quality];
      if (pos % 4 === 0) kick(t, 3);
      if (pos === 4 || pos === 12) snare(t, 2.4);
      hat(t, false, pos % 2 ? 0.45 : 0.8);
      if (b === 7 && pos >= 8 && pos % 2 === 0) tom(t, 260 - (pos - 8) * 18, 2); // 내려가는 탐 필인
      // 오케스트라 히트: 1·5마디 첫 박
      if (pos === 0 && (b === 0 || b === 4)) {
        crash(t);
        for (const tone of tones.slice(0, 3)) voice('sawtooth', midi(root + 12 + tone), t, len * 6, 0.9, 1800, { detune: 10 });
      }
      voice('sawtooth', midi(root + (pos % 2 ? 12 : 0)), t, len * 0.9, 1.5, 650); // 옥타브 베이스
      voice('square', midi(root + 36 + tones[ARP[pos]]), t, len * 0.8, 0.3, 2200);
      playLine(BRASS, s, t, len, (n, at, dur) => voice('sawtooth', midi(n), at, dur, 0.75, 2000, { attack: 0.03, detune: 7 }));
    },
  };
})();

const SONGS = { battle: BATTLE, boss: BOSS, wilson: WILSON, sky: SKY_SONG, deathstar: DEATHSTAR_SONG };
export const SONG_IDS = Object.keys(SONGS);

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
 * id는 틀 곡(SONGS의 키, 기본 'battle'). 곡이 바뀌면 새 곡을 처음부터 튼다.
 */
export function updateMusic(audioCtx, on, id = 'battle') {
  if (!audioCtx) return;
  setup(audioCtx);
  const now = ctx.currentTime;
  if (id !== song && SONGS[id]) {
    song = id;
    step = 0;
    nextTime = now + 0.05;
  }
  const wasPlaying = playing;
  playing = on && !muted;
  master.gain.setTargetAtTime(targetGain(), now, playing ? 0.12 : 0.25);
  if (!playing) return;
  if (!wasPlaying || nextTime < now) nextTime = now + 0.05; // 다시 켜질 때 밀린 음은 건너뛴다
  const tune = SONGS[song];
  const len = 60 / tune.bpm / 4; // 16분음표 길이(초)
  while (nextTime < now + LOOKAHEAD) {
    tune.schedule(step, nextTime, len);
    step = (step + 1) % (tune.bars * 16);
    nextTime += len;
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
