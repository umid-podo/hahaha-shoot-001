// 논리 단위는 1600×1000 경기장 기준 (docs/02-game-design.md 기본 수치)
export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 1000;
// 팀이 처음 서는 줄(1인칭 3D에서도 시작 자리·연출 기준으로 쓴다). 경기 중에는 경기장 어디로든(상대 진영까지) 움직일 수 있다.
export const RAIL_Y = { isb: 92, earth: 892 };
/**
 * 팀 진영: 경기장의 위(ISB)·아래(지구방위팀) 절반. 예전에는 이 안에서만 움직였지만 지금은 상대 진영·가운데로도 넘어갈 수 있고,
 * AI가 주로 머무는 범위·전투기 미사일이 노리는 자리를 정할 때만 쓴다. 플레이어가 갈 수 있는 앞뒤 범위는 MIN_Y~MAX_Y.
 */
export const ZONE = { isb: { minY: 50, maxY: 430 }, earth: { minY: 570, maxY: 950 } };
export const MIN_Y = 50;
export const MAX_Y = 950;
/**
 * 점프·고지대. jump: 뛰어오르는 첫 속도(초당), gravity: 중력(초당²) → 최고 높이 jump²/(2·gravity) ≈ 120.
 * 높이(z)는 발바닥 높이. 엄폐물(높이 COVER_HEIGHT)은 그보다 높이 떠 있으면 넘어가고, 고지대는 그 높이 가까이 뛰어올라야 올라선다(step 이하 턱은 그냥 걸어 오름).
 * 탄은 쏜 사람 발 높이(z)에서 날아가, 높이 차이가 hitBelow~hitAbove 안인 사람만 맞힌다(점프로 낮은 탄을 피할 수 있음).
 * 쏜 자리가 coverClear보다 높으면(고지대·점프 중) 엄폐물 위로 넘어간다.
 */
export const JUMP = { jump: 620, gravity: 1600, step: 18, hitBelow: 100, hitAbove: 110, coverClear: 40 };
export const COVER_HEIGHT = 84;
/**
 * 회피(빠른 돌진): 누른 순간 움직이던 쪽(안 움직이면 앞)으로 time초 동안 초당 speed만큼 돌진한다. 돌진하는 동안 받는 피해는 taken배(30% 덜 받음).
 * charges번 연달아 돌진할 수 있고, 마지막 돌진이 끝나고 cooldown초가 지나면 다시 charges번으로 채워진다.
 */
export const EVADE = { speed: 1500, time: 0.18, charges: 2, cooldown: 0.5, taken: 0.7 };
/**
 * 넓은 맵(2인 대결·자유 대전): 원래 옥상 경기장(1600×1000)을 가운데에 두고 사방으로 크게 넓힌 건물 옥상(5000×4000, 원래의 12.5배).
 * 시작 자리는 원래대로 가운데 근처이고, 둘레로 엄폐물·고지대·컨테이너·계단식 탑이 흩어져 있다. 스토리 모드는 원래 크기.
 */
export const FIELD = { minX: -1700, maxX: 3300, minY: -1500, maxY: 2500 };
/**
 * 고지대: 올라설 수 있는 높은 단(경기장 위에서 본 사각형, h는 높이). 가운데 양옆 둘(상대 진영으로 넘어가는 길목)과
 * 진영마다 하나씩(점대칭). 옥상·자유 대전·2인 대결·스토리 1~2스테이지에 있다.
 */
export const HIGHS = [
  { id: 'high-west', x: 230, y: 500, w: 240, h: 170, height: 92 },
  { id: 'high-east', x: 1370, y: 500, w: 240, h: 170, height: 92 },
  { id: 'high-earth', x: 1380, y: 700, w: 200, h: 110, height: 64 },
  { id: 'high-isb', x: 220, y: 300, w: 200, h: 110, height: 64 },
];
/**
 * 넓은 맵에만 있는 고지대: 북·남 계단식 탑(64 → 128 → 190, 한 칸씩 뛰어 올라감), 컨테이너(높이 92, 길쭉함),
 * 네 귀퉁이 전망대(계단식 두 칸). 점대칭으로 놓아 양 팀이 공평하다.
 */
