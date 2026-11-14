import { MIN_X, MAX_X, BULLET_RADIUS, TICK, WEAPONS, RULES, ZONE, JUMP, SHOT_HEIGHT, secondarySlot } from './config.js';
import { segmentRectTime } from './collision.js';
import { lineBlocked } from './terrain.js';
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
 * assist: 조준 보정. AI가 쏜 총알이 가장 가까운 상대 쪽으로 초당 이만큼(라디안) 살짝 휘어 날아간다(명중률 향상, 폭발·화염·던지는 무기 제외).
 * jump: 날아오는 탄을 점프로 피하려 할 확률. hop: 평소에 가끔 뛰는 간격 [최소, 최대](초).
 * 명중률을 크게 올리려고 모든 난이도가 상대 이동을 예측해 겨눈다(lead).
 */
export const DIFFICULTY = {
  easy: {
    name: '쉬움', reaction: 0.5, dodge: 0.2, lead: 0.85, move: 0.55,
    fire: [[1.2, 2.2], [0.5, 1.0]], charge: [0.4, 0.7], grenade: [10, 18], swap: [10, 16], coverAware: false,
    jump: 0.2, hop: [4, 8], assist: 0.9,
  },
  normal: {
    name: '보통', reaction: 0.3, dodge: 0.5, lead: 1, move: 0.8,
    fire: [[2, 3.5], [0.2, 0.5]], charge: [0.2, 0.4], grenade: [5, 10], swap: [8, 12], coverAware: true,
    jump: 0.45, hop: [2.5, 5], assist: 1.4,
  },
  hard: {
    name: '어려움', reaction: 0.15, dodge: 0.8, lead: 1, move: 1,
    fire: [[3, 5], [0, 0.15]], charge: [0.12, 0.22], grenade: [1, 4], swap: [6, 10], coverAware: true,
    jump: 0.7, hop: [1.5, 3.5], assist: 2,
  },
};
export const DIFFICULTY_IDS = Object.keys(DIFFICULTY);

// 탄을 얼마나 멀리(도착까지 남은 시간) 보고 피할지, 판정 원에 더하는 여유
const DODGE_HORIZON = 1.6;
const DODGE_MARGIN = 14;
const BLOCKED_PATIENCE = 1.5;
// 탄을 뛰어넘어 피할 때 점프키를 누르고 있는 시간(이만큼이면 탄 높이 차 hitAbove를 넘게 뛴다)
const AI_DODGE_HOLD = 0.2;

export function createAI(playerId, difficulty = 'normal', seed = Date.now()) {
  const rng = createRng(seed);
  const diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  return {
    playerId, diff, rng,
    dodgeDecisions: new Map(), // 탄 id → 피할지 여부(탄마다 한 번만 정한다)
    wanderX: null, wanderY: null, wanderTimer: 0,
    firing: true, fireTimer: between(rng, diff.fire[0]),
    charge: null, // 떼면 쏘는 무기를 조준 중이면 남은 시간
    blockedFor: 0, // 떼면 쏘는 무기가 엄폐물에 막혀 기다린 시간
    grenadeTimer: between(rng, diff.grenade),
    swapTimer: between(rng, diff.swap),
    hopTimer: between(rng, diff.hop),
    jumpDecisions: new Map(), // 탄 id → 점프로 피할지(탄마다 한 번만 정한다)
  };
}

/** 대상의 이번 틱 이동으로 추정한 속도 */
const velocityX = (p) => (p.x - p.previousX) / TICK;
const velocityY = (p) => (p.y - (p.previousY ?? p.y)) / TICK;
/** 팀 진영의 세로 범위(없으면 경기장 전체) */
const zoneOf = (team) => ZONE[team] ?? { minY: 0, maxY: 1000 };
/** AI가 움직일 범위: 넓은 맵이면 맵 전체, 아니면 자기 진영 */
const areaOf = (match, team) => (match?.wide ? { minX: match.bounds.minX + 60, maxX: match.bounds.maxX - 60, minY: match.bounds.minY + 60, maxY: match.bounds.maxY - 60 }
  : { minX: MIN_X, maxX: MAX_X, ...zoneOf(team) });

