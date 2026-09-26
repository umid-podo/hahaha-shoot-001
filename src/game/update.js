import {
  ARENA_WIDTH, ARENA_HEIGHT, RAIL_Y, MIN_X, MAX_X, MAX_SPEED, BODY_RADIUS, BULLET_RADIUS,
  MUZZLE_OFFSET, BULLET_LIFE, TICK, WEAPONS, SWAP_TIME, SLOT_ORDER, SLOT_WEAPON, JET, COVER,
} from './config.js';
import { segmentCircleTime, segmentRectTime } from './collision.js';
import { between } from './state.js';

const HIT_RADIUS = BODY_RADIUS + BULLET_RADIUS;
const OUT_MARGIN = 40;
const HURT_TIME = 0.2;
const ENEMY_RAIL = { earth: RAIL_Y.isb, isb: RAIL_Y.earth };
const LASER_LENGTH = 2400;
// 0.1초 같은 간격이 1/60초 틱의 부동소수 오차로 한 틱 밀리지 않도록 쓰는 여유
const EPS = 1e-9;

export function spawnProjectile(match, player, aim) {
  const weapon = WEAPONS[player.weapon];
  const x = player.x + Math.cos(aim) * MUZZLE_OFFSET;
  const y = player.y + Math.sin(aim) * MUZZLE_OFFSET;
  const projectile = {
    id: match.nextProjectileId++, ownerId: player.id, team: player.team, weapon: weapon.id,
    x, y, previousX: x, previousY: y,
    vx: Math.cos(aim) * weapon.speed, vy: Math.sin(aim) * weapon.speed,
    life: BULLET_LIFE, damage: weapon.damage,
    splash: weapon.splash, homing: weapon.homing, endY: ENEMY_RAIL[player.team],
    // 던진 무기는 아무것에도 닿지 않고 목표 레일 선에서 터진다. startY는 포물선 표시용.
    thrown: !!weapon.thrown, overCovers: !!weapon.thrown, startY: y,
  };
  match.projectiles.push(projectile);
  return projectile;
}

/**
 * 전투기 미사일: 위(ISB 쪽)·아래(지구방위 쪽)로 똑바로 한 발씩. 팀이 'jet'이라 양 팀 모두 맞고,
 * overCovers는 엄폐물을 넘어간다는 뜻이다.
 */
function fireJet(match, jet, events) {
  const { missile } = JET;
  for (const [dy, targetTeam] of [[-1, 'isb'], [1, 'earth']]) {
    const y = jet.y + dy * missile.offset;
    match.projectiles.push({
      id: match.nextProjectileId++, ownerId: 'jet', team: 'jet', weapon: 'jet',
      x: jet.x, y, previousX: jet.x, previousY: y,
      vx: 0, vy: dy * missile.speed,
      life: BULLET_LIFE, damage: missile.damage,
      splash: missile.splash, endY: RAIL_Y[targetTeam], overCovers: true,
    });
  }
  events.push({ type: 'jet-fire', x: jet.x, y: jet.y });
}

/** 전투기를 움직이고 화면 안에서는 주기적으로 쏜다. 화면을 벗어나면 다음 등장까지 무작위로 기다린다. */
function updateJet(match, dt, events) {
  const { jet } = match;
  if (jet) {
    jet.previousX = jet.x;
    jet.x += jet.dir * JET.speed * dt;
    const edge = JET.length / 2 + OUT_MARGIN;
    if (jet.x < -edge || jet.x > ARENA_WIDTH + edge) {
      match.jet = null;
      match.jetTimer = between(match.rng, JET.delay);
      return;
    }
    jet.fireTimer -= dt;
    if (jet.fireTimer <= 0) {
      jet.fireTimer += JET.missile.interval;
      if (jet.x >= 0 && jet.x <= ARENA_WIDTH) fireJet(match, jet, events);
    }
    return;
  }
  match.jetTimer -= dt;
  if (match.jetTimer > 0) return;
  const dir = match.rng() < 0.5 ? 1 : -1;
  const x = dir > 0 ? -JET.length / 2 : ARENA_WIDTH + JET.length / 2;
  match.jet = { x, previousX: x, y: JET.y, dir, fireTimer: JET.missile.interval };
}

