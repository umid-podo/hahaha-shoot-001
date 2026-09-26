import { MIN_X, MAX_X, BULLET_RADIUS, TICK, WEAPONS, RULES } from './config.js';
import { segmentRectTime } from './collision.js';
import { createRng, between } from './state.js';

/** 싱글플레이 AI 캐릭터는 요원들 중에서만 무작위로 고른다. */
export const AI_CHARACTERS = ['isb-agent-1', 'isb-agent-2'];

/**
 * 난이도별 AI 성향.
 * reaction: 탄을 알아채기까지 걸리는 시간(초). dodge: 알아챈 탄을 피하려 할 확률.
 * lead: 상대 이동을 예측해 앞을 조준하는 정도(0 = 지금 위치, 1 = 완전 예측). 조준은 언제나 상대 플레이어를 향한다.
 * move: 이동 속도 비율. fire: [쏘는 시간, 쉬는 시간] 범위(초, 자동 연사 무기). charge: 떼면 쏘는 무기를 조준하는 시간.
 * grenade: 수류탄을 던지고 다음에 던질 생각을 하기까지의 추가 대기.
 * coverAware: 엄폐물에 막히면 상대가 보이는 자리로 옮긴다. 자동 연사 무기는 막혀도 쏴서 엄폐물을 깎고,
 * 떼면 쏘는 무기(RPG·저격총)는 BLOCKED_PATIENCE초까지 트인 자리를 기다린다.
 */
export const DIFFICULTY = {
  easy: {
    name: '쉬움', reaction: 0.5, dodge: 0.2, lead: 0, move: 0.55,
    fire: [[0.8, 1.6], [0.8, 1.6]], charge: [0.7, 1.2], grenade: [10, 18], swap: [10, 16], coverAware: false,
  },
  normal: {
    name: '보통', reaction: 0.3, dodge: 0.5, lead: 0.6, move: 0.8,
    fire: [[1.5, 3], [0.3, 0.8]], charge: [0.35, 0.6], grenade: [5, 10], swap: [8, 12], coverAware: true,
  },
  hard: {
    name: '어려움', reaction: 0.15, dodge: 0.8, lead: 1, move: 1,
    fire: [[3, 5], [0, 0.15]], charge: [0.15, 0.3], grenade: [1, 4], swap: [6, 10], coverAware: true,
  },
};
export const DIFFICULTY_IDS = Object.keys(DIFFICULTY);

// 탄을 얼마나 멀리(도착까지 남은 시간) 보고 피할지, 판정 원에 더하는 여유
const DODGE_HORIZON = 1.6;
const DODGE_MARGIN = 14;
const BLOCKED_PATIENCE = 1.5;

export function createAI(playerId, difficulty = 'normal', seed = Date.now()) {
  const rng = createRng(seed);
  const diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  return {
    playerId, diff, rng,
    dodgeDecisions: new Map(), // 탄 id → 피할지 여부(탄마다 한 번만 정한다)
    wanderX: null, wanderTimer: 0,
    firing: true, fireTimer: between(rng, diff.fire[0]),
    charge: null, // 떼면 쏘는 무기를 조준 중이면 남은 시간
    blockedFor: 0, // 떼면 쏘는 무기가 엄폐물에 막혀 기다린 시간
    grenadeTimer: between(rng, diff.grenade),
    swapTimer: between(rng, diff.swap),
  };
}

/** 대상의 이번 틱 이동으로 추정한 X 속도 */
const velocityX = (p) => (p.x - p.previousX) / TICK;

/** 무기 탄속(레이저처럼 즉시 닿으면 Infinity) */
function projectileSpeed(me, weaponId) {
  const w = WEAPONS[weaponId];
  return w.speed ? w.speed * (me.bulletSpeedScale ?? 1) : Infinity;
}

/**
 * 상대 플레이어를 향한 조준 각도. lead만큼 상대가 움직일 곳을 예측한다.
 * 결과는 자기 팀의 조준 반원(상단 [0, π], 하단 [-π, 0]) 안으로 맞춘다.
 */