/** 무기 탄속(레이저처럼 즉시 닿으면 Infinity) */
function projectileSpeed(me, weaponId) {
  const w = WEAPONS[weaponId];
  if (w.dash) return w.dash.speed;
  return w.speed ? w.speed * (me.bulletSpeedScale ?? 1) : Infinity;
}

/**
 * 상대 플레이어를 향한 조준 각도(1인칭 3D에서는 바라보는 방향도 된다). lead만큼 상대가 움직일 곳을 예측한다.
 */
export function aimAtTarget(me, target, speed, lead, bounds = null) {
  let tx = target.x, ty = target.y;
  if (lead > 0 && Number.isFinite(speed)) {
    const vx = velocityX(target), vy = velocityY(target);
    // 예측한 자리는 상대가 갈 수 있는 범위 안으로(넓은 맵이면 그 맵 범위)
    const minX = bounds?.minX ?? MIN_X, maxX = bounds?.maxX ?? MAX_X;
    const minY = bounds?.minY ?? -Infinity, maxY = bounds?.maxY ?? Infinity;
    for (let i = 0; i < 4; i++) {
      const t = Math.hypot(tx - me.x, ty - me.y) / speed;
      tx = Math.min(maxX, Math.max(minX, target.x + vx * t * lead));
      ty = Math.min(maxY, Math.max(minY, target.y + vy * t * lead));
    }
  }
  return Math.atan2(ty - me.y, tx - me.x);
}

/** (x, y)에서 상대를 향해 쏠 때 부서지지 않은 엄폐물이나 건물·고지대(구조물)가 가로막는지 */
function blockedAt(match, me, x, target, y = me.y) {
  const x0 = x, y0 = y, x1 = target.x, y1 = target.y;
  return match.covers.some((c) => c.hp > 0 && segmentRectTime(
    x0 - c.x, y0 - c.y, x1 - c.x, y1 - c.y, c.w / 2 + BULLET_RADIUS, c.h / 2 + BULLET_RADIUS) !== null)
    || (match.highs?.length > 0 && lineBlocked(match, x0, y0, (me.z ?? 0) + SHOT_HEIGHT, x1, y1, (target.z ?? 0) + SHOT_HEIGHT));
}

/**
 * 나에게 날아오는 탄 목록: { t: 나와 가장 가까워지기까지 남은 시간, x·y: 그때 탄의 자리, reach: 맞는 거리 }.
 * 나온 지 reaction초가 안 된 탄은 아직 못 본 것으로 치고, 탄마다 dodge 확률로 피할지 한 번 정한다.
 */
function threats(ai, match, me) {
  const list = [];
  const seen = new Set();
  const approach = (key, x, y, vx, vy, reach, age, splashy = false) => {
    seen.add(key);
    const rx = me.x - x, ry = me.y - y, v2 = vx * vx + vy * vy;
    if (!v2) return;
    const t = (rx * vx + ry * vy) / v2;
    if (t <= 0 || t > DODGE_HORIZON) return; // 멀어지는 탄·아직 먼 탄
    if (age < ai.diff.reaction) return;
    if (!ai.dodgeDecisions.has(key)) ai.dodgeDecisions.set(key, ai.rng() < ai.diff.dodge);
    if (!ai.dodgeDecisions.get(key)) return;
    list.push({ t, x: x + vx * t, y: y + vy * t, reach, key, splash: splashy });
  };
  for (const b of match.projectiles) {
    if (b.team === me.team || b.ownerId === me.id) continue;
    // 폭발 무기는 폭발 반경까지, 던진 무기는 직격 없이 폭발만
    const direct = b.thrown ? 0 : me.radius + (b.hitRadius ?? BULLET_RADIUS); // 넓은 검기(쌍 카타나)는 더 멀리 비켜야 한다
    const reach = Math.max(direct, b.splash ? b.splash.radius + me.radius : 0) + DODGE_MARGIN;
    approach(b.id, b.x, b.y, b.vx, b.vy, reach, RULES.bulletLife - b.life, !!(b.splash || b.field));
  }
  // 상대의 단검 돌진도 날아오는 탄처럼 피한다(몸끼리 닿는 거리)
  for (const q of match.players) {
    const d = q.dash;
    if (!d || d.returning || q.team === me.team) continue;
    approach(`dash-${q.id}`, q.x, q.y, d.vx, d.vy, me.radius + q.radius + DODGE_MARGIN, d.age);
  }
  for (const id of ai.dodgeDecisions.keys()) if (!seen.has(id)) ai.dodgeDecisions.delete(id);
  return list;
}