/** 유도탄: 가장 가까운 살아있는 적 쪽으로 turnRate 한도 안에서 꺾는다. 속력은 그대로. */
function steer(match, b, turnRate, dt) {
  let target = null, best = Infinity;
  for (const p of match.players) {
    if (!p.alive || p.team === b.team) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < best) { best = d; target = p; }
  }
  if (!target) return;
  const heading = Math.atan2(b.vy, b.vx);
  let diff = Math.atan2(target.y - b.y, target.x - b.x) - heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // [-π, π]
  const max = turnRate * dt;
  const next = heading + Math.max(-max, Math.min(max, diff));
  const speed = Math.hypot(b.vx, b.vy);
  b.vx = Math.cos(next) * speed; b.vy = Math.sin(next) * speed;
}

/**
 * 아무것도 맞히지 못한 폭발탄(RPG·전투기 미사일)이 경로 끝에 닿았는지. 목표 레일 선(endY)을 넘은 지점,
 * 경기장 밖으로 나간 지점, 수명이 다한 지점 중 먼저인 곳의 좌표를 돌려준다. 아직이면 null.
 */
function rocketEnd(b) {
  const railY = b.endY;
  if ((b.previousY - railY) * (b.y - railY) <= 0 && b.previousY !== railY) {
    const t = (railY - b.previousY) / (b.y - b.previousY);
    return { x: b.previousX + (b.x - b.previousX) * t, y: railY };
  }
  const out = b.x < 0 || b.x > ARENA_WIDTH || b.y < 0 || b.y > ARENA_HEIGHT;
  if (out || b.life <= 0) {
    return { x: Math.max(0, Math.min(ARENA_WIDTH, b.x)), y: Math.max(0, Math.min(ARENA_HEIGHT, b.y)) };
  }
  return null;
}

/** 탄환이 이번 틱에 부서지지 않은 엄폐물에 닿는 가장 이른 접촉 { t, cover }. 없으면 null. */
function coverContact(match, b) {
  let earliest = null;
  for (const c of match.covers) {
    if (c.hp <= 0) continue;
    const t = segmentRectTime(
      b.previousX - c.x, b.previousY - c.y, b.x - c.x, b.y - c.y,
      c.w / 2 + BULLET_RADIUS, c.h / 2 + BULLET_RADIUS);
    if (t !== null && (earliest === null || t < earliest.t)) earliest = { t, cover: c };
  }
  return earliest;
}

/** 엄폐물 내구도 감소. 0이 되면 부서짐 이벤트를 낸다. */
function damageCover(cover, amount, events) {
  if (cover.steel || cover.hp <= 0 || amount <= 0) return; // 강철 엄폐물은 부서지지 않는다
  cover.hp = Math.max(0, cover.hp - amount);
  events.push({ type: 'cover-hit', coverId: cover.id, damage: amount });
  if (cover.hp === 0) events.push({ type: 'cover-break', coverId: cover.id, x: cover.x, y: cover.y });
}

/** 탄 한 발이 엄폐물에 주는 피해. RPG 직격은 배수 적용. */
function coverDamage(b) {
  return b.weapon === 'rpg' ? b.damage * COVER.rpgMultiplier : b.damage;
}

/** 탄환이 이번 틱에 전투기에 닿는 가장 이른 시각. 전투기 진행 방향에 따라 판정도 좌우 반전된다. */
function jetContactTime(jet, b) {
  let earliest = null;
  for (const box of JET.hitboxes) {
    const ox = jet.dir * box.dx;
    const t = segmentRectTime(
      b.previousX - jet.previousX - ox, b.previousY - jet.y, b.x - jet.x - ox, b.y - jet.y,
      box.w / 2 + BULLET_RADIUS, box.h / 2 + BULLET_RADIUS);
    if (t !== null && (earliest === null || t < earliest)) earliest = t;
  }
  return earliest;
}

