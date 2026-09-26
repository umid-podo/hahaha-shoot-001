import {
  RAIL_Y, COUNTDOWN, MAX_HP, BODY_RADIUS, MAX_SPEED, ARENA_WIDTH, CHARACTERS, WEAPONS, PRIMARY_IDS, JET, COVERS, COVER,
  STEEL, STEEL_SPOTS,
} from './config.js';

// 2인 전용. 자리(P1·P2)가 팀을 정한다. 캐릭터·주무기는 준비 화면에서 자유롭게 바꾸며, 아래는 기본값(그림 속 무기)이다.
export const SLOTS = [
  { id: 'P1', team: 'earth', characterId: 'earth-arrow', weapon: 'dual' },
  { id: 'P2', team: 'isb', characterId: 'isb-agent-1', weapon: 'pistol' },
];

export const characterOf = (id) => CHARACTERS.find((c) => c.id === id);
export const characterName = (id) => characterOf(id)?.name ?? id;

/** 기본 선택. { P1: { characterId, weapon }, P2: ... } */
export function defaultLoadout() {
  return Object.fromEntries(SLOTS.map((s) => [s.id, { characterId: s.characterId, weapon: s.weapon }]));
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
 * @param {Record<string, {characterId: string, weapon: string}>} [loadout]
 * 자리별 선택에 싱글플레이 AI 설정을 더할 수 있다: ai(true면 AI가 조작), maxHp(체력),
 * bulletSpeedScale(탄속 배율), damage({ primary, secondary, grenade } 칸별 피해).
 */
export function createMatch(loadout = defaultLoadout(), seed = Date.now()) {
  const players = SLOTS.map((slot) => {
    const x = ARENA_WIDTH / 2;
    const pick = loadout[slot.id] ?? {};
    const characterId = characterOf(pick.characterId) ? pick.characterId : slot.characterId;
    const character = characterOf(characterId);
    // 드론은 전용 무기 고정. 그 외에는 고른 주무기(주무기 목록에 없으면 자리 기본값).
    const weapon = character.weapon ?? (PRIMARY_IDS.includes(pick.weapon) ? pick.weapon : slot.weapon);
    const maxHp = pick.maxHp > 0 ? Math.round(pick.maxHp) : character.maxHp ?? MAX_HP;
    return {
      id: slot.id, team: slot.team, characterId, name: pick.ai ? `${character.name} (AI)` : character.name,
      ai: !!pick.ai, bulletSpeedScale: pick.bulletSpeedScale > 0 ? pick.bulletSpeedScale : 1, damage: pick.damage ?? null,
      drone: !!character.drone, scale: character.scale ?? 1,
      radius: character.radius ?? BODY_RADIUS, speed: character.speed ?? MAX_SPEED,
      primary: weapon, slot: 'primary', weapon,
      battery: WEAPONS[weapon].battery?.shots ?? 0, sinceShot: Infinity, heat: 0, overheat: 0, grenadeCooldown: 0,
      x, previousX: x, y: RAIL_Y[slot.team],
      aim: initialAim(slot.team),
      hp: maxHp, maxHp, alive: true, hurt: 0,
      cooldown: 0, burstLeft: 0, burstTimer: 0, wasAiming: false,
    };
  });
  const rng = createRng(seed);
  return {
    phase: 'countdown', countdown: COUNTDOWN,
    players, projectiles: [], nextProjectileId: 1,
    covers: [...COVERS.map((c) => ({ ...c, hp: COVER.hp })), ...steelCovers(players)],
    jet: null, jetTimer: between(rng, JET.firstDelay), rng,
    tick: 0, winner: null, stats: createStats(players),
  };
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

export function createInputs(players) {
  const inputs = {};
  for (const p of players) {
    // swap: 주무기↔보조무기 전환, select: 누른 무기 칸('primary'·'secondary')으로 바로 전환, item: 수류탄 던지기
    inputs[p.id] = { moveAxis: 0, touchAxis: 0, aim: initialAim(p.team), aiming: false, swap: false, select: null, item: false };
  }
  return inputs;
}

/** 일시정지·포커스 상실 시 호출. 조준 각도는 유지하고 진행 중인 입력(이동·사격)만 버린다. */
export function cancelInputs(inputs) {
  for (const f of Object.values(inputs)) {
    f.moveAxis = 0; f.touchAxis = 0; f.aiming = false; f.swap = false; f.select = null; f.item = false;
  }
}