/** 이동 방향 (dx, dy)(길이 0~1)를 유지했을 때 날아오는 탄들에 얼마나 위험한지. 0이면 안전. */
function danger(me, dx, dy, speed, list, match = null) {
  const zone = areaOf(match, me.team);
  let sum = 0;
  for (const th of list) {
    const x = Math.min(zone.maxX, Math.max(zone.minX, me.x + dx * speed * th.t));
    const y = Math.min(zone.maxY, Math.max(zone.minY, me.y + dy * speed * th.t));
    const overlap = th.reach - Math.hypot(x - th.x, y - th.y);
    if (overlap > 0) sum += overlap / (th.t + 0.1);
  }
  return sum;
}

/** 피할 때 견주어 보는 방향: 가만히, 8방향 */
const DIRS = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)])];

/**
 * 평소 이동: 자기 진영 안에서 이리저리 자리를 옮기되(앞뒤·좌우), 엄폐물에 막혔으면 상대가 보이는 곳으로 간다.
 * 가려는 쪽 방향 [dx, dy](길이 0~1)를 돌려준다.
 */
function wanderDir(ai, match, me, target, dt) {
  ai.wanderTimer -= dt;
  const zone = areaOf(match, me.team);
  const needsClearShot = ai.diff.coverAware && blockedAt(match, me, me.x, target);
  // 넓은 맵: 상대 둘레 350~700 거리의 자리로 옮겨 다니며 따라간다(멀리 도망가도 쫓아감). 좁은 맵: 자기 진영 안 아무 데나
  const spot = () => {
    // 화염방사기처럼 사거리가 짧은 무기: 진영을 넘어서라도 상대 둘레 120~240 거리로 다가간다
    if (WEAPONS[me.weapon]?.flame) {
      const B = match.bounds ?? { minX: MIN_X, maxX: MAX_X, minY: ZONE.isb.minY, maxY: ZONE.earth.maxY };
      const a = ai.rng() * Math.PI * 2, r = between(ai.rng, [120, 240]);
      return [Math.min(B.maxX, Math.max(B.minX, target.x + Math.cos(a) * r)), Math.min(B.maxY, Math.max(B.minY, target.y + Math.sin(a) * r))];
    }
    if (match.wide) {
      const a = ai.rng() * Math.PI * 2, r = between(ai.rng, [350, 700]);
      return [Math.min(zone.maxX, Math.max(zone.minX, target.x + Math.cos(a) * r)), Math.min(zone.maxY, Math.max(zone.minY, target.y + Math.sin(a) * r))];
    }
    return [between(ai.rng, [MIN_X + 60, MAX_X - 60]), between(ai.rng, [zone.minY + 20, zone.maxY - 20])];
  };
  if (ai.wanderX === null || ai.wanderTimer <= 0 || (needsClearShot && blockedAt(match, me, ai.wanderX, target, ai.wanderY))) {
    ai.wanderTimer = between(ai.rng, [1.2, 3]);
    let [x, y] = spot();
    if (ai.diff.coverAware) {
      for (let i = 0; i < 8 && blockedAt(match, me, x, target, y); i++) [x, y] = spot();
    }
    ai.wanderX = x;
    ai.wanderY = y;
  }
  const gx = ai.wanderX - me.x, gy = (ai.wanderY ?? me.y) - me.y;
  const dist = Math.hypot(gx, gy);
  return dist < 10 ? [0, 0] : [gx / dist, gy / dist];
}

/** 가장 가까운 살아 있는 상대(스토리 모드 2인 협동처럼 상대가 여럿이면 가까운 쪽을 노린다). 없으면 undefined. */
export function nearestTarget(match, me) {
  let best, dist = Infinity;
  for (const p of match.players) {
    if (!p.alive || p.entering || p.team === me.team) continue;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d < dist) { best = p; dist = d; }
  }
  return best;
}

