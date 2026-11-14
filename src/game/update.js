import {
  ARENA_WIDTH, ARENA_HEIGHT, MIN_X, MAX_X, MIN_Y, MAX_Y, BULLET_RADIUS, ZONE, JUMP, COVER_HEIGHT,
  MUZZLE_OFFSET, TICK, WEAPONS, RULES, SLOT_ORDER, secondaryIndex, secondarySlot, FLIGHT, JET, TANK, SHIP, COVER, EVADE, PAD, VERTICAL_AIM, PITCH, SHOT_HEIGHT,
} from './config.js';
import { segmentCircleTime, segmentRectTime } from './collision.js';
import { highAt, groundAt, structureHit, lineBlocked } from './terrain.js';

export { highAt, groundAt };
import { between } from './state.js';
import {
  updateStory, holdsResult, startsCutscene, startCutscene, updateCutscene, updateKillcam, startKillcam,
} from './story.js';
import { needsGunKata, startGunKata, updateGunKata, kataOn } from './gunkata.js';

const OUT_MARGIN = 40;
/** 경기의 이동 범위(넓은 맵이면 FIELD, 아니면 원래 경기장) */
const boundsOf = (match) => match.bounds ?? { minX: MIN_X, maxX: MAX_X, minY: MIN_Y, maxY: MAX_Y };
/** 탄이 사라지는 바깥 경계: 원래 경기장, 넓은 맵이면 그 둘레(난간)까지 */
const fieldOf = (match) => (match.wide ? { x0: match.bounds.minX - 60, x1: match.bounds.maxX + 60, y0: match.bounds.minY - 60, y1: match.bounds.maxY + 60 }
  : { x0: 0, x1: ARENA_WIDTH, y0: 0, y1: ARENA_HEIGHT });
const HURT_TIME = 0.2;
// 0.1초 같은 간격이 1/60초 틱의 부동소수 오차로 한 틱 밀리지 않도록 쓰는 여유
const EPS = 1e-9;

/** 무기 칸 이름: 수류탄은 'grenade', 고른 주무기는 'primary', 그 밖(기관단총)은 'secondary'. */
function slotOf(player, weaponId) {
  if (weaponId === 'grenade' || weaponId === 'missile') return 'grenade'; // 아이템 칸
  return weaponId === player.primary ? 'primary' : 'secondary';
}

/**
 * 이 플레이어가 이 무기로 주는 피해 { damage, splash }. 싱글플레이 AI처럼 player.damage[칸]이 있으면 그 값을 쓴다.
 * 수류탄은 폭발 피해를, RPG처럼 직격+폭발 무기는 직격 피해를 바꾸고 폭발 피해는 같은 비율로 맞춘다.
 */
export function weaponDamage(player, weaponId) {
  const { damage, splash } = baseDamage(player, weaponId);
  // damageScale: 스토리 모드 적의 피해 배율(기본 1)
  const scale = player.damageScale ?? 1;
  if (scale === 1) return { damage, splash };
  return {
    damage: Math.round(damage * scale),
    splash: splash && { ...splash, damage: Math.round(splash.damage * scale) },
  };
}

function baseDamage(player, weaponId) {
  const weapon = WEAPONS[weaponId];
  const override = player.damage?.[slotOf(player, weaponId)];
  if (!Number.isFinite(override)) return { damage: weapon.damage, splash: weapon.splash };
  if (weapon.thrown) return weapon.splash ? { damage: 0, splash: { ...weapon.splash, damage: override } } : { damage: 0, splash: undefined };
  const splash = weapon.splash && {
    ...weapon.splash,
    damage: weapon.damage > 0 ? Math.round((weapon.splash.damage * override) / weapon.damage) : weapon.splash.damage,
  };
  return { damage: override, splash };
}

/**
 * 탄 한 발을 만든다. offset은 조준 방향에 수직으로 비켜 놓는 거리(나란히 쏘는 화살),
 * group은 한 번에 함께 나간 탄들의 공용 기록(명중 수를 방아쇠 한 번당 한 번만 세려고)이다.
 */
export function spawnProjectile(match, player, aim, weaponId = player.weapon, { offset = 0, group = null } = {}) {
  const weapon = WEAPONS[weaponId];
  const { damage: base, splash } = weaponDamage(player, weaponId);
  // 과냉각 중 주무기는 연사가 빨라지는 대신 한 발 피해가 boost.damage(기본 1)
  const boost = player.boost > 0 && weaponId === player.primary ? WEAPONS[(player.secondaries ?? [player.secondary]).find((id) => WEAPONS[id]?.boost)]?.boost : null;
  const damage = Number.isFinite(boost?.damage) ? boost.damage : base;
  // bulletSpeedScale: 싱글플레이 AI 탄속 배율(기본 1)
  const speed = weapon.speed * (player.bulletSpeedScale ?? 1);
  // 위아래 시선(pitch): 사람 플레이어는 바라보는 높낮이 그대로 쏜다(가로 속도 cos, 위아래 속도 sin). 던지는 무기는 포물선이라 빼고
  const pitch = weapon.thrown ? 0 : clampPitch(player.pitch ?? 0);
  const flat = Math.cos(pitch);
  const x = player.x + Math.cos(aim) * MUZZLE_OFFSET * flat - Math.sin(aim) * offset;
  const y = player.y + Math.sin(aim) * MUZZLE_OFFSET * flat + Math.cos(aim) * offset;
  // 화염방사기 불꽃은 짧게 살고, 에너지 돌격소총 볼트는 튕길 횟수를 갖는다. 유탄처럼 수명이 정해진 탄도 있다
  const life = weapon.flame ? weapon.flame.life : weapon.life ?? RULES.bulletLife;
  // 위아래 자동 조준: 높이가 크게 다른 상대를 겨누면 탄이 그 높이로 기울어 날아간다(던진 무기는 포물선이라 빼고)
  // AI(위아래 시선이 없음)는 예전처럼 높이가 크게 다른 상대 쪽으로 기울여 쏜다
  const vz = weapon.thrown ? 0 : pitch ? Math.sin(pitch) * speed : player.ai ? verticalAim(match, player, aim, speed) : 0;
  const projectile = {
    id: match.nextProjectileId++, ownerId: player.id, team: player.team, weapon: weapon.id,
    x, y, previousX: x, previousY: y,
    vx: Math.cos(aim) * speed * flat, vy: Math.sin(aim) * speed * flat,
    life, damage,
    // AI 조준 보정(player.aimAssist): 폭발·화염·던지는 무기가 아닌 총알은 상대 쪽으로 살짝 휘어 날아간다
    splash, homing: weapon.homing ?? (player.aimAssist > 0 && !splash && !weapon.flame && !weapon.thrown ? { turnRate: player.aimAssist } : undefined),
    ...(vz ? { vz } : {}),
    // 감전(에너지 RPG 폭발): 맞은 적이 shock초 동안 움직이지도 쏘지도 못함. 전기 장판(전기충격기 발사기): 떨어진 자리에 퍼짐
    ...(weapon.shock ? { shock: weapon.shock } : {}),
    ...(weapon.field ? { field: weapon.field } : {}),
    // 화염폭탄: 떨어진 자리에 불길, 섬광탄: 떨어진 자리에서 섬광
    ...(weapon.fire ? { fire: weapon.fire } : {}),
    ...(weapon.flash ? { flash: weapon.flash } : {}),
    ...(weapon.bounces > 0 ? { bounces: weapon.bounces } : {}),
    ...(weapon.flame ? { flame: true, maxLife: life } : {}),
    // connected: 이 탄이 적에게 한 번이라도 피해를 줬는지(명중 수 통계용). group이 있으면 그쪽에 기록한다.
    connected: false, group,
    // z: 쏜 사람 발 높이(높이가 다른 사람은 hitBelow~hitAbove 안일 때만 맞고, coverClear보다 높으면 엄폐물 위로 지나감).
    // 실제로 날아가는 높이는 z + SHOT_HEIGHT(총 높이)이고, 위아래로 쏘면 z가 vz만큼 바뀐다
    z: (player.z ?? 0) + Math.sin(pitch) * MUZZLE_OFFSET,
    // 던진 무기는 아무것에도 닿지 않고 조준 방향으로 RULES.throwRange만큼 날아가 터진다. startX·startY는 날아간 거리(포물선 높이)용.
    thrown: !!weapon.thrown, overCovers: !!weapon.thrown, startX: x, startY: y,
    // 던지는 무기는 고개를 들수록 멀리, 숙일수록 가까이 떨어진다
    ...(weapon.thrown ? { range: (weapon.range ?? RULES.throwRange) * Math.max(0.3, Math.min(1.8, 1 + (player.pitch ?? 0))) } : {}),
  };
  match.projectiles.push(projectile);
  return projectile;
}

/** 위아래 시선 각도를 PITCH.max 안으로 */
export const clampPitch = (a) => Math.max(-PITCH.max, Math.min(PITCH.max, Number.isFinite(a) ? a : 0));

/**
 * 위아래 자동 조준(AI): 조준 방향 VERTICAL_AIM.cone도 안에서 가장 가까운 상대가 서 있는 바닥과 내 바닥의 높이 차이가 VERTICAL_AIM.minDz보다 크면,
 * 탄이 그 상대 자리에 닿을 때 그 높이가 되도록 위아래 속도(초당)를 돌려준다. 점프 높이가 아니라 서 있는 바닥 높이로 정하므로
 * 뛰어올라 탄을 피하는 것은 그대로 된다. 없으면 0.
 */
function verticalAim(match, player, aim, speed) {
  if (!match?.players || !(speed > 0)) return 0;
  const cone = (VERTICAL_AIM.cone * Math.PI) / 180;
  let best = null, bestD = Infinity;
  for (const q of match.players) {
    if (!q.alive || q.team === player.team || q.entering) continue;
    const d = Math.hypot(q.x - player.x, q.y - player.y);
    if (d < 1 || d >= bestD) continue;
    const diff = Math.atan2(Math.sin(Math.atan2(q.y - player.y, q.x - player.x) - aim), Math.cos(Math.atan2(q.y - player.y, q.x - player.x) - aim));
    if (Math.abs(diff) > cone) continue;
    best = q; bestD = d;
  }
  if (!best) return 0;
  // 나는 사람(강습 건쉽)은 바닥이 아니라 떠 있는 높이로 겨눈다
  const from = player.flier ? player.z ?? 0 : groundAt(match, player.x, player.y, player.z ?? 0);
  const to = best.flier ? best.z ?? 0 : groundAt(match, best.x, best.y, best.z ?? 0);
  const dz = to - from;
  if (Math.abs(dz) < VERTICAL_AIM.minDz) return 0;
  return dz / (bestD / speed);
}