function damage(victim, amount, team, events) {
  victim.hp = Math.max(0, victim.hp - amount);
  victim.hurt = HURT_TIME;
  events.push({ type: 'hit', x: victim.x, y: victim.y, team, damage: amount, victimId: victim.id });
}

/** RPG 폭발: 직접 맞은 대상을 뺀 주변 살아있는 적과, 범위에 걸친 엄폐물에 범위 피해. */
function explode(match, b, x, y, directVictim, directCover, events) {
  const { splash } = b;
  events.push({ type: 'explode', x, y, radius: splash.radius });
  for (const p of match.players) {
    if (!p.alive || p.team === b.team || p === directVictim) continue;
    if (Math.hypot(p.x - x, p.y - y) <= splash.radius + BODY_RADIUS) damage(p, splash.damage, b.team, events);
  }
  for (const c of match.covers) {
    // 전투기 미사일은 엄폐물을 깎지 않는다. 수류탄은 엄폐물을 넘어 날아가지만 폭발은 엄폐물도 깎는다.
    if (b.team === 'jet' || c.hp <= 0 || c === directCover) continue;
    // 폭발 중심에서 엄폐물 사각형까지의 최단 거리
    const dx = Math.max(0, Math.abs(x - c.x) - c.w / 2);
    const dy = Math.max(0, Math.abs(y - c.y) - c.h / 2);
    if (Math.hypot(dx, dy) <= splash.radius) damageCover(c, splash.damage, events);
  }
}

/** 다음 무기로 교체. 점사는 끊기고 SWAP_TIME 동안은 쏘지 못한다. */
/** 주무기 → 보조무기 → 수류탄 → 주무기 순으로 전환. 점사는 끊기고 SWAP_TIME 동안은 쏘지 못한다. */
function swapWeapon(p, events) {
  p.slot = SLOT_ORDER[(SLOT_ORDER.indexOf(p.slot) + 1) % SLOT_ORDER.length];
  p.weapon = p.slot === 'primary' ? p.primary : SLOT_WEAPON[p.slot];
  p.burstLeft = 0;
  p.cooldown = Math.max(p.cooldown, SWAP_TIME);
  events.push({ type: 'swap', playerId: p.id, weapon: p.weapon, slot: p.slot });
}

/** 레이저: 조준 방향으로 즉시 뻗어 가장 먼저 닿는 엄폐물·전투기·적에서 멈춘다. */
function fireLaser(match, p, weapon, events) {
  const cos = Math.cos(p.aim), sin = Math.sin(p.aim);
  const x0 = p.x + cos * MUZZLE_OFFSET, y0 = p.y + sin * MUZZLE_OFFSET;
  const x1 = x0 + cos * LASER_LENGTH, y1 = y0 + sin * LASER_LENGTH;
  const ray = { previousX: x0, previousY: y0, x: x1, y: y1 };
  let best = { t: 1 };
  const cover = coverContact(match, ray);
  if (cover) best = cover;
  if (match.jet) {
    const t = jetContactTime({ ...match.jet, previousX: match.jet.x }, ray);
    if (t !== null && t < best.t) best = { t, jet: true };
  }
  for (const q of match.players) {
    if (!q.alive || q.team === p.team) continue;
    const t = segmentCircleTime(x0 - q.x, y0 - q.y, x1 - q.x, y1 - q.y, BODY_RADIUS);
    if (t !== null && t < best.t) best = { t, victim: q };
  }
  const x = x0 + (x1 - x0) * best.t, y = y0 + (y1 - y0) * best.t;
  events.push({ type: 'fire', playerId: p.id, weapon: weapon.id });
  events.push({ type: 'laser', playerId: p.id, x1: x0, y1: y0, x2: x, y2: y });
  if (best.victim) damage(best.victim, weapon.damage, p.team, events);
  else if (best.cover || best.jet) events.push({ type: 'block', x, y });
  if (best.cover) damageCover(best.cover, weapon.damage, events);
}

