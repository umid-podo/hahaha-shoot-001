// 논리 단위는 1600×1000 경기장 기준 (docs/02-game-design.md 초기 밸런스 설정)
export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 1000;
export const RAIL_Y = { isb: 92, earth: 892 };
export const MIN_X = 80;
export const MAX_X = 1520;
export const MAX_SPEED = 300;
export const BODY_RADIUS = 30;
export const SPRITE_SIZE = 128;
export const BULLET_RADIUS = 5;
export const MUZZLE_OFFSET = 38;
export const BULLET_LIFE = 2;
export const MAX_HP = 500;
export const DEADZONE = 0.15;
export const COUNTDOWN = 3;
export const KEY_AIM_SPEED = (120 * Math.PI) / 180;
export const TICK = 1 / 60;

/**
 * 무기표 (손글씨 메모 2장). 기본은 조준(스틱 드래그·발사키 누름)을 유지하는 동안 interval마다 자동 발사.
 * trigger: 'release'인 무기는 조준한 뒤 손을 뗄 때 한 발 쏘고, interval은 발사 후 쿨타임이다.
 * burst는 한 번에 나가는 발 수, burstGap은 점사 사이 간격. splash는 RPG 폭발 범위 피해.
 * homing.turnRate(rad/s)는 가장 가까운 적을 향해 초당 꺾을 수 있는 최대 각도. RPG는 빗나가도 적 레일 선·경기장 끝·수명 끝에서 터진다.
 * beam: 탄 대신 즉시 닿는 레이저. battery.shots발을 쏘면 방전되고, 마지막 발사 후 battery.recharge초가 지나면 가득 찬다.
 * heat: 연속 사격 max초를 채우면 과열되어 cooldown초 동안 쏘지 못한다. 쉬는 동안에는 초당 decay만큼 식는다.
 * thrown: 던지는 무기. 엄폐물·플레이어·전투기 위로 날아가 목표 레일 선에서 터진다(직격 없음, 폭발 피해만).
 */
export const WEAPONS = {
  rifle: { id: 'rifle', name: '돌격소총', interval: 0.2, damage: 7, speed: 760, burst: 1 },
  pistol: { id: 'pistol', name: '권총', interval: 0.5, damage: 10, speed: 720, burst: 1 },
  dual: { id: 'dual', name: '쌍권총', interval: 0.5, damage: 10, speed: 720, burst: 2, burstGap: 0.1 },
  rpg: {
    id: 'rpg', name: 'RPG', interval: 1, damage: 40, speed: 900, burst: 1, trigger: 'release',
    splash: { damage: 10, radius: 120 }, homing: { turnRate: 0.8 },
  },
  sniper: {
    id: 'sniper', name: '저격총', interval: 1, damage: 60, speed: 1600, burst: 1, trigger: 'release',
    note: '팀 진영에 강철 엄폐물',
  },
  // 드론(R-10) 전용 주무기
  laser: { id: 'laser', name: '레이저 캐논', interval: 0.1, damage: 4, burst: 1, beam: true, battery: { shots: 30, recharge: 2 } },
  // 보조무기
  smg: { id: 'smg', name: '기관단총', interval: 0.1, damage: 4, speed: 800, burst: 1, heat: { max: 4, cooldown: 2, decay: 1 } },
  // 수류탄: interval은 한 번 던진 뒤의 쿨타임
  grenade: {
    id: 'grenade', name: '수류탄', interval: 20, damage: 0, speed: 700, burst: 1, trigger: 'release', thrown: true,
    splash: { damage: 50, radius: 240 },
  },
};
/** 경기 중 무기 교체 후 다시 쏠 수 있을 때까지의 시간(초). 교체로 쿨타임을 건너뛰지 못하게 한다. */
export const SWAP_TIME = 0.4;
export const WEAPON_IDS = Object.keys(WEAPONS);
/** 준비 화면에서 고르는 주무기. 경기 중에는 주무기 → 보조무기 → 수류탄 → 주무기 순으로만 전환한다. */
export const PRIMARY_IDS = ['rifle', 'pistol', 'dual', 'rpg', 'sniper'];
export const SLOT_ORDER = ['primary', 'secondary', 'grenade'];
export const SLOT_WEAPON = { secondary: 'smg', grenade: 'grenade' };
export const SLOT_NAME = { primary: '주무기', secondary: '보조무기', grenade: '수류탄' };

