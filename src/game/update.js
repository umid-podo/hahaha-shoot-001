import {
  ARENA_WIDTH, ARENA_HEIGHT, MIN_X, MAX_X, MAX_SPEED, BODY_RADIUS, BULLET_RADIUS,
  MUZZLE_OFFSET, BULLET_LIFE, TICK, WEAPONS, JET,
} from './config.js';
import { segmentCircleTime, segmentRectTime } from './collision.js';
import { between } from './state.js';

const HIT_RADIUS = BODY_RADIUS + BULLET_RADIUS;
const OUT_MARGIN = 40;
const HURT_TIME = 0.2;

export function spawnProjectile(match, player, aim) {
  const weapon = WEAPONS[player.weapon];
  const x = player.x + Math.cos(aim) * MUZZLE_OFFSET;
  const y = player.y + Math.sin(aim) * MUZZLE_OFFSET;
  const projectile = {
    id: match.nextProjectileId++, ownerId: player.id, team: player.team, weapon: weapon.id,
    x, y, previousX: x, previousY: y,
    vx: Math.cos(aim) * weapon.speed, vy: Math.sin(aim) * weapon.speed,
    life: BULLET_LIFE,
  };
  match.projectiles.push(projectile);
  return projectile;
}

/** 전투기를 움직이고, 화면을 벗어나면 다음 등장까지 무작위로 기다린다. */
function updateJet(match, dt) {
  const { jet } = match;
  if (jet) {
    jet.previousX = jet.x;
    jet.x += jet.dir * JET.speed * dt;
    const edge = JET.length / 2 + OUT_MARGIN;
    if (jet.x < -edge || jet.x > ARENA_WIDTH + edge) {
      match.jet = null;
      match.jetTimer = between(match.rng, JET.delay);
    }
    return;
  }
  match.jetTimer -= dt;
  if (match.jetTimer > 0) return;
  const dir = match.rng() < 0.5 ? 1 : -1;
  const x = dir > 0 ? -JET.length / 2 : ARENA_WIDTH + JET.length / 2;
  match.jet = { x, previousX: x, y: JET.y, dir };
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

/** RPG 폭발: 직접 맞은 대상을 뺀 주변 살아있는 적에게 범위 피해. */
function explode(match, b, x, y, directVictim, events) {
  const { splash } = WEAPONS[b.weapon];
  events.push({ type: 'explode', x, y });
  for (const p of match.players) {
    if (!p.alive || p.team === b.team || p === directVictim) continue;
    if (Math.hypot(p.x - x, p.y - y) <= splash.radius + BODY_RADIUS) damage(p, splash.damage, b.team, events);
  }
}

function fire(match, p, events) {
  spawnProjectile(match, p, p.aim);
  events.push({ type: 'fire', playerId: p.id, weapon: p.weapon });
}

/**
 * 고정 틱 한 번. 렌더·사운드용 이벤트 목록을 돌려준다.
 * 순서: 전투기 → 플레이어 이동·자동 발사 → 탄환 이동·충돌 → 쓰러짐·승패.
 */
export function step(match, inputs, dt = TICK) {
  const events = [];
  if (match.phase === 'countdown') {
    match.countdown -= dt;
    if (match.countdown <= 0) match.phase = 'playing';
    return events;
  }
  if (match.phase !== 'playing') return events;
  match.tick++;

  updateJet(match, dt);

  for (const p of match.players) {
    p.previousX = p.x;
    p.hurt = Math.max(0, p.hurt - dt);
    if (!p.alive) continue;
    const input = inputs[p.id];
    const weapon = WEAPONS[p.weapon];
    p.cooldown = Math.max(0, p.cooldown - dt);
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
    } else if (input.aiming && p.cooldown <= 0) {
      fire(match, p, events);
      p.cooldown = weapon.interval;
      p.burstLeft = weapon.burst - 1;
      p.burstTimer = weapon.burstGap ?? 0;
    }
  }

  const removed = new Set();
  const contacts = [];
  for (const b of match.projectiles) {
    b.previousX = b.x; b.previousY = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    let earliest = null;
    if (match.jet) {
      const t = jetContactTime(match.jet, b);
      if (t !== null) earliest = { t, projectile: b, victim: null };
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

  for (const { t, projectile: b, victim } of contacts) {
    removed.add(b);
    const x = b.previousX + (b.x - b.previousX) * t;
    const y = b.previousY + (b.y - b.previousY) * t;
    if (victim) damage(victim, WEAPONS[b.weapon].damage, b.team, events);
    else events.push({ type: 'block', x, y });
    if (WEAPONS[b.weapon].splash) explode(match, b, x, y, victim, events);
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
