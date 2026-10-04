import { ARENA_WIDTH, RAIL_Y, MIN_X, MAX_X, PRIMARY_IDS, SECONDARY_IDS, MUZZLE_OFFSET } from './config.js';
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

/** 헬리콥터·건쉽이 오른쪽 화면 밖에서 날아온다. 요원·보스가 오므로 경고음(배경음악이 작아짐)을 울린다. */
function callCarrier(story, kind, events) {
  events.push({ type: 'alarm', boss: kind === 'gunship' });
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
        callCarrier(story, 'heli', events);
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
        callCarrier(story, 'gunship', events);
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

/* ───────── 엔딩 컷씬 ─────────
 * 스미스 요원을 쓰러뜨리면 바로 끝나지 않고 컷씬이 나온다: 스미스 요원이 다시 일어나 주인공에게 달려들고,
 * 주인공은 권총을 쏘지만 스미스 요원은 모두 피한다. 코앞까지 온 스미스 요원을 주인공이 발로 차서
 * 옥상(건물) 밖으로 떨어뜨린다. 컷씬이 끝나면 승리 결과.
 * 시간표(초): 0~1 일어남, 1~4.2 달려듦(그동안 총 6발, 모두 피함), 4.2~4.7 발차기, 4.7~7 날아가 건물 밖으로 추락, ~8.2 끝.
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

/** 마지막 웨이브(보스)를 쓰러뜨리면 결과 대신 컷씬을 시작하는지 */
export function startsCutscene(match) {
  if (!match.story || match.story.wave !== WAVES.length - 1) return false;
  const hero = match.players.find((p) => p.team === 'earth' && p.alive);
  return !!hero && !!match.players.find((p) => p.boss);
}

export function startCutscene(match) {
  const hero = match.players.find((p) => p.team === 'earth' && p.alive);
  const boss = match.players.find((p) => p.boss);
  match.phase = 'cutscene';
  match.projectiles = [];
  match.jet = null;
  match.story.banner = null;
  match.story.carrier = null;
  const dir = boss.x < ARENA_WIDTH / 2 ? -1 : 1; // 가까운 쪽 건물 끝으로 차 낸다
  match.cutscene = {
    t: 0, heroId: hero.id, bossId: boss.id, bossScale: boss.scale,
    from: { x: boss.x, y: boss.y }, to: { x: hero.x, y: hero.y - STOP_GAP }, dir,
    fired: 0, bullets: [], dodge: { x: 0, y: 0 }, kicked: false, screamed: false,
    hero: { x: hero.x, y: hero.y, aim: hero.aim, lunge: 0 },
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

/** 컷씬 한 틱. 끝나면 결과(지구방위팀 승리)로 넘어간다. */
export function updateCutscene(match, dt, events) {
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
    c.caption = t < FLY_END ? '퍽!!' : t < FALL_END ? `${BOSS_NAME}: 으아아아아…!` : `${BOSS_NAME}을 물리쳤다!`;
  }

  if (t >= CUTSCENE_TIME) {
    match.cutscene.done = true;
    match.phase = 'result';
    match.winner = 'earth';
    events.push({ type: 'result', winner: 'earth' });
  }
}

/* ───────── 처치 컷씬(킬캠) ─────────
 * 스토리 모드에서 요원을 쓰러뜨릴 때마다 경기가 잠깐 멈추고 카메라가 쓰러진 요원을 확대하며 마지막 한마디가 나온다.
 * 웨이브의 마지막 요원이면 웨이브마다 다른 장면이 이어진다(보스는 엔딩 컷씬).
 *   1웨이브: 쓰러진 요원이 무전기로 본부에 지원 요청 → 헬리콥터가 오는 이유
 *   2웨이브: 카메라가 주인공에게 넘어가 한마디
 *   3웨이브: 화면이 붉어지고 스미스 요원이 무전으로 경고 → 보스전
 * 장면은 shots 목록: { until(초), focus('victim'|'hero'|null), zoom, caption, mode }. 앞에서부터 until까지 그 장면.
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

function killcamShots(wave, line) {
  const kill = { until: KILL_TIME, focus: 'victim', zoom: 1.8, caption: `요원: ${line}`, mode: 'kill' };
  if (wave === 0) {
    return [kill,
      { until: 2.4, focus: 'victim', zoom: 2.1, caption: '(치지직…) 요원이 무전기를 꺼낸다', mode: 'radio' },
      { until: 3.9, focus: 'victim', zoom: 2.1, caption: '요원(무전): 본부… 지원 요청… 헬기를 보내라…', mode: 'radio' }];
  }
  if (wave === 1) {
    return [kill,
      { until: 3.4, focus: 'hero', zoom: 1.7, caption: '주인공: 아직 몸풀기도 안 끝났다고!', mode: 'hero' }];
  }
  if (wave === 2) {
    return [kill,
      { until: 2.4, focus: null, zoom: 1, caption: '(치지직…) 낯선 무전이 끼어든다…', mode: 'smith' },
      { until: 4.4, focus: null, zoom: 1, caption: `${BOSS_NAME}(무전): 쓸모없는 녀석들… 내가 직접 상대해 주지.`, mode: 'smith' }];
  }
  return [kill];
}

/** 쓰러진 요원 victim으로 킬캠을 시작한다. waveEnd면 그 웨이브의 마무리 장면까지. */
export function startKillcam(match, victim, waveEnd) {
  const story = match.story;
  const line = LAST_WORDS[Math.floor(story.rng() * LAST_WORDS.length) % LAST_WORDS.length];
  const hero = match.players.find((p) => p.team === 'earth');
  const shots = killcamShots(waveEnd ? story.wave : -1, line);
  match.phase = 'killcam';
  match.killcam = {
    t: 0, duration: shots.at(-1).until, shots, shot: shots[0], victimId: victim.id,
    victim: { x: victim.x, y: victim.y }, hero: { x: hero.x, y: hero.y }, waveEnd, wave: story.wave, cues: new Set(),
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
  cue('killcam');
  if (k.shot.mode === 'radio' || k.shot.mode === 'smith') cue('radio');
  if (k.shot.mode === 'smith' && k.t >= KILL_TIME + 1) cue('smith-voice');
  if (k.shot.mode === 'hero') cue('hero-pose');
  if (k.t >= k.duration) {
    match.killcam = null;
    match.phase = 'playing';
  }
}
