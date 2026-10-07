import {
  ARENA_WIDTH, RAIL_Y, MIN_X, MAX_X, PRIMARY_IDS, SECONDARY_IDS, MUZZLE_OFFSET, COUNTDOWN, TURRET, TURRETS,
} from './config.js';
import { SLOTS, createPlayer, createInput, createMatchWith, addStats, createRng, createCovers } from './state.js';
import { createAI, AI_CHARACTERS, DIFFICULTY } from './ai.js';

/**
 * 스토리 모드(싱글 플레이). 플레이어(P1, 지구방위팀) 혼자 ISB팀 요원들을 웨이브마다 상대한다. 스테이지는 두 개다.
 * 1스테이지 옥상: 1웨이브 요원 1명(돌격소총) → 2웨이브 헬리콥터에서 요원 2명 → 3웨이브 요원 3명
 *   → 중간보스: 전투기가 헬리콥터를 격추하고, 건쉽에서 스미스 요원(권총 + 보조무기 + 수류탄)이 내려온다.
 *   스미스 요원을 쓰러뜨리면 엔딩 컷씬(발차기로 건물 밖으로) 뒤 다음 스테이지로. 스테이지를 깰 때마다 체력 100% 회복.
 * 2스테이지 복도: 엘리베이터에서 요원이 나온다. 1웨이브 보통 요원 1명(무작위 무기) → 2웨이브 쉬움 돌격소총 + 보통 돌격소총
 *   → 3웨이브 쉬움 요원 4명(쌍권총·권총·권총·돌격소총) → 보스전: 천장을 부수고 R-10(레이저 캐논, 체력 600)이 나온다.
 *   R-10을 쓰러뜨리면 RPG 엔딩 컷씬 뒤 승리. 복도에는 전투기 대신 벽 포탑 2개가 플레이어를 쏜다(config.js TURRET).
 * 일반 요원의 무작위 주무기는 RPG·저격총·아킴보 석궁을 뺀 주무기 중 하나. 스미스 요원 말고는 보조무기·수류탄을 쓰지 않는다.
 * 웨이브별 요원 체력·난이도·피해·탄속·이동 속도·히트박스와 요원마다의 주무기(R-10 빼고)는 스토리 설정(밸런스 칸)에서 바꾼다.
 * 2인 협동: P2도 지구방위팀으로 함께 싸운다(COOP_SLOT). 둘 다 쓰러지면 패배, 한 명이라도 서 있으면 계속한다.
 *   쓰러진 동료는 스테이지를 깰 때 체력 가득으로 다시 일어난다. 요원·포탑은 가까운 쪽 주인공을 노린다.
 */
export const STORY_WEAPONS = PRIMARY_IDS.filter((id) => !['rpg', 'sniper', 'crossbow'].includes(id));
export const BOSS_NAME = '스미스 요원';
export const R10_NAME = 'R-10';

export const STAGES = {
  rooftop: { num: 1, name: '옥상' },
  corridor: { num: 2, name: '복도' },
};

/**
 * 웨이브 구성. from: 'start'(경기 시작부터 서 있음)·'heli'(헬리콥터)·'gunship'(건쉽)·'elevator'(엘리베이터)·'ceiling'(천장을 부수고).
 * weapon 'random'은 STORY_WEAPONS 중 무작위. agents가 있으면 요원마다 { weapon, difficulty }(difficulty는 설정이 '기획대로'일 때).
 * boss: 'smith'(중간보스)·'r10'(마지막 보스). end: 웨이브 마지막 요원을 쓰러뜨렸을 때의 장면(killcamShots).
 * killLine: 그 웨이브의 마지막이 아닌 요원을 쓰러뜨렸을 때 나오는 한마디(없으면 LAST_WORDS 중 무작위).
 */
export const WAVES = [
  { stage: 'rooftop', title: '1웨이브', count: 1, weapon: 'rifle', from: 'start', end: 'radio' },
  { stage: 'rooftop', title: '2웨이브', count: 2, weapon: 'random', from: 'heli', end: 'hero' },
  { stage: 'rooftop', title: '3웨이브', count: 3, weapon: 'random', from: 'heli', end: 'smith' },
  { stage: 'rooftop', title: '중간보스', count: 1, weapon: 'pistol', from: 'gunship', boss: 'smith' },
  { stage: 'corridor', title: '1웨이브', count: 1, weapon: 'random', from: 'elevator', end: 'corridor-call' },
  {
    stage: 'corridor', title: '2웨이브', from: 'elevator', end: 'eikk', killLine: '나 이제 승급인데!!!',
    agents: [{ weapon: 'rifle', difficulty: 'easy' }, { weapon: 'rifle', difficulty: 'normal' }],
  },
  {
    stage: 'corridor', title: '3웨이브', from: 'elevator', end: 'rumble',
    agents: ['dual', 'pistol', 'pistol', 'rifle'].map((weapon) => ({ weapon })),
  },
  { stage: 'corridor', title: '보스전', count: 1, from: 'ceiling', boss: 'r10' },
].map((w) => ({ ...w, count: w.agents?.length ?? w.count }));

/** '복도 2웨이브' */
export const waveLabel = (i) => `${STAGES[WAVES[i].stage].name} ${WAVES[i].title}`;
/** 스테이지 안에서 몇 번째 웨이브인지 { n, total } */
export function stageProgress(i) {
  const list = WAVES.filter((w) => w.stage === WAVES[i].stage);
  return { n: list.indexOf(WAVES[i]) + 1, total: list.length };
}
/** 화면에 보여 줄 웨이브: 싸우는 중이면 그 웨이브, 웨이브 사이(클리어·등장 연출)면 다음에 올 웨이브 */
export function currentWave(story) {
  return ['fight', 'drop'].includes(story.phase) ? story.wave : Math.min(story.wave + 1, WAVES.length - 1);
}

/** 요원 주무기로 고를 수 있는 값: 'random'(STORY_WEAPONS 중 무작위) 또는 주무기 id */
export const AGENT_WEAPON_CHOICES = ['random', ...PRIMARY_IDS];
/** 웨이브 i 요원들의 기획 무기(요원마다 'random' 또는 주무기 id). R-10은 레이저 캐논 전용이라 없음([]). */
export const defaultWeapons = (i) => (WAVES[i].boss === 'r10' ? []
  : Array.from({ length: WAVES[i].count }, (_, k) => WAVES[i].agents?.[k]?.weapon ?? WAVES[i].weapon));

/**
 * 웨이브별 요원 밸런스 기본값. damage·bulletSpeed·speed는 %, radius는 히트박스 반지름.
 * difficulty 'mixed'(기획대로)는 요원마다 WAVES의 난이도를 쓴다(복도 2웨이브: 쉬움·보통).
 * secondary(스미스 요원만): 보조무기 id 또는 'random'(경기마다 무작위).
 * weapons: 요원마다의 주무기(AGENT_WEAPON_CHOICES). R-10은 빈 목록.
 */
export function defaultStory() {
  const agent = (hp, difficulty = 'normal') => ({ hp, difficulty, damage: 100, bulletSpeed: 100, speed: 100, radius: 30 });
  const waves = [
    agent(500), agent(300), agent(200), { ...agent(800), secondary: 'random' },
    agent(500), agent(300, 'mixed'), agent(200, 'easy'), { ...agent(600), radius: 48 },
  ];
  return { waves: waves.map((w, i) => ({ ...w, weapons: defaultWeapons(i) })) };
}

