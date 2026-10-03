import { ARENA_WIDTH, RAIL_Y, MIN_X, MAX_X, PRIMARY_IDS, SECONDARY_IDS } from './config.js';
import { SLOTS, createPlayer, createInput, createMatchWith, addStats, createRng } from './state.js';
import { createAI, AI_CHARACTERS, DIFFICULTY } from './ai.js';

/**
 * 스토리 모드(싱글 플레이). 플레이어(P1, 지구방위팀) 혼자 ISB팀 요원들을 웨이브마다 상대한다.
 * 1웨이브: 요원 1명(돌격소총) → 2웨이브: 헬리콥터에서 요원 2명 → 3웨이브: 헬리콥터에서 요원 3명
 * → 보스전: 전투기가 헬리콥터를 격추하고, 건쉽에서 스미스 요원(권총 + 보조무기 + 수류탄)이 내려온다. 스미스 요원을 쓰러뜨리면 승리.
 * 2·3웨이브 요원의 주무기는 RPG·저격총·아킴보 석궁을 뺀 주무기 중 무작위. 스미스 요원 말고는 보조무기·수류탄을 쓰지 않는다.
 * 웨이브별 요원 체력·난이도·피해·탄속·이동 속도·히트박스는 스토리 설정(밸런스 칸)에서 바꾼다.
 */
export const STORY_WEAPONS = PRIMARY_IDS.filter((id) => !['rpg', 'sniper', 'crossbow'].includes(id));
export const BOSS_NAME = '스미스 요원';

/** 웨이브 구성. from: 'start'(경기 시작부터 서 있음)·'heli'(헬리콥터)·'gunship'(건쉽). weapon 'random'은 STORY_WEAPONS 중 무작위. */
export const WAVES = [
  { title: '1웨이브', count: 1, weapon: 'rifle', from: 'start' },
  { title: '2웨이브', count: 2, weapon: 'random', from: 'heli' },
  { title: '3웨이브', count: 3, weapon: 'random', from: 'heli' },
  { title: '보스전', count: 1, weapon: 'pistol', from: 'gunship', boss: true },
];

/**
 * 웨이브별 요원 밸런스 기본값. damage·bulletSpeed·speed는 %, radius는 히트박스 반지름.
 * secondary(보스만): 보조무기 id 또는 'random'(경기마다 무작위).
 */
export function defaultStory() {
  const agent = (hp) => ({ hp, difficulty: 'normal', damage: 100, bulletSpeed: 100, speed: 100, radius: 30 });
  return { waves: [agent(500), agent(300), agent(200), { ...agent(800), secondary: 'random' }] };
}

/** 저장된 값을 기본값 위에 덮고, 범위·선택지 밖의 값은 기본값으로 되돌린다. */
export function normalizeStory(saved) {
  const story = defaultStory();
  const waves = Array.isArray(saved?.waves) ? saved.waves : [];
  story.waves.forEach((def, i) => {
    const w = waves[i] ?? {};
    for (const key of Object.keys(STORY_FIELDS)) {
      const f = STORY_FIELDS[key];
      const v = Number(w[key]);
      if (w[key] !== undefined && w[key] !== '' && Number.isFinite(v)) def[key] = Math.min(f.max, Math.max(f.min, Math.round(v)));
    }
    if (DIFFICULTY[w.difficulty]) def.difficulty = w.difficulty;
    if ('secondary' in def && (w.secondary === 'random' || SECONDARY_IDS.includes(w.secondary))) def.secondary = w.secondary;
  });
  return story;
}

/** 스토리 설정 화면의 숫자 칸(웨이브마다 같은 칸). */
export const STORY_FIELDS = {
  hp: { label: '체력', min: 1, max: 9999, step: 10, unit: '' },
  damage: { label: '피해', min: 0, max: 1000, step: 10, unit: '%' },
  bulletSpeed: { label: '탄속', min: 25, max: 300, step: 5, unit: '%' },
  speed: { label: '이동 속도', min: 20, max: 300, step: 5, unit: '%' },
  radius: { label: '히트박스 반지름', min: 5, max: 150, step: 1, unit: '' },
};

// 연출 시간·속도
const CLEAR_TIME = 1.6;        // 웨이브 클리어 후 쓰러진 요원을 보여 주는 시간
const BANNER_TIME = 2.4;
const CARRIER_SPEED = 520;     // 헬리콥터·건쉽 비행 속도(초당)
export const CARRIER_Y = 190;  // 헬리콥터가 떠 있는 높이(ISB 레일 아래 하늘)
const DROP_TIME = 1.1;         // 요원 한 명이 줄을 타고 내려오는 시간
const DROP_GAP = 0.45;         // 여러 명이 내려올 때 사이 간격
const DROP_SPREAD = 150;       // 요원끼리 떨어져 내리는 거리
const STRIKE_JET_SPEED = 1100;
const STRIKE_MISSILE_SPEED = 1500;
const FALL_TIME = 1.4;         // 격추된 헬리콥터가 떨어지는 시간
const GUNSHIP_DELAY = 0.8;     // 격추 뒤 건쉽이 나타나기까지
const OFF = 320;               // 화면 밖 대기 거리