/**
 * drone: 보조무기·수류탄을 쓸 수 없고 주무기는 weapon 하나로 고정된다.
 * maxHp는 캐릭터별 최대 체력(없으면 MAX_HP), scale은 그림 크기 배율(판정 크기는 그대로).
 */
export const CHARACTERS = [
  { id: 'earth-arrow', name: '온이름' },
  { id: 'earth-pizza', name: '피자럭스' },
  { id: 'isb-agent-1', name: '요원 1' },
  { id: 'isb-agent-2', name: '요원 2' },
  { id: 'r10', name: 'R-10', drone: true, weapon: 'laser', maxHp: 400, scale: 1.4, image: 'assets/characters/r10.svg' },
];

/**
 * 전투기: 경기장 가운데를 가로로 지나가며 양 팀 탄환을 막는다. 판정은 동체·주익 두 사각형.
 * 화면 안에 있는 동안 missile.interval마다 위(ISB)·아래(지구방위) 양쪽으로 미사일을 한 발씩 쏜다.
 * 미사일은 RPG처럼 터져 폭발 피해를 주고(양 팀 모두 맞음), 유도 없이 똑바로 날아가며,
 * 엄폐물 위로 넘어가 막히지도 깎지도 않는다. 빗나가면 목표 레일 선에서 터진다.
 */
export const JET = {
  y: ARENA_HEIGHT / 2,
  speed: 160,
  firstDelay: [3, 6],
  delay: [5, 11],
  hitboxes: [
    { w: 240, h: 40, dx: 0 },  // 동체
    { w: 70, h: 190, dx: -15 }, // 주익
  ],
  length: 260,
  missile: {
    interval: 1, damage: 20, speed: 640, offset: 60,
    splash: { damage: 8, radius: 120 },
  },
};

/**
 * 엄폐물: 모든 탄환(아군·적·전투기)을 막는 고정 사각형. 가운데 1개 + 팀 진영마다 1개(점대칭 배치).
 * 내구도 hp가 0이 되면 부서져 그 경기 동안 사라진다. 양 팀 총알과 RPG 폭발 범위가 내구도를 깎고,
 * RPG 직격은 rpgMultiplier배 피해를 준다. 전투기 기관포는 막히기만 하고 내구도를 깎지 않는다.
 */
export const COVER = { hp: 200, rpgMultiplier: 2 };
/**
 * 강철 엄폐물: 주무기로 저격총을 고른 플레이어마다 그 팀 진영에 경기 내내 하나씩 생긴다.
 * 부서지지 않고 양 팀 총알을 모두 막는다. 팀 엄폐물과 겹치지 않게 진영 반대쪽부터 채운다.
 */
export const STEEL = { w: 160, h: 44 };
export const COVERS = [
  { id: 'center', x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, w: 200, h: 48 },
  { id: 'earth', team: 'earth', x: 480, y: RAIL_Y.earth - 160, w: 170, h: 44 },
  { id: 'isb', team: 'isb', x: ARENA_WIDTH - 480, y: RAIL_Y.isb + 160, w: 170, h: 44 },
];
export const STEEL_SPOTS = {
  earth: [{ x: ARENA_WIDTH - 480, y: RAIL_Y.earth - 160 }, { x: ARENA_WIDTH / 2, y: RAIL_Y.earth - 160 }],
  isb: [{ x: 480, y: RAIL_Y.isb + 160 }, { x: ARENA_WIDTH / 2, y: RAIL_Y.isb + 160 }],
};

export const TEAM_COLOR = { earth: '#247BDB', isb: '#D56A26' };
export const TEAM_NAME = { earth: '지구방위팀', isb: 'ISB팀' };
