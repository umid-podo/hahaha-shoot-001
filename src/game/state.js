import {
  RAIL_Y, COUNTDOWN, MAX_HP, BODY_RADIUS, MAX_SPEED, ARENA_WIDTH, CHARACTERS, WEAPONS, PRIMARY_IDS, SECONDARY_IDS, DEFAULT_SECONDARY, normalizeSecondaries, JET, COVERS, COVER,
  STEEL, STEEL_SPOTS, HIGHS, ARENA_BOUNDS, EVADE, FLIGHT,
} from './config.js';
import { applyMap } from './maps.js';

// 2인 전용. 자리(P1·P2)가 팀을 정한다. 캐릭터·주무기는 준비 화면에서 자유롭게 바꾸며, 아래는 기본값(그림 속 무기)이다.
export const SLOTS = [
  { id: 'P1', team: 'earth', characterId: 'earth-arrow', weapon: 'dual' },
  { id: 'P2', team: 'isb', characterId: 'isb-agent-1', weapon: 'pistol' },
];

export const characterOf = (id) => CHARACTERS.find((c) => c.id === id);
export const characterName = (id) => characterOf(id)?.name ?? id;

/** 기본 선택. { P1: { characterId, weapon, secondary }, P2: ... } */
export function defaultLoadout() {
  return Object.fromEntries(SLOTS.map((s) => [s.id, { characterId: s.characterId, weapon: s.weapon, secondary: DEFAULT_SECONDARY, secondaries: [DEFAULT_SECONDARY] }]));
}

export function initialAim(team) {
  return team === 'isb' ? Math.PI / 2 : -Math.PI / 2;
}

/** 시드 고정 난수 (mulberry32). 전투기 등장 시점·방향에만 쓰며 테스트에서 재현 가능하다. */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (rng, [min, max]) => min + rng() * (max - min);

/**
 * 경기 통계. 플레이어마다 무기별 { shots 발사, hits 적에게 피해를 준 발, damage 적에게 준 피해, coverDamage 엄폐물 피해 }와
 * taken(받은 피해), takenFrom(출처별 받은 피해: 상대 id 또는 'jet'), killedBy(쓰러뜨린 쪽)를 모은다.
 */
function createStats(players) {
  return Object.fromEntries(players.map((p) => [p.id, { weapons: {}, taken: 0, takenFrom: {}, killedBy: null, downAt: null }]));
}

/**
 * 자리(slot: { id, team, characterId, weapon }) 하나의 플레이어를 만든다.
 * pick의 secondary는 보조무기(SECONDARY_IDS, 없으면 기관단총). 싱글플레이 AI·스토리 모드 적 설정을 더할 수 있다: ai(true면 AI가 조작),
 * maxHp(체력), radius(히트박스 반지름), bulletSpeedScale(탄속 배율), damage({ primary, secondary, grenade } 칸별 피해),
 * damageScale(모든 피해 배율), speedScale(이동 속도 배율), primaryOnly(보조무기·수류탄 없음), name(이름), scale(그림 크기), boss(보스 표시).
 * weaponPool: 고를 수 있는 주무기 목록(기본은 준비 화면 주무기 목록).
 */