export const WIDE_HIGHS = [
  { id: 'tower-n-1', x: 800, y: -620, w: 360, h: 260, height: 64 },
  { id: 'tower-n-2', x: 800, y: -620, w: 210, h: 150, height: 128 },
  { id: 'tower-n-3', x: 800, y: -620, w: 100, h: 90, height: 190 },
  { id: 'tower-s-1', x: 800, y: 1620, w: 360, h: 260, height: 64 },
  { id: 'tower-s-2', x: 800, y: 1620, w: 210, h: 150, height: 128 },
  { id: 'tower-s-3', x: 800, y: 1620, w: 100, h: 90, height: 190 },
  { id: 'box-1', x: -600, y: 150, w: 320, h: 100, height: 92, kind: 'container', color: '#B4472F' },
  { id: 'box-2', x: 2200, y: 850, w: 320, h: 100, height: 92, kind: 'container', color: '#B4472F' },
  { id: 'box-3', x: -300, y: 1300, w: 100, h: 320, height: 92, kind: 'container', color: '#2F6FB4' },
  { id: 'box-4', x: 1900, y: -300, w: 100, h: 320, height: 92, kind: 'container', color: '#2F6FB4' },
  { id: 'box-5', x: 2600, y: 1700, w: 320, h: 100, height: 92, kind: 'container', color: '#3E8A4A' },
  { id: 'box-6', x: -1000, y: -700, w: 320, h: 100, height: 92, kind: 'container', color: '#3E8A4A' },
  { id: 'box-7', x: 2500, y: -1000, w: 100, h: 320, height: 92, kind: 'container', color: '#C9A23A' },
  { id: 'box-8', x: -900, y: 2000, w: 100, h: 320, height: 92, kind: 'container', color: '#C9A23A' },
  { id: 'look-nw-1', x: -1350, y: -1150, w: 400, h: 400, height: 64 },
  { id: 'look-nw-2', x: -1420, y: -1220, w: 220, h: 220, height: 128 },
  { id: 'look-se-1', x: 2950, y: 2150, w: 400, h: 400, height: 64 },
  { id: 'look-se-2', x: 3020, y: 2220, w: 220, h: 220, height: 128 },
  { id: 'look-ne-1', x: 2950, y: -1150, w: 300, h: 300, height: 92 },
  { id: 'look-sw-1', x: -1350, y: 2150, w: 300, h: 300, height: 92 },
];
/** 넓은 맵에만 있는 엄폐물(내구도는 COVER.hp, 중립 색). 길목·탑 주변·컨테이너 사이에 흩어 놓음(점대칭) */
export const WIDE_COVERS = [
  { id: 'w1', x: 300, y: -250, w: 180, h: 44 }, { id: 'w2', x: 1300, y: 1250, w: 180, h: 44 },
  { id: 'w3', x: 1300, y: -250, w: 180, h: 44 }, { id: 'w4', x: 300, y: 1250, w: 180, h: 44 },
  { id: 'w5', x: -250, y: 500, w: 44, h: 220 }, { id: 'w6', x: 1850, y: 500, w: 44, h: 220 },
  { id: 'w7', x: 800, y: -1050, w: 260, h: 44 }, { id: 'w8', x: 800, y: 2050, w: 260, h: 44 },
  { id: 'w9', x: -800, y: -150, w: 200, h: 44 }, { id: 'w10', x: 2400, y: 1150, w: 200, h: 44 },
  { id: 'w11', x: 2300, y: 100, w: 44, h: 200 }, { id: 'w12', x: -700, y: 900, w: 44, h: 200 },
  { id: 'w13', x: -1200, y: 500, w: 200, h: 44 }, { id: 'w14', x: 2800, y: 500, w: 200, h: 44 },
  { id: 'w15', x: 1700, y: -900, w: 200, h: 44 }, { id: 'w16', x: -100, y: 1900, w: 200, h: 44 },
  { id: 'w17', x: 400, y: -1300, w: 44, h: 200 }, { id: 'w18', x: 1200, y: 2300, w: 44, h: 200 },
];
export const MIN_X = 80;
export const MAX_X = 1520;
/** 원래 크기 경기장의 이동 범위(스토리 모드·건 카타 수련장) */
export const ARENA_BOUNDS = { minX: MIN_X, maxX: MAX_X, minY: MIN_Y, maxY: MAX_Y };
export const MAX_SPEED = 300;
export const BODY_RADIUS = 30;
export const SPRITE_SIZE = 128;
export const BULLET_RADIUS = 5;
export const MUZZLE_OFFSET = 38;
export const MAX_HP = 500;
export const DEADZONE = 0.15;
export const COUNTDOWN = 3;
export const KEY_AIM_SPEED = (120 * Math.PI) / 180;
export const TICK = 1 / 60;

