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
 */
export const WEAPONS = {
  rifle: { id: 'rifle', name: '돌격소총', interval: 0.2, damage: 5, speed: 760, burst: 1 },
  pistol: { id: 'pistol', name: '권총', interval: 0.5, damage: 10, speed: 720, burst: 1 },
  dual: { id: 'dual', name: '쌍권총', interval: 0.5, damage: 10, speed: 720, burst: 2, burstGap: 0.1 },
  rpg: {
    id: 'rpg', name: 'RPG', interval: 1, damage: 40, speed: 900, burst: 1, trigger: 'release',
    splash: { damage: 4, radius: 120 }, homing: { turnRate: 0.8 },
  },
  sniper: { id: 'sniper', name: '저격총', interval: 1.5, damage: 60, speed: 1600, burst: 1 },
};
/** 경기 중 무기 교체 후 다시 쏠 수 있을 때까지의 시간(초). 교체로 쿨타임을 건너뛰지 못하게 한다. */
export const SWAP_TIME = 0.4;
export const WEAPON_IDS = Object.keys(WEAPONS);

export const CHARACTERS = [
  { id: 'earth-arrow', name: '온이름' },
  { id: 'earth-pizza', name: '피자럭스' },
  { id: 'isb-agent-1', name: '요원 1' },
  { id: 'isb-agent-2', name: '요원 2' },
];

/**
 * 전투기: 경기장 가운데를 가로로 지나가며 양 팀 탄환을 막는다. 판정은 동체·주익 두 사각형.
 * 화면 안에 있는 동안 missile.interval마다 위(ISB)·아래(지구방위) 양쪽으로 미사일을 한 발씩 쏜다.
 * 미사일은 RPG처럼 터져 폭발 피해를 주고(양 팀 모두 맞음), 향하는 쪽 레일의 가장 가까운 플레이어를 약하게 유도하며,
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
    splash: { damage: 8, radius: 120 }, homing: { turnRate: 0.8 },
  },
};

/**
 * 엄폐물: 모든 탄환(아군·적·전투기)을 막는 고정 사각형. 가운데 1개 + 팀 진영마다 1개(점대칭 배치).
 * 내구도 hp가 0이 되면 부서져 그 경기 동안 사라진다. 양 팀 총알과 RPG 폭발 범위가 내구도를 깎고,
 * RPG 직격은 rpgMultiplier배 피해를 준다. 전투기 기관포는 막히기만 하고 내구도를 깎지 않는다.
 */
export const COVER = { hp: 200, rpgMultiplier: 2 };
export const COVERS = [
  { id: 'center', x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, w: 200, h: 48 },
  { id: 'earth', team: 'earth', x: 480, y: RAIL_Y.earth - 160, w: 170, h: 44 },
  { id: 'isb', team: 'isb', x: ARENA_WIDTH - 480, y: RAIL_Y.isb + 160, w: 170, h: 44 },
];

export const TEAM_COLOR = { earth: '#247BDB', isb: '#D56A26' };
export const TEAM_NAME = { earth: '지구방위팀', isb: 'ISB팀' };