/** 전투기 종류(kind)별 설정: 탱크(4스테이지 도로)·배(5스테이지 대교)·전투기 */
const JET_KINDS = { tank: TANK, ship: SHIP };
const configOf = (kind) => JET_KINDS[kind] ?? JET;
/** 지금 경기에 나올 전투기 종류: 스토리 4스테이지(도로)는 탱크, 5스테이지(대교)는 배, 그 밖에는 전투기(undefined) */
const jetKind = (match) => ({ road: 'tank', bridge: 'ship' })[match.story?.stage];

/**
 * 전투기 미사일(탱크 포탄·배 대포알): 위(ISB 진영)·아래(지구방위 진영) 쪽으로 한 발씩, 그 진영에서 가장 가까운 살아 있는 플레이어가
 * 있던 자리를 노려 쏘고 그 자리(range)에서 터진다(없으면 진영 가운데). 팀이 'jet'이라 양 팀 모두 맞고,
 * overCovers는 엄폐물을 넘어간다는 뜻이다. 탱크·배는 쏜 쪽·무기가 'tank'·'ship'(결과 화면에 '탱크'·'배')이다.
 */
function fireJet(match, jet, events) {
  const { missile } = configOf(jet.kind);
  const source = jet.kind ?? 'jet';
  for (const [dy, team] of [[-1, 'isb'], [1, 'earth']]) {
    const y = jet.y + dy * missile.offset;
    let target = null, best = Infinity;
    for (const p of match.players) {
      if (!p.alive || p.entering || p.team !== team) continue;
      const d = Math.hypot(p.x - jet.x, p.y - y);
      if (d < best) { best = d; target = p; }
    }
    const tx = target?.x ?? jet.x, ty = target?.y ?? (ZONE[team].minY + ZONE[team].maxY) / 2;
    const aim = Math.atan2(ty - y, tx - jet.x);
    match.projectiles.push({
      id: match.nextProjectileId++, ownerId: source, team: 'jet', weapon: source,
      x: jet.x, y, previousX: jet.x, previousY: y, startX: jet.x, startY: y,
      vx: Math.cos(aim) * missile.speed, vy: Math.sin(aim) * missile.speed,
      life: RULES.bulletLife, damage: missile.damage, connected: false,
      splash: missile.splash, range: Math.hypot(tx - jet.x, ty - y), overCovers: true,
    });
  }
  events.push({ type: `${source}-fire`, x: jet.x, y: jet.y });
}

/**
 * 전투기(도로에서는 탱크, 대교에서는 배)를 움직이고 화면 안에서는 주기적으로 쏜다. 화면을 벗어나면 다음 등장까지 무작위로 기다린다.
 * 탱크는 도로 가운데 차선을, 배는 벌어진 다리 틈의 강을 따라 지나간다(kind 'tank'·'ship').
 */
function updateJet(match, dt, events) {
  const { jet } = match;
  if (jet) {
    const cfg = configOf(jet.kind);
    jet.previousX = jet.x;
    jet.x += jet.dir * cfg.speed * dt;
    const edge = cfg.length / 2 + OUT_MARGIN;
    if (jet.x < -edge || jet.x > ARENA_WIDTH + edge) {
      match.jet = null;
      match.jetTimer = between(match.rng, cfg.delay);
      return;
    }
    jet.fireTimer -= dt;
    if (jet.fireTimer <= 0) {
      jet.fireTimer += cfg.missile.interval;
      if (jet.x >= 0 && jet.x <= ARENA_WIDTH) fireJet(match, jet, events);
    }
    return;
  }
  match.jetTimer -= dt;
  if (match.jetTimer > 0) return;
  const kind = jetKind(match);
  const cfg = configOf(kind);
  const dir = match.rng() < 0.5 ? 1 : -1;
  const x = dir > 0 ? -cfg.length / 2 : ARENA_WIDTH + cfg.length / 2;
  match.jet = { x, previousX: x, y: cfg.y, dir, fireTimer: cfg.missile.interval, ...(kind ? { kind } : {}) };
}

/** 유도탄: 가장 가까운 살아있는 적 쪽으로 turnRate 한도 안에서 꺾는다. 속력은 그대로. */
function steer(match, b, turnRate, dt) {
  let target = null, best = Infinity;
  for (const p of match.players) {
    if (!p.alive || p.team === b.team || p.entering) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < best) { best = d; target = p; }
  }
  if (!target) return;
  const heading = Math.atan2(b.vy, b.vx);
  // 상대가 움직이는 쪽 조금 앞(탄이 닿을 때쯤 있을 자리 쪽으로 1/4만큼)을 노린다
  const speed0 = Math.hypot(b.vx, b.vy) || 1;
  const lead = Math.hypot(target.x - b.x, target.y - b.y) / speed0 * 0.25;
  const tvx = (target.x - (target.previousX ?? target.x)) / TICK, tvy = (target.y - (target.previousY ?? target.y)) / TICK;
  let diff = Math.atan2(target.y + tvy * lead - b.y, target.x + tvx * lead - b.x) - heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // [-π, π]
  const max = turnRate * dt;
  const next = heading + Math.max(-max, Math.min(max, diff));
  const speed = Math.hypot(b.vx, b.vy);
  b.vx = Math.cos(next) * speed; b.vy = Math.sin(next) * speed;
  // 위아래로도 쫓는 유도탄(강습 건쉽 유도미사일): 닿을 때쯤 적 몸 높이가 되도록 위아래 속도를 조금씩 맞춘다
  if (b.homing?.vertical && b.z !== undefined) {
    const t = Math.max(0.05, Math.hypot(target.x - b.x, target.y - b.y) / Math.max(1, speed));
    const want = ((target.z ?? 0) + 20 - b.z) / t;
    const dv = speed * turnRate * dt;
    b.vz = (b.vz ?? 0) + Math.max(-dv, Math.min(dv, want - (b.vz ?? 0)));
  }
}

/**
 * 아무것도 맞히지 못한 폭발탄(RPG·수류탄·전투기 미사일)이 경로 끝에 닿았는지. 목표 거리(range)만큼 날아간 지점,
 * 경기장 밖으로 나간 지점(벽), 수명이 다한 지점 중 먼저인 곳의 좌표를 돌려준다. 아직이면 null.
 */
export function rocketEnd(b, match = null) {
  if (b.range !== undefined) {
    const sx = b.startX ?? b.previousX, sy = b.startY ?? b.previousY;
    const before = Math.hypot(b.previousX - sx, b.previousY - sy), after = Math.hypot(b.x - sx, b.y - sy);
    if (after >= b.range) {
      const t = after > before ? Math.max(0, Math.min(1, (b.range - before) / (after - before))) : 1;
      return { x: b.previousX + (b.x - b.previousX) * t, y: b.previousY + (b.y - b.previousY) * t };
    }
  }
  const f = match ? fieldOf(match) : { x0: 0, x1: ARENA_WIDTH, y0: 0, y1: ARENA_HEIGHT };
  const out = b.x < f.x0 || b.x > f.x1 || b.y < f.y0 || b.y > f.y1;
  if (out || b.life <= 0) {
    return { x: Math.max(f.x0, Math.min(f.x1, b.x)), y: Math.max(f.y0, Math.min(f.y1, b.y)) };
  }
  return null;
}

/** 엄폐물이 놓인 바닥 높이(고지대 위에 놓였으면 그 높이). 처음 한 번만 잰다 */
function coverBase(match, c) {
  c.base ??= groundAt(match, c.x, c.y, 0); // 다리 밑에 놓인 엄폐물은 바닥(0)에
  return c.base;
}

/**
 * 탄환이 이번 틱에 부서지지 않은 엄폐물에 닿는 가장 이른 접촉 { t, cover }. 없으면 null.
 * 높이도 본다: 닿는 순간 탄의 발 높이가 엄폐물 바닥 + coverClear보다 높으면 위로 넘어가고, 엄폐물보다 한참 아래(고지대 밑)면 맞지 않는다.
 */
function coverContact(match, b) {
  let earliest = null;
  const z0 = b.previousZ ?? b.z ?? 0, z1 = b.z ?? 0;
  for (const c of match.covers) {
    if (c.hp <= 0) continue;
    const t = segmentRectTime(
      b.previousX - c.x, b.previousY - c.y, b.x - c.x, b.y - c.y,
      c.w / 2 + BULLET_RADIUS, c.h / 2 + BULLET_RADIUS);
    if (t === null || (earliest !== null && t >= earliest.t)) continue;
    const z = z0 + (z1 - z0) * t, base = coverBase(match, c);
    if (z - base > JUMP.coverClear || z + SHOT_HEIGHT < base) continue;
    earliest = { t, cover: c };
  }
  return earliest;
}

/**
 * 튕기는 탄을 엄폐물 면에서 반사한다. (x, y)는 닿은 자리. 덜 파고든 쪽(가로·세로) 면에 닿은 것으로 보고 그 축의 속도를 뒤집는다.
 * 다음 틱에 같은 면에 다시 닿지 않도록 면 바깥으로 살짝 띄워 둔다.
 */
function bounceOffCover(b, c, x, y) {
  const hw = c.w / 2 + BULLET_RADIUS, hh = c.h / 2 + BULLET_RADIUS;
  const dx = (x - c.x) / hw, dy = (y - c.y) / hh;
  if (Math.abs(dx) >= Math.abs(dy)) {
    b.vx = -b.vx;
    b.x = c.x + Math.sign(dx || -b.vx || 1) * (hw + 1);
    b.y = y;
  } else {
    b.vy = -b.vy;
    b.x = x;
    b.y = c.y + Math.sign(dy || -b.vy || 1) * (hh + 1);
  }
  b.previousX = b.x; b.previousY = b.y;
  b.bounces--;
  b.bounced = (b.bounced ?? 0) + 1;
}

/** 튕기는 탄을 구조물·바닥·천장 면(axis 'x'·'y'·'h')에서 반사한다. 닿은 자리에서 살짝 물러나 다시 날아간다 */
function bounceOffWall(b, axis, x, y, z) {
  const speed = Math.hypot(b.vx, b.vy, b.vz ?? 0) || 1;
  b.x = x - (b.vx / speed) * 2; b.y = y - (b.vy / speed) * 2;
  if (b.z !== undefined) b.z = z - ((b.vz ?? 0) / speed) * 2;
  if (axis === 'x') b.vx = -b.vx;
  else if (axis === 'y') b.vy = -b.vy;
  else b.vz = -(b.vz ?? 0);
  b.previousX = b.x; b.previousY = b.y; b.previousZ = b.z ?? 0;
  b.bounces--;
  b.bounced = (b.bounced ?? 0) + 1;
}