function fire(match, p, events) {
  const weapon = WEAPONS[p.weapon];
  p.sinceShot = 0;
  if (weapon.battery) p.battery--;
  if (weapon.heat) {
    p.heat += weapon.interval;
    if (p.heat >= weapon.heat.max - 1e-9) {
      p.overheat = weapon.heat.cooldown;
      events.push({ type: 'overheat', playerId: p.id });
    }
  }
  if (weapon.beam) { fireLaser(match, p, weapon, events); return; }
  spawnProjectile(match, p, p.aim);
  events.push({ type: 'fire', playerId: p.id, weapon: p.weapon });
}

/** 탄약 외 제약(배터리·과열·수류탄 쿨타임) 때문에 지금 쏠 수 없는지. */
function blocked(p, weapon) {
  if (weapon.battery) return p.battery <= 0;
  if (weapon.heat) return p.overheat > 0;
  if (weapon.id === 'grenade') return p.grenadeCooldown > 0;
  return false;
}

/** 배터리 충전, 기관단총 냉각, 수류탄 쿨타임. 무기를 들고 있지 않아도 시간은 흐른다. */
function updateResources(p, firing, dt) {
  p.sinceShot += dt;
  p.grenadeCooldown = Math.max(0, p.grenadeCooldown - dt);
  const battery = WEAPONS[p.primary].battery;
  if (battery && p.sinceShot >= battery.recharge) p.battery = battery.shots;
  const { heat } = WEAPONS.smg;
  if (p.overheat > 0) {
    p.overheat = Math.max(0, p.overheat - dt);
    if (p.overheat === 0) p.heat = 0;
  } else if (!firing) {
    p.heat = Math.max(0, p.heat - heat.decay * dt);
  }
}

/**
 * 고정 틱 한 번. 렌더·사운드용 이벤트 목록을 돌려준다.
 * 순서: 전투기(이동·사격) → 플레이어 이동·자동 발사 → 탄환 이동·충돌(엄폐물·전투기·적, 엄폐물 내구도) → 쓰러짐·승패.
 */