/**
 * 무기표 (손글씨 메모 2장). 기본은 조준(스틱 드래그·발사키 누름)을 유지하는 동안 interval마다 자동 발사.
 * trigger: 'release'인 무기는 조준한 뒤 손을 뗄 때 한 발 쏘고, interval은 발사 후 쿨타임이다.
 * burst는 한 번에 나가는 발 수, burstGap은 점사 사이 간격. splash는 RPG 폭발 범위 피해.
 * RPG는 유도 없이 똑바로 날아가고, 빗나가도 적 레일 선·경기장 끝·수명 끝에서 터진다.
 * battery: battery.shots발을 쏘면 방전되고, 마지막 발사 후 battery.recharge초가 지나면 가득 찬다(R-10 레이저 캐논).
 * mag·reload: 탄창에 든 총알 수(0이면 무제한)와 탄창을 갈아 끼우는 시간(초). 다 쏘면 그 무기를 든 채 reload초 동안 장전한 뒤 다시 가득 찬다.
 *   장전 중에 다른 무기로 바꾸면 장전이 끊기고, 다시 들면 처음부터 장전한다. 점사(쌍권총)는 한 발마다 1씩 쓴다.
 * heat: 연속 사격 max초를 채우면 과열되어 cooldown초 동안 쏘지 못한다. 쉬는 동안에는 초당 decay만큼 식는다.
 * ownCooldown: 쿨타임(interval)을 이 무기만 따로 센다(단검·샷건). 쿨타임 중에도 다른 무기는 바로 쏠 수 있다.
 * dash: 쏘는 대신 조준 방향으로 dash.speed(초당)로 돌진해 상대 몸에 닿으면 damage를 준다(단검).
 * pellets·spread: 한 번에 pellets발을 spread도 부채꼴로 고르게 쏜다(샷건).
 * arrows·arrowGap: 한 번에 arrows발을 arrowGap 간격으로 나란히 쏜다(아킴보 석궁).
 * instakill: 거대한 레이저. 조준 방향에서 가장 가까운 상대 쪽으로 최대 homing도까지 휘어(180이면 어디를 겨눠도 명중),
 *   닿으면 damage 피해(기본 9999 = 즉사)를 준다. 엄폐물·무적은 무시한다. 경기 시작 readyAfter초 뒤부터 쓸 수 있고,
 *   쏜 뒤 interval초(쿨타임)가 지나면 다시 쓸 수 있다(제작자 전용).
 *   beamWidth는 레이저 굵기(명중 판정 여유).
 * hidden: 선택 목록에 보이지 않는 숨겨진 무기. unlockFrom 무기 버튼을 빠르게 unlockTaps번 누르면 그 자리에 나타난다.
 * flame: 화염방사기. 한 발이 flame.life초만 날아가다 사라지는 불꽃 덩어리이고, 쏠 때마다 ±flame.spread/2도 안에서 흩어진다(짧은 사거리).
 * bounces: 엄폐물·경기장 끝에 닿으면 그만큼 튕겨 나간다(에너지 돌격소총). 튕길 때도 엄폐물은 깎인다.
 * energy: 푸른 에너지 볼트를 쏘는 에너지 무기(탄 모양·총구 빛이 푸르다). alternate: 두 자루를 번갈아 쏜다(에너지 쌍권총).
 * legendary: 전설 무기. 상점에서 사야(50코인) 무기 선택 목록에 나온다.
 * thrown: 던지는 무기. 엄폐물·플레이어 위로 조준 방향으로 RULES.throwRange만큼 날아가 터진다(직격 없음, 폭발 피해만).
 * 폭발 무기(splash)는 맞히지 못하면 벽(경기장 끝)·수명 끝에서 터진다. 전투기·포탑처럼 목표를 노린 폭탄은 목표 자리(range)에서 터진다.
 */