/** 튕기는 탄이 반사되는 벽(경기장 끝): 넓은 맵은 이동 범위 둘레, 원래 경기장은 화면 테두리 */
const wallsOf = (match) => (match.wide ? match.bounds : { minX: 0, maxX: ARENA_WIDTH, minY: 0, maxY: ARENA_HEIGHT });

/** 탄이 벽(walls)을 넘었으면 거울처럼 되돌리고 그 축의 속도를 뒤집는다. 튕겼으면 true */
function bounceOffWalls(b, walls) {
  let hit = false;
  for (const [axis, v, lo, hi] of [['x', 'vx', walls.minX, walls.maxX], ['y', 'vy', walls.minY, walls.maxY]]) {
    if (b.bounces <= 0) break;
    if (b[axis] < lo || b[axis] > hi) {
      const edge = b[axis] < lo ? lo : hi;
      b[axis] = 2 * edge - b[axis];
      b[v] = -b[v];
      b.bounces--;
      b.bounced = (b.bounced ?? 0) + 1;
      hit = true;
    }
  }
  if (hit) { b.previousX = b.x; b.previousY = b.y; }
  return hit;
}

/** 쏜 사람·무기의 통계 칸. 전투기처럼 플레이어가 아니면 null. */
function weaponStats(match, ownerId, weaponId) {
  const stats = match.stats?.[ownerId];
  if (!stats) return null;
  return (stats.weapons[weaponId] ??= { shots: 0, hits: 0, damage: 0, coverDamage: 0 });
}

/** 엄폐물 내구도 감소. 0이 되면 부서짐 이벤트를 낸다. shot은 깎은 탄(통계용). */
function damageCover(match, cover, amount, shot, events) {
  if (cover.steel || cover.hp <= 0 || amount <= 0) return; // 강철 엄폐물은 부서지지 않는다
  const dealt = Math.min(cover.hp, amount);
  cover.hp = Math.max(0, cover.hp - amount);
  const ws = weaponStats(match, shot.ownerId, shot.weapon);
  if (ws) ws.coverDamage += dealt;
  events.push({ type: 'cover-hit', coverId: cover.id, damage: amount });
  if (cover.hp === 0) events.push({ type: 'cover-break', coverId: cover.id, x: cover.x, y: cover.y });
}

/**
 * 단검 돌진 중(가고 돌아오는 동안 모두)에는 무적: 탄·폭발·레이저·돌진에 맞지 않는다.
 * 스토리 모드에서 헬리콥터에서 내려오는 중인 적도 아직 맞지 않는다.
 */
export const invulnerable = (p) => !!p.dash || !!p.entering;

/** 탄 한 발이 엄폐물에 주는 피해. RPG 직격은 배수 적용. */
function coverDamage(b) {
  return b.weapon === 'rpg' ? b.damage * COVER.rpgMultiplier : b.damage;
}

/**
 * 플레이어 피해. shot은 피해를 준 탄(또는 레이저 한 발) { team, ownerId, weapon, connected }이며,
 * 쏜 사람의 무기별 피해·명중과 맞은 사람의 받은 피해를 통계에 더한다. 통계의 피해는 실제로 깎인 체력이다.
 */
function damage(match, victim, amount, shot, events, from = null) {
  // bonusDamage: 추가 피해가 있는 캐릭터(아크 트루퍼)가 상대 플레이어에게 준 피해마다 더한다
  const attacker = match.players.find((p) => p.id === shot.ownerId);
  amount += attacker?.bonusDamage ?? 0;
  // 폭동 진압 방패: 앞쪽(방패 각도 안)에서 온 공격이면 남은 방패만큼 막는다
  if (victim.shield && from && amount > 0 && fromFront(victim, from)) {
    const absorbed = Math.min(amount, victim.shield.hp);
    victim.shield.hp -= absorbed;
    amount -= absorbed;
    events.push({ type: 'shield-hit', playerId: victim.id, x: victim.x, y: victim.y, absorbed, left: victim.shield.hp });
    if (victim.shield.hp <= 0) { victim.shield = null; events.push({ type: 'shield-break', playerId: victim.id, x: victim.x, y: victim.y }); }
    if (amount <= 0) return;
  }
  // 회피(돌진) 중에는 피해를 30% 덜 받는다
  if (victim.evade && amount > 0) amount = Math.max(1, Math.round(amount * EVADE.taken));
  const dealt = Math.min(victim.hp, amount);
  victim.hp = Math.max(0, victim.hp - amount);
  victim.hurt = HURT_TIME;
  events.push({ type: 'hit', x: victim.x, y: victim.y, team: shot.team, damage: amount, victimId: victim.id, ownerId: shot.ownerId, weapon: shot.weapon });
  const ws = weaponStats(match, shot.ownerId, shot.weapon);
  // 샷건·석궁처럼 여러 발이 함께 나가면 한 번이라도 맞은 방아쇠 한 번을 명중 1로 센다.
  const tracker = shot.group ?? shot;
  if (ws) {
    ws.damage += dealt;
    if (!tracker.connected) ws.hits++;
  }
  tracker.connected = true;
  const taken = match.stats?.[victim.id];
  if (taken) {
    taken.taken += dealt;
    taken.takenFrom[shot.ownerId] = (taken.takenFrom[shot.ownerId] ?? 0) + dealt;
    if (victim.hp <= 0 && !taken.killedBy) taken.killedBy = { ownerId: shot.ownerId, weapon: shot.weapon };
  }
}

/** 공격이 온 자리(from)가 방패 앞쪽(바라보는 방향 ± arc/2)인지 */
function fromFront(victim, from) {
  const arc = ((WEAPONS.riotshield.shield.arc ?? 140) * Math.PI) / 360;
  const a = Math.atan2(from.y - victim.y, from.x - victim.x);
  return Math.abs(Math.atan2(Math.sin(a - victim.aim), Math.cos(a - victim.aim))) <= arc;
}

/** 폭동 진압 방패를 세운다: shield.time초 동안 앞쪽 공격 shield.hp만큼 막음(다시 세우면 새로 가득) */
function raiseShield(p, weapon, events) {
  p.shield = { hp: weapon.shield.hp, t: weapon.shield.time, max: weapon.shield.hp };
  events.push({ type: 'fire', playerId: p.id, weapon: weapon.id });
  events.push({ type: 'shield-up', playerId: p.id, x: p.x, y: p.y });
}

/**
 * 카타나: 앞을 가로로 벤다. 바라보는 방향 ± slash.arc/2 부채꼴, slash.range(+몸 반지름) 안의 적 모두(높이 차 150 안,
 * 구조물에 가리지 않은)에게 피해. 무적(돌진 중·내려오는 중)은 맞지 않는다.
 */
function slashKatana(match, p, weapon, events) {
  const { range, arc } = weapon.slash;
  const half = (arc * Math.PI) / 360;
  const dmg = weaponDamage(p, weapon.id).damage;
  const shot = { team: p.team, ownerId: p.id, weapon: weapon.id, connected: false };
  const z = p.z ?? 0;
  for (const q of match.players) {
    if (!q.alive || q.team === p.team || invulnerable(q)) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > range + q.radius || Math.abs((q.z ?? 0) - z) > 150) continue;
    const a = Math.atan2(q.y - p.y, q.x - p.x);
    if (d > q.radius && Math.abs(Math.atan2(Math.sin(a - p.aim), Math.cos(a - p.aim))) > half) continue;
    if (lineBlocked(match, p.x, p.y, z + SHOT_HEIGHT, q.x, q.y, (q.z ?? 0) + SHOT_HEIGHT)) continue;
    damage(match, q, dmg, shot, events, { x: p.x, y: p.y });
  }
  events.push({ type: 'fire', playerId: p.id, weapon: weapon.id });
  events.push({ type: 'slash', playerId: p.id, x: p.x, y: p.y, h: z, aim: p.aim, range, arc });
}

/** RPG 폭발: 직접 맞은 대상을 뺀 주변 살아있는 적과, 범위에 걸친 엄폐물에 범위 피해. */
function explode(match, b, x, y, directVictim, directCover, events) {
  const { splash } = b;
  events.push({ type: 'explode', x, y, z: b.z ?? 0, radius: splash.radius, ...(b.shock ? { energy: true } : {}) });
  for (const p of match.players) {
    if (!p.alive || p.team === b.team || p === directVictim || invulnerable(p)) continue;
    // 높이가 폭발 범위보다 한참 다르면(고지대 위·아래) 닿지 않는다
    if (b.z !== undefined && Math.abs((p.z ?? 0) - b.z) > splash.radius + 120) continue;
    if (Math.hypot(p.x - x, p.y - y) <= splash.radius + p.radius) {
      damage(match, p, splash.damage, b, events, { x, y });
      if (b.shock) stun(p, 'shock', b.shock, events);
    }
  }
  // 에너지 RPG: 직격 맞은 적도 감전
  if (b.shock && directVictim && !invulnerable(directVictim)) stun(directVictim, 'shock', b.shock, events);
  for (const c of match.covers) {
    // 전투기 미사일은 엄폐물을 깎지 않는다. 수류탄은 엄폐물을 넘어 날아가지만 폭발은 엄폐물도 깎는다.
    if (b.team === 'jet' || c.hp <= 0 || c === directCover) continue;
    // 폭발 중심에서 엄폐물 사각형까지의 최단 거리
    const dx = Math.max(0, Math.abs(x - c.x) - c.w / 2);
    const dy = Math.max(0, Math.abs(y - c.y) - c.h / 2);
    if (Math.hypot(dx, dy) <= splash.radius) damageCover(match, c, splash.damage, b, events);
  }
}

/**
 * 감전·마비: kind 'shock'(에너지 RPG, 움직이지도 쏘지도 못함) 또는 'freeze'(전기 장판, 움직이지 못함). 이미 걸려 있으면 더 긴 쪽으로.
 * 비행기(공중전)·드론처럼 떠 있는 것도 똑같이 걸린다.
 */