export function createPlayer(slot, pick = {}, weaponPool = PRIMARY_IDS) {
  const x = pick.x ?? ARENA_WIDTH / 2;
  const characterId = characterOf(pick.characterId) ? pick.characterId : slot.characterId;
  const character = characterOf(characterId);
  // R-10·숨겨진 캐릭터는 전용 무기 고정. 그 외에는 고른 주무기(주무기 목록에 없으면 자리 기본값).
  // 강습 건쉽처럼 무기 구성이 정해진 캐릭터(loadout)는 그 주무기·보조무기
  const weapon = character.loadout?.primary ?? character.weapon ?? (weaponPool.includes(pick.weapon) ? pick.weapon : slot.weapon);
  // 보조무기 최대 3개(secondaries). 예전 선택(secondary 하나)도 받는다. secondary는 첫 번째 보조무기
  const secondaries = character.loadout ? [...character.loadout.secondaries]
    : normalizeSecondaries(pick.secondaries ?? (SECONDARY_IDS.includes(pick.secondary) ? [pick.secondary] : [DEFAULT_SECONDARY]));
  const secondary = secondaries[0];
  const maxHp = pick.maxHp > 0 ? Math.round(pick.maxHp) : character.maxHp ?? MAX_HP;
  const name = pick.name ?? character.name;
  return {
    id: slot.id, team: slot.team, characterId, name: pick.ai && !pick.name ? `${name} (AI)` : name,
    ai: !!pick.ai, bulletSpeedScale: pick.bulletSpeedScale > 0 ? pick.bulletSpeedScale : 1, damage: pick.damage ?? null,
    damageScale: pick.damageScale >= 0 ? pick.damageScale : 1, boss: !!pick.boss,
    // primaryOnly: 전용 주무기 하나만 쓰는 캐릭터(보조무기·수류탄 없음). 스토리 모드 일반 요원도 주무기만 쓴다.
    drone: !!character.drone, primaryOnly: !!character.weapon || !!pick.primaryOnly, bonusDamage: character.bonusDamage ?? 0,
    jetpack: character.jetpack ? character.jetpackNozzle : null, scale: pick.scale ?? character.scale ?? 1,
    // radius: 싱글플레이에서 AI 히트박스 반지름을 따로 정할 수 있다
    radius: pick.radius > 0 ? pick.radius : character.radius ?? BODY_RADIUS,
    speed: (character.speed ?? MAX_SPEED) * (pick.speedScale > 0 ? pick.speedScale : 1),
    primary: weapon, secondary, secondaries, slot: 'primary', weapon,
    // shield: 폭동 진압 방패를 세웠으면 { hp(남은 막을 피해), t(남은 초) }, blind: 섬광에 눈이 먼 남은 초
    shield: null, blind: 0,
    // flier: 하늘을 나는 캐릭터(강습 건쉽) — 점프 대신 고도를 올리고 내리며 떠 있다. noItem: 아이템(수류탄) 없음
    flier: !!character.flier, noItem: !!character.noItem,
    battery: WEAPONS[weapon].battery?.shots ?? 0, sinceShot: Infinity, heat: 0, overheat: 0, grenadeCooldown: 0,
    // item: 아이템 버튼 무기(평소 수류탄, 스토리 공중전은 미사일). boost: 과냉각이 남은 시간(그동안 주무기 연사가 빨라짐)
    item: 'grenade', boost: 0,
    x, previousX: x, y: RAIL_Y[slot.team],
    aim: initialAim(slot.team),
    hp: maxHp, maxHp, alive: true, hurt: 0,
    // ammo: 무기별 남은 총알(없으면 가득), reload: 장전 중이면 { weapon, t(남은 초), total }
    ammo: {}, reload: null,
    // z: 발 높이(점프·고지대), vz: 위로 가는 속도
    z: character.flier ? FLIGHT.hoverAlt : 0, vz: 0,
    // shock: 감전 남은 초(움직이지도 쏘지도 못함), freeze: 마비 남은 초(움직이지 못함)
    shock: 0, freeze: 0,
    // evade: 회피 돌진 중이면 { dx, dy, t(남은 초) }, evadeCharges: 남은 연속 회피 횟수, evadeCooldown: 다시 채워질 때까지 남은 초
    evade: null, evadeCharges: EVADE.charges, evadeCooldown: 0,
    cooldown: 0, cooldowns: {}, dash: null, burstLeft: 0, burstTimer: 0, wasAiming: false,
    // entering: 스토리 모드에서 헬리콥터에서 내려오는 중(움직이지도 맞지도 않음) { t, duration, fromY }
    entering: null,
  };
}

/** 플레이어 목록으로 경기 상태를 만든다. */
export function createMatchWith(players, seed = Date.now()) {
  const rng = createRng(seed);
  return {
    phase: 'countdown', countdown: COUNTDOWN,
    players, projectiles: [], nextProjectileId: 1,
    covers: createCovers(players),
    // highs: 고지대(올라설 수 있는 높은 단). 공중전·도로·대교 스테이지에서는 비운다
    highs: HIGHS.map((h) => ({ ...h })),
    // bounds: 움직일 수 있는 범위(원래 크기). createMatch(2인 대결·자유 대전)는 넓은 맵으로 넓힌다
    bounds: { ...ARENA_BOUNDS }, wide: false, map: null,
    // pads: 점프 패드(고공 요새), fields: 퍼져 나가는 전기 장판(전기충격기 발사기)
    pads: [], fields: [],
    jet: null, jetTimer: between(rng, JET.firstDelay), rng,
    tick: 0, winner: null, stats: createStats(players),
  };
}

/**
 * @param {Record<string, {characterId: string, weapon: string}>} [loadout]
 * 자리별 선택(createPlayer의 pick)으로 P1·P2 경기를 만든다.
 */
export function createMatch(loadout = defaultLoadout(), seed = Date.now(), { wide = false, map = 'wide' } = {}) {
  const match = createMatchWith(SLOTS.map((slot) => createPlayer(slot, loadout[slot.id] ?? {})), seed);
  if (wide) widen(match, map);
  return match;
}

/**
 * 넓은 맵으로(2인 대결·자유 대전·스토리 1스테이지 옥상): 원래의 10배 넓이 거대한 옥상(maps.js). map 'wide'(넓은 옥상: 계단식 탑·컨테이너·전망대)
 * 또는 'cloud'(구름 위 하얀 섬: 하얀 블록 탑·아치·공중 다리·기둥 숲) 또는 'fortress'(고공 요새: 매우 높은 고지대 2개·잇는 다리·오르막길·점프 패드) 둘레에 거대한 빌딩·계단식 탑·높은 다리·오르막길·점프 패드가 더 있다.
 */