export const WEAPONS = {
  rifle: { id: 'rifle', name: '돌격소총', interval: 0.2, damage: 7, speed: 760, burst: 1, mag: 30, reload: 2 },
  pistol: { id: 'pistol', name: '권총', interval: 0.5, damage: 20, speed: 720, burst: 1, mag: 12, reload: 1.4 },
  dual: { id: 'dual', name: '쌍권총', interval: 0.5, damage: 10, speed: 720, burst: 2, burstGap: 0.1, mag: 20, reload: 1.6 },
  // 쌍 RPG(윌슨 요원 전용): 쌍권총처럼 2점사로 쏘지만 탄이 작은 로켓이라 맞거나 레일 선에서 터진다(유도 없음, 지나간 길에 연기)
  dualrpg: {
    id: 'dualrpg', name: '쌍 RPG', interval: 0.5, damage: 10, speed: 720, burst: 2, burstGap: 0.1,
    splash: { damage: 8, radius: 90 },
  },
  // 존슨 요원(대교 보스) 전용 저격총: interval초마다 빨간 조준선(volley.aim초 동안 보임)을 따라 volley.count발을 부채꼴로 한꺼번에 쏜다.
  // 체력이 절반 아래로 내려가면 volley.rage발. 일반 사격 대신 story.js가 쏜다(조준선이 보인 뒤 발사).
  jsniper: {
    id: 'jsniper', name: '존슨 저격총', interval: 1.5, damage: 30, speed: 2000, burst: 1,
    volley: { count: 3, rage: 5, spread: 7, aim: 0.8 },
  },
  rpg: {
    id: 'rpg', name: 'RPG', interval: 1, damage: 40, speed: 900, burst: 1, trigger: 'release', mag: 1, reload: 1,
    splash: { damage: 10, radius: 120 }, // 유도 없이 똑바로 날아간다
  },
  // 아킴보 석궁(숨겨진 무기): 권총 손잡이가 달린 작은 석궁 두 자루. 연사는 조금 느리지만 탄속이 빠르고 화살 2개가 나란히 날아간다.
  // 무기 선택에서 쌍권총 버튼을 빠르게 2번 누르면 나타난다.
  crossbow: {
    id: 'crossbow', name: '아킴보 석궁', interval: 0.7, damage: 12, speed: 1500, burst: 1, arrows: 2, arrowGap: 26, mag: 6, reload: 1.8,
    hidden: true, unlockFrom: 'dual', unlockTaps: 2,
  },
  // 화염방사기: 불꽃을 짧게 뿜는다. 가까이에서 아주 세지만 사거리가 짧다(불꽃 0.45초 ≈ 330 거리)
  flamethrower: {
    id: 'flamethrower', name: '화염방사기', interval: 0.05, damage: 4, speed: 650, burst: 1, mag: 80, reload: 2.4,
    flame: { life: 0.45, spread: 12 },
  },
  // ── 전설 무기(상점 50코인) ──
  // 에너지 돌격소총: 푸른 에너지 볼트. 탄속이 매우 빠르고 엄폐물·경기장 끝에 3번까지 튕긴다
  energyrifle: {
    id: 'energyrifle', name: '에너지 돌격소총', interval: 0.16, damage: 9, speed: 2400, burst: 1, mag: 30, reload: 1.8,
    bounces: 3, energy: true, legendary: true,
  },
  // 에너지 쌍권총: 푸른 에너지 볼트를 아주 빠르게 연사한다. 250발(다 쏘면 두 자루를 빠르게 돌리며 1.2초 장전)·탄속 매우 빠름, 대신 한 발 피해가 낮다
  energydual: {
    id: 'energydual', name: '에너지 쌍권총', interval: 0.06, damage: 3, speed: 2400, burst: 1, mag: 250, reload: 1.2,
    energy: true, alternate: true, legendary: true,
  },
  sniper: {
    id: 'sniper', name: '저격총', interval: 1, damage: 60, speed: 1600, burst: 1, trigger: 'release', mag: 5, reload: 2.4,
    note: '팀 진영에 강철 엄폐물',
  },
  // 제작자 전용 주무기: 커다란 레이저포. 전투 시작 30초 뒤부터 쏠 수 있고, 쏘면 유도되는 거대 레이저가 상대를 즉사시킨다.
  instakill: {
    id: 'instakill', name: '즉사기', interval: 10, damage: 9999, burst: 1, instakill: true, readyAfter: 30, homing: 180, beamWidth: 40,
  },
  // 드론(R-10) 전용 주무기
  // R-10 레이저 캐논: 붉은 레이저 탄환을 3점사. 배터리 15발(5번 점사, 약 3초)을 쏘면 방전되고 2초 쉬면 가득 찬다.
  laser: {
    id: 'laser', name: '레이저 캐논', interval: 0.7, damage: 20, speed: 1400, burst: 3, burstGap: 0.08,
    battery: { shots: 15, recharge: 2 },
  },
  // 보조무기
  smg: { id: 'smg', name: '기관단총', interval: 0.02, damage: 4, speed: 800, burst: 1, mag: 0, reload: 1.8, heat: { max: 1, cooldown: 2, decay: 1 } },
  // 단검: 조준한 뒤 떼면 조준 방향으로 매우 빠르게 돌진해, 상대 몸에 닿으면 큰 피해. 돌진 뒤 자기 레일로 돌아온다.
  dagger: {
    id: 'dagger', name: '단검', interval: 10, damage: 100, burst: 1, trigger: 'release', ownCooldown: true,
    dash: { speed: 2400 },
  },
  // 샷건: 조준한 뒤 떼면 부채꼴로 여러 발
  shotgun: {
    id: 'shotgun', name: '샷건', interval: 10, damage: 40, speed: 900, burst: 1, trigger: 'release', ownCooldown: true, mag: 0, reload: 1.5,
    pellets: 5, spread: 40,
  },
  // 수류탄(아이템): 아이템 버튼으로 지금 조준 방향에 바로 던진다. interval은 던진 뒤의 쿨타임
  grenade: {
    id: 'grenade', name: '수류탄', interval: 10, damage: 0, speed: 700, burst: 1, thrown: true,
    splash: { damage: 50, radius: 240 },
  },
  // ── 스토리 모드 3스테이지(하늘) 공중전 ──
  // 라이트닝(주인공 전용기) 기관포: 20mm·12.7mm 기관포를 한꺼번에 쏜다(2발이 나란히)
  lightning: { id: 'lightning', name: '라이트닝 기관포', interval: 0.16, damage: 9, speed: 1300, burst: 1, arrows: 2, arrowGap: 30 },
  // 과냉각(공중전 보조무기): 누르면 active초 동안 주무기 연사 간격이 rate배로 짧아지고 한 발 피해는 boost.damage(3)가 된다. interval은 다시 쓸 때까지의 쿨타임
  overcool: { id: 'overcool', name: '과냉각', interval: 15, damage: 0, burst: 1, ownCooldown: true, boost: { active: 5, rate: 0.3, damage: 3 } },
  // 미사일(공중전 아이템): 아이템 버튼으로 쏘는 미사일(유도 없음)
  missile: {
    id: 'missile', name: '미사일', interval: 6, damage: 60, speed: 950, burst: 1,
    splash: { damage: 25, radius: 150 },
  },
  // ISB 건쉽 기관포
  gunship: { id: 'gunship', name: '건쉽 기관포', interval: 0.8, damage: 14, speed: 820, burst: 2, burstGap: 0.12 },
  // 데스스타(거대 비행선) 산탄포: 부채꼴로 여러 발
  flak: { id: 'flak', name: '데스스타 산탄포', interval: 1.3, damage: 14, speed: 640, burst: 1, pellets: 7, spread: 70 },
  // 데스스타 3갈래 미사일: interval초마다 가장 가까운 라이트닝 쪽으로 volley.count발을 volley.spread도 간격 부채꼴로(유도 없음)
  dsmissile: {
    id: 'dsmissile', name: '데스스타 미사일', interval: 4, damage: 30, speed: 560, burst: 1,
    splash: { damage: 15, radius: 120 }, volley: { count: 3, spread: 28 },
  },
};