export function stun(p, kind, seconds, events) {
  if (!(seconds > 0) || !p.alive) return;
  const before = p[kind] ?? 0;
  p[kind] = Math.max(before, seconds);
  if (kind === 'shock') { p.evade = null; p.burstLeft = 0; }
  if (before <= 0) events.push({ type: 'stun', kind, playerId: p.id, x: p.x, y: p.y, time: seconds });
}
/** 감전(움직이지도 쏘지도 못함)인지, 마비(움직이지 못함)까지 포함해 움직일 수 없는지 */
export const shocked = (p) => (p.shock ?? 0) > 0;
export const frozen = (p) => shocked(p) || (p.freeze ?? 0) > 0;

/** 전기 장판 하나를 (x, y)에 깐다(전기충격기가 떨어진 자리) */
function spawnField(match, b, x, y, events) {
  match.fields ??= [];
  // 떨어진 자리의 바닥 높이(고지대 위에 떨어지면 그 위에 퍼진다)
  const h = groundAt(match, x, y, (b.z ?? 0) + 200);
  if (b.fire) {
    // 화염폭탄의 불길: 바로 퍼져 life초 동안 타며, 안의 적에게 초당 dps(FIRE_TICK마다 나눠서)
    const f = b.fire;
    match.fields.push({
      id: b.id, kind: 'fire', x, y, h, team: b.team, ownerId: b.ownerId, weapon: b.weapon, t: 0, tick: 0,
      radius: f.radius, spread: 0.2, life: f.life, dps: f.dps, hit: [],
    });
    events.push({ type: 'field', kind: 'fire', x, y, h, radius: f.radius, spread: 0.2, life: f.life });
    return;
  }
  const f = b.field;
  match.fields.push({
    id: b.id, x, y, h, team: b.team, ownerId: b.ownerId, t: 0,
    radius: f.radius, spread: f.spread, life: f.life, freeze: f.freeze, hit: [],
  });
  events.push({ type: 'field', x, y, h, radius: f.radius, spread: f.spread, life: f.life });
}

/** 불길이 피해를 주는 간격(초) */
const FIRE_TICK = 0.25;

/**
 * 섬광탄: (x, y)에서 번쩍 터진다. 반경 안에서 섬광이 보이는(구조물에 가리지 않은) 적은 가까울수록 오래 눈이 먼다(blind초).
 * 눈이 먼 사람은 화면이 하얗게 바래고(사람), AI는 그동안 겨누지도 쏘지도 못한다.
 */
function flashBurst(match, b, x, y, events) {
  const { radius, blind } = b.flash;
  const h = groundAt(match, x, y, (b.z ?? 0) + 200) + 40;
  events.push({ type: 'flash', x, y, h, radius });
  for (const p of match.players) {
    if (!p.alive || p.team === b.team || p.entering) continue;
    const d = Math.hypot(p.x - x, p.y - y, (p.z ?? 0) + 128 - h);
    if (d > radius || lineBlocked(match, x, y, h, p.x, p.y, (p.z ?? 0) + 128)) continue;
    const time = blind * (1 - 0.6 * (d / radius));
    if (time > (p.blind ?? 0)) p.blind = time;
    events.push({ type: 'blind', playerId: p.id, time });
  }
}

/** 지금 전기 장판의 반지름(떨어진 뒤 spread초 동안 퍼진다) */
export const fieldRadius = (f) => f.radius * Math.min(1, f.t / Math.max(0.01, f.spread));

/** 전기 장판 한 틱: 퍼지며, 닿은 적(바닥 가까이 있는)은 한 번씩 freeze초 동안 마비. 수명이 다하면 사라진다. */
function updateFields(match, dt, events) {
  if (!match.fields?.length) return;
  for (const f of match.fields) {
    f.t += dt;
    const r = fieldRadius(f);
    if (f.kind === 'fire') {
      f.tick += dt;
      if (f.tick + 1e-9 < FIRE_TICK) continue;
      f.tick -= FIRE_TICK;
      const shot = { team: f.team, ownerId: f.ownerId, weapon: f.weapon ?? 'firebomb', connected: false };
      for (const p of match.players) {
        if (!p.alive || p.team === f.team || invulnerable(p)) continue;
        if (Math.abs((p.z ?? 0) - f.h) > 60 || Math.hypot(p.x - f.x, p.y - f.y) > r + p.radius) continue;
        damage(match, p, Math.max(1, Math.round(f.dps * FIRE_TICK)), shot, events);
        events.push({ type: 'burn', playerId: p.id, x: p.x, y: p.y });
      }
      continue;
    }
    for (const p of match.players) {
      if (!p.alive || p.team === f.team || invulnerable(p) || f.hit.includes(p.id)) continue;
      // 높이 뛰어 있으면 전기에 닿지 않는다
      if (Math.abs((p.z ?? 0) - f.h) > 40) continue;
      if (Math.hypot(p.x - f.x, p.y - f.y) > r + p.radius) continue;
      f.hit.push(p.id);
      stun(p, 'freeze', f.freeze, events);
    }
  }
  match.fields = match.fields.filter((f) => f.t < f.life);
}

/** 이 플레이어가 가진 무기 칸: 주무기 + 고른 보조무기 수만큼(최대 3) */
export function slotsOf(p) {
  const list = p.secondaries ?? [p.secondary];
  return ['primary', ...list.map((_, i) => secondarySlot(i))];
}
/** 칸에 든 무기 id(없는 칸이면 null) */
export function weaponOfSlot(p, slot) {
  if (slot === 'primary') return p.primary;
  const i = secondaryIndex(slot);
  return i < 0 ? null : (p.secondaries ?? [p.secondary])[i] ?? null;
}

/** 무기 칸(주무기·보조무기 1~3)으로 전환. 이미 든 칸이면 아무 일 없다. 점사는 끊기고 RULES.swapTime 동안은 쏘지 못한다. */
function selectSlot(p, slot, events) {
  const id = weaponOfSlot(p, slot);
  if (!id || !SLOT_ORDER.includes(slot)) return;
  // 과냉각처럼 쓰는 순간 효과가 나는 보조무기는 들지 않고 바로 켠다
  if (WEAPONS[id]?.boost) { activateBoost(p, id, events); return; }
  if (p.slot === slot) return;
  p.slot = slot;
  p.weapon = id;
  p.burstLeft = 0;
  p.cooldown = Math.max(p.cooldown, RULES.swapTime);
  events.push({ type: 'swap', playerId: p.id, weapon: p.weapon, slot: p.slot });
}

/** 주무기 → 보조무기 1 → 2 → 3 → 주무기 순환 전환(쓰는 순간 효과가 나는 칸은 건너뛴다) */
function swapWeapon(p, events) {
  const slots = slotsOf(p).filter((sl) => sl === p.slot || !WEAPONS[weaponOfSlot(p, sl)]?.boost);
  if (slots.length < 2) { if (slotsOf(p).length > 1) selectSlot(p, slotsOf(p)[1], events); return; }
  selectSlot(p, slots[(slots.indexOf(p.slot) + 1) % slots.length], events);
}

/** 과냉각: active초 동안 주무기 연사 간격이 rate배. 쓴 뒤에는 그 무기 쿨타임(interval)이 돈다. */
function activateBoost(p, id, events) {
  const w = WEAPONS[id];
  if ((p.cooldowns[w.id] ?? 0) > 0 || p.boost > 0) return;
  p.boost = w.boost.active;
  p.cooldowns[w.id] = w.interval;
  events.push({ type: 'overcool', playerId: p.id });
}

/** 지금 연사 간격 배율(과냉각 중이면 작아진다) */
const fireRate = (p) => (p.boost > 0 ? WEAPONS[(p.secondaries ?? [p.secondary]).find((id) => WEAPONS[id]?.boost)]?.boost?.rate ?? 1 : 1);

/**
 * 아이템: 든 무기와 상관없이 지금 조준 방향으로 바로 쓴다. 평소에는 수류탄을 던지고,
 * 스토리 공중전에서는 미사일(유도 없음)을 쏜다(p.item). 쿨타임 중이면 무시.
 */
function throwGrenade(match, p, events) {
  if (p.grenadeCooldown > 0 || p.noItem) return;
  const item = WEAPONS[p.item ?? 'grenade'];
  p.grenadeCooldown = item.interval;
  spawnProjectile(match, p, p.aim, item.id);
  const ws = weaponStats(match, p.id, item.id);
  if (ws) ws.shots++;
  events.push({ type: 'fire', playerId: p.id, weapon: item.id });
}

function fire(match, p, events) {
  const weapon = WEAPONS[p.weapon];
  p.sinceShot = 0;
  const ws = weaponStats(match, p.id, weapon.id);
  if (ws) ws.shots++;
  if (weapon.battery) p.battery--;
  if (hasMag(weapon)) { p.ammo ??= {}; p.ammo[weapon.id] = ammoOf(p, weapon) - 1; }
  if (weapon.heat) {
    p.heat += weapon.interval;
    if (p.heat >= weapon.heat.max - 1e-9) {
      p.overheat = weapon.heat.cooldown;
      events.push({ type: 'overheat', playerId: p.id });
    }
  }
  if (weapon.instakill) { fireInstakill(match, p, weapon, events); return; }
  if (weapon.dash) { startDash(p, weapon, events); return; }
  if (weapon.slash) { slashKatana(match, p, weapon, events); return; }
  if (weapon.shield) { raiseShield(p, weapon, events); return; }
  const group = { connected: false };
  if (weapon.pellets) {
    // 샷건: spread도 부채꼴 안에 pellets발을 고르게
    const n = Math.max(1, Math.round(weapon.pellets));
    const spread = (weapon.spread * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const angle = n === 1 ? p.aim : p.aim - spread / 2 + (spread * i) / (n - 1);
      spawnProjectile(match, p, angle, weapon.id, { group });
    }
  } else if (weapon.arrows) {
    // 아킴보 석궁: 같은 방향으로 나란히
    const n = Math.max(1, Math.round(weapon.arrows));
    for (let i = 0; i < n; i++) {
      spawnProjectile(match, p, p.aim, weapon.id, { offset: (i - (n - 1) / 2) * weapon.arrowGap, group });
    }
  } else if (weapon.flame) {
    // 화염방사기: 조준 방향 둘레로 흩어지는 불꽃
    const spread = (weapon.flame.spread * Math.PI) / 180;
    const r = match.rng ? match.rng() : Math.random();
    spawnProjectile(match, p, p.aim + (r - 0.5) * spread, weapon.id, { group });
  } else if (weapon.alternate) {
    // 에너지 쌍권총: 오른손·왼손 총을 번갈아(총구가 양옆으로 조금 벌어져 있다)
    p.hand = p.hand === 1 ? -1 : 1;
    spawnProjectile(match, p, p.aim, weapon.id, { offset: p.hand * 12, group });
  } else {
    if (weapon.pattern) spawnPatterned(match, p, weapon);
    else spawnProjectile(match, p, p.aim);
  }
  events.push({ type: 'fire', playerId: p.id, weapon: p.weapon, ...(weapon.alternate ? { hand: p.hand } : {}) });
}

