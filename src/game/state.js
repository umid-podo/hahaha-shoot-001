import { RAIL_Y, COUNTDOWN, MAX_HP, CHARACTERS, WEAPONS, JET } from './config.js';

// 자리(P1~P4)가 팀을 정한다. 캐릭터·총기는 준비 화면에서 자유롭게 바꾸며, 아래는 기본값이다.
export const SLOTS = [
  { id: 'P1', team: 'earth', characterId: 'earth-arrow', weapon: 'rifle' },
  { id: 'P2', team: 'isb', characterId: 'isb-agent-1', weapon: 'dual' },
  { id: 'P3', team: 'earth', characterId: 'earth-pizza', weapon: 'pistol' },
  { id: 'P4', team: 'isb', characterId: 'isb-agent-2', weapon: 'rpg' },
];

export const characterName = (id) => CHARACTERS.find((c) => c.id === id)?.name ?? id;

/** 기본 선택. { P1: { characterId, weapon }, ... } */
export function defaultLoadout(playerCount) {
  return Object.fromEntries(SLOTS.slice(0, playerCount).map((s) => [s.id, { characterId: s.characterId, weapon: s.weapon }]));
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
 * @param {2|4} playerCount
 * @param {Record<string, {characterId: string, weapon: string}>} [loadout]
 */
export function createMatch(playerCount, loadout = defaultLoadout(playerCount), seed = Date.now()) {
  const players = SLOTS.slice(0, playerCount).map((slot, i) => {
    const x = playerCount === 2 ? 800 : i < 2 ? 480 : 1120;
    const pick = loadout[slot.id] ?? {};
    const characterId = pick.characterId ?? slot.characterId;
    const weapon = WEAPONS[pick.weapon] ? pick.weapon : slot.weapon;
    return {
      id: slot.id, team: slot.team, characterId, name: characterName(characterId), weapon,
      x, previousX: x, y: RAIL_Y[slot.team],
      aim: initialAim(slot.team),
      hp: MAX_HP, alive: true, hurt: 0,
      cooldown: 0, burstLeft: 0, burstTimer: 0,
    };
  });
  const rng = createRng(seed);
  return {
    phase: 'countdown', countdown: COUNTDOWN,
    players, projectiles: [], nextProjectileId: 1,
    jet: null, jetTimer: between(rng, JET.firstDelay), rng,
    tick: 0, winner: null,
  };
}

export function createInputs(players) {
  const inputs = {};
  for (const p of players) {
    inputs[p.id] = { moveAxis: 0, touchAxis: 0, aim: initialAim(p.team), aiming: false };
  }
  return inputs;
}

/** 일시정지·포커스 상실 시 호출. 조준 각도는 유지하고 진행 중인 입력(이동·사격)만 버린다. */
export function cancelInputs(inputs) {
  for (const f of Object.values(inputs)) {
    f.moveAxis = 0; f.touchAxis = 0; f.aiming = false;
  }
}