/**
 * 스토리 모드 3스테이지 하늘(공중전) 공통 수치. planeSpeed는 라이트닝 이동 속도 배율(캐릭터 기본 속도 대비),
 * enemyFlyIn은 건쉽이 화면 위에서 날아 들어오는 시간(초), dsFirstVolley는 데스스타 전투 시작 뒤 첫 미사일까지(초).
 */
export const SKY = { planeSpeed: 1.3, enemyFlyIn: 1.2, dsFirstVolley: 2.5 };
/**
 * 밸런스 메뉴에서 조정하는 공통 규칙.
 * swapTime: 경기 중 무기 교체 후 다시 쏠 수 있을 때까지의 시간(초). 교체로 쿨타임을 건너뛰지 못하게 한다.
 * bulletLife: 탄환 수명(초). throwRange: 수류탄이 날아가 터지는 거리. dashRange: 단검 돌진이 돌아오기 전까지 가는 최대 거리.
 */
export const RULES = { swapTime: 0.4, bulletLife: 2, throwRange: 600, dashRange: 900 };
export const WEAPON_IDS = Object.keys(WEAPONS);
/**
 * 준비 화면에서 고르는 주무기·보조무기(숨겨진 무기 포함, 목록에는 hidden이 아닌 것만 보인다). 경기 중에는 고른 주무기·보조무기 사이만 바꾸고,
 * 수류탄은 아이템 버튼으로 바로 던진다.
 */