/**
 * 계속 쏘는 무기(강습 건쉽 미사일 5연발, autoFire): 발사키와 든 무기에 상관없이 interval초마다 한 차례(burst발을 burstGap 간격으로) 쏜다.
 * 비행 무늬(pattern)가 있으면 흩어져 원을 그리다 유도되는 미사일로.
 */
function autoFire(match, p, dt, events) {
  const w = WEAPONS[p.primary];
  if (!w?.autoFire) return;
  p.autoCooldown = (p.autoCooldown ?? 0) - dt;
  if (p.autoCooldown <= EPS && !(p.autoBurst > 0)) {
    p.autoCooldown = Math.max(0, p.autoCooldown) + w.interval * fireRate(p);
    p.autoBurst = Math.max(1, Math.round(w.burst ?? 1));
    p.autoBurstTimer = 0;
  }
  if (!(p.autoBurst > 0)) return;
  p.autoBurstTimer -= dt;
  if (p.autoBurstTimer > EPS) return;
  p.autoBurstTimer += w.burstGap ?? 0;
  p.autoBurst--;
  const ws = weaponStats(match, p.id, w.id);
  if (ws) ws.shots++;
  if (w.pattern) spawnPatterned(match, p, w);
  else spawnProjectile(match, p, p.aim, w.id);
  events.push({ type: 'fire', playerId: p.id, weapon: w.id });
}

/**
 * 비행 무늬가 있는 미사일 한 발(강습 건쉽). swarm(5연발): 쏠 때마다 부채꼴 자리를 하나씩 돌아가며 흩어지고 도는 방향도 번갈아.
 * loiter(유도미사일): 조준 방향으로 쏜다. 처음엔 'orbit'(빠르게 원을 그림) 단계.
 */
function spawnPatterned(match, p, weapon) {
  const pt = weapon.pattern;
  let angle = p.aim, dir = 1;
  if (pt.kind === 'swarm') {
    const n = Math.max(1, weapon.burst);
    const i = (p.swarmIndex = ((p.swarmIndex ?? -1) + 1) % n);
    angle = p.aim + ((n === 1 ? 0 : i / (n - 1) - 0.5) * pt.spread * Math.PI) / 180;
    dir = i % 2 ? -1 : 1;
  }
  const b = spawnProjectile(match, p, angle, weapon.id);
  b.vz = (b.vz ?? 0) + (pt.rise ?? 0);
  b.pattern = { kind: pt.kind, phase: 'orbit', t: 0, dir, omega: pt.omega * (0.9 + ((b.id * 37) % 20) / 100) };
  return b;
}

/** 가장 가까운 살아 있는 적(유도 목표) */
function nearestEnemy(match, b) {
  let target = null, best = Infinity;
  for (const p of match.players) {
    if (!p.alive || p.team === b.team || p.entering) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y, (p.z ?? 0) - (b.z ?? 0));
    if (d < best) { best = d; target = p; }
  }
  return target;
}

/**
 * 비행 무늬 한 틱. 'orbit': 수평으로 빠르게 원을 그리며(초당 omega 라디안) 위로 조금 솟는다.
 * swarm은 orbit이 끝나면 바로 'home'(세게 유도). loiter는 'hover'(공중에 멈춰 적을 조준) 뒤 그 적 쪽으로 빠르게 곧장 날아가고 'home'.
 */
function flyPattern(match, b, dt, events) {
  const pt = WEAPONS[b.weapon]?.pattern;
  const st = b.pattern;
  if (!pt || !st) return;
  st.t += dt;
  if (st.phase === 'orbit') {
    const speed = Math.hypot(b.vx, b.vy) || WEAPONS[b.weapon].speed;
    const heading = Math.atan2(b.vy, b.vx) + st.dir * st.omega * dt;
    b.vx = Math.cos(heading) * speed; b.vy = Math.sin(heading) * speed;
    b.vz = (b.vz ?? 0) * Math.max(0, 1 - 3 * dt); // 솟는 힘은 점점 줄어든다
    st.turned = (st.turned ?? 0) + st.omega * dt;
    // turns가 있으면 그 바퀴 수만큼 다 돌아야, 없으면 orbit초가 지나야 다음 단계
    if (pt.turns ? st.turned < pt.turns * Math.PI * 2 : st.t < pt.orbit) return;
    st.t = 0;
    if (pt.kind === 'loiter') {
      // 공중에 멈춰 조준
      st.phase = 'hover';
      st.speed = speed;
      b.vx = 0; b.vy = 0; b.vz = 0;
      events.push({ type: 'missile-lock', x: b.x, y: b.y, h: (b.z ?? 0) + SHOT_HEIGHT, ownerId: b.ownerId });
    } else {
      st.phase = 'home';
      // 가장 가까운 적 쪽으로 머리를 돌려 곧장
      const t = nearestEnemy(match, b);
      if (t) {
        const a = Math.atan2(t.y - b.y, t.x - b.x);
        const s = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s;
      }
    }
    return;
  }
  if (st.phase === 'hover') {
    b.vx = 0; b.vy = 0; b.vz = 0;
    if (st.t < pt.hover) return;
    // 조준한 적에게 빠르게 날아간다(위아래 포함 곧장)
    st.phase = 'home';
    const t = nearestEnemy(match, b);
    const speed = (st.speed ?? WEAPONS[b.weapon].speed) * (pt.dash ?? 1);
    if (!t) { b.vx = speed; return; }
    const dx = t.x - b.x, dy = t.y - b.y, dz = (t.z ?? 0) + 20 - (b.z ?? 0);
    const d = Math.hypot(dx, dy, dz) || 1;
    b.vx = (dx / d) * speed; b.vy = (dy / d) * speed; b.vz = (dz / d) * speed;
  }
}

/** 경기 시작 뒤 흐른 시간(초). 카운트다운·일시정지는 세지 않는다. */
export const elapsed = (match) => match.tick * TICK;

/**
 * 즉사기: 조준 방향에서 가장 가까운 상대 쪽으로 최대 weapon.homing도까지 휘는 거대한 레이저.
 * 휜 방향의 빛줄기(굵기 beamWidth)가 상대 몸에 닿으면 weapon.damage 피해(기본 9999 = 즉사). 엄폐물·무적은 무시한다.
 * 맞든 빗나가든 쏜 뒤에는 쿨타임(weapon.interval)이 돈다.
 */
function fireInstakill(match, p, weapon, events) {
  let target = null, best = Infinity;
  for (const q of match.players) {
    if (!q.alive || q.team === p.team || q.entering) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best) { best = d; target = q; }
  }
  if (!target) return;
  const x1 = p.x + Math.cos(p.aim) * MUZZLE_OFFSET * 1.6, y1 = p.y + Math.sin(p.aim) * MUZZLE_OFFSET * 1.6;
  // 유도: 조준 방향에서 상대 방향으로 최대 homing도까지 꺾는다
  const toTarget = Math.atan2(target.y - y1, target.x - x1);
  const diff = Math.atan2(Math.sin(toTarget - p.aim), Math.cos(toTarget - p.aim));
  const limit = (Math.max(0, weapon.homing) * Math.PI) / 180;
  const dir = p.aim + Math.max(-limit, Math.min(limit, diff));
  const reach = 2400;
  const x2 = x1 + Math.cos(dir) * reach, y2 = y1 + Math.sin(dir) * reach;
  const hit = segmentCircleTime(x1 - target.x, y1 - target.y, x2 - target.x, y2 - target.y,
    target.radius + weapon.beamWidth / 2) !== null;
  events.push({ type: 'fire', playerId: p.id, weapon: weapon.id });
  events.push({
    type: 'megalaser', playerId: p.id, x1, y1, aim: p.aim, hit,
    // 맞으면 상대에게 휘어 꽂히고, 빗나가면 꺾인 방향으로 경기장 끝까지
    x2: hit ? target.x : x1 + Math.cos(dir) * 1800, y2: hit ? target.y : y1 + Math.sin(dir) * 1800,
  });
  if (!hit) return;
  const shot = { team: p.team, ownerId: p.id, weapon: weapon.id, connected: false };
  damage(match, target, weaponDamage(p, weapon.id).damage, shot, events);
}

/** 단검 돌진 시작: 조준 방향으로 날아가 상대에 닿거나, 엄폐물·경기장 끝에 닿거나 RULES.dashRange만큼 가면 출발한 자리로 돌아온다. */
function startDash(p, weapon, events) {
  const speed = weapon.dash.speed;
  p.burstLeft = 0;
  p.dash = {
    vx: Math.cos(p.aim) * speed, vy: Math.sin(p.aim) * speed, speed, age: 0,
    homeX: p.x, homeY: p.y, returning: false,
    damage: weaponDamage(p, weapon.id).damage,
    shot: { team: p.team, ownerId: p.id, weapon: weapon.id, connected: false },
  };
  events.push({ type: 'fire', playerId: p.id, weapon: weapon.id });
  events.push({ type: 'dash', playerId: p.id });
}

/** 돌진 한 틱: 가는 중에는 가장 먼저 닿는 상대(피해)·엄폐물(막힘)을 찾고, 돌아올 때는 출발한 자리로 곧장 간다. */
function updateDash(match, p, dt, events) {
  const d = p.dash;
  d.age += dt;
  if (d.returning) {
    const hx = d.homeX, hy = d.homeY;
    const dist = Math.hypot(hx - p.x, hy - p.y);
    const move = d.speed * dt;
    if (dist <= move) {
      p.x = hx; p.y = hy; p.dash = null;
    } else {
      p.x += ((hx - p.x) / dist) * move;
      p.y += ((hy - p.y) / dist) * move;
    }
    return;
  }
  const x0 = p.x, y0 = p.y, x1 = x0 + d.vx * dt, y1 = y0 + d.vy * dt;
  let best = null;
  for (const q of match.players) {
    if (!q.alive || q.team === p.team || invulnerable(q)) continue;
    const t = segmentCircleTime(x0 - q.x, y0 - q.y, x1 - q.x, y1 - q.y, p.radius + q.radius);
    if (t !== null && (!best || t < best.t)) best = { t, victim: q };
  }
  for (const c of match.covers) {
    if (c.hp <= 0) continue;
    const t = segmentRectTime(x0 - c.x, y0 - c.y, x1 - c.x, y1 - c.y, c.w / 2 + p.radius / 2, c.h / 2 + p.radius / 2);
    // 출발 때 이미 겹쳐 있던 엄폐물(t=0)은 무시하고 지나간다
    if (t !== null && t > 0 && (!best || t < best.t)) best = { t, cover: c };
  }
  const t = best ? best.t : 1;
  p.x = Math.min(boundsOf(match).maxX, Math.max(boundsOf(match).minX, x0 + (x1 - x0) * t));
  p.y = y0 + (y1 - y0) * t;
  if (best?.victim) {
    damage(match, best.victim, d.damage, d.shot, events, { x: x0, y: y0 });
    d.returning = true;
  } else if (best?.cover) {
    events.push({ type: 'block', x: p.x, y: p.y });
    d.returning = true;
  }
  // 최대 거리만큼 가거나 경기장 끝·옆 벽에 닿으면 돌아온다
  const far = Math.hypot(p.x - d.homeX, p.y - d.homeY) >= RULES.dashRange;
  const B = boundsOf(match);
  if (far || p.x <= B.minX || p.x >= B.maxX || p.y < B.minY - 50 || p.y > B.maxY + 50) d.returning = true;
}