/**
 * 매 틱 step() 전에 호출해 AI 자리의 입력 프레임을 채운다.
 * 조준은 언제나 상대 플레이어를 향하고, 날아오는 탄은 옮겨 다니며 피한다.
 */
export function updateAI(ai, match, inputs, dt = TICK) {
  const me = match.players.find((p) => p.id === ai.playerId);
  const frame = inputs[ai.playerId];
  if (!me || !frame) return;
  const target = nearestTarget(match, me);
  // 스토리 모드에서 헬리콥터에서 내려오는 중인 요원은 아직 움직이지 않는다
  if (!me.alive || me.entering || !target || match.phase !== 'playing') {
    frame.moveAxis = 0;
    frame.moveY = 0;
    frame.aiming = false;
    ai.charge = null;
    if (me.alive && target) frame.aim = aimAtTarget(me, target, projectileSpeed(me, me.weapon), 0);
    return;
  }
  const weapon = WEAPONS[me.weapon];
  me.aimAssist = ai.diff.assist ?? 0;

  // 조준: 무조건 상대 플레이어(이동을 예측해 앞을 겨눈다)
  frame.aim = aimAtTarget(me, target, projectileSpeed(me, me.weapon), ai.diff.lead, match.bounds);

  // 이동: 위험한 탄이 있으면 가장 안전한 방향(8방향·가만히 중), 없으면 평소 이동(자기 진영 안 이곳저곳)
  const speed = me.speed * ai.diff.move;
  const wander = wanderDir(ai, match, me, target, dt);
  const list = threats(ai, match, me);
  let dir = wander;
  if (list.length && danger(me, wander[0], wander[1], speed, list, match) > 0) {
    let best = Infinity;
    for (const d of [wander, ...DIRS]) {
      const risk = danger(me, d[0], d[1], speed, list, match);
      if (risk < best - 1e-6) { best = risk; dir = d; }
    }
  }
  frame.moveAxis = dir[0] * ai.diff.move;
  frame.moveY = dir[1] * ai.diff.move;
  // 가려는데 엄폐물·고지대 옆면에 막혀 거의 못 움직이면 뛰어넘는다(넓은 맵에서 컨테이너 등을 넘어 따라옴)
  const moved = Math.hypot(me.x - (ai.lastX ?? me.x), me.y - (ai.lastY ?? me.y));
  const wants = Math.hypot(dir[0], dir[1]) > 0.3;
  ai.stuck = wants && moved < speed * dt * 0.25 ? (ai.stuck ?? 0) + dt : 0;
  // 높은 구조물에 막혔으면 점프키를 꾹 눌러(최대로 모아) 높이 뛰어오른다
  if (ai.stuck > 0.25) { frame.jump = true; ai.stuck = 0; ai.holdJump = JUMP.holdTime + 0.05; }
  ai.holdJump = Math.max(0, (ai.holdJump ?? 0) - dt);
  frame.jumpHeld = ai.holdJump > 0;
  ai.lastX = me.x; ai.lastY = me.y;
  // 점프: 곧 닿을 탄은 난이도별 확률로 뛰어올라 피하고(탄은 발 높이로 날아와 높이 뛰면 밑으로 지나감), 평소에도 가끔 뛴다
  const soon = list.filter((th) => th.t < 0.35 && !th.splash);
  for (const th of soon) {
    if (!ai.jumpDecisions.has(th.key)) ai.jumpDecisions.set(th.key, ai.rng() < (ai.diff.jump ?? 0));
    // 점프로 피할 때는 탄 위로 넘어갈 만큼(살짝 뛰면 낮으니) 잠깐 꾹 눌러 높이 뛴다
    if (ai.jumpDecisions.get(th.key)) { frame.jump = true; ai.holdJump = Math.max(ai.holdJump ?? 0, AI_DODGE_HOLD); }
  }
  if (ai.jumpDecisions.size > 200) ai.jumpDecisions.clear();
  frame.jumpHeld = ai.holdJump > 0;
  ai.hopTimer = (ai.hopTimer ?? 3) - dt;
  if (ai.hopTimer <= 0) {
    frame.jump = true;
    ai.hopTimer = between(ai.rng, ai.diff.hop ?? [3, 6]);
  }

  // 무기 전환: 가끔 주무기 ↔ 보조무기(가진 것 중 쓸 수 있는 하나). 기관단총이 과열되거나 든 보조무기가 쿨타임이면 바로 주무기로,
  // 쿨타임 중인 보조무기로는 바꾸지 않는다. 카타나는 상대가 가까울 때만, 방패는 날아오는 탄이 있을 때 든다.
  ai.swapTimer -= dt;
  if (!me.primaryOnly) {
    const cooling = (id) => WEAPONS[id]?.ownCooldown && (me.cooldowns[id] ?? 0) > 0;
    const dist = Math.hypot(target.x - me.x, target.y - me.y);
    const usable = (id) => !cooling(id) && !WEAPONS[id]?.boost
      && (id !== 'katana' || dist < WEAPONS.katana.slash.range + 60)
      && (id !== 'riotshield' || (list.length > 0 && !me.shield));
    const smgHot = me.weapon === 'smg' && (me.overheat > 0 || me.heat > WEAPONS.smg.heat.max * 0.85);
    const held = me.slot !== 'primary' ? me.weapon : null;
    const choices = (me.secondaries ?? [me.secondary]).map((id, i) => ({ id, slot: secondarySlot(i) })).filter((c) => usable(c.id));
    // 상대가 가까우면 카타나, 탄이 날아오면 방패를 바로 꺼낸다
    const urgent = choices.find((c) => c.id === 'katana') ?? choices.find((c) => c.id === 'riotshield');
    if ((smgHot || (held && (cooling(held) || (held === 'katana' && !usable('katana'))))) && ai.charge === null) {
      frame.select = 'primary';
      ai.swapTimer = between(ai.rng, ai.diff.swap);
    } else if (urgent && held !== urgent.id && ai.charge === null) {
      frame.select = urgent.slot;
    } else if (ai.swapTimer <= 0 && ai.charge === null) {
      const next = me.slot === 'primary' && choices.length ? choices[Math.floor(ai.rng() * choices.length)].slot : 'primary';
      frame.select = next;
      ai.swapTimer = between(ai.rng, ai.diff.swap);
    }
  }
  // 섬광에 눈이 멀었으면 겨누지도 쏘지도 못하고 허둥댄다
  if ((me.blind ?? 0) > 0) {
    frame.aim += (ai.rng() - 0.5) * 1.2;
    frame.aiming = false;
    ai.charge = null;
    return;
  }
  // 방패: 들었으면 바로 세운다(누르는 무기)
  if (weapon.shield) {
    frame.aiming = !me.shield && !((me.cooldowns[weapon.id] ?? 0) > 0);
    return;
  }

  // 수류탄: 쿨타임이 끝나고 난이도별 대기가 지나면 상대 쪽으로 던진다.
  ai.grenadeTimer -= dt;
  if (!me.primaryOnly && me.grenadeCooldown <= 0 && ai.grenadeTimer <= 0) {
    frame.item = true;
    ai.grenadeTimer = WEAPONS.grenade.interval + between(ai.rng, ai.diff.grenade);
  }

  // 사격
  if (weapon.trigger === 'release') {
    const blocked = ai.diff.coverAware && blockedAt(match, me, me.x, target);
    ai.blockedFor = blocked ? ai.blockedFor + dt : 0;
    const clear = !blocked || ai.blockedFor >= BLOCKED_PATIENCE;
    if (ai.charge === null) {
      if (me.cooldown <= 0 && !((me.cooldowns[weapon.id] ?? 0) > 0) && clear) {
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
  // 배터리 무기(R-10 레이저 캐논)는 계속 누르고 있는다: 배터리가 바닥날 때까지(3점사 5번, 약 3초) 쏘고, 완충(2초)되면 다시 쏜다.
  if (weapon.battery) {
    frame.aiming = true;
    return;
  }
  ai.fireTimer -= dt;
  if (ai.fireTimer <= 0) {
    ai.firing = !ai.firing;
    ai.fireTimer = between(ai.rng, ai.diff.fire[ai.firing ? 0 : 1]);
  }
  frame.aiming = ai.firing;
}