export const PRIMARY_IDS = ['rifle', 'pistol', 'dual', 'rpg', 'sniper', 'crossbow', 'flamethrower', 'energyrifle', 'energydual'];
/** 상점에서 사야 쓸 수 있는 전설 무기 */
export const LEGENDARY_IDS = PRIMARY_IDS.filter((id) => WEAPONS[id].legendary);
export const SECONDARY_IDS = ['smg', 'dagger', 'shotgun'];
export const DEFAULT_SECONDARY = 'smg';
export const SLOT_ORDER = ['primary', 'secondary'];
export const SLOT_NAME = { primary: '주무기', secondary: '보조무기' };

/**
 * weapon이 있는 캐릭터는 주무기가 그 무기로 고정되고 보조무기·수류탄을 쓸 수 없다(R-10, 제작자).
 * drone: 떠 있는 드론(둥실 뜨는 모습). hidden: 선택 화면에 보이지 않는 숨겨진 캐릭터로,
 * unlockFrom 캐릭터 버튼을 빠르게 unlockTaps번(기본 3번) 누르면 그 자리에 나타난다.
 * bonusDamage: 상대 플레이어에게 피해를 줄 때마다 더하는 추가 피해.
 * jetpack: 제트팩으로 떠서 움직이고, 움직일 때 제트팩에서 불꽃이 나온다(아크 트루퍼). jetpackNozzle은 그림 안 분사구 위치(0~1).
 * pictured: 그림에서 들고 있는 주무기. 선택 화면에서 그 캐릭터를 고르면 주무기도 이 무기로 바뀐다(바꿀 수 있음).
 * maxHp는 최대 체력, radius는 몸 판정(히트 박스) 반지름, speed는 초당 이동 속도, scale은 그림 크기 배율.
 * maxHp·radius·speed는 밸런스 메뉴에서 캐릭터별로 조정한다.
 */