/** 장탄 수가 정해진 무기(mag > 0)인지 */
const hasMag = (weapon) => (weapon.mag ?? 0) > 0;
/** 그 무기의 남은 총알(한 번도 안 쐈으면 가득, 밸런스에서 장탄 수를 줄였으면 그만큼으로 자름) */
export function ammoOf(p, weapon) {
  if (!hasMag(weapon)) return Infinity;
  return Math.min(weapon.mag, p.ammo?.[weapon.id] ?? weapon.mag);
}
/**
 * 장전: 든 무기의 총알이 다 떨어지면 reload초 동안 탄창을 갈아 끼우고 가득 채운다.
 * 다른 무기로 바꾸면 장전이 끊긴다(다시 들면 처음부터).
 */
function updateReload(p, weapon, dt, events) {
  if (p.reload && p.reload.weapon !== weapon.id) p.reload = null;
  if (!hasMag(weapon)) return;
  if (!p.reload && p.burstLeft === 0 && ammoOf(p, weapon) <= 0) {
    const total = Math.max(0.05, weapon.reload ?? 1.5);
    p.reload = { weapon: weapon.id, t: total, total };
    events.push({ type: 'reload', playerId: p.id, weapon: weapon.id, time: total });
    return;
  }
  if (!p.reload) return;
  p.reload.t -= dt;
  if (p.reload.t <= 1e-9) {
    p.reload = null;
    p.ammo ??= {};
    p.ammo[weapon.id] = weapon.mag;
    events.push({ type: 'reloaded', playerId: p.id, weapon: weapon.id });
  }
}

/** 탄약 외 제약(배터리·과열·무기별 쿨타임·즉사기 대기) 때문에 지금 쏠 수 없는지. 장전 중이거나 총알이 없어도 못 쏜다. */
function blocked(p, weapon, match) {
  if (hasMag(weapon) && (p.reload || ammoOf(p, weapon) <= 0)) return true;
  if (weapon.instakill) return elapsed(match) < weapon.readyAfter; // 쏜 뒤 대기는 공통 쿨타임(p.cooldown)
  if (weapon.battery) return p.battery <= 0;
  if (weapon.heat) return p.overheat > 0;
  if (weapon.ownCooldown) return (p.cooldowns[weapon.id] ?? 0) > 0;
  return false;
}

/** 배터리 충전, 기관단총 냉각, 수류탄·무기별 쿨타임. 무기를 들고 있지 않아도 시간은 흐른다. */
function updateResources(p, firing, dt) {
  p.sinceShot += dt;
  p.grenadeCooldown = Math.max(0, p.grenadeCooldown - dt);
  p.boost = Math.max(0, (p.boost ?? 0) - dt);
  for (const id of Object.keys(p.cooldowns)) p.cooldowns[id] = Math.max(0, p.cooldowns[id] - dt);
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

/** 경기장 앞뒤 범위(MIN_Y~MAX_Y) 안으로 Y를 자른다. 예전에는 자기 진영 안이었지만 지금은 상대 진영까지 갈 수 있다. */
export const clampY = (team, y) => Math.min(MAX_Y, Math.max(MIN_Y, y));

/** 오르막길만 따진 (x, y)의 높이(걸어서 오를 수 있는지 볼 때) */
function rampAt(match, x, y) {
  let h = 0;
  for (const g of match.highs ?? []) {
    if (!g.ramp || !(Math.abs(x - g.x) < g.w / 2 - 0.01 && Math.abs(y - g.y) < g.h / 2 - 0.01)) continue;
    h = Math.max(h, highAt(g, x, y));
  }
  return h;
}

/**
 * 이동 한 틱: 가로(ax)·세로(ay) 축 입력(-1~1, 합이 1을 넘으면 1로)대로 움직인다. 가로는 MIN_X~MAX_X, 세로는 MIN_Y~MAX_Y(상대 진영까지),
 * 부서지지 않은 엄폐물은 그보다 높이 떠 있지 않으면 뚫고 지나가지 못하고(몸 반지름만큼 밀어낸다), 고지대는 발이 그 높이(턱 JUMP.step 빼고)보다
 * 낮으면 벽처럼 막는다(뛰어올라 올라선다).
 */
export function move(match, p, ax, ay, dt, speed = p.speed) {
  const len = Math.hypot(ax, ay);
  if (len > 1) { ax /= len; ay /= len; }
  if (!ax && !ay) return;
  // 꾹 눌러 높이 뛴 점프: 공중에서는 모은 만큼 더 빠르게(훨씬 멀리 날아간다)
  if (p.jumpCharge > 0 && (p.z ?? 0) > 0.5) speed *= 1 + JUMP.airBoost * Math.min(1, p.jumpCharge);
  const B = boundsOf(match);
  const cy = (v) => Math.min(B.maxY, Math.max(B.minY, v));
  let x = Math.min(B.maxX, Math.max(B.minX, p.x + ax * speed * dt));
  let y = cy(p.y + ay * speed * dt);
  const z = p.z ?? 0;
  const walls = [
    ...(match.covers ?? []).filter((c) => c.hp > 0 && z < coverBase(match, c) + COVER_HEIGHT - 2 && z + 150 > coverBase(match, c)).map((c) => ({ c, pad: p.radius * 0.6 })),
    // 고지대 옆면: 가장자리 안쪽으로 발 중심이 들어가면 막음(그 위에 서면 바닥이 높아짐). 다리는 밑으로 지나가고, 오르막길은 아래에서 따로 본다
    ...(match.highs ?? []).filter((g) => !g.bridge && !g.ramp && z < g.height - JUMP.step).map((g) => ({ c: g, pad: 0 })),
  ];
  for (const { c, pad } of walls) {
    const hw = c.w / 2 + pad, hh = c.h / 2 + pad;
    const dx = x - c.x, dy = y - c.y;
    if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) continue;
    // 덜 파고든 쪽으로 밀어낸다
    const px = hw - Math.abs(dx), py = hh - Math.abs(dy);
    if (px < py) x = c.x + Math.sign(dx || ax || 1) * hw;
    else y = cy(c.y + Math.sign(dy || ay || 1) * hh);
  }
  // 오르막길: 비탈을 따라서는 걸어 오르지만, 옆에서 높은 곳으로 들어가려면 막힌다(한 축씩 되돌려 미끄러지듯)
  if (rampAt(match, x, y) > z + JUMP.step) {
    if (rampAt(match, x, p.y) <= z + JUMP.step) y = p.y;
    else if (rampAt(match, p.x, y) <= z + JUMP.step) x = p.x;
    else { x = p.x; y = p.y; }
  }
  p.x = Math.min(B.maxX, Math.max(B.minX, x));
  p.y = y;
}

/** (x, y)를 밟는 점프 패드(없으면 null) */
export function padAt(match, x, y, ground = 0) {
  return (match.pads ?? []).find((pad) => Math.abs(ground - (pad.h ?? 0)) <= 0.5 && Math.hypot(x - pad.x, y - pad.y) <= (pad.r ?? PAD.r)) ?? null;
}

/** 남은 회피 횟수(없으면 가득) */
export const evadeCharges = (p) => p.evadeCharges ?? EVADE.charges;

/**
 * 회피 시작: 움직이던 쪽(이동 입력이 없으면 바라보는 쪽)으로 빠르게 돌진한다. 남은 횟수가 없으면 아무 일 없다.
 * 돌진 중에 다시 누르면(연속 회피) 그 자리에서 새 방향으로 다시 돌진한다.
 */
export function startEvade(p, input, events) {
  const left = evadeCharges(p);
  if (left <= 0) return false;
  let dx = input.moveAxis ?? 0, dy = input.moveY ?? 0;
  const len = Math.hypot(dx, dy);
  if (len < 0.2) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); } else { dx /= len; dy /= len; }
  p.evadeCharges = left - 1;
  p.evade = { dx, dy, t: EVADE.time };
  events.push({ type: 'evade', playerId: p.id, left: p.evadeCharges });
  return true;
}

/** 회피 돌진 한 틱(엄폐물·고지대 옆면은 걸을 때처럼 막힌다). 돌진이 끝나면 쿨타임이 돈다. */
function updateEvade(match, p, dt) {
  const e = p.evade;
  move(match, p, e.dx, e.dy, Math.min(dt, e.t), EVADE.speed);
  e.t -= dt;
  if (e.t <= EPS) {
    p.evade = null;
    p.evadeCooldown = EVADE.cooldown;
  }
}

/** 회피 쿨타임: 쓴 횟수가 있으면 마지막 돌진이 끝나고 EVADE.cooldown초 뒤 가득 채운다(돌진 중에는 멈춤). */
function updateEvadeCharges(p, dt) {
  if (p.evade || evadeCharges(p) >= EVADE.charges) return;
  p.evadeCooldown = Math.max(0, (p.evadeCooldown ?? 0) - dt);
  if (p.evadeCooldown <= EPS) p.evadeCharges = EVADE.charges;
}

/**
 * 점프·떨어지기 한 틱: 땅(고지대 위 포함)에 있을 때 jump면 뛰어오르고, 공중이면 중력으로 떨어져 바닥 높이에 내려선다.
 * held: 점프키를 누르고 있는지. 뛰어오른 뒤 누르고 있는 동안(최대 JUMP.holdTime초) 위로 더 밀어 올려, 살짝 누르면 원래 높이,
 * 꾹 누를수록 훨씬 높이(그리고 공중에서 빨라져 멀리) 뛴다. 천장(match.ceiling)이 있으면 머리가 닿는 곳에서 멈춘다.
 */