export function widen(match, map = 'wide') {
  return applyMap(match, ['fortress', 'cloud'].includes(map) ? map : 'wide');
}

/** 원래 크기 경기장으로 되돌린다(테스트·예전 호출용). 스토리 스테이지는 applyMap으로 그 스테이지의 거대한 경기장을 쓴다 */
export function unwiden(match) {
  match.wide = false;
  match.map = null;
  match.bounds = { ...ARENA_BOUNDS };
  match.highs = HIGHS.map((h) => ({ ...h }));
  match.pads = [];
  match.fields = [];
  match.ceiling = null;
  return match;
}

/** 경기 중에 들어온 플레이어(스토리 모드 적)의 통계 칸을 만든다. */
export function addStats(match, player) {
  match.stats[player.id] ??= createStats([player])[player.id];
}

/** 새 엄폐물 한 벌: 기본 엄폐물 3개(내구도 가득) + 저격총을 고른 플레이어의 강철 엄폐물. 스토리 모드는 스테이지마다 새로 만든다. */
export function createCovers(players) {
  return [...COVERS.map((c) => ({ ...c, hp: COVER.hp })), ...steelCovers(players)];
}

/** 저격총을 주무기로 고른 플레이어마다 그 팀 진영의 빈 강철 자리에 부서지지 않는 엄폐물 하나. */
function steelCovers(players) {
  const used = { earth: 0, isb: 0 };
  const covers = [];
  for (const p of players) {
    if (p.primary !== 'sniper') continue;
    const spot = STEEL_SPOTS[p.team][used[p.team]++];
    if (!spot) continue;
    covers.push({ id: `steel-${p.id}`, team: p.team, steel: true, ...spot, ...STEEL, hp: Infinity });
  }
  return covers;
}

/**
 * 플레이어 한 명의 입력 프레임. moveAxis·moveY: 경기장 가로(X)·세로(Y) 이동축(-1~1, AI는 직접 넣고 사람은 input/view.js가 앞뒤·좌우 입력을
 * 바라보는 방향에 맞춰 바꿔 넣는다). fwd·side: 사람 입력의 앞뒤(+앞)·좌우(+오른쪽), touchFwd·touchSide: 그중 터치 스틱 몫, turn: 이번 틱에
 * 고개를 돌리는 속도(-1~1, 키·스틱), aim: 바라보는(쏘는) 방향(라디안, 경기장 기준).
 * evade: 회피(빠른 돌진), pitch: 위아래 시선(+위, 라디안), jumpHeld: 점프키를 누르고 있는지(꾹 누르면 더 높이·멀리),
 * swap: 주무기→보조무기(최대 3개) 차례로 전환, select: 누른 무기 칸('primary'·'secondary'·'secondary2'·'secondary3')으로 바로 전환, item: 수류탄 던지기,
 * kata: 스토리 모드 건 카타에서 누른 버튼(1~4, 안 눌렀으면 0)
 */
export function createInput(player) {
  return {
    moveAxis: 0, moveY: 0, fwd: 0, side: 0, touchFwd: 0, touchSide: 0, turn: 0, touchTurn: 0,
    aim: initialAim(player.team), aiming: false, swap: false, select: null, item: false, kata: 0, jump: false, evade: false,
    // pitch: 위아래 시선(라디안, +위). look·touchLook: 이번 틱에 고개를 드는 속도(-1~1, 키·스틱·터치), mousePitch: 마우스로 든 각도
    // jumpHeld·touchJump: 점프키(터치 점프 버튼)를 누르고 있는지 — 꾹 누를수록 높이 뛴다
    pitch: 0, look: 0, touchLook: 0, jumpHeld: false, touchJump: false,
    // descendHeld·touchDescend: 회피키(터치 회피 버튼)를 누르고 있는지 — 나는 캐릭터(강습 건쉽)는 이것으로 고도를 내린다
    descendHeld: false, touchDescend: false,
  };
}

export function createInputs(players) {
  return Object.fromEntries(players.map((p) => [p.id, createInput(p)]));
}

/** 일시정지·포커스 상실 시 호출. 조준 각도는 유지하고 진행 중인 입력(이동·사격)만 버린다. */
export function cancelInputs(inputs) {
  for (const f of Object.values(inputs)) {
    f.moveAxis = 0; f.moveY = 0; f.fwd = 0; f.side = 0; f.touchFwd = 0; f.touchSide = 0; f.turn = 0; f.touchTurn = 0;
    f.aiming = false; f.swap = false; f.select = null; f.item = false; f.kata = 0; f.jump = false; f.evade = false;
    f.look = 0; f.touchLook = 0; f.jumpHeld = false; f.touchJump = false; f.descendHeld = false; f.touchDescend = false;
  }
}