const ISB = SLOTS.find((s) => s.team === 'isb');

/**
 * 스토리 모드 경기. playerPick은 플레이어(P1) 선택, settings는 defaultStory() 모양.
 * 1웨이브 요원은 경기 시작부터 서 있다.
 */
export function createStoryMatch(playerPick, settings = defaultStory(), seed = Date.now()) {
  const player = createPlayer(SLOTS[0], playerPick);
  const match = createMatchWith([player], seed);
  const rng = createRng(seed ^ 0x5eed);
  match.story = {
    wave: 0, phase: 'fight', timer: 0, settings: normalizeStory(settings), rng,
    brains: [], roster: [], nextId: 1,
    carrier: null, jet: null, missile: null,
    banner: banner(WAVES[0].title, waveInfo(0, settings)),
  };
  spawnWave(match, {}, 0); // 입력 칸은 경기를 시작할 때 createInputs(match.players)로 만든다
  return match;
}

/** 웨이브 안내 문구: '요원 2명 · 체력 300' */
export function waveInfo(index, settings) {
  const wave = WAVES[index];
  const hp = normalizeStory(settings).waves[index].hp;
  return wave.boss ? `${BOSS_NAME} · 체력 ${hp}` : `요원 ${wave.count}명 · 체력 ${hp}`;
}