export function step(match, inputs, dt = TICK) {
  const events = [];
  if (match.phase === 'countdown') {
    // 일시정지 해제 등으로 조준이 끊긴 것을 '손을 뗌'으로 보지 않도록 초기화
    for (const p of match.players) p.wasAiming = false;
    match.countdown -= dt;
    if (match.countdown <= 0) match.phase = 'playing';
    return events;
  }
  if (match.phase !== 'playing') return events;
  match.tick++;

  updateJet(match, dt, events);

  for (const p of match.players) {
    p.previousX = p.x;
    p.hurt = Math.max(0, p.hurt - dt);
    if (!p.alive) continue;
    const input = inputs[p.id];
    if (input.swap) {
      input.swap = false;
      if (!p.drone) swapWeapon(p, events); // 드론은 주무기 하나뿐
    }
    const weapon = WEAPONS[p.weapon];
    p.cooldown = Math.max(0, p.cooldown - dt);
    updateResources(p, weapon.heat && input.aiming, dt);
    p.x = Math.min(MAX_X, Math.max(MIN_X, p.x + input.moveAxis * MAX_SPEED * dt));
    p.aim = input.aim;
    // 점사 중인 남은 탄은 조준을 풀어도 끝까지 나간다.
    if (p.burstLeft > 0) {
      p.burstTimer -= dt;
      if (p.burstTimer <= 0) {
        fire(match, p, events);
        p.burstLeft--;
        p.burstTimer += weapon.burstGap;
      }
    } else if (p.cooldown <= EPS && !blocked(p, weapon) &&
      (weapon.trigger === 'release' ? p.wasAiming && !input.aiming : input.aiming)) {
      fire(match, p, events);
      if (weapon.id === 'grenade') p.grenadeCooldown = weapon.interval;
      else p.cooldown = weapon.interval;
      p.burstLeft = weapon.burst - 1;
      p.burstTimer = weapon.burstGap ?? 0;
    }
    p.wasAiming = input.aiming;
  }

  const removed = new Set();
  const contacts = [];
  for (const b of match.projectiles) {
    b.previousX = b.x; b.previousY = b.y;
    if (b.homing) steer(match, b, b.homing.turnRate, dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    let earliest = null;
    if (b.thrown) continue; // 던진 무기는 날아가는 동안 아무것에도 닿지 않는다
    const coverHit = b.overCovers ? null : coverContact(match, b);
    if (coverHit) earliest = { t: coverHit.t, projectile: b, victim: null, cover: coverHit.cover };
    // 전투기 자신이 쏜 탄은 전투기에 막히지 않는다.
    if (match.jet && b.team !== 'jet') {
      const t = jetContactTime(match.jet, b);
      if (t !== null && (earliest === null || t < earliest.t)) earliest = { t, projectile: b, victim: null };
    }
    for (const p of match.players) {
      if (!p.alive || p.team === b.team) continue;
      const t = segmentCircleTime(
        b.previousX - p.previousX, b.previousY - p.y, b.x - p.x, b.y - p.y, HIT_RADIUS);
      if (t !== null && (earliest === null || t < earliest.t)) earliest = { t, projectile: b, victim: p };
    }
    if (earliest) contacts.push(earliest);
  }
  contacts.sort((a, b) => a.t - b.t || a.projectile.id - b.projectile.id);

  // 같은 틱에 먼저 맞은 탄으로 엄폐물이 부서져도, 이미 그 엄폐물에 닿은 나머지 탄은 막힌 것으로 처리한다.
  for (const { t, projectile: b, victim, cover } of contacts) {
    removed.add(b);
    const x = b.previousX + (b.x - b.previousX) * t;
    const y = b.previousY + (b.y - b.previousY) * t;
    if (victim) damage(victim, b.damage, b.team, events);
    else events.push({ type: 'block', x, y });
    if (cover) damageCover(cover, coverDamage(b), events);
    if (b.splash) explode(match, b, x, y, victim, cover, events);
  }

  // 빗나간 RPG·전투기 미사일은 경로 끝에서 터져 주변에 폭발 피해를 준다.
  for (const b of match.projectiles) {
    if (removed.has(b) || !b.splash) continue;
    const end = rocketEnd(b);
    if (!end) continue;
    removed.add(b);
    explode(match, b, end.x, end.y, null, null, events);
  }

  // 같은 틱의 피해를 모두 반영한 뒤 쓰러짐을 판정한다.
  for (const p of match.players) {
    if (p.alive && p.hp <= 0) {
      p.alive = false;
      events.push({ type: 'down', playerId: p.id, x: p.x, y: p.y });
    }
  }

  match.projectiles = match.projectiles.filter((b) =>
    !removed.has(b) && b.life > 0 &&
    b.x > -OUT_MARGIN && b.x < ARENA_WIDTH + OUT_MARGIN && b.y > -OUT_MARGIN && b.y < ARENA_HEIGHT + OUT_MARGIN);

  // 팀 전원이 쓰러지면 패배. 같은 틱에 양 팀이 모두 쓰러지면 무승부.
  const earthUp = match.players.some((p) => p.team === 'earth' && p.alive);
  const isbUp = match.players.some((p) => p.team === 'isb' && p.alive);
  if (!earthUp || !isbUp) {
    match.winner = !earthUp && !isbUp ? 'draw' : earthUp ? 'earth' : 'isb';
    match.phase = 'result';
    match.projectiles = [];
    events.push({ type: 'result', winner: match.winner });
  }
  return events;
}