export function updateJump(match, p, jump, dt, events, held = false) {
  p.z ??= 0; p.vz ??= 0;
  let ground = groundAt(match, p.x, p.y, p.z);
  // 막혀야 할 높은 단 위에 밀려 들어간 경우(가장자리 계산 오차)에는 순간 이동하지 않는다
  if (ground > p.z + JUMP.step && p.vz <= 0 && p.z <= 0.5) ground = 0;
  // 오르막길을 걸어 내려갈 때처럼 바닥이 조금 낮아졌으면 떨어지지 않고 그대로 붙어 걷는다
  if (p.vz === 0 && p.z > ground && p.z - ground <= JUMP.step) p.z = ground;
  const onGround = p.z <= ground + 0.5 && p.vz <= 0;
  // 점프 패드: 바닥(패드가 놓인 높이)에서 밟으면 매우 높이 튀어 오른다(마비·감전 중에도 튕겨 오른다)
  const pad = onGround && p.alive && !p.dash && !p.plane ? padAt(match, p.x, p.y, ground) : null;
  if (pad) {
    p.vz = pad.power ?? PAD.power;
    p.jumpHold = 0;
    events.push({ type: 'pad', playerId: p.id, x: pad.x, y: pad.y, h: pad.h ?? 0 });
  } else if (jump && onGround && p.alive && !p.dash && !p.plane) {
    p.vz = JUMP.jump;
    p.jumpHold = JUMP.holdTime; // 이만큼 더 누르고 있을 수 있다
    p.jumpCharge = 0;
    events.push({ type: 'jump', playerId: p.id });
  }
  // 누르고 있는 동안(올라가는 중) 더 밀어 올린다. 한 번 떼면 그 점프에서는 다시 모으지 못한다
  if ((p.jumpHold ?? 0) > 0) {
    if (held && p.vz > 0 && p.alive) {
      const t = Math.min(dt, p.jumpHold);
      p.vz += JUMP.holdAccel * t;
      p.jumpHold -= t;
      p.jumpCharge = Math.min(1, (p.jumpCharge ?? 0) + t / JUMP.holdTime);
    } else {
      p.jumpHold = 0;
    }
  }
  if (p.z > ground || p.vz > 0) {
    p.vz -= JUMP.gravity * dt;
    p.z += p.vz * dt;
    // 천장: 머리(눈높이 조금 위)가 닿으면 더 오르지 못한다
    const roof = Number.isFinite(match.ceiling) ? match.ceiling - 190 : Infinity;
    if (p.z > roof) { p.z = roof; p.vz = Math.min(0, p.vz); p.jumpHold = 0; }
    if (p.z <= ground) {
      if (p.vz < -200) events.push({ type: 'jump-land', playerId: p.id, x: p.x, y: p.y });
      p.z = ground; p.vz = 0; p.jumpCharge = 0; p.jumpHold = 0;
    }
  } else {
    p.z = ground; p.vz = 0; p.jumpCharge = 0;
  }
}

/**
 * 비행 한 틱(강습 건쉽): dir(+1 위, -1 아래, 0 그대로)으로 고도를 올리고 내린다. 입력이 없으면 그 높이에서 멈춰 떠 있는다(호버링).
 * 바닥·고지대 위 FLIGHT.minAlt보다 낮게, FLIGHT.maxAlt(천장이 있으면 그 아래)보다 높게는 못 간다. 쓰러지면 바닥으로 떨어진다.
 */
export function updateFlight(match, p, dir, dt) {
  p.z ??= FLIGHT.hoverAlt; p.vz ??= 0;
  const ground = groundAt(match, p.x, p.y, p.z);
  if (!p.alive) {
    p.vz -= JUMP.gravity * dt;
    p.z = Math.max(ground, p.z + p.vz * dt);
    if (p.z <= ground) p.vz = 0;
    return;
  }
  // 공중전(하늘): 건쉽·적 비행기가 모두 같은 높이에서 싸운다(고도를 바꾸지 않음)
  if (match.story?.stage === 'sky') { p.z = 0; p.vz = 0; return; }
  const min = ground + FLIGHT.minAlt;
  const max = Math.min(FLIGHT.maxAlt, Number.isFinite(match.ceiling) ? match.ceiling - 260 : Infinity);
  const want = Math.max(-1, Math.min(1, dir)) * FLIGHT.climb;
  const step = FLIGHT.accel * dt;
  p.vz += Math.max(-step, Math.min(step, want - p.vz));
  p.z += p.vz * dt;
  if (p.z < min) { p.z = min; if (p.vz < 0) p.vz = 0; }
  if (p.z > max) { p.z = max; if (p.vz > 0) p.vz = 0; }
}

/**
 * 고정 틱 한 번. 렌더·사운드용 이벤트 목록을 돌려준다.
 * 순서: 전투기(이동·사격) → 플레이어 무기 전환·이동·아이템·자동 발사 → 탄환 이동·충돌(엄폐물·적, 엄폐물 내구도) → 쓰러짐·승패.
 */