export function aimAtTarget(me, target, speed, lead) {
  let tx = target.x;
  if (lead > 0 && Number.isFinite(speed)) {
    const vx = velocityX(target);
    for (let i = 0; i < 2; i++) {
      const t = Math.hypot(tx - me.x, target.y - me.y) / speed;
      tx = Math.min(MAX_X, Math.max(MIN_X, target.x + vx * t * lead));
    }
  }
  const angle = Math.atan2(target.y - me.y, tx - me.x);
  return me.team === 'isb' ? Math.min(Math.PI, Math.max(0, angle)) : Math.min(0, Math.max(-Math.PI, angle));
}

/** x에서 상대를 향해 쏠 때 부서지지 않은 엄폐물이 가로막는지 */
function blockedAt(match, me, x, target) {
  const x0 = x, y0 = me.y, x1 = target.x, y1 = target.y;
  return match.covers.some((c) => c.hp > 0 && segmentRectTime(
    x0 - c.x, y0 - c.y, x1 - c.x, y1 - c.y, c.w / 2 + BULLET_RADIUS, c.h / 2 + BULLET_RADIUS) !== null);
}

/**
 * 나에게 날아오는 탄 목록: { t: 내 레일에 닿기까지 남은 시간, x: 그때 X, reach: 맞는 거리 }.
 * 나온 지 reaction초가 안 된 탄은 아직 못 본 것으로 치고, 탄마다 dodge 확률로 피할지 한 번 정한다.
 */
function threats(ai, match, me) {
  const list = [];
  const seen = new Set();
  for (const b of match.projectiles) {
    if (b.team === me.team || b.ownerId === me.id) continue;
    seen.add(b.id);
    const dy = me.y - b.y;
    if (dy * b.vy <= 0) continue; // 멀어지는 탄
    if (RULES.bulletLife - b.life < ai.diff.reaction) continue;
    if (!ai.dodgeDecisions.has(b.id)) ai.dodgeDecisions.set(b.id, ai.rng() < ai.diff.dodge);
    if (!ai.dodgeDecisions.get(b.id)) continue;
    const t = dy / b.vy;
    if (t > DODGE_HORIZON) continue;
    // 폭발 무기는 폭발 반경까지, 던진 무기는 직격 없이 폭발만
    const direct = b.thrown ? 0 : me.radius + BULLET_RADIUS;
    const reach = Math.max(direct, b.splash ? b.splash.radius + me.radius : 0) + DODGE_MARGIN;
    list.push({ t, x: b.x + b.vx * t, reach });
  }
  for (const id of ai.dodgeDecisions.keys()) if (!seen.has(id)) ai.dodgeDecisions.delete(id);
  return list;
}

/** 이동 방향 dir(-1·0·1)을 유지했을 때 날아오는 탄들에 얼마나 위험한지. 0이면 안전. */
function danger(me, dir, speed, list) {
  let sum = 0;
  for (const th of list) {
    const x = Math.min(MAX_X, Math.max(MIN_X, me.x + dir * speed * th.t));
    const overlap = th.reach - Math.abs(x - th.x);
    if (overlap > 0) sum += overlap / (th.t + 0.1);
  }
  return sum;
}

/** 평소 이동: 이리저리 자리를 옮기되, 엄폐물에 막혔으면 상대가 보이는 곳으로 간다. */
function wanderAxis(ai, match, me, target, dt) {
  ai.wanderTimer -= dt;
  const needsClearShot = ai.diff.coverAware && blockedAt(match, me, me.x, target);
  if (ai.wanderX === null || ai.wanderTimer <= 0 || (needsClearShot && blockedAt(match, me, ai.wanderX, target))) {
    ai.wanderTimer = between(ai.rng, [1.2, 3]);
    let x = between(ai.rng, [MIN_X + 60, MAX_X - 60]);
    if (ai.diff.coverAware) {
      for (let i = 0; i < 8 && blockedAt(match, me, x, target); i++) x = between(ai.rng, [MIN_X + 60, MAX_X - 60]);
    }
    ai.wanderX = x;
  }
  const gap = ai.wanderX - me.x;
  return Math.abs(gap) < 10 ? 0 : Math.sign(gap);
}