export const CHARACTERS = [
  { id: 'earth-arrow', name: '온이름', maxHp: 1000, radius: BODY_RADIUS, speed: MAX_SPEED },
  { id: 'earth-pizza', name: '피자럭스', maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED },
  // 지구방위팀 요원들(사용자가 준 캐릭터 소개 그림). 키 큰 전신 그림이라 조금 크게 그린다.
  { id: 'codename-x', name: '코드네임 X', pictured: 'rifle', maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED, scale: 1.2 },
  { id: 'codename-v', name: '코드네임 V', pictured: 'dual', maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED, scale: 1.2 },
  { id: 'codename-r', name: '코드네임 R', pictured: 'sniper', maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED, scale: 1.2 },
  { id: 'sirius-k', name: '시리우스 K', pictured: 'pistol', maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED, scale: 1.2 },
  { id: 'isb-agent-1', name: '요원 1', maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED },
  { id: 'isb-agent-2', name: '요원 2', maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED },
  {
    id: 'r10', name: 'R-10', drone: true, weapon: 'laser', maxHp: 400, radius: 48, speed: MAX_SPEED, scale: 1.4,
    image: 'assets/characters/r10.svg',
  },
  // 스토리 모드 4스테이지(도로)의 보스: RPG 두 자루를 든 윌슨 요원(쌍 RPG 전용). 그림은 요원 2에 RPG 두 자루를 덧그린다.
  {
    id: 'wilson', name: '윌슨 요원', hidden: true, weapon: 'dualrpg', maxHp: 800, radius: BODY_RADIUS, speed: MAX_SPEED, scale: 1.2,
    image: 'assets/characters/isb-agent-2.png',
  },
  // 스토리 모드 5스테이지(대교)의 보스: 저격총을 든 존슨 요원(빨간 조준선 3발·체력 절반 아래면 5발). 그림은 요원 1에 저격총을 덧그린다.
  {
    id: 'johnson', name: '존슨 요원', hidden: true, weapon: 'jsniper', maxHp: 800, radius: BODY_RADIUS, speed: MAX_SPEED, scale: 1.2,
    image: 'assets/characters/isb-agent-1.png',
  },
  // 건 카타 수련장의 상대: 훈련용 전투 로봇(선택 화면에는 나오지 않음)
  {
    id: 'training-bot', name: '훈련용 전투 로봇', hidden: true, maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED,
    image: 'assets/characters/training-bot.svg',
  },
  // 숨겨진 캐릭터: 온이름 버튼을 빠르게 2번 누르면 온이름 대신 나타난다. 모든 피해에 +5.
  {
    id: 'arc-trooper', name: '아크 트루퍼', hidden: true, unlockFrom: 'earth-arrow', unlockTaps: 2, bonusDamage: 5,
    // 그림: 장갑 몸통에 온이름 머리. 머리·화살표 때문에 그림판이 넓어 1.25배로 그려 몸 크기를 맞춘다.
    jetpack: true, jetpackNozzle: [0.348, 0.68], scale: 1.25,
    maxHp: MAX_HP, radius: BODY_RADIUS, speed: 420,
  },
  // 스토리 모드 3스테이지(하늘)의 적: 선택 화면에는 나오지 않는다(hidden). aircraft는 위에서 본 비행체로 그린다.
  {
    id: 'gunship', name: '건쉽', hidden: true, aircraft: true, weapon: 'gunship', maxHp: 300, radius: 46, speed: 240,
    image: 'assets/characters/gunship.svg',
  },
  {
    id: 'deathstar', name: '데스스타', hidden: true, aircraft: true, weapon: 'flak', maxHp: 10000, radius: 130, speed: 70,
    image: 'assets/characters/deathstar.svg',
  },
  // 숨겨진 캐릭터: 온이름 버튼을 빠르게 3번 누르면 나타난다. 모습은 온이름 + 몸에 빨간 '제작자'. 즉사기 전용.
  {
    id: 'creator', name: '제작자', hidden: true, unlockFrom: 'earth-arrow', unlockTaps: 3, weapon: 'instakill',
    maxHp: MAX_HP, radius: BODY_RADIUS, speed: MAX_SPEED,
  },
];

/**
 * 전투기: 경기장 가운데 하늘 위를 가로로 지나간다. 높이 날기 때문에 양 팀 탄환은 전투기 밑으로 그냥 지나간다.
 * 화면 안에 있는 동안 missile.interval마다 위(ISB)·아래(지구방위) 양쪽으로 미사일을 한 발씩 쏜다.
 * 미사일은 RPG처럼 터져 폭발 피해를 주고(양 팀 모두 맞음), 유도 없이 똑바로 날아가며,
 * 엄폐물 위로 넘어가 막히지도 깎지도 않는다. 빗나가면 목표 레일 선에서 터진다.
 */
export const JET = {
  y: ARENA_HEIGHT / 2,
  speed: 160,
  firstDelay: [3, 6],
  delay: [5, 11],
  length: 260,
  missile: {
    interval: 1, damage: 20, speed: 640, offset: 60,
    splash: { damage: 8, radius: 120 },
  },
};

/**
 * 탱크: 스토리 4스테이지(도로)에서 전투기 대신 나온다. 도로 가운데 차선을 따라 가로로 지나가며,
 * 화면 안에 있는 동안 shell.interval마다 위(ISB)·아래(지구방위) 양쪽으로 포탄을 한 발씩 쏜다(전투기 미사일과 같은 규칙:
 * 양 팀 모두 맞고, 엄폐물 위로 넘어가며, 빗나가면 목표 레일 선에서 터진다). 탄환은 탱크를 맞히지 못하고 그냥 지나간다.
 */