function banner(text, sub = '') {
  return { text, sub, t: 0, duration: BANNER_TIME };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

/** 웨이브 index의 요원들을 만든다. 헬리콥터·건쉽으로 오는 웨이브는 차례로 줄을 타고 내려온다(entering). */
function spawnWave(match, inputs, index) {
  const story = match.story;
  const wave = WAVES[index];
  const cfg = story.settings.waves[index];
  const center = story.carrier?.x ?? ARENA_WIDTH / 2;
  for (let i = 0; i < wave.count; i++) {
    const x = Math.min(MAX_X, Math.max(MIN_X, center + (i - (wave.count - 1) / 2) * DROP_SPREAD));
    const weapon = wave.weapon === 'random' ? pick(story.rng, STORY_WEAPONS) : wave.weapon;
    const id = wave.boss ? 'BOSS' : `E${story.nextId++}`;
    const p = createPlayer({ ...ISB, id }, {
      ai: true, x, weapon,
      // 스미스 요원은 권총을 든 요원 1 그림을 크게 그린다
      characterId: wave.boss ? 'isb-agent-1' : pick(story.rng, AI_CHARACTERS),
      name: wave.boss ? BOSS_NAME : undefined,
      // 스미스 요원만 보조무기·수류탄을 쓴다
      primaryOnly: !wave.boss, boss: !!wave.boss, scale: wave.boss ? 1.2 : undefined,
      secondary: wave.boss ? (cfg.secondary === 'random' ? pick(story.rng, SECONDARY_IDS) : cfg.secondary) : undefined,
      maxHp: cfg.hp, radius: cfg.radius, bulletSpeedScale: cfg.bulletSpeed / 100,
      damageScale: cfg.damage / 100, speedScale: cfg.speed / 100,
    });
    if (wave.from !== 'start') {
      p.entering = { t: -i * DROP_GAP, duration: DROP_TIME, fromY: CARRIER_Y };
      p.y = CARRIER_Y;
    }
    match.players.push(p);
    inputs[id] = createInput(p);
    addStats(match, p);
    story.brains.push(createAI(id, cfg.difficulty, Math.floor(story.rng() * 2 ** 32)));
    story.roster.push(p);
  }
}

/** 남은 웨이브가 있어 ISB팀이 전멸해도 경기를 끝내지 않아야 하는지 */
export function holdsResult(match) {
  return !!match.story && match.story.wave < WAVES.length - 1;
}

const enemies = (match) => match.players.filter((p) => p.team === 'isb');

/** 헬리콥터·건쉽이 오른쪽 화면 밖에서 날아온다. */
function callCarrier(story, kind) {
  story.carrier = { kind, x: ARENA_WIDTH + OFF, y: CARRIER_Y, targetX: ARENA_WIDTH / 2, state: 'in', t: 0, angle: 0 };
  story.phase = 'arrive';
}

function moveCarrier(story, dt) {
  const c = story.carrier;
  if (!c) return;
  c.t += dt;
  if (c.state === 'in') {
    c.x = Math.max(c.targetX, c.x - CARRIER_SPEED * dt);
    if (c.x === c.targetX) c.state = 'hover';
  } else if (c.state === 'out') {
    c.x -= CARRIER_SPEED * dt;
    if (c.x < -OFF) story.carrier = null;
  } else if (c.state === 'down') {
    // 격추: 빙글빙글 돌며 떨어진다
    c.fall += dt;
    c.x += 140 * dt;
    c.y += 90 * dt;
    c.angle += 7 * dt;
    if (c.fall >= FALL_TIME) story.carrier = null;
  }
}

/** 보스전 직전: 전투기가 왼쪽에서 날아와 헬리콥터에 미사일을 쏴 격추한다. */
function moveStrike(story, dt, events) {
  const { jet, missile, carrier } = story;
  if (jet) {
    jet.x += STRIKE_JET_SPEED * dt;
    if (!jet.fired && carrier && jet.x >= carrier.x - 560) {
      jet.fired = true;
      story.missile = { x: jet.x + 70, y: jet.y };
      events.push({ type: 'jet-fire', x: jet.x, y: jet.y });
    }
    if (jet.x > ARENA_WIDTH + OFF) story.jet = null;
  }
  if (missile) {
    missile.x += STRIKE_MISSILE_SPEED * dt;
    if (carrier && carrier.state !== 'down' && missile.x >= carrier.x - 40) {
      story.missile = null;
      carrier.state = 'down';
      carrier.fall = 0;
      events.push({ type: 'explode', x: carrier.x, y: carrier.y, radius: 170 });
      events.push({ type: 'heli-down' });
      story.banner = banner('헬리콥터 격추!', '무언가 다가온다…');
    }
  }
}

/**
 * 고정 틱마다 step()이 부른다(경기 중일 때만). 웨이브 클리어 판정, 헬리콥터·건쉽·전투기 연출, 요원 내려오기를 진행한다.
 * 새 요원의 입력 칸은 inputs에, AI는 match.story.brains에 더한다.
 */
export function updateStory(match, inputs, dt, events) {
  const story = match.story;
  if (story.banner) {
    story.banner.t += dt;
    if (story.banner.t >= story.banner.duration) story.banner = null;
  }
  moveCarrier(story, dt);
  moveStrike(story, dt, events);
  // 줄 타고 내려오기
  for (const p of enemies(match)) {
    const e = p.entering;
    if (!e) continue;
    e.t += dt;
    const k = Math.max(0, Math.min(1, e.t / e.duration));
    p.y = e.fromY + (RAIL_Y[p.team] - e.fromY) * k;
    if (k >= 1) { p.y = RAIL_Y[p.team]; p.entering = null; }
  }
  // 연출 중에는 평소의 전투기가 나오지 않게 미룬다
  if (story.phase !== 'fight') match.jetTimer = Math.max(match.jetTimer, 2);

  const next = story.wave + 1;
  switch (story.phase) {
    case 'fight':
      if (next < WAVES.length && enemies(match).every((p) => !p.alive)) {
        story.phase = 'clear';
        story.timer = 0;
        story.banner = banner(`${WAVES[story.wave].title} 클리어!`, next === WAVES.length - 1 ? '' : '다음 요원들이 온다');
        events.push({ type: 'wave-clear', wave: story.wave });
      }
      break;
    case 'clear':
      story.timer += dt;
      if (story.timer >= CLEAR_TIME) {
        // 쓰러진 요원은 경기장에서 치우고(결과 화면용으로 roster에는 남는다) 다음 웨이브를 부른다
        match.players = match.players.filter((p) => p.team !== 'isb' || p.alive);
        story.brains = story.brains.filter((b) => match.players.some((p) => p.id === b.playerId));
        callCarrier(story, 'heli');
        if (WAVES[next].boss) story.banner = banner('경고!', '헬리콥터 접근 중');
      }
      break;
    case 'arrive':
      if (story.carrier?.state !== 'hover') break;
      if (WAVES[next].from === 'gunship' && story.carrier.kind === 'heli') {
        // 보스전: 전투기가 헬리콥터를 격추한다
        story.phase = 'strike';
        story.timer = 0;
        story.jet = { x: -OFF, y: CARRIER_Y, dir: 1, fired: false };
        story.banner = banner('전투기 출현!');
        break;
      }
      story.phase = 'drop';
      story.wave = next;
      story.banner = banner(WAVES[next].title, waveInfo(next, story.settings));
      spawnWave(match, inputs, next);
      events.push({ type: 'wave', wave: next, title: WAVES[next].title });
      break;
    case 'strike':
      if (story.carrier) break;
      story.timer += dt;
      if (story.timer >= GUNSHIP_DELAY) {
        callCarrier(story, 'gunship');
        story.banner = banner('건쉽 접근!', BOSS_NAME);
      }
      break;
    case 'drop':
      if (enemies(match).some((p) => p.entering)) break;
      story.phase = 'fight';
      if (story.carrier) story.carrier.state = 'out';
      break;
    default:
      break;
  }
}