/**
 * 매 틱 step() 전에 호출해 AI 자리의 입력 프레임을 채운다.
 * 조준은 언제나 상대 플레이어를 향하고, 날아오는 탄은 옮겨 다니며 피한다.
 */
export function updateAI(ai, match, inputs, dt = TICK) {
  const me = match.players.find((p) => p.id === ai.playerId);
  const frame = inputs[ai.playerId];
  if (!me || !frame) return;
  const target = match.players.find((p) => p.alive && p.team !== me.team);
  if (!me.alive || !target || match.phase !== 'playing') {
    frame.moveAxis = 0;
    frame.aiming = false;
    ai.charge = null;
    if (me.alive && target) frame.aim = aimAtTarget(me, target, projectileSpeed(me, me.weapon), 0);
    return;
  }
  const weapon = WEAPONS[me.weapon];

  // 조준: 무조건 상대 플레이어
  frame.aim = aimAtTarget(me, target, projectileSpeed(me, me.weapon), ai.diff.lead);

  // 이동: 위험한 탄이 있으면 가장 안전한 방향, 없으면 평소 이동
  const speed = me.speed * ai.diff.move;
  const wander = wanderAxis(ai, match, me, target, dt);
  const list = threats(ai, match, me);
  let axis = wander;
  if (list.length && danger(me, wander, speed, list) > 0) {
    let best = Infinity;
    for (const dir of [wander, -1, 1, 0]) {
      const d = danger(me, dir, speed, list);
      if (d < best - 1e-6) { best = d; axis = dir; }
    }
  }
  frame.moveAxis = axis * ai.diff.move;

  // 무기 전환: 가끔 주무기 ↔ 기관단총. 기관단총이 과열되면 바로 주무기로.
  ai.swapTimer -= dt;
  if (!me.drone) {
    const smgHot = me.weapon === 'smg' && (me.overheat > 0 || me.heat > WEAPONS.smg.heat.max * 0.85);
    if (smgHot) {
      frame.select = 'primary';
      ai.swapTimer = between(ai.rng, ai.diff.swap);
    } else if (ai.swapTimer <= 0 && ai.charge === null) {
      frame.select = me.slot === 'primary' ? 'secondary' : 'primary';
      ai.swapTimer = between(ai.rng, ai.diff.swap);
    }
  }

  // 수류탄: 쿨타임이 끝나고 난이도별 대기가 지나면 상대 쪽으로 던진다.
  ai.grenadeTimer -= dt;
  if (!me.drone && me.grenadeCooldown <= 0 && ai.grenadeTimer <= 0) {
    frame.item = true;
    ai.grenadeTimer = WEAPONS.grenade.interval + between(ai.rng, ai.diff.grenade);
  }

  // 사격
  if (weapon.trigger === 'release') {
    const blocked = ai.diff.coverAware && blockedAt(match, me, me.x, target);
    ai.blockedFor = blocked ? ai.blockedFor + dt : 0;
    const clear = !blocked || ai.blockedFor >= BLOCKED_PATIENCE;
    if (ai.charge === null) {
      if (me.cooldown <= 0 && clear) {
        ai.blockedFor = 0;
        ai.charge = between(ai.rng, ai.diff.charge);
        frame.aiming = true;
      } else {
        frame.aiming = false;
      }
    } else {
      ai.charge -= dt;
      frame.aiming = ai.charge > 0; // 조준을 풀면 step()에서 한 발 나간다
      if (ai.charge <= 0) ai.charge = null;
    }
    return;
  }
  ai.fireTimer -= dt;
  if (ai.fireTimer <= 0) {
    ai.firing = !ai.firing;
    ai.fireTimer = between(ai.rng, ai.diff.fire[ai.firing ? 0 : 1]);
  }
  frame.aiming = ai.firing;
}