/** 저장된 값을 기본값 위에 덮고, 범위·선택지 밖의 값은 기본값으로 되돌린다. */
export function normalizeStory(saved) {
  const story = defaultStory();
  const waves = Array.isArray(saved?.waves) ? saved.waves : [];
  story.waves.forEach((def, i) => {
    const w = waves[i] ?? {};
    const mixable = def.difficulty === 'mixed';
    for (const key of Object.keys(STORY_FIELDS)) {
      const f = STORY_FIELDS[key];
      const v = Number(w[key]);
      if (w[key] !== undefined && w[key] !== '' && Number.isFinite(v)) def[key] = Math.min(f.max, Math.max(f.min, Math.round(v)));
    }
    if (DIFFICULTY[w.difficulty] || (mixable && w.difficulty === 'mixed')) def.difficulty = w.difficulty;
    if ('secondary' in def && (w.secondary === 'random' || SECONDARY_IDS.includes(w.secondary))) def.secondary = w.secondary;
    if (Array.isArray(w.weapons)) {
      def.weapons = def.weapons.map((d, k) => (AGENT_WEAPON_CHOICES.includes(w.weapons[k]) ? w.weapons[k] : d));
    }
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
// 복도: 엘리베이터(위쪽 벽 가운데)와 천장
export const ELEVATOR = { x: ARENA_WIDTH / 2, y: 34, w: 170 };
const ELEVATOR_OPEN_TIME = 0.6; // 문이 다 열리거나 닫히는 시간
const WALK_TIME = 1.0;          // 엘리베이터에서 걸어 나와 자기 자리까지
const WALK_GAP = 0.35;
export const CEILING_X = ARENA_WIDTH / 2 + 260; // R-10이 천장을 부수고 떨어지는 자리
export const CRACK_TIME = 1.2;  // 천장이 흔들리다 부서지기까지
const LAND_TIME = 0.7;          // R-10이 떨어져 내려앉는 시간
const TURRET_MUZZLE = 44;
const TURRET_SHELL_LIFE = 4;

const ISB = SLOTS.find((s) => s.team === 'isb');
/** 2인 협동의 두 번째 주인공 자리: P2(키보드·두 번째 컨트롤러·오른쪽 조작 패널)지만 지구방위팀이다. 기본은 피자럭스 돌격소총. */
export const COOP_SLOT = { id: 'P2', team: 'earth', characterId: 'earth-pizza', weapon: 'rifle' };
const COOP_GAP = 170; // 2인 협동에서 두 주인공이 서는 간격(가운데에서 양옆으로)

/** 주인공들(1인이면 P1 하나, 2인 협동이면 P1·P2)의 시작 x */
function heroXs(count) {
  return count > 1 ? [ARENA_WIDTH / 2 - COOP_GAP, ARENA_WIDTH / 2 + COOP_GAP] : [ARENA_WIDTH / 2];
}

/**
 * 스토리 모드 경기. playerPick은 플레이어(P1) 선택, settings는 defaultStory() 모양.
 * 1웨이브 요원은 경기 시작부터 서 있다. resume({ wave, hp, hp2 })을 주면 저장한 웨이브가 오는 장면부터 그 체력으로 이어 한다
 * (hp2 0이면 P2는 쓰러진 채로, 다음 스테이지에서 일어난다). partnerPick을 주면 2인 협동: P2가 지구방위팀으로 함께 싸운다.
 */
export function createStoryMatch(playerPick, settings = defaultStory(), seed = Date.now(), resume = null, partnerPick = null) {
  const xs = heroXs(partnerPick ? 2 : 1);
  const player = createPlayer(SLOTS[0], { ...playerPick, x: xs[0] });
  const heroes = partnerPick ? [player, createPlayer(COOP_SLOT, { ...partnerPick, x: xs[1] })] : [player];
  const match = createMatchWith(heroes, seed);
  const rng = createRng(seed ^ 0x5eed);
  const start = Math.min(WAVES.length - 1, Math.max(0, Math.floor(Number(resume?.wave)) || 0));
  match.story = {
    stage: 'rooftop', wave: 0, phase: 'fight', timer: 0, settings: normalizeStory(settings), rng,
    brains: [], roster: [], nextId: 1,
    carrier: null, jet: null, missile: null, elevator: null, ceiling: null, turrets: null,
    banner: banner(waveLabel(0), waveInfo(0, settings)),
    started: start > 0, coop: heroes.length > 1,
  };
  if (resume) {
    // 저장한 체력. 0이면 쓰러진 채로 이어 한다(둘 중 한 명은 서 있다).
    heroes.forEach((p, i) => {
      const hp = Number(i === 0 ? resume.hp : resume.hp2);
      if (!Number.isFinite(hp)) return;
      p.hp = Math.min(p.maxHp, Math.max(0, Math.round(hp)));
      if (p.hp === 0) p.alive = false;
    });
  }
  if (start === 0) {
    spawnWave(match, {}, 0); // 입력 칸은 경기를 시작할 때 createInputs(match.players)로 만든다
    return match;
  }
  // 이어하기: 바로 앞 웨이브를 깬 직후처럼 시작해, 저장한 웨이브의 요원이 오는 장면부터
  if (WAVES[start].stage === 'corridor') setupCorridor(match);
  Object.assign(match.story, { wave: start - 1, phase: 'clear', timer: CLEAR_TIME / 2 });
  match.story.banner = banner('이어하기', `${waveLabel(start)}부터`);
  return match;
}

/** 웨이브 안내 문구: '요원 2명 · 체력 300' */
export function waveInfo(index, settings) {
  const wave = WAVES[index];
  const hp = normalizeStory(settings).waves[index].hp;
  const who = wave.boss === 'smith' ? BOSS_NAME : wave.boss === 'r10' ? R10_NAME : `요원 ${wave.count}명`;
  return `${who} · 체력 ${hp}`;
}

function banner(text, sub = '') {
  return { text, sub, t: 0, duration: BANNER_TIME };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

/** 웨이브 index의 요원들을 만든다. 헬리콥터·건쉽·엘리베이터·천장으로 오는 웨이브는 차례로 들어온다(entering). */
function spawnWave(match, inputs, index) {
  const story = match.story;
  const wave = WAVES[index];
  const cfg = story.settings.waves[index];
  const center = wave.from === 'ceiling' ? CEILING_X : wave.from === 'elevator' ? ELEVATOR.x : story.carrier?.x ?? ARENA_WIDTH / 2;
  for (let i = 0; i < wave.count; i++) {
    const spec = wave.agents?.[i] ?? {};
    const x = Math.min(MAX_X, Math.max(MIN_X, center + (i - (wave.count - 1) / 2) * DROP_SPREAD));
    // 스토리 설정에서 요원마다 고른 주무기(없으면 기획 무기). R-10은 레이저 캐논 고정.
    const kind = cfg.weapons?.[i] ?? spec.weapon ?? wave.weapon;
    const weapon = kind === 'random' ? pick(story.rng, STORY_WEAPONS) : kind;
    const id = wave.boss ? 'BOSS' : `E${story.nextId++}`;
    const smith = wave.boss === 'smith', r10 = wave.boss === 'r10';
    const p = createPlayer({ ...ISB, id }, {
      ai: true, x, weapon,
      // 스미스 요원은 권총을 든 요원 1 그림을 크게, R-10은 드론 그림을 크게 그린다
      characterId: smith ? 'isb-agent-1' : r10 ? 'r10' : pick(story.rng, AI_CHARACTERS),
      name: smith ? BOSS_NAME : r10 ? R10_NAME : undefined,
      // 스미스 요원만 보조무기·수류탄을 쓴다(R-10은 레이저 캐논 전용)
      primaryOnly: !smith, boss: !!wave.boss, scale: smith ? 1.2 : r10 ? 1.6 : undefined,
      secondary: smith ? (cfg.secondary === 'random' ? pick(story.rng, SECONDARY_IDS) : cfg.secondary) : undefined,
      maxHp: cfg.hp, radius: cfg.radius, bulletSpeedScale: cfg.bulletSpeed / 100,
      damageScale: cfg.damage / 100, speedScale: cfg.speed / 100,
    });
    if (wave.from === 'heli' || wave.from === 'gunship') {
      p.entering = { kind: 'rope', t: -i * DROP_GAP, duration: DROP_TIME, fromY: CARRIER_Y };
      p.y = CARRIER_Y;
    } else if (wave.from === 'elevator') {
      // 엘리베이터 안에서 차례로 걸어 나와 자기 자리로
      p.entering = { kind: 'walk', t: -i * WALK_GAP, duration: WALK_TIME, fromX: ELEVATOR.x, fromY: ELEVATOR.y, toX: x };
      p.x = p.previousX = ELEVATOR.x;
      p.y = ELEVATOR.y;
    } else if (wave.from === 'ceiling') {
      // 천장에서 떨어진다: 처음엔 카메라 가까이(크게) 있다가 바닥(레일)에 내려앉는다
      p.entering = { kind: 'fall', t: 0, duration: LAND_TIME };
    }
    match.players.push(p);
    inputs[id] = createInput(p);
    addStats(match, p);
    const difficulty = cfg.difficulty === 'mixed' ? spec.difficulty ?? 'normal' : cfg.difficulty;
    story.brains.push(createAI(id, difficulty, Math.floor(story.rng() * 2 ** 32)));
    story.roster.push(p);
  }
}

/** 남은 웨이브가 있어 ISB팀이 전멸해도 경기를 끝내지 않아야 하는지 */
export function holdsResult(match) {
  return !!match.story && match.story.wave < WAVES.length - 1;
}

const enemies = (match) => match.players.filter((p) => p.team === 'isb');
const heroes = (match) => match.players.filter((p) => p.team === 'earth');
/** 장면에 나올 주인공: 살아 있는 주인공 중 prefer(예: 요원을 쓰러뜨린 쪽)가 있으면 그쪽, 없으면 먼저 오는 쪽 */
function heroOf(match, preferId = null) {
  const list = heroes(match);
  const alive = list.filter((p) => p.alive);
  return alive.find((p) => p.id === preferId) ?? alive[0] ?? list[0];
}
/** victim을 쓰러뜨린 주인공 id(포탑·전투기 등이면 null) */
const killerOf = (match, victim) => match.stats?.[victim.id]?.killedBy?.ownerId ?? null;

/** 복도 스테이지 준비: 엘리베이터·포탑, 새 엄폐물. 전투기는 나오지 않는다. */
function setupCorridor(match) {
  const story = match.story;
  story.stage = 'corridor';
  story.elevator = { open: 0, target: 0 };
  story.turrets = TURRETS.map((t) => ({ ...t, aim: t.dir > 0 ? 0 : Math.PI, fireTimer: 0 }));
  story.turretTimer = TURRET.firstDelay;
  story.turretFiring = false;
  match.covers = createCovers(heroes(match));
  match.jet = null;
  match.jetTimer = Infinity;
}

/**
 * 스테이지 클리어(계단 컷씬 중 화면이 어두워졌을 때): 체력 100% 회복(2인 협동에서 쓰러진 동료도 일어남), 경기장을 복도로 바꾼다.
 * 쓰러진 스미스 요원은 치우고(결과 화면용으로 roster에는 남는다), 컷씬이 끝나면 카운트다운 뒤 복도 1웨이브 요원이 엘리베이터로 온다.
 */
function moveToCorridor(match, events) {
  const story = match.story;
  match.players = match.players.filter((p) => p.team !== 'isb');
  story.brains = [];
  match.projectiles = [];
  const list = heroes(match);
  const xs = heroXs(list.length);
  list.forEach((hero, i) => {
    Object.assign(hero, {
      hp: hero.maxHp, alive: true, hurt: 0, x: xs[i], previousX: xs[i], y: RAIL_Y.earth, dash: null,
      cooldown: 0, cooldowns: {}, burstLeft: 0, grenadeCooldown: 0, heat: 0, overheat: 0, sinceShot: Infinity,
    });
  });
  setupCorridor(match);
  Object.assign(story, { carrier: null, jet: null, missile: null, phase: 'clear', timer: 0 });
  events.push({ type: 'stage', stage: 'corridor' }, ...list.map((hero) => ({ type: 'heal', playerId: hero.id })));
}

/** 헬리콥터·건쉽이 오른쪽 화면 밖에서 날아온다. 요원·보스가 오므로 경고음(배경음악이 작아짐)을 울린다. */
function callCarrier(story, kind, events) {
  events.push({ type: 'alarm', boss: kind === 'gunship' });
  story.carrier = { kind, x: ARENA_WIDTH + OFF, y: CARRIER_Y, targetX: ARENA_WIDTH / 2, state: 'in', t: 0, angle: 0 };
  story.phase = 'arrive';
}

/** 다음 웨이브 요원을 부른다: 헬리콥터, 엘리베이터 문 열기, 또는 천장 흔들기 */
function callNext(story, next, events) {
  const { from, boss } = WAVES[next];
  story.phase = 'arrive';
  if (from === 'elevator') {
    events.push({ type: 'alarm', boss: false }, { type: 'elevator' });
    story.elevator.target = 1;
  } else if (from === 'ceiling') {
    events.push({ type: 'alarm', boss: true }, { type: 'rumble' });
    story.ceiling = { x: CEILING_X, y: RAIL_Y.isb, t: 0 };
    story.banner = banner('경고!', '천장이 무너진다!');
  } else {
    callCarrier(story, 'heli', events);
    if (boss) story.banner = banner('경고!', '헬리콥터 접근 중');
  }
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

/** 엘리베이터 문: open이 target(0 닫힘·1 열림) 쪽으로 움직인다. 천장: 흔들리는 시간을 센다. */
function moveCorridor(story, dt) {
  const e = story.elevator;
  if (e) {
    const step = dt / ELEVATOR_OPEN_TIME;
    e.open = e.target > e.open ? Math.min(e.target, e.open + step) : Math.max(e.target, e.open - step);
  }
  if (story.ceiling) story.ceiling.t += dt;
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

/** 들어오는 중인 요원(줄 타기·엘리베이터에서 걸어 나오기·천장에서 떨어지기)을 움직인다. */
function moveEntering(match, dt, events) {
  for (const p of enemies(match)) {
    const e = p.entering;
    if (!e) continue;
    e.t += dt;
    const k = Math.max(0, Math.min(1, e.t / e.duration));
    const railY = RAIL_Y[p.team];
    if (e.kind === 'walk') {
      // 먼저 엘리베이터 밖으로(아래로) 나온 뒤 옆으로 걸어 자기 자리로
      p.y = e.fromY + (railY - e.fromY) * Math.min(1, k / 0.35);
      const side = Math.max(0, (k - 0.35) / 0.65);
      p.x = e.fromX + (e.toX - e.fromX) * side;
    } else if (e.kind === 'rope') {
      p.y = e.fromY + (railY - e.fromY) * k;
    }
    if (k >= 1) {
      p.y = railY;
      if (e.toX !== undefined) p.x = e.toX;
      p.previousX = p.x;
      p.entering = null;
      if (e.kind === 'fall') events.push({ type: 'land', x: p.x, y: p.y });
    }
  }
}

/** 포탑 t에서 가장 가까운 살아 있는 주인공 */
function turretTarget(match, t) {
  let best = null, dist = Infinity;
  for (const p of heroes(match)) {
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (p.alive && d < dist) { best = p; dist = d; }
  }
  return best;
}

/**
 * 복도 벽 포탑: 웨이브 전투 중에만 돈다. TURRET.burst초 동안 interval마다 살아 있는 플레이어 쪽으로 포탄을 쏘고,
 * TURRET.rest초 쉬었다 다시 쏜다. 쉬는 동안에도 포신은 플레이어를 따라 돈다. 2인 협동이면 포탑마다 가까운 주인공을 노린다.
 */
function updateTurrets(match, dt, events) {
  const story = match.story;
  if (!heroes(match).some((p) => p.alive)) return;
  for (const t of story.turrets) {
    const hero = turretTarget(match, t);
    t.aim = Math.atan2(hero.y - t.y, hero.x - t.x);
  }
  if (story.phase !== 'fight') return;
  story.turretTimer -= dt;
  if (story.turretFiring) {
    if (story.turretTimer <= 1e-9) {
      story.turretFiring = false;
      story.turretTimer += TURRET.rest;
      return;
    }
    for (const t of story.turrets) {
      t.fireTimer -= dt;
      if (t.fireTimer <= 1e-9) {
        t.fireTimer += TURRET.interval;
        fireTurret(match, t, turretTarget(match, t), events);
      }
    }
  } else if (story.turretTimer <= 1e-9) {
    story.turretFiring = true;
    story.turretTimer += TURRET.burst;
    for (const t of story.turrets) t.fireTimer = TURRET.interval;
    for (const t of story.turrets) fireTurret(match, t, turretTarget(match, t), events);
  }
}

/**
 * 포탄 한 발: ISB팀 탄이라 요원은 맞지 않는다. 엄폐물에 막히고, 맞히거나 플레이어 레일 선에서 터져 폭발 피해를 준다.
 * 쏜 쪽(ownerId)은 'turret'이라 결과 화면에 '포탑'으로 나온다.
 */
function fireTurret(match, t, hero, events) {
  const aim = Math.atan2(hero.y - t.y, hero.x - t.x);
  t.aim = aim;
  const x = t.x + Math.cos(aim) * TURRET_MUZZLE, y = t.y + Math.sin(aim) * TURRET_MUZZLE;
  match.projectiles.push({
    id: match.nextProjectileId++, ownerId: 'turret', team: 'isb', weapon: 'turret',
    x, y, previousX: x, previousY: y,
    vx: Math.cos(aim) * TURRET.speed, vy: Math.sin(aim) * TURRET.speed,
    life: TURRET_SHELL_LIFE, damage: TURRET.damage, connected: false,
    splash: { ...TURRET.splash }, endY: RAIL_Y[hero.team],
  });
  events.push({ type: 'turret-fire', x: t.x, y: t.y });
}

/**
 * 고정 틱마다 step()이 부른다(경기 중일 때만). 웨이브 클리어 판정, 헬리콥터·건쉽·전투기·엘리베이터·천장 연출,
 * 요원 들어오기, 복도 포탑을 진행한다. 새 요원의 입력 칸은 inputs에, AI는 match.story.brains에 더한다.
 */
export function updateStory(match, inputs, dt, events) {
  const story = match.story;
  // 전투 시작: 1웨이브 요원 등장 경고
  if (!story.started) {
    story.started = true;
    events.push({ type: 'alarm', boss: false });
  }
  if (story.banner) {
    story.banner.t += dt;
    if (story.banner.t >= story.banner.duration) story.banner = null;
  }
  moveCarrier(story, dt);
  moveStrike(story, dt, events);
  moveCorridor(story, dt);
  moveEntering(match, dt, events);
  if (story.turrets) updateTurrets(match, dt, events);
  // 연출 중에는 평소의 전투기가 나오지 않게 미룬다(복도에는 아예 나오지 않음)
  if (story.phase !== 'fight') match.jetTimer = Math.max(match.jetTimer, 2);

  const next = story.wave + 1;
  switch (story.phase) {
    case 'fight':
      if (next < WAVES.length && enemies(match).every((p) => !p.alive)) {
        story.phase = 'clear';
        story.timer = 0;
        story.banner = banner(`${WAVES[story.wave].title} 클리어!`, WAVES[next].boss ? '' : '다음 요원들이 온다');
        events.push({ type: 'wave-clear', wave: story.wave });
      }
      break;
    case 'clear':
      story.timer += dt;
      if (story.timer >= CLEAR_TIME) {
        // 쓰러진 요원은 경기장에서 치우고(결과 화면용으로 roster에는 남는다) 다음 웨이브를 부른다
        match.players = match.players.filter((p) => p.team !== 'isb' || p.alive);
        story.brains = story.brains.filter((b) => match.players.some((p) => p.id === b.playerId));
        callNext(story, next, events);
      }
      break;
    case 'arrive': {
      const { from } = WAVES[next];
      if (from === 'elevator') {
        if (story.elevator.open < 1) break;
      } else if (from === 'ceiling') {
        if (story.ceiling.t < CRACK_TIME) break;
        // 천장이 무너진다: 폭발과 파편 속에서 R-10이 떨어진다
        events.push({ type: 'explode', x: story.ceiling.x, y: story.ceiling.y + 40, radius: 190 });
        events.push({ type: 'ceiling-break', x: story.ceiling.x, y: story.ceiling.y + 40 });
        story.ceiling = null;
      } else {
        if (story.carrier?.state !== 'hover') break;
        if (from === 'gunship' && story.carrier.kind === 'heli') {
          // 중간보스: 전투기가 헬리콥터를 격추한다
          story.phase = 'strike';
          story.timer = 0;
          story.jet = { x: -OFF, y: CARRIER_Y, dir: 1, fired: false };
          story.banner = banner('전투기 출현!');
          break;
        }
      }
      story.phase = 'drop';
      story.wave = next;
      story.banner = banner(WAVES[next].title, waveInfo(next, story.settings));
      spawnWave(match, inputs, next);
      events.push({ type: 'wave', wave: next, title: WAVES[next].title });
      break;
    }
    case 'strike':
      if (story.carrier) break;
      story.timer += dt;
      if (story.timer >= GUNSHIP_DELAY) {
        callCarrier(story, 'gunship', events);
        story.banner = banner('건쉽 접근!', BOSS_NAME);
      }
      break;
    case 'drop':
      if (enemies(match).some((p) => p.entering)) break;
      story.phase = 'fight';
      if (story.carrier) story.carrier.state = 'out';
      if (story.elevator) story.elevator.target = 0;
      // R-10이 내려앉으면 도발 장면
      if (WAVES[story.wave].boss === 'r10') startTaunt(match);
      break;
    default:
      break;
  }
}

/* ───────── 저장하기 · 이어하기 ─────────
 * 일시정지 화면의 '저장하기'는 지금 싸우는 웨이브(웨이브 사이라면 다음에 올 웨이브)와 체력을 저장한다.
 * 이어하기는 그 웨이브의 요원이 오는 장면부터 시작한다(쓰러뜨리던 요원은 처음부터 다시).
 */

/**
 * 지금 저장하면 이어할 { wave, hp, label } (2인 협동이면 P2 체력 hp2와 coop: true도).
 * 저장할 수 없으면 null(주인공이 모두 쓰러졌거나 건 카타 중이거나 마지막 엔딩 컷씬).
 */
export function checkpoint(match) {
  const story = match.story;
  if (!story || !heroes(match).some((p) => p.alive) || match.phase === 'result') return null;
  if (match.gunkata) return null; // 건 카타 중에는 저장하지 않는다(끝나면 엔딩 컷씬 중에 저장 가능)
  const [hero, partner] = heroes(match);
  let wave = currentWave(story);
  if (match.cutscene) {
    if (WAVES[story.wave].boss === 'r10') return null; // 이미 스토리를 깼다
    wave = story.wave + 1;
  } else if (match.killcam?.waveEnd || (story.phase === 'fight' && enemies(match).every((p) => !p.alive))) {
    wave = story.wave + 1;
  }
  wave = Math.min(wave, WAVES.length - 1);
  // 다음 스테이지로 넘어가는 길이면 체력은 100% 회복된 값(쓰러진 동료도 일어남)
  const nextStage = WAVES[wave].stage !== story.stage;
  const hpOf = (p) => (nextStage ? p.maxHp : p.alive ? p.hp : 0);
  const point = { wave, hp: hpOf(hero), label: waveLabel(wave) };
  if (partner) Object.assign(point, { hp2: hpOf(partner), coop: true });
  return point;
}

/**
 * 저장해 둔 값 검사: 웨이브 번호·체력·캐릭터 선택이 맞지 않으면 null. label은 지금 웨이브 이름으로 다시 만든다.
 * 2인 협동 저장(coop)은 P2 체력 hp2·선택 pick2도 있고, 두 체력 중 하나만 0보다 크면 된다(0은 쓰러진 채로).
 */
export function normalizeStorySave(save) {
  const wave = Number(save?.wave), hp = Number(save?.hp);
  const isPick = (pick) => typeof pick === 'object' && !!pick;
  if (!Number.isInteger(wave) || wave < 0 || wave >= WAVES.length || !isPick(save.pick)) return null;
  const pickOf = ({ characterId, weapon, secondary }) => ({ characterId, weapon, secondary });
  const savedAt = Number(save.savedAt) || 0;
  if (save.coop) {
    const hp2 = Number(save.hp2);
    if (!isPick(save.pick2) || !(hp >= 0) || !(hp2 >= 0) || !(hp > 0 || hp2 > 0)) return null;
    return {
      wave, hp: Math.round(hp), hp2: Math.round(hp2), coop: true, label: waveLabel(wave),
      pick: pickOf(save.pick), pick2: pickOf(save.pick2), savedAt,
    };
  }
  if (!(hp > 0)) return null;
  return { wave, hp: Math.round(hp), label: waveLabel(wave), pick: pickOf(save.pick), savedAt };
}

/* ───────── 엔딩 컷씬 ─────────
 * 보스를 쓰러뜨리면 바로 끝나지 않고 컷씬이 나온다.
 * 스미스 요원(옥상 중간보스): 다시 일어나 주인공에게 달려들고, 주인공은 권총을 쏘지만 스미스 요원은 모두 피한다.
 *   코앞까지 온 스미스 요원을 주인공이 발로 차서 옥상(건물) 밖으로 떨어뜨린다. 컷씬이 끝나면 2스테이지(복도)로.
 *   시간표(초): 0~1 일어남, 1~4.2 달려듦(그동안 총 6발, 모두 피함), 4.2~4.7 발차기, 4.7~7 날아가 건물 밖으로 추락, ~8.2 끝.
 * R-10(복도 보스): 아래 R-10 엔딩 컷씬. 끝나면 승리 결과.
 */
export const CUTSCENE_TIME = 8.2;
const RUN_START = 1, RUN_END = 4.2, KICK_AT = 4.5, FLY_END = 5.6, FALL_END = 7;
const SHOTS = [1.2, 1.7, 2.2, 2.7, 3.2, 3.7];
const SHOT_TRAVEL = 0.35;       // 겨눌 때 예측하는 시간(총알이 닿기까지 대략)
const DODGE = 95;               // 피할 때 옆으로 비키는 거리
const DODGE_RANGE = 230;        // 총알이 이만큼 다가오면 비킨다
const DODGE_SPEED = 1300;       // 비키는 속도(초당)
const STOP_GAP = 120;           // 주인공 앞 멈추는 거리
const CUT_BULLET_SPEED = 1300;

/** 보스(스미스 요원·R-10)를 쓰러뜨리면 결과·다음 웨이브 대신 컷씬을 시작하는지 */
export function startsCutscene(match) {
  if (!match.story || !WAVES[match.story.wave].boss) return false;
  const hero = match.players.find((p) => p.team === 'earth' && p.alive);
  const boss = match.players.find((p) => p.boss);
  return !!hero && !!boss && !boss.alive;
}

export function startCutscene(match) {
  if (WAVES[match.story.wave].boss === 'r10') {
    startR10Cutscene(match);
    return;
  }
  const boss = match.players.find((p) => p.boss);
  const hero = heroOf(match, killerOf(match, boss)); // 2인 협동이면 보스를 쓰러뜨린 쪽이 컷씬의 주인공
  match.phase = 'cutscene';
  match.projectiles = [];
  match.jet = null;
  match.story.banner = null;
  match.story.carrier = null;
  const dir = boss.x < ARENA_WIDTH / 2 ? -1 : 1; // 가까운 쪽 건물 끝으로 차 낸다
  match.cutscene = {
    kind: 'smith', t: 0, heroId: hero.id, bossId: boss.id, bossScale: boss.scale,
    from: { x: boss.x, y: boss.y }, to: { x: hero.x, y: hero.y - STOP_GAP }, dir,
    fired: 0, bullets: [], dodge: { x: 0, y: 0 }, kicked: false, screamed: false,
    hero: { x: hero.x, y: hero.y, aim: hero.aim, lunge: 0, weapon: 'pistol' },
    smith: { x: boss.x, y: boss.y, scale: boss.scale, angle: 0, alpha: 1, standing: 0, trail: [] },
    caption: '',
  };
}

/** 달려드는 경로 위 위치(피하기 전) */
function runPath(c, t) {
  const k = Math.max(0, Math.min(1, (t - RUN_START) / (RUN_END - RUN_START)));
  const ease = k * k * (3 - 2 * k);
  return { x: c.from.x + (c.to.x - c.from.x) * ease, y: c.from.y + (c.to.y - c.from.y) * ease };
}

/** 총알 b에서 본 스미스 요원까지 남은 거리(총알 진행 방향으로). 음수면 이미 지나갔다. */
function ahead(b, x, y) {
  const speed = Math.hypot(b.vx, b.vy);
  return ((x - b.x) * b.vx + (y - b.y) * b.vy) / speed;
}

/**
 * 피하기: 아직 지나가지 않은 총알이 DODGE_RANGE 안으로 다가오면 총알이 날아오는 방향의 옆(왼쪽·오른쪽 번갈아)으로
 * 재빨리 비키고, 총알이 지나가면 다시 달리던 길로 돌아온다. 지금 비켜 있는 거리 { x, y }를 돌려준다.
 */
function dodgeOffset(c, base, dt) {
  const threat = c.bullets.find((b) => !b.missed && ahead(b, base.x, base.y) < DODGE_RANGE);
  let want = { x: 0, y: 0 };
  if (threat) {
    const speed = Math.hypot(threat.vx, threat.vy);
    const px = -threat.vy / speed, py = threat.vx / speed; // 총알 방향에 수직
    let side = threat.side;
    // 벽 쪽으로는 비킬 수 없으니 반대쪽으로
    if (base.x + side * px * DODGE < MIN_X || base.x + side * px * DODGE > MAX_X) side = -side;
    want = { x: side * px * DODGE, y: side * py * DODGE };
  }
  const dx = want.x - c.dodge.x, dy = want.y - c.dodge.y;
  const dist = Math.hypot(dx, dy);
  const k = dist > 0 ? Math.min(1, (DODGE_SPEED * dt) / dist) : 0;
  c.dodge.x += dx * k;
  c.dodge.y += dy * k;
  return c.dodge;
}

/** 컷씬 한 틱. 스미스 요원 컷씬이 끝나면 계단 컷씬 뒤 2스테이지(복도)로, R-10 컷씬이 끝나면 결과(지구방위팀 승리)로 넘어간다. */
export function updateCutscene(match, dt, events) {
  if (match.cutscene.kind === 'stairs') {
    updateStairs(match, dt, events);
    return;
  }
  if (match.cutscene.kind === 'r10') {
    updateR10Cutscene(match, dt, events);
    return;
  }
  const c = match.cutscene;
  const t = (c.t += dt);
  const { smith, hero } = c;
  smith.standing = Math.min(1, t / 0.6);

  // 달려들기 + 피하기
  if (t < KICK_AT) {
    const base = runPath(c, t);
    const prevX = smith.x;
    const dodge = dodgeOffset(c, base, dt);
    smith.x = Math.min(MAX_X, Math.max(MIN_X, base.x + dodge.x));
    smith.y = base.y + dodge.y;
    if (t > RUN_START) smith.trail = [{ x: prevX, y: smith.y }, ...smith.trail].slice(0, 4);
    c.caption = t < RUN_START ? `${BOSS_NAME}: 아직 끝나지 않았다!` : t < RUN_END ? '탕! 탕! …다 피한다!' : '';
  }
  hero.aim = Math.atan2(smith.y - hero.y, smith.x - hero.x);

  // 주인공의 권총: 스미스 요원이 갈 자리를 겨누지만, 닿는 순간 스미스 요원이 비킨다
  while (c.fired < SHOTS.length && t >= SHOTS[c.fired]) {
    const target = runPath(c, SHOTS[c.fired] + SHOT_TRAVEL);
    const x0 = hero.x + Math.cos(hero.aim) * MUZZLE_OFFSET, y0 = hero.y + Math.sin(hero.aim) * MUZZLE_OFFSET;
    const aim = Math.atan2(target.y - y0, target.x - x0);
    c.bullets.push({
      x: x0, y: y0, vx: Math.cos(aim) * CUT_BULLET_SPEED, vy: Math.sin(aim) * CUT_BULLET_SPEED, life: 1.2, missed: false,
      side: c.fired % 2 ? -1 : 1, // 왼쪽·오른쪽 번갈아 피한다
    });
    events.push({ type: 'fire', playerId: c.heroId, weapon: 'pistol' });
    c.fired++;
  }
  for (const b of c.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (!b.missed && ahead(b, smith.x, smith.y) < -20) {
      b.missed = true;
      events.push({ type: 'dodge', x: smith.x, y: smith.y });
    }
  }
  c.bullets = c.bullets.filter((b) => b.life > 0 && b.y > -50);

  // 발차기
  if (t >= KICK_AT - 0.25 && t < KICK_AT + 0.25) {
    hero.lunge = Math.max(0, 1 - Math.abs(t - KICK_AT) / 0.25);
    c.caption = '이얍!';
  } else {
    hero.lunge = 0;
  }
  if (!c.kicked && t >= KICK_AT) {
    c.kicked = true;
    c.kickFrom = { x: smith.x, y: smith.y };
    events.push({ type: 'kick', x: smith.x, y: smith.y });
  }

  // 차여서 건물 끝으로 날아가고(빙글빙글), 난간을 넘으면 아래로 떨어지며 작아진다
  if (c.kicked) {
    // 난간(옥상 끝)까지 날아간 뒤, 난간 너머로 넘어가며 아래로 떨어진다(작아지며 사라짐)
    const edgeX = c.dir < 0 ? 30 : ARENA_WIDTH - 30;
    const k = Math.min(1, (t - KICK_AT) / (FLY_END - KICK_AT));
    const over = Math.max(0, Math.min(1, (t - FLY_END) / (FALL_END - FLY_END)));
    smith.x = c.kickFrom.x + (edgeX - c.kickFrom.x) * k + c.dir * 70 * over;
    smith.y = c.kickFrom.y - Math.sin(k * Math.PI) * 120 - k * 180;
    smith.angle = c.dir * (t - KICK_AT) * 12;
    smith.trail = [];
    smith.scale = c.bossScale * (1 - 0.9 * over);
    smith.alpha = 1 - over;
    if (!c.screamed && t >= FLY_END - 0.5) {
      c.screamed = true;
      events.push({ type: 'scream' });
    }
    c.caption = t < FLY_END ? '퍽!!' : t < FALL_END ? `${BOSS_NAME}: 으아아아아…!` : `${BOSS_NAME}을 물리쳤다! 다음은 복도다!`;
  }

  if (t >= CUTSCENE_TIME) startStairs(match);
}

/* ───────── 계단 컷씬(옥상 → 복도) ─────────
 * 스미스 요원 엔딩 컷씬 뒤: 주인공(2인 협동이면 둘 다)이 옥상 계단실 문으로 걸어가 계단을 내려간다.
 * 화면이 어두워지는 동안 경기장이 복도로 바뀌고(체력 100% 회복), 주인공이 복도 왼쪽 벽의 계단 문으로 나와 자기 자리로 걸어간다.
 * 시간표(초): 0~0.9 대사, 0.9~3.3 계단실 문까지 걸어감(문이 열림), 3.3~4.1 계단으로 내려감, 4.1~4.7 어두워짐,
 *   4.7 복도로 바뀜, 4.7~5.3 밝아짐, 5.3~7.3 계단 문에서 나와 자리로, 7.8 끝(카운트다운).
 */
export const STAIRS_TIME = 7.8;
const STAIRS_WALK = 0.9, STAIRS_DOOR = 3.3, STAIRS_DOWN = 4.1, STAIRS_SWITCH = 4.7, STAIRS_LIGHT = 5.3, STAIRS_OUT = 7.3;
const STAIRS_GAP = 0.35;   // 2인 협동에서 둘째가 따라가는 간격
const STAIRS_HOP = 0.45;   // 레일에서 문 앞까지 올라가는 데 쓰는 비율(걷는 시간 중 뒤쪽)
/** 옥상 계단실 문(배경 그림의 계단실)과 복도 왼쪽 벽 아래쪽 문 */
export const ROOF_STAIRS = { x: 155, y: 700, w: 70, h: 50 };
export const CORRIDOR_STAIRS = { x: 42, y: 855, w: 16, h: 110 };

function startStairs(match) {
  const story = match.story;
  // 스미스 요원은 건물 밖으로 떨어졌다
  match.players = match.players.filter((p) => p.team !== 'isb');
  story.brains = [];
  match.projectiles = [];
  const list = heroes(match);
  match.cutscene = {
    kind: 'stairs', t: 0, door: 0, fade: 0, switched: false,
    // 2인 협동에서 쓰러져 있던 동료도 일어나 함께 내려간다(체력은 복도로 바뀔 때 회복)
    heroes: list.map((p, i) => ({ id: p.id, fromX: p.x, x: p.x, y: p.y, alpha: 1, scale: 1, walk: 0, delay: i * STAIRS_GAP, alive: true })),
    caption: list.length > 1 ? '주인공: 계단으로 내려가자! 둘이 같이!' : '주인공: 계단으로 내려가자!',
  };
}

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));

function updateStairs(match, dt, events) {
  const c = match.cutscene;
  const t = (c.t += dt);
  const story = match.story;
  if (!c.switched) {
    // 옥상: 계단실 문까지 걸어가(레일을 따라 옆으로 → 문 앞으로) 계단으로 내려간다
    c.door = clamp01((t - (STAIRS_DOOR - 0.8)) / 0.4);
    for (const h of c.heroes) {
      const k = clamp01((t - STAIRS_WALK - h.delay) / (STAIRS_DOOR - STAIRS_WALK - STAIRS_GAP));
      const side = ease(clamp01(k / (1 - STAIRS_HOP)));
      const up = ease(clamp01((k - (1 - STAIRS_HOP)) / STAIRS_HOP));
      const prevX = h.x, prevY = h.y;
      h.x = h.fromX + (ROOF_STAIRS.x - h.fromX) * side;
      h.y = RAIL_Y.earth + (ROOF_STAIRS.y + 10 - RAIL_Y.earth) * up;
      h.walk = Math.sign(h.x - prevX) || (h.y !== prevY ? -1 : 0);
      // 계단을 내려가며 작아지고 흐려진다
      const down = clamp01((t - STAIRS_DOOR - h.delay) / (STAIRS_DOWN - STAIRS_DOOR - STAIRS_GAP));
      h.scale = 1 - 0.45 * down;
      h.alpha = 1 - down;
      if (down > 0) h.walk = 0;
    }
    c.fade = clamp01((t - STAIRS_DOWN) / (STAIRS_SWITCH - STAIRS_DOWN));
    if (t >= STAIRS_WALK) c.caption = t < STAIRS_DOWN ? '(터벅터벅…) 옥상 계단실로' : '계단을 내려간다…';
    if (t >= STAIRS_SWITCH) {
      // 어두운 동안 복도로 바뀐다: 체력 회복, 엄폐물·포탑·엘리베이터
      c.switched = true;
      moveToCorridor(match, events);
      const xs = heroXs(c.heroes.length);
      c.heroes.forEach((h, i) => Object.assign(h, {
        fromX: CORRIDOR_STAIRS.x - 20, toX: xs[i], x: CORRIDOR_STAIRS.x - 20, y: RAIL_Y.earth, alpha: 0, scale: 1, walk: 0, alive: true,
      }));
    }
    return;
  }
  // 복도: 밝아지고, 왼쪽 벽 계단 문으로 나와 자기 자리까지 걷는다
  c.fade = 1 - clamp01((t - STAIRS_SWITCH) / (STAIRS_LIGHT - STAIRS_SWITCH));
  c.door = 1 - clamp01((t - STAIRS_OUT) / 0.4);
  for (const h of c.heroes) {
    const k = clamp01((t - STAIRS_LIGHT - h.delay) / (STAIRS_OUT - STAIRS_LIGHT - STAIRS_GAP));
    const prevX = h.x;
    h.x = h.fromX + (h.toX - h.fromX) * ease(k);
    h.alpha = clamp01(k * 6);
    h.walk = Math.sign(h.x - prevX);
  }
  c.caption = t < STAIRS_LIGHT + 0.6 ? `${STAGES.corridor.num}스테이지 · ISB 본부 ${STAGES.corridor.name}` : '주인공: 여기가 놈들의 본부인가…';
  if (t >= STAIRS_TIME) {
    match.cutscene = null;
    story.banner = banner(`${STAGES.corridor.num}스테이지 · ${STAGES.corridor.name}`, '체력 100% 회복!');
    match.phase = 'countdown';
    match.countdown = COUNTDOWN;
  }
}

/* ───────── R-10 엔딩 컷씬 ─────────
 * R-10을 쓰러뜨리면: R-10이 다시 떠올라 레이저 광선을 마구 쏘지만 주인공은 좌우로 피한다(모두 빗나감).
 * 주인공 "후, RPG가 남아있었지." → R-10 "그게 무슨-" → 주인공이 RPG를 쏴 R-10을 폭발시키고 게임이 끝난다.
 * 시간표(초): 0~0.8 떠오름, 0.8~3.6 레이저 난사, 3.6~5 주인공 대사, 5~6 R-10 대사, 6 RPG 발사, 명중하면 폭발, 9 끝.
 */
export const R10_CUTSCENE_TIME = 9;
const R10_RISE = 0.8, R10_FIRE_END = 3.6, R10_LINE = 5, R10_SHOOT = 6;
const R10_LASER_EVERY = 0.16;
const R10_STEP_EVERY = 0.4;     // 주인공이 옆으로 비키는 간격
const R10_STEP = 110;           // 비키는 거리
const R10_MISS = [110, 230];    // 레이저가 주인공 옆으로 비껴 가는 거리(레일 선에서)
const CUT_ROCKET_SPEED = 1400;

function startR10Cutscene(match) {
  const boss = match.players.find((p) => p.boss);
  const hero = heroOf(match, killerOf(match, boss));
  match.phase = 'cutscene';
  match.projectiles = [];
  match.story.banner = null;
  match.cutscene = {
    kind: 'r10', t: 0, heroId: hero.id, bossId: boss.id,
    hero: { x: hero.x, y: hero.y, aim: hero.aim, lunge: 0, weapon: 'pistol', baseX: hero.x, side: hero.x < ARENA_WIDTH / 2 ? 1 : -1 },
    r10: { x: boss.x, y: boss.y, scale: boss.scale, alpha: 1, angle: 0, rise: 0 },
    lasers: 0, steps: 0, rocket: null, boomed: false, booms: 0, caption: '',
  };
}

function updateR10Cutscene(match, dt, events) {
  const c = match.cutscene;
  const t = (c.t += dt);
  const { hero, r10 } = c;
  const rng = match.story.rng;
  r10.rise = Math.min(1, t / R10_RISE);

  // 주인공: 레이저를 피해 좌우로 비킨다(벽에 막히면 반대로)
  const steps = t < R10_FIRE_END ? Math.floor(Math.max(0, t - R10_RISE) / R10_STEP_EVERY) : c.steps;
  while (c.steps < steps) {
    c.steps++;
    if (hero.baseX + hero.side * R10_STEP < MIN_X || hero.baseX + hero.side * R10_STEP > MAX_X) hero.side = -hero.side;
    hero.baseX += hero.side * R10_STEP;
    hero.side = -hero.side * (rng() < 0.3 ? -1 : 1);
  }
  hero.x += (hero.baseX - hero.x) * Math.min(1, dt * 18);

  // 레이저 난사: 주인공이 있던 자리 옆으로 비껴 간다
  if (t >= R10_RISE && t < R10_FIRE_END) {
    while (c.lasers < Math.floor((t - R10_RISE) / R10_LASER_EVERY) + 1) {
      c.lasers++;
      const side = c.lasers % 2 ? 1 : -1;
      const miss = R10_MISS[0] + rng() * (R10_MISS[1] - R10_MISS[0]);
      let x2 = hero.x + side * miss;
      if (x2 < 30 || x2 > ARENA_WIDTH - 30) x2 = hero.x - side * miss;
      const aim = Math.atan2(hero.y - r10.y, x2 - r10.x);
      const x1 = r10.x + Math.cos(aim) * MUZZLE_OFFSET * r10.scale, y1 = r10.y + Math.sin(aim) * MUZZLE_OFFSET * r10.scale;
      // 바닥(레일 선 조금 아래)까지 뻗는다
      const y2 = hero.y + 70, x3 = x1 + (x2 - x1) * ((y2 - y1) / (hero.y - y1));
      events.push({ type: 'fire', playerId: c.bossId, weapon: 'laser' });
      events.push({ type: 'laser', playerId: c.bossId, x1, y1, x2: x3, y2 });
      if (c.lasers % 3 === 0) events.push({ type: 'dodge', x: hero.x, y: hero.y });
    }
  }
  hero.aim = Math.atan2(r10.y - hero.y, r10.x - hero.x);
  if (t >= R10_FIRE_END) hero.weapon = 'rpg';

  if (t < R10_RISE) c.caption = 'R-10: 삐-빅! 오류… 전부 쏴 버린다!';
  else if (t < R10_FIRE_END) c.caption = 'R-10이 레이저 광선을 마구 쏜다!';
  else if (t < R10_LINE) c.caption = '주인공: 후, RPG가 남아있었지.';
  else if (t < R10_SHOOT) c.caption = 'R-10: 그게 무슨-';

  // RPG 발사 → 명중하면 연달아 폭발
  if (!c.rocket && t >= R10_SHOOT) {
    const x = hero.x + Math.cos(hero.aim) * MUZZLE_OFFSET, y = hero.y + Math.sin(hero.aim) * MUZZLE_OFFSET;
    c.rocket = { x, y, angle: hero.aim, hit: false };
    events.push({ type: 'fire', playerId: c.heroId, weapon: 'rpg' });
    c.caption = '쾅!!';
  }
  const rocket = c.rocket;
  if (rocket && !rocket.hit) {
    const angle = Math.atan2(r10.y - rocket.y, r10.x - rocket.x);
    rocket.angle = angle;
    const move = CUT_ROCKET_SPEED * dt;
    const dist = Math.hypot(r10.x - rocket.x, r10.y - rocket.y);
    if (dist <= move + 20) {
      rocket.hit = true;
      c.boomAt = t;
    } else {
      rocket.x += Math.cos(angle) * move;
      rocket.y += Math.sin(angle) * move;
    }
  }
  if (c.boomAt !== undefined) {
    // 0.25초 간격으로 세 번 펑, 그동안 R-10은 사라진다
    while (c.booms < 3 && t >= c.boomAt + c.booms * 0.25) {
      const k = c.booms++;
      events.push({ type: 'explode', x: r10.x + (k - 1) * 50, y: r10.y + (k % 2 ? 30 : -10), radius: 150 + k * 40 });
      if (k === 0) events.push({ type: 'cover-break', x: r10.x, y: r10.y });
    }
    r10.alpha = Math.max(0, 1 - (t - c.boomAt) / 0.5);
    c.caption = t < c.boomAt + 1 ? '콰콰쾅!!' : `${R10_NAME}을 물리쳤다! 스토리 클리어!`;
  }

  if (t >= R10_CUTSCENE_TIME) {
    match.cutscene.done = true;
    match.phase = 'result';
    match.winner = 'earth';
    events.push({ type: 'result', winner: 'earth' });
  }
}

/* ───────── 처치 컷씬(킬캠) ─────────
 * 스토리 모드에서 요원을 쓰러뜨릴 때마다 경기가 잠깐 멈추고 카메라가 쓰러진 요원을 확대하며 마지막 한마디가 나온다.
 * 웨이브의 마지막 요원이면 웨이브마다 다른 장면(WAVES의 end)이 이어진다(보스는 엔딩 컷씬).
 *   옥상 1웨이브: 쓰러진 요원이 무전기로 본부에 지원 요청 → 헬리콥터가 오는 이유
 *   옥상 2웨이브: 카메라가 주인공에게 넘어가 한마디
 *   옥상 3웨이브: 화면이 붉어지고 스미스 요원이 무전으로 경고 → 중간보스
 *   복도 1웨이브: 요원이 무전으로 "요원들은 복도로 와라!"
 *   복도 2웨이브: 첫 요원은 "나 이제 승급인데!!!", 마지막 요원 뒤 주인공이 "에잇크."
 *   복도 3웨이브: 주인공 "이 정도냐? 들어와—" (쿠쿵!) "…이게 뭐야?" → 천장이 부서지며 R-10
 * 장면은 shots 목록: { until(초), focus('victim'|'hero'|null), zoom, caption, mode, bubble }. 앞에서부터 until까지 그 장면.
 * R-10이 내려앉을 때의 도발 장면(startTaunt)도 같은 방식으로 보여 준다.
 */
export const LAST_WORDS = [
  '으윽… 보고서를… 아직 못 썼는데…',
  '내 선글라스가… 깨졌어…',
  '이건… 연습이었다…',
  '다음 생엔… 지구방위팀으로…',
  'ISB… 만세…',
  '월급이… 이것밖에 안 되는데…',
  '엄마… 나 옥상이야…',
  '조금만… 쉬었다 갈게…',
];
const KILL_TIME = 1.4;

function killcamShots(end, line) {
  const kill = { until: KILL_TIME, focus: 'victim', zoom: 1.8, caption: `요원: ${line}`, mode: 'kill' };
  switch (end) {
    case 'radio':
      return [kill,
        { until: 2.4, focus: 'victim', zoom: 2.1, caption: '(치지직…) 요원이 무전기를 꺼낸다', mode: 'radio', bubble: '치지직…' },
        { until: 3.9, focus: 'victim', zoom: 2.1, caption: '요원(무전): 본부… 지원 요청… 헬기를 보내라…', mode: 'radio', bubble: '지원 요청!' }];
    case 'hero':
      return [kill, { until: 3.4, focus: 'hero', zoom: 1.7, caption: '주인공: 아직 몸풀기도 안 끝났다고!', mode: 'hero' }];
    case 'smith':
      return [kill,
        { until: 2.4, focus: null, zoom: 1, caption: '(치지직…) 낯선 무전이 끼어든다…', mode: 'smith' },
        { until: 4.4, focus: null, zoom: 1, caption: `${BOSS_NAME}(무전): 쓸모없는 녀석들… 내가 직접 상대해 주지.`, mode: 'smith' }];
    case 'corridor-call':
      return [kill,
        { until: 2.4, focus: 'victim', zoom: 2.1, caption: '(치지직…) 요원이 무전기를 꺼낸다', mode: 'radio', bubble: '치지직…' },
        { until: 4.0, focus: 'victim', zoom: 2.1, caption: '요원(무전): 요원들은 복도로 와라!', mode: 'radio', bubble: '복도로 와라!' }];
    case 'eikk':
      return [kill, { until: 3.2, focus: 'hero', zoom: 1.8, caption: '주인공: 에잇크.', mode: 'sigh' }];
    case 'rumble':
      return [kill,
        { until: 3.2, focus: 'hero', zoom: 1.7, caption: '주인공: 이 정도냐? 들어와—', mode: 'hero' },
        { until: 4.4, focus: null, zoom: 1, caption: '(쿠쿵!)', mode: 'rumble' },
        { until: 5.8, focus: 'hero', zoom: 1.8, caption: '주인공: …이게 뭐야?', mode: 'what' }];
    default:
      return [kill];
  }
}

/** 쓰러진 요원 victim으로 킬캠을 시작한다. waveEnd면 그 웨이브의 마무리 장면까지. */
export function startKillcam(match, victim, waveEnd) {
  const story = match.story;
  const wave = WAVES[story.wave];
  const line = !waveEnd && wave.killLine ? wave.killLine
    : LAST_WORDS[Math.floor(story.rng() * LAST_WORDS.length) % LAST_WORDS.length];
  const hero = heroOf(match, killerOf(match, victim)); // 2인 협동이면 쓰러뜨린 쪽 주인공을 비춘다
  const shots = killcamShots(waveEnd ? wave.end : null, line);
  match.phase = 'killcam';
  match.killcam = {
    t: 0, duration: shots.at(-1).until, shots, shot: shots[0], victimId: victim.id,
    victim: { x: victim.x, y: victim.y }, hero: { x: hero.x, y: hero.y }, waveEnd, wave: story.wave, cues: new Set(),
  };
}

/** R-10이 천장에서 내려앉으면: 경기가 잠깐 멈추고 R-10을 확대하며 도발한다. */
function startTaunt(match) {
  const r10 = match.players.find((p) => p.boss);
  const hero = heroOf(match);
  const shots = [
    { until: 1.3, focus: 'victim', zoom: 1.4, caption: 'R-10: 넌 나를 이길 수 없음!', mode: 'taunt', bubble: '삐빅!' },
    { until: 2.8, focus: 'victim', zoom: 1.5, caption: 'R-10: 넌 나를 이길 수 없음! 도발하기!', mode: 'taunt', bubble: '도발하기!' },
  ];
  match.phase = 'killcam';
  match.killcam = {
    t: 0, duration: shots.at(-1).until, shots, shot: shots[0], victimId: r10.id,
    victim: { x: r10.x, y: r10.y }, hero: { x: hero.x, y: hero.y }, waveEnd: false, wave: match.story.wave, cues: new Set(),
  };
}

/** 킬캠 한 틱. 장면이 바뀔 때 효과음 이벤트를 내고, 끝나면 경기로 돌아간다. */
export function updateKillcam(match, dt, events) {
  const k = match.killcam;
  k.t += dt;
  k.shot = k.shots.find((s) => k.t < s.until) ?? k.shots.at(-1);
  const cue = (name) => {
    if (k.cues.has(name)) return;
    k.cues.add(name);
    events.push({ type: name, wave: k.wave });
  };
  if (k.shots[0].mode === 'kill') cue('killcam');
  if (k.shot.mode === 'radio' || k.shot.mode === 'smith') cue('radio');
  if (k.shot.mode === 'smith' && k.t >= KILL_TIME + 1) cue('smith-voice');
  if (k.shot.mode === 'hero') cue('hero-pose');
  if (k.shot.mode === 'sigh') cue('sigh');
  if (k.shot.mode === 'rumble') cue('rumble');
  if (k.shot.mode === 'what') cue('what');
  if (k.shot.mode === 'taunt') cue('taunt');
  if (k.t >= k.duration) {
    match.killcam = null;
    match.phase = 'playing';
  }
}