export const TANK = {
  y: 380, // 가운데 엄폐물(트럭)과 겹치지 않는 차선
  speed: 130,
  firstDelay: [3, 6],
  delay: [6, 12],
  length: 300,
  missile: {
    interval: 1.4, damage: 5, speed: 720, offset: 70,
    splash: { damage: 2, radius: 130 },
  },
};

/**
 * 건 카타 모드(스토리 모드·건 카타 수련장). warn: 버튼이 빛나는 시간 = 눌러야 하는 시간제한(초),
 * gap: 한 공격이 끝나고 다음 공격까지 쉬는 시간 [최소, 최대](초, 그 사이에서 무작위), damage: 못 막았을 때 깎이는 체력.
 * 밸런스 조정의 '건 카타' 칸에서 바꾼다.
 */
export const KATA = { warn: 1.5, gap: [0.55, 0.55], damage: 100 };

/**
 * 배: 스토리 5스테이지(대교)에서 전투기 대신 나온다. 다리 가운데가 벌어지면(openTime초 동안 열림) 그 틈의 강을 따라 가로로 지나가며,
 * 화면 안에 있는 동안 missile.interval마다 위(ISB)·아래(지구방위) 양쪽으로 대포를 한 발씩 쏜다(전투기 미사일과 같은 규칙).
 * 대포알은 맞으면(명중) damage(5), 폭발 범위에 닿으면 splash.damage(2). 배가 지나가면 다리가 다시 닫힌다.
 */
export const SHIP = {
  y: ARENA_HEIGHT / 2,
  speed: 200,
  firstDelay: [5, 8],
  delay: [8, 14],
  length: 460,
  openTime: 1.5,
  missile: {
    interval: 1.2, damage: 5, speed: 700, offset: 70,
    splash: { damage: 2, radius: 120 },
  },
};

/**
 * 대교로 가는 길(윌슨 요원을 물리친 뒤): 눈 내리는 길을 자동차로 달리며 구멍을 피한다. time초 동안 달리면 대교에 도착한다.
 * 구멍에 빠지면 체력 damage가 깎이고(1 아래로는 안 깎임) 잠깐(safe초) 다시 빠지지 않는다. 눈더미에 부딪히면 잠깐 느려진다.
 * steer는 좌우로 움직이는 속도(초당), speed는 길이 흘러가는 속도(초당), holes·drifts는 길 1000마다 놓이는 구멍·눈더미 수.
 */
export const DRIVE = { time: 20, speed: 700, steer: 560, damage: 20, safe: 0.8, holes: 2.4, drifts: 0.6 };

/**
 * 엄폐물: 모든 탄환(아군·적·전투기)을 막는 고정 사각형. 가운데 1개 + 팀 진영마다 1개(점대칭 배치).
 * 내구도 hp가 0이 되면 부서져 그 경기 동안 사라진다. 양 팀 총알과 RPG 폭발 범위가 내구도를 깎고,
 * RPG 직격은 rpgMultiplier배 피해를 준다. 전투기 미사일은 엄폐물을 넘어가 내구도를 깎지 않는다.
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

/**
 * 스토리 모드 2스테이지(복도)의 벽 포탑: 전투기 대신 나온다. 왼쪽 벽 위쪽·오른쪽 벽 아래쪽에 하나씩 붙어 있다.
 * 웨이브 전투 중 burst초 동안 interval마다 플레이어 쪽으로 포탄을 쏘고, rest초 쉬었다가 다시 쏜다(처음엔 firstDelay초 뒤).
 * 포탄은 엄폐물에 막히고, 맞으면 damage, 폭발 범위(splash)에 닿으면 splash.damage. ISB팀(요원)은 맞지 않는다.
 */
export const TURRET = {
  firstDelay: 4, burst: 5, rest: 10, interval: 1, damage: 5, speed: 620,
  splash: { damage: 2, radius: 100 },
};
export const TURRETS = [
  { id: 'turret-left', x: 46, y: 340, dir: 1 },
  { id: 'turret-right', x: ARENA_WIDTH - 46, y: 680, dir: -1 },
];

export const TEAM_COLOR = { earth: '#247BDB', isb: '#D56A26' };
export const TEAM_NAME = { earth: '지구방위팀', isb: 'ISB팀' };