export function step(match, inputs, dt = TICK) {
  const events = [];
  if (match.phase === 'countdown') {
    // 일시정지 해제 등으로 조준이 끊긴 것을 '손을 뗌'으로 보지 않도록 초기화
    for (const p of match.players) {
      p.wasAiming = false;
      if (inputs?.[p.id]) inputs[p.id].evade = false;
    }
    match.countdown -= dt;
    if (match.countdown <= 0) match.phase = 'playing';
    return events;
  }
  // 스토리 모드 엔딩 컷씬: 연출만 진행한다(대교 가는 길만 좌우 이동 입력을 받는다)
  if (match.phase === 'cutscene') {
    updateCutscene(match, dt, events, inputs);
    return events;
  }
  // 스토리 모드 건 카타(스미스 요원): 1·2·3·4 버튼 대응만 받는다
  if (match.phase === 'gunkata') {
    // 건 카타의 1~4 버튼이 무기 칸 고르기로 남지 않게
    for (const f of Object.values(inputs ?? {})) if (f) f.select = null;
    updateGunKata(match, inputs, dt, events);
    return events;
  }
  // 스토리 모드 처치 컷씬(킬캠): 경기가 멈춘 채 연출만 진행한다
  if (match.phase === 'killcam') {
    updateKillcam(match, dt, events);
    return events;
  }
  if (match.phase !== 'playing') return events;
  match.tick++;

  // 스토리 모드: 웨이브 진행·헬리콥터 연출·적 내려오기
  if (match.story) updateStory(match, inputs, dt, events);
  updateJet(match, dt, events);
  updateFields(match, dt, events);

  for (const p of match.players) {
    p.previousX = p.x;
    p.previousY = p.y;
    p.hurt = Math.max(0, p.hurt - dt);
    if (!p.alive && p.flier && p.z > 0) updateFlight(match, p, 0, dt); // 격추된 건쉽은 바닥으로 떨어진다
    if (!p.alive || p.entering) continue;
    const input = inputs[p.id];
    // 전용 무기 캐릭터(R-10·숨겨진 캐릭터)는 주무기 하나뿐이고 아이템도 없다
    if (input.select) {
      if (!p.primaryOnly) selectSlot(p, input.select, events);
      input.select = null;
    }
    if (input.swap) {
      input.swap = false;
      if (!p.primaryOnly) swapWeapon(p, events);
    }
    const weapon = WEAPONS[p.weapon];
    // 누르고 있는 연사는 남은 시간(음수)을 다음 발로 넘겨, 틱(1/60초)보다 짧은 발사 간격도 평균으로 지킨다
    const carry = Math.min(0, p.cooldown - dt);
    p.cooldown = Math.max(0, p.cooldown - dt);
    updateResources(p, weapon.heat && input.aiming, dt);
    updateReload(p, weapon, dt, events);
    p.aim = input.aim;
    // 위아래 시선(사람 플레이어). 쏘는 탄도 이 각도로 날아간다
    p.pitch = clampPitch(input.pitch ?? 0);
    // 감전(에너지 RPG): 움직이지도 쏘지도 못한다(고개만 돌림). 마비(전기 장판): 움직이지 못한다(쏠 수는 있음)
    p.shock = Math.max(0, (p.shock ?? 0) - dt);
    p.freeze = Math.max(0, (p.freeze ?? 0) - dt);
    p.blind = Math.max(0, (p.blind ?? 0) - dt);
    // 방패는 shield.t초가 지나면 내린다
    if (p.shield) {
      p.shield.t -= dt;
      if (p.shield.t <= 0) { p.shield = null; events.push({ type: 'shield-down', playerId: p.id }); }
    }
    // 단검 돌진 중에는 이동·사격·아이템 입력을 받지 않는다(조준 각도만 따라감).
    updateEvadeCharges(p, dt);
    if (p.dash) {
      input.item = false;
      input.evade = false;
      updateDash(match, p, dt, events);
      p.wasAiming = false;
      continue;
    }
    // rooted: 스토리 연출로 잠깐 멈춰 선 적(조준선을 긋는 존슨 요원)
    // 회피: 돌진하는 동안은 걷기 대신 돌진한다(사격·점프는 그대로 된다)
    const stuck = frozen(p);
    if (input.evade) {
      input.evade = false;
      // 나는 캐릭터는 회피키가 고도 내리기라 돌진하지 않는다
      if (!p.rooted && !p.scripted && !p.plane && !p.flier && !stuck) startEvade(p, input, events);
    }
    if (stuck) p.evade = null;
    if (p.evade) updateEvade(match, p, dt);
    else if (!p.rooted && !stuck) move(match, p, input.moveAxis, input.moveY ?? 0, dt);
    if (p.flier) {
      // 고도: 점프키(누르고 있는 동안) 위로, 회피키(누르고 있는 동안) 아래로. AI는 flyDir로
      const up = input.jump || input.jumpHeld || input.touchJump, down = input.descendHeld || input.touchDescend;
      updateFlight(match, p, stuck ? 0 : input.flyDir ?? ((up ? 1 : 0) - (down ? 1 : 0)), dt);
    } else {
      updateJump(match, p, input.jump && !p.rooted && !stuck, dt, events, !!(input.jumpHeld || input.touchJump) && !stuck);
    }
    input.jump = false;
    if (shocked(p)) {
      // 감전: 아이템·사격·점사 모두 멈춘다. 손을 떼면 쏘는 무기가 풀리자마자 나가지 않게 조준도 풀린 것으로 둔다
      input.item = false;
      p.burstLeft = 0;
      p.wasAiming = false;
      continue;
    }
    // 스토리가 대신 쏘는 적(존슨 요원의 조준선 저격)은 움직이기만 한다
    if (p.scripted) { input.item = false; p.wasAiming = false; continue; }
    // 강습 건쉽 미사일 5연발: 늘 계속 쏜다(발사키는 유도미사일용)
    autoFire(match, p, dt, events);
    if (input.item) {
      input.item = false;
      if (!p.primaryOnly) throwGrenade(match, p, events);
    }
    // 점사 중인 남은 탄은 조준을 풀어도 끝까지 나간다.
    if (p.burstLeft > 0) {
      p.burstTimer -= dt;
      if (p.burstTimer <= 0) {
        // 점사 중에 총알이 떨어지면 남은 점사는 나가지 않는다
        if (ammoOf(p, weapon) <= 0) p.burstLeft = 0;
        else {
          fire(match, p, events);
          p.burstLeft--;
          p.burstTimer += weapon.burstGap;
        }
      }
    } else if (p.cooldown <= EPS && !blocked(p, weapon, match) && !weapon.autoFire &&
      (weapon.trigger === 'release' ? p.wasAiming && !input.aiming : input.aiming)) {
      fire(match, p, events);
      // 단검·샷건은 그 무기 쿨타임만 돌고, 다른 무기는 바로 쓸 수 있다.
      if (weapon.ownCooldown) p.cooldowns[weapon.id] = weapon.interval;
      else p.cooldown = weapon.interval * fireRate(p) + (weapon.trigger !== 'release' && p.wasAiming ? carry : 0);
      p.burstLeft = weapon.burst - 1;
      p.burstTimer = weapon.burstGap ?? 0;
    }
    p.wasAiming = input.aiming;
  }

  const removed = new Set();
  const contacts = [];
  const sky = match.story?.stage === 'sky';
  for (const b of match.projectiles) {
    b.previousX = b.x; b.previousY = b.y; b.previousZ = b.z ?? 0;
    // 원을 그리며 돌다가 적에게 가는 미사일(강습 건쉽): 도는 동안·멈춘 동안은 유도하지 않는다
    if (b.pattern) flyPattern(match, b, dt, events);
    if (b.homing && (!b.pattern || b.pattern.phase === 'home')) steer(match, b, b.homing.turnRate, dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.vz) b.z = (b.z ?? 0) + b.vz * dt;
    b.life -= dt;
    let earliest = null;
    if (b.thrown) continue; // 던진 무기는 날아가는 동안 아무것에도 닿지 않는다
    // 구조물(건물·고지대·다리·오르막길)·바닥·천장: 어떤 구조물도 뚫지 못한다(전투기 미사일처럼 하늘에서 내리꽂는 것은 빼고)
    if (!b.overCovers) {
      const z0 = b.previousZ, z1 = b.z ?? 0;
      const wall = structureHit(match, b.previousX, b.previousY, z0 + SHOT_HEIGHT, b.x, b.y, z1 + SHOT_HEIGHT, { floor: !sky });
      if (wall) earliest = { t: wall.t, projectile: b, victim: null, cover: null, wall };
    }
    const coverHit = b.overCovers ? null : coverContact(match, b);
    if (coverHit && (!earliest || coverHit.t < earliest.t)) earliest = { t: coverHit.t, projectile: b, victim: null, cover: coverHit.cover };
    // 전투기는 하늘 높이 날기 때문에 탄환은 그 밑으로 지나간다(막지 않음).
    for (const p of match.players) {
      // 단검 돌진 중(무적)인 플레이어는 탄이 그냥 지나간다
      if (!p.alive || p.team === b.team || invulnerable(p)) continue;
      const t = segmentCircleTime(
        b.previousX - p.previousX, b.previousY - (p.previousY ?? p.y), b.x - p.x, b.y - p.y, p.radius + BULLET_RADIUS);
      if (t === null || (earliest !== null && t >= earliest.t)) continue;
      // 높이 차이(닿는 순간 탄 높이 기준): 탄보다 너무 높이 뛰었거나(점프로 피함) 너무 아래면 지나간다
      if (b.z !== undefined) {
        const dz = (p.z ?? 0) - (b.previousZ + ((b.z ?? 0) - b.previousZ) * t);
        if (dz > JUMP.hitAbove || dz < -JUMP.hitBelow) continue;
      }
      earliest = { t, projectile: b, victim: p };
    }
    if (earliest) contacts.push(earliest);
  }
  contacts.sort((a, b) => a.t - b.t || a.projectile.id - b.projectile.id);

  // 같은 틱에 먼저 맞은 탄으로 엄폐물이 부서져도, 이미 그 엄폐물에 닿은 나머지 탄은 막힌 것으로 처리한다.
  for (const { t, projectile: b, victim, cover, wall } of contacts) {
    const x = b.previousX + (b.x - b.previousX) * t;
    const y = b.previousY + (b.y - b.previousY) * t;
    const z = b.previousZ + ((b.z ?? 0) - b.previousZ) * t;
    // 튕기는 탄(에너지 돌격소총)이 구조물·바닥에 닿으면 그 면에서 반사돼 계속 날아간다
    if (wall && b.bounces > 0) {
      bounceOffWall(b, wall.axis, x, y, z);
      events.push({ type: 'bounce', x, y, h: z + SHOT_HEIGHT, weapon: b.weapon });
      continue;
    }
    // 튕기는 탄(에너지 돌격소총)이 엄폐물에 닿으면: 엄폐물을 깎고 닿은 면에서 반사돼 계속 날아간다
    if (!victim && cover && b.bounces > 0) {
      damageCover(match, cover, coverDamage(b), b, events);
      bounceOffCover(b, cover, x, y);
      events.push({ type: 'bounce', x, y, weapon: b.weapon });
      continue;
    }
    removed.add(b);
    if (b.z !== undefined) b.z = z;
    if (victim) damage(match, victim, b.damage, b, events, { x: b.previousX, y: b.previousY });
    else events.push({ type: 'block', x, y, ...(b.z !== undefined ? { h: z + SHOT_HEIGHT } : {}) });
    if (cover) damageCover(match, cover, coverDamage(b), b, events);
    if (b.splash) explode(match, b, x, y, victim, cover, events);
  }

  // 튕기는 탄이 경기장 끝(벽)을 넘으면 그 벽에서 반사한다
  for (const b of match.projectiles) {
    if (removed.has(b) || !(b.bounces > 0)) continue;
    if (bounceOffWalls(b, wallsOf(match))) events.push({ type: 'bounce', x: b.x, y: b.y, weapon: b.weapon });
  }

  // 빗나간 RPG·전투기 미사일은 경로 끝에서 터져 주변에 폭발 피해를 준다.
  for (const b of match.projectiles) {
    if (removed.has(b) || !(b.splash || b.field || b.fire || b.flash)) continue;
    const end = rocketEnd(b, match);
    if (!end) continue;
    removed.add(b);
    if (b.field || b.fire) spawnField(match, b, end.x, end.y, events);
    if (b.flash) flashBurst(match, b, end.x, end.y, events);
    if (b.splash) explode(match, b, end.x, end.y, null, null, events);
  }

  // 같은 틱의 피해를 모두 반영한 뒤 쓰러짐을 판정한다.
  const downed = [];
  for (const p of match.players) {
    if (p.alive && p.hp <= 0) {
      downed.push(p);
      p.alive = false;
      // 돌진 중에 쓰러지면 출발한 자리에 쓰러진다
      if (p.dash) { p.x = p.dash.homeX; p.y = p.dash.homeY; p.dash = null; }
      p.evade = null;
      p.shock = 0; p.freeze = 0; p.shield = null; p.blind = 0;
      if (match.stats?.[p.id]) match.stats[p.id].downAt = match.tick * TICK;
      events.push({ type: 'down', playerId: p.id, x: p.x, y: p.y });
    }
  }

  match.projectiles = match.projectiles.filter((b) =>
    !removed.has(b) && b.life > 0 &&
    (({ x0, x1, y0, y1 }) => b.x > x0 - OUT_MARGIN && b.x < x1 + OUT_MARGIN && b.y > y0 - OUT_MARGIN && b.y < y1 + OUT_MARGIN)(fieldOf(match)));

  // 팀 전원이 쓰러지면 패배. 같은 틱에 양 팀이 모두 쓰러지면 무승부.
  // 스토리 모드는 사람 주인공이 모두 쓰러지면 AI 동료가 남아 있어도 진다
  const earthUp = match.players.some((p) => p.team === 'earth' && p.alive && !(match.story && p.ai));
  const isbUp = match.players.some((p) => p.team === 'isb' && p.alive);
  // 스토리 모드는 남은 웨이브가 있으면 ISB팀이 전멸해도 끝나지 않는다(다음 웨이브는 story.js가 불러온다).
  if (earthUp && !isbUp && startsCutscene(match)) {
    // 스토리 모드 보스를 쓰러뜨리면 결과 전에 엔딩 컷씬(그 전에 건 카타)
    if (needsGunKata(match)) startGunKata(match, match.players.find((p) => p.boss), { kind: 'cutscene' }, events);
    else startCutscene(match);
    return events;
  }
  // 스토리 모드에서 요원을 쓰러뜨리면 건 카타 → 킬캠(웨이브 마지막 요원이면 웨이브 마무리 장면까지).
  // 하늘(공중전)의 건쉽은 건 카타 없이 그 자리에서 터진다.
  const downedAgent = downed.find((p) => p.team === 'isb');
  if (match.story?.stage === 'sky') {
    for (const p of downed.filter((q) => q.team === 'isb' && !q.boss)) events.push({ type: 'explode', x: p.x, y: p.y, radius: 140 });
  } else if (match.story && earthUp && downedAgent) {
    // 스토리 설정에서 건 카타를 껐으면 바로 처치 컷씬
    if (kataOn(match)) startGunKata(match, downedAgent, { kind: 'killcam', waveEnd: !isbUp }, events);
    else startKillcam(match, downedAgent, !isbUp);
    return events;
  }
  if ((!earthUp || !isbUp) && !(earthUp && holdsResult(match))) {
    match.winner = !earthUp && !isbUp ? 'draw' : earthUp ? 'earth' : 'isb';
    match.phase = 'result';
    match.projectiles = [];
    events.push({ type: 'result', winner: match.winner });
  }
  return events;
}
