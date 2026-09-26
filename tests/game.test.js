// 핵심 로직 검증: 이동·조준·자동 발사·총기별 피해·체력/쓰러짐·엄폐물·전투기 방어/사격 (DOM 경로는 브라우저에서 확인)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs, cancelInputs } from '../src/game/state.js';
import { step, spawnProjectile } from '../src/game/update.js';
import { segmentRectTime } from '../src/game/collision.js';
import { aimFromDrag, moveAxisFromDrag } from '../src/input/pointer.js';
import { MIN_X, MAX_X, RAIL_Y, TICK, MAX_HP, WEAPONS, JET, COVERS, COVER, ARENA_WIDTH, BODY_RADIUS } from '../src/game/config.js';

function playing(count, loadout) {
  const match = createMatch(count, loadout, 1);
  match.phase = 'playing';
  match.jetTimer = Infinity; // 전투기 테스트가 아니면 끈다
  const inputs = createInputs(match.players);
  const byId = Object.fromEntries(match.players.map((p) => [p.id, p]));
  return { match, inputs, ...byId };
}
const UP = -Math.PI / 2, DOWN = Math.PI / 2;
/** seconds 동안 틱을 돌리고 발생한 이벤트를 모두 돌려준다. */
function run(match, inputs, seconds) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) events.push(...step(match, inputs));
  return events;
}
/** 탄환을 대상 바로 앞(접촉 직전)에 놓는다. */
function bulletNear(match, shooter, target, aim) {
  const b = spawnProjectile(match, shooter, aim);
  b.x = b.previousX = target.x;
  b.y = b.previousY = target.y - Math.sin(aim) * 40;
  return b;
}
const fired = (match, id) => match.projectiles.filter((b) => b.ownerId === id).length;
const shots = (events, id) => events.filter((e) => e.type === 'fire' && e.playerId === id).length;

test('이동을 오래 유지해도 X 경계 유지, Y 불변', () => {
  const { match, inputs, P1, P2 } = playing(2);
  inputs.P1.moveAxis = 1; inputs.P2.moveAxis = -1;
  for (let i = 0; i < 600; i++) step(match, inputs);
  assert.equal(P1.x, MAX_X); assert.equal(P1.y, RAIL_Y.earth);
  assert.equal(P2.x, MIN_X); assert.equal(P2.y, RAIL_Y.isb);
});

test('전 방향 드래그에도 자기 안쪽 반원으로만 조준', () => {
  for (let deg = 0; deg < 360; deg += 5) {
    const dx = Math.cos(deg * Math.PI / 180) * 50, dy = Math.sin(deg * Math.PI / 180) * 50;
    const earth = aimFromDrag(dx, dy, 60, 'earth', UP).aim;
    const isb = aimFromDrag(dx, dy, 60, 'isb', DOWN).aim;
    assert.ok(earth >= -Math.PI && earth <= 0, `earth ${deg}`);
    assert.ok(isb >= 0 && isb <= Math.PI, `isb ${deg}`);
  }
  assert.equal(aimFromDrag(0, 50, 60, 'earth', -1).aim, -1, '정반대 드래그는 이전 방향 유지');
  assert.equal(aimFromDrag(0, 50, 60, 'earth', -1).armed, false);
  assert.equal(aimFromDrag(3, -3, 60, 'earth', UP).armed, false, '데드존 안은 조준 아님');
  assert.equal(moveAxisFromDrag(5, 60), 0);
  assert.equal(moveAxisFromDrag(200, 60), 1);
});

test('조준하면 바로 발사, 유지하는 동안 총기 간격마다 자동 연사, 놓으면 멈춤', () => {
  const { match, inputs } = playing(2, { P1: { weapon: 'rifle' }, P2: { weapon: 'pistol' } });
  inputs.P1.aiming = true; inputs.P2.aiming = true;
  const first = step(match, inputs);
  assert.equal(shots(first, 'P1'), 1, '조준 즉시 첫 발');
  assert.equal(shots(first, 'P2'), 1);
  const rest = run(match, inputs, 1 - TICK);
  assert.equal(shots(rest, 'P1'), 4, '돌격소총 0.2초 간격: 1초에 5발');
  assert.equal(shots(rest, 'P2'), 1, '권총 0.5초 간격: 1초에 2발');
  inputs.P1.aiming = false;
  assert.equal(shots(run(match, inputs, 1), 'P1'), 0, '조준을 풀면 발사 없음');
});

test('쌍권총은 0.5초마다 2점사, 점사 중 조준을 풀어도 두 번째 탄까지 나감', () => {
  const { match, inputs } = playing(2, { P1: { weapon: 'dual' } });
  inputs.P1.aiming = true;
  assert.equal(shots(step(match, inputs), 'P1'), 1);
  inputs.P1.aiming = false;
  assert.equal(shots(run(match, inputs, WEAPONS.dual.burstGap + TICK), 'P1'), 1, '두 번째 탄');
  assert.equal(shots(run(match, inputs, 1), 'P1'), 0, '그 뒤로는 없음');
  inputs.P1.aiming = true;
  assert.equal(shots(run(match, inputs, 1), 'P1'), 4, '유지하면 0.5초마다 2발');
});

test('입력 취소 후 발사 없음, 이동 0', () => {
  const { match, inputs, P1 } = playing(2);
  Object.assign(inputs.P1, { moveAxis: 1, touchAxis: 1, aiming: true });
  cancelInputs(inputs);
  const x = P1.x;
  step(match, inputs);
  assert.equal(match.projectiles.length, 0);
  assert.equal(P1.x, x);
});

test('총기별 피해: 돌격소총 7, 권총 10, 쌍권총 10, RPG 40', () => {
  for (const [weapon, dmg] of [['rifle', 7], ['pistol', 10], ['dual', 10], ['rpg', 40]]) {
    const { match, inputs, P1, P2 } = playing(2, { P1: { weapon } });
    bulletNear(match, P1, P2, UP);
    step(match, inputs);
    assert.equal(P2.hp, MAX_HP - dmg, weapon);
  }
});

test('아군은 통과, 적만 적중', () => {
  const { match, inputs, P1, P3, P2 } = playing(4);
  const through = spawnProjectile(match, P1, 0); // 같은 레일의 P3를 향해 수평 발사
  through.x = through.previousX = P3.x - 40;
  step(match, inputs);
  assert.equal(P3.hp, MAX_HP);
  assert.ok(match.projectiles.includes(through));
  bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, MAX_HP - WEAPONS[P1.weapon].damage);
});

test('적 둘을 관통할 경로여도 가장 이른 한 명만 적중', () => {
  const { match, inputs, P1, P2, P4 } = playing(4, { P1: { weapon: 'pistol' } });
  P2.x = P2.previousX = 500; P4.x = P4.previousX = 540;
  const b = spawnProjectile(match, P1, 0);
  b.x = b.previousX = 440; b.y = b.previousY = P2.y;
  for (let i = 0; i < 20; i++) step(match, inputs);
  assert.equal(P2.hp, MAX_HP - 10);
  assert.equal(P4.hp, MAX_HP);
  assert.equal(match.projectiles.length, 0);
});

test('연사한 탄은 무적 없이 모두 피해', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rifle' } });
  bulletNear(match, P1, P2, UP); bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, MAX_HP - 14);
  bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, MAX_HP - 21);
  assert.equal(match.projectiles.length, 0);
});

test('RPG: 직접 명중 40 + 주변 적 폭발 피해 10, 아군·먼 적은 무사', () => {
  const { match, inputs, P1, P2, P3, P4 } = playing(4, { P1: { weapon: 'rpg' } });
  P2.x = P2.previousX = 500; P4.x = P4.previousX = 580; // 80px 옆
  bulletNear(match, P1, P2, UP);
  const events = step(match, inputs);
  assert.equal(P2.hp, MAX_HP - 40);
  assert.equal(P4.hp, MAX_HP - 10);
  assert.equal(P3.hp, MAX_HP);
  assert.ok(events.some((e) => e.type === 'explode'));
  P4.x = P4.previousX = 1000;
  bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, MAX_HP - 80);
  assert.equal(P4.hp, MAX_HP - 10, '폭발 범위 밖');
});

test('체력 0이면 쓰러지고, 쓰러진 플레이어는 움직이거나 쏘거나 맞지 않음', () => {
  const { match, inputs, P1, P2, P4 } = playing(4, { P1: { weapon: 'rpg' } });
  P2.hp = 40;
  bulletNear(match, P1, P2, UP);
  const events = step(match, inputs);
  assert.equal(P2.hp, 0);
  assert.equal(P2.alive, false);
  assert.ok(events.some((e) => e.type === 'down' && e.playerId === 'P2'));
  assert.equal(match.phase, 'playing', 'P4가 남아 있으면 계속');
  const x = P2.x;
  Object.assign(inputs.P2, { moveAxis: 1, aiming: true });
  const b = bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.x, x);
  assert.equal(fired(match, 'P2'), 0);
  assert.ok(match.projectiles.includes(b), '쓰러진 대상은 통과');
  assert.equal(P4.alive, true);
});

test('팀 전원이 쓰러지면 상대 팀 승리', () => {
  const { match, inputs, P1, P2, P4 } = playing(4);
  P2.alive = false; P2.hp = 0;
  P4.hp = 5;
  bulletNear(match, P1, P4, UP);
  const events = step(match, inputs);
  assert.equal(match.winner, 'earth');
  assert.equal(match.phase, 'result');
  assert.equal(match.projectiles.length, 0);
  assert.ok(events.some((e) => e.type === 'result'));
});

test('같은 틱에 양 팀 마지막 한 명이 함께 쓰러지면 무승부', () => {
  const { match, inputs, P1, P2 } = playing(2);
  P1.hp = 5; P2.hp = 5;
  bulletNear(match, P1, P2, UP); bulletNear(match, P2, P1, DOWN);
  step(match, inputs);
  assert.equal(match.winner, 'draw');
});

test('큰 dt와 이동 중인 대상에도 연속 충돌로 적중', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'pistol' } });
  const b = spawnProjectile(match, P1, UP);
  b.y = b.previousY = P2.y + 50; // 한 틱(0.15초=108px)에 대상을 완전히 지나쳐 시작·끝점 모두 판정 원 밖
  b.x = b.previousX = P2.x - 25;
  inputs.P2.moveAxis = -1;
  step(match, inputs, 0.15);
  assert.ok(Math.hypot(b.x - P2.x, b.y - P2.y) > 35);
  assert.equal(P2.hp, MAX_HP - 10);
});

test('전투기는 무작위로 나타나 가운데를 가로질러 지나가고 사라짐', () => {
  const { match, inputs } = playing(2);
  match.jetTimer = 0.5;
  run(match, inputs, 0.4);
  assert.equal(match.jet, null);
  run(match, inputs, 0.2);
  const { jet } = match;
  assert.ok(jet);
  assert.equal(jet.y, JET.y);
  const startX = jet.x;
  run(match, inputs, 1);
  assert.ok(Math.abs(Math.abs(jet.x - startX) - JET.speed) < 3, '초당 JET.speed로 X축 이동');
  let t = 0;
  while (match.jet && t < 20) { step(match, inputs); t += TICK; }
  assert.equal(match.jet, null, '화면을 벗어나면 사라짐');
  assert.ok(match.jetTimer >= JET.delay[0] && match.jetTimer <= JET.delay[1], '다음 등장은 무작위 대기 후');
});

test('전투기는 양 팀 총알을 막아 줌 (RPG는 그 자리에서 폭발)', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rpg' } });
  match.jet = { x: 600, previousX: 600, y: JET.y, dir: 1, fireTimer: Infinity }; // 기관포는 끔
  P1.x = P1.previousX = 600; P2.x = P2.previousX = 600;
  const up = spawnProjectile(match, P1, UP);
  inputs.P2.aiming = true;
  step(match, inputs);
  inputs.P2.aiming = false;
  const events = [];
  for (let i = 0; i < 120; i++) events.push(...step(match, inputs));
  assert.ok(!match.projectiles.includes(up));
  assert.equal(P1.hp, MAX_HP);
  assert.equal(P2.hp, MAX_HP);
  assert.ok(events.filter((e) => e.type === 'block').length >= 2);
  assert.ok(events.some((e) => e.type === 'explode'));
});

test('사각형 선분 판정', () => {
  assert.equal(segmentRectTime(-20, 0, 20, 0, 10, 10), 0.25);
  assert.equal(segmentRectTime(0, 0, 5, 5, 10, 10), 0, '시작점이 안이면 0');
  assert.equal(segmentRectTime(-20, 30, 20, 30, 10, 10), null);
  assert.equal(segmentRectTime(-20, 0, -15, 0, 10, 10), null);
});

test('자리별 팀 고정, 캐릭터·총기는 자유 선택, 체력 500으로 시작', () => {
  assert.deepEqual(createMatch(2).players.map((p) => [p.id, p.team, p.characterId, p.weapon]),
    [['P1', 'earth', 'earth-arrow', 'dual'], ['P2', 'isb', 'isb-agent-1', 'pistol']], '그림 속 무기가 기본');
  const four = createMatch(4, {
    P1: { characterId: 'isb-agent-2', weapon: 'rpg' }, P2: { characterId: 'earth-pizza', weapon: 'rifle' },
    P3: { characterId: 'earth-pizza', weapon: 'smg' }, P4: {},
  }).players;
  assert.deepEqual(four.map((p) => p.team), ['earth', 'isb', 'earth', 'isb']);
  assert.deepEqual(four.map((p) => p.characterId), ['isb-agent-2', 'earth-pizza', 'earth-pizza', 'isb-agent-2']);
  assert.deepEqual(four.map((p) => p.weapon), ['rpg', 'rifle', 'rifle', 'rpg'], '주무기가 아닌 것은 자리 기본값');
  assert.equal(four[0].name, '요원 2');
  assert.deepEqual(four.map((p) => p.x), [480, 480, 1120, 1120]);
  assert.equal(MAX_HP, 500);
  assert.ok(four.every((p) => p.hp === MAX_HP && p.alive));
});

test('카운트다운 중에는 조준해도 발사 없이 3초 뒤 시작', () => {
  const match = createMatch(2);
  const inputs = createInputs(match.players);
  inputs.P1.aiming = true;
  for (let i = 0; i < 180; i++) step(match, inputs);
  assert.equal(match.projectiles.length, 0);
  step(match, inputs);
  assert.equal(match.phase, 'playing');
});

test('RPG 탄속 900, 쿨타임 1초', () => {
  assert.equal(WEAPONS.rpg.speed, 900);
  assert.equal(WEAPONS.rpg.interval, 1);
});

test('엄폐물: 가운데 1개 + 팀마다 1개, 모든 탄을 막고 RPG는 그 자리에서 폭발', () => {
  assert.equal(COVERS.length, 3);
  assert.equal(COVERS.filter((c) => c.team === 'earth').length, 1);
  assert.equal(COVERS.filter((c) => c.team === 'isb').length, 1);
  const center = COVERS.find((c) => !c.team);
  assert.equal(center.x, ARENA_WIDTH / 2);

  for (const cover of COVERS) {
    const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rpg' }, P2: { weapon: 'pistol' } });
    P1.x = P1.previousX = cover.x; P2.x = P2.previousX = cover.x;
    const up = spawnProjectile(match, P1, UP);
    const down = spawnProjectile(match, P2, DOWN);
    const events = run(match, inputs, 1);
    assert.ok(!match.projectiles.includes(up) && !match.projectiles.includes(down), cover.id);
    assert.equal(P1.hp, MAX_HP, cover.id);
    assert.equal(P2.hp, MAX_HP, cover.id);
    assert.ok(events.filter((e) => e.type === 'block').length >= 2, cover.id);
    assert.ok(events.some((e) => e.type === 'explode'), cover.id);
  }
});

test('전투기는 1초마다 위·아래 양쪽으로 20 피해 미사일을 쏘고, 양 팀 모두 맞음', () => {
  const { match, inputs, P1, P2 } = playing(2);
  const x = 300; // 엄폐물이 없는 세로줄
  assert.ok(COVERS.every((c) => Math.abs(c.x - x) > c.w / 2 + 40));
  match.jet = { x, previousX: x, y: JET.y, dir: 1, fireTimer: JET.missile.interval };
  const events = [];
  for (let i = 0; i < 20; i++) { // 전투기를 제자리에 고정하고 사격 주기만 확인
    match.jet.x = match.jet.previousX = x;
    events.push(...step(match, inputs));
  }
  assert.equal(events.filter((e) => e.type === 'jet-fire').length, 0, '첫 발은 등장 1초 뒤');
  P1.x = P1.previousX = x; P2.x = P2.previousX = x;
  for (let i = 0; i < 60 * 2.5; i++) {
    match.jet.x = match.jet.previousX = x;
    events.push(...step(match, inputs));
  }
  const volleys = events.filter((e) => e.type === 'jet-fire').length;
  assert.equal(volleys, 2, '1초 간격');
  const hits = events.filter((e) => e.type === 'hit' && e.team === 'jet');
  assert.ok(hits.some((e) => e.victimId === 'P1') && hits.some((e) => e.victimId === 'P2'), '위·아래 모두');
  assert.ok(hits.every((e) => e.damage === JET.missile.damage && e.damage === 20));
  assert.equal(P1.hp, MAX_HP - 20 * volleys);
  assert.equal(P2.hp, MAX_HP - 20 * volleys);
});

test('전투기 미사일은 전투기 자신에게 막히지 않고, 화면 밖에서는 쏘지 않음', () => {
  const { match, inputs } = playing(2);
  match.jet = { x: -100, previousX: -100, y: JET.y, dir: 1, fireTimer: 0 };
  const events = step(match, inputs);
  assert.equal(events.filter((e) => e.type === 'jet-fire').length, 0);
  match.jet = { x: 300, previousX: 300, y: JET.y, dir: 1, fireTimer: 0 };
  const ev = step(match, inputs);
  assert.equal(ev.filter((e) => e.type === 'jet-fire').length, 1);
  assert.equal(match.projectiles.filter((b) => b.team === 'jet').length, 2);
  assert.equal(ev.filter((e) => e.type === 'block').length, 0);
});

/** 엄폐물 바로 아래(지구방위 쪽)에서 위로 날아가는 탄을 놓는다. */
function bulletBelowCover(match, shooter, cover, dx = 0) {
  const b = spawnProjectile(match, shooter, UP);
  b.x = b.previousX = cover.x + dx;
  b.y = b.previousY = cover.y + cover.h / 2 + 8;
  return b;
}
const coverById = (match, id) => match.covers.find((c) => c.id === id);

test('엄폐물 내구도 200: 총알만큼 깎이고 RPG 직격은 2배', () => {
  const { match, inputs, P1 } = playing(2, { P1: { weapon: 'rifle' } });
  const cover = coverById(match, 'center');
  assert.equal(cover.hp, COVER.hp);
  assert.equal(COVER.hp, 200);
  bulletBelowCover(match, P1, cover);
  const events = step(match, inputs);
  assert.equal(cover.hp, 200 - 7);
  assert.ok(events.some((e) => e.type === 'cover-hit' && e.coverId === 'center'));
  P1.weapon = 'rpg';
  bulletBelowCover(match, P1, cover);
  step(match, inputs);
  assert.equal(cover.hp, 200 - 7 - 80);
});

test('내구도가 0이 되면 부서지고, 그 뒤로는 탄이 통과하며 다시 생기지 않음', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rpg' } });
  const cover = coverById(match, 'center');
  cover.hp = 60;
  bulletBelowCover(match, P1, cover);
  const events = step(match, inputs);
  assert.equal(cover.hp, 0);
  assert.ok(events.some((e) => e.type === 'cover-break' && e.coverId === 'center'));
  P1.weapon = 'pistol';
  P2.x = P2.previousX = cover.x;
  const b = bulletBelowCover(match, P1, cover);
  step(match, inputs);
  assert.ok(match.projectiles.includes(b), '부서진 자리는 통과');
  run(match, inputs, 3);
  assert.equal(P2.hp, MAX_HP - 10, '뒤의 적이 맞음');
  assert.equal(cover.hp, 0, '재생성 없음');
  assert.equal(createMatch(2).covers.find((c) => c.id === 'center').hp, COVER.hp, '새 경기는 온전한 엄폐물');
});

test('RPG 폭발 범위는 근처 엄폐물도 깎음', () => {
  const { match, inputs, P1 } = playing(2, { P1: { weapon: 'rpg' } });
  const center = coverById(match, 'center');
  const near = coverById(match, 'isb');
  near.x = center.x + center.w / 2 + near.w / 2 + 60; near.y = center.y; // 경기 상태에서만 옆으로 옮겨 붙인다
  bulletBelowCover(match, P1, center, center.w / 2 - 10);
  step(match, inputs);
  assert.equal(center.hp, COVER.hp - WEAPONS.rpg.damage * COVER.rpgMultiplier, '직격은 2배, 폭발 중복 없음');
  assert.equal(near.hp, COVER.hp - WEAPONS.rpg.splash.damage, '옆 엄폐물은 폭발 피해');
  assert.equal(COVERS.find((c) => c.id === 'isb').x, ARENA_WIDTH - 480, '설정값은 그대로');
});

test('전투기 미사일은 엄폐물을 넘어 뒤의 플레이어를 직격하고, 엄폐물은 깎지 않음', () => {
  const { match, inputs, P2 } = playing(2);
  const c = coverById(match, 'isb');
  P2.x = P2.previousX = c.x; // ISB 엄폐물 바로 뒤
  match.jet = { x: c.x, previousX: c.x, y: JET.y, dir: 1, fireTimer: 0 };
  const events = step(match, inputs);
  match.jet = null; // 한 발만 확인
  events.push(...run(match, inputs, 1));
  assert.equal(c.hp, COVER.hp, '엄폐물 내구도 그대로');
  assert.ok(!events.some((e) => e.type === 'block'), '막히지 않음');
  assert.equal(P2.hp, MAX_HP - JET.missile.damage, '직격 20, 직격 대상은 폭발 중복 없음');
  assert.ok(events.some((e) => e.type === 'explode'), '맞으면 터짐');
});

test('전투기 미사일은 유도 없이 똑바로 날아가고, 빗나가면 레일에서 터져 주변 폭발 피해', () => {
  assert.equal(JET.missile.homing, undefined);
  const { match, inputs, P1, P2 } = playing(2);
  const x = 300;
  P2.x = P2.previousX = x + 60; // 직선 경로에서 60px 옆: 유도가 없으니 직격은 못 하고 폭발 피해만
  P1.x = P1.previousX = x + 400; // 폭발 범위 밖
  match.jet = { x, previousX: x, y: JET.y, dir: 1, fireTimer: 0 };
  const events = step(match, inputs);
  match.jet = null;
  const up = match.projectiles.find((b) => b.team === 'jet' && b.vy < 0);
  const launchX = up.x; // 전투기가 이번 틱에 조금 움직인 뒤 쏜 위치
  events.push(...run(match, inputs, 1));
  assert.equal(up.x, launchX, '옆으로 휘지 않음');
  assert.equal(P2.hp, MAX_HP - JET.missile.splash.damage, '직격 없이 폭발 피해');
  assert.equal(P1.hp, MAX_HP);
  const booms = events.filter((e) => e.type === 'explode');
  assert.equal(booms.length, 2);
  assert.ok(booms.every((e) => e.x === launchX), '둘 다 전투기 바로 위아래에서 터짐');
  assert.ok(booms.some((e) => Math.abs(e.y - RAIL_Y.earth) < 1e-6));
});

test('RPG 유도: 비껴 쏴도 가장 가까운 적 쪽으로 휘어 직격', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rpg' } });
  P1.x = P1.previousX = 300; P2.x = P2.previousX = 450; // 정면이 아니라 150px 옆의 적
  spawnProjectile(match, P1, UP); // 똑바로 위로
  const events = run(match, inputs, 1);
  assert.equal(P2.hp, MAX_HP - WEAPONS.rpg.damage);
  assert.ok(events.some((e) => e.type === 'hit' && e.victimId === 'P2'));

  // 유도 없는 권총은 같은 조건에서 빗나감
  const other = playing(2, { P1: { weapon: 'pistol' } });
  other.P1.x = other.P1.previousX = 300; other.P2.x = other.P2.previousX = 450;
  spawnProjectile(other.match, other.P1, UP);
  run(other.match, other.inputs, 2);
  assert.equal(other.P2.hp, MAX_HP);
});

test('RPG 유도는 한도가 있어 너무 먼 적은 못 맞힘', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rpg' } });
  P1.x = P1.previousX = 200; P2.x = P2.previousX = 800; // 600px 옆은 유도로 못 따라가고 폭발 범위 밖
  spawnProjectile(match, P1, UP);
  run(match, inputs, 2);
  assert.equal(P2.hp, MAX_HP);
});

test('빗나간 RPG는 적 레일 선에서 터져 근처 적에게 폭발 피해', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rpg' } });
  P2.x = P2.previousX = 800;
  const b = spawnProjectile(match, P1, UP);
  b.x = b.previousX = P2.x + 90; b.y = b.previousY = RAIL_Y.isb + 40; // 판정 원 밖으로 스쳐 지나가는 위치
  const events = run(match, inputs, 0.2);
  const boom = events.find((e) => e.type === 'explode');
  assert.ok(boom, '빗나가도 폭발');
  assert.ok(Math.abs(boom.y - RAIL_Y.isb) < 1e-6, '적 레일 선에서');
  assert.equal(P2.hp, MAX_HP - WEAPONS.rpg.splash.damage);
  assert.equal(match.projectiles.length, 0);
});

test('레일에 닿기 전에 경기장을 벗어나거나 수명이 다한 RPG도 그 자리에서 터짐', () => {
  const { match, inputs, P1 } = playing(2, { P1: { weapon: 'rpg' } });
  P1.x = P1.previousX = MAX_X;
  const out = spawnProjectile(match, P1, -0.05); // 오른쪽 벽으로 거의 수평
  const events = run(match, inputs, 0.3);
  const boom = events.find((e) => e.type === 'explode');
  assert.ok(boom);
  assert.equal(boom.x, ARENA_WIDTH);
  assert.ok(!match.projectiles.includes(out));

  const b = spawnProjectile(match, P1, UP);
  b.life = TICK / 2;
  assert.ok(step(match, inputs).some((e) => e.type === 'explode'), '수명 끝');
});

test('RPG는 조준 중에는 쏘지 않고 손을 뗄 때 한 발, 이후 1초 쿨타임', () => {
  const { match, inputs } = playing(2, { P1: { weapon: 'rpg' } });
  inputs.P1.aiming = true;
  assert.equal(shots(run(match, inputs, 2), 'P1'), 0, '누르고 있는 동안은 발사 없음');
  inputs.P1.aiming = false;
  assert.equal(shots(step(match, inputs), 'P1'), 1, '손을 떼면 발사');
  assert.equal(shots(run(match, inputs, 1), 'P1'), 0, '다시 누르지 않으면 없음');

  // 쿨타임 중에 조준·해제하면 발사 없음
  inputs.P1.aiming = true; step(match, inputs); inputs.P1.aiming = false;
  const quick = playing(2, { P1: { weapon: 'rpg' } });
  quick.inputs.P1.aiming = true; step(quick.match, quick.inputs);
  quick.inputs.P1.aiming = false; step(quick.match, quick.inputs); // 1발
  quick.inputs.P1.aiming = true; run(quick.match, quick.inputs, 0.5);
  quick.inputs.P1.aiming = false;
  assert.equal(shots(step(quick.match, quick.inputs), 'P1'), 0, '0.5초 만에 뗀 건 쿨타임이라 무시');
  quick.inputs.P1.aiming = true; run(quick.match, quick.inputs, 0.6);
  quick.inputs.P1.aiming = false;
  assert.equal(shots(step(quick.match, quick.inputs), 'P1'), 1, '1초가 지난 뒤 떼면 발사');
});

test('일시정지로 조준이 풀린 것은 발사로 치지 않음', () => {
  const { match, inputs } = playing(2, { P1: { weapon: 'rpg' } });
  inputs.P1.aiming = true;
  step(match, inputs);
  cancelInputs(inputs);
  match.phase = 'countdown'; match.countdown = 0.05;
  const events = run(match, inputs, 1);
  assert.equal(shots(events, 'P1'), 0);
});

test('저격총: 한 발 피해 60, 조준 후 떼면 발사, 발사 뒤 1초 쿨타임', () => {
  assert.ok(WEAPONS.sniper.damage > WEAPONS.rpg.damage);
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'sniper' } });
  bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, MAX_HP - 60);

  const o = playing(2, { P1: { weapon: 'sniper' } });
  o.inputs.P1.aiming = true;
  assert.equal(shots(run(o.match, o.inputs, 2), 'P1'), 0, '누르고 있는 동안은 안 쏨');
  o.inputs.P1.aiming = false;
  assert.equal(shots(step(o.match, o.inputs), 'P1'), 1, '떼면 발사');
  o.inputs.P1.aiming = true; run(o.match, o.inputs, 0.5); o.inputs.P1.aiming = false;
  assert.equal(shots(step(o.match, o.inputs), 'P1'), 0, '0.5초 만엔 쿨타임');
  o.inputs.P1.aiming = true; run(o.match, o.inputs, 0.6); o.inputs.P1.aiming = false;
  assert.equal(shots(step(o.match, o.inputs), 'P1'), 1, '1초 뒤엔 발사');
});

test('저격총을 고른 플레이어마다 그 팀 진영에 강철 엄폐물: 부서지지 않고 양 팀 총알을 모두 막음', () => {
  const none = createMatch(2, { P1: { weapon: 'rifle' }, P2: { weapon: 'pistol' } });
  assert.equal(none.covers.filter((c) => c.steel).length, 0, '저격수 없으면 없음');

  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'sniper' } });
  const steel = match.covers.filter((c) => c.steel);
  assert.equal(steel.length, 1);
  assert.equal(steel[0].team, 'earth');
  assert.ok(Math.abs(steel[0].y - RAIL_Y.earth) < 200, '지구방위팀 진영');
  assert.ok(COVERS.every((c) => Math.hypot(c.x - steel[0].x, c.y - steel[0].y) > 200), '다른 엄폐물과 떨어져 있음');

  // 아래(저격수 쪽)와 위(적 쪽)에서 모두 쏴도 막힘, 내구도 그대로
  P1.x = P1.previousX = steel[0].x; P2.x = P2.previousX = steel[0].x;
  P1.weapon = 'rpg'; P2.weapon = 'sniper';
  const own = spawnProjectile(match, P1, UP);
  own.y = own.previousY = steel[0].y + 40;
  const enemy = spawnProjectile(match, P2, DOWN);
  enemy.y = enemy.previousY = steel[0].y - 60;
  const events = run(match, inputs, 0.3);
  assert.ok(!match.projectiles.includes(own) && !match.projectiles.includes(enemy));
  assert.equal(events.filter((e) => e.type === 'block').length, 2);
  assert.ok(!events.some((e) => e.type === 'cover-hit' || e.type === 'cover-break'));
  assert.equal(steel[0].hp, Infinity);
  assert.equal(P1.hp, MAX_HP, '적 저격탄은 강철에 막힘');

  const four = createMatch(4, { P1: { weapon: 'sniper' }, P3: { weapon: 'sniper' }, P2: { weapon: 'sniper' } });
  const s4 = four.covers.filter((c) => c.steel);
  assert.deepEqual(s4.map((c) => c.team).sort(), ['earth', 'earth', 'isb']);
  assert.notEqual(s4[0].x, s4[1].x, '같은 팀 둘이면 다른 자리');
});

test('경기 중 무기 전환: 주무기 → 보조무기(기관단총) → 수류탄 → 주무기, 전환 직후 잠깐 발사 불가, 쓰러지면 불가', () => {
  const { match, inputs, P1 } = playing(2, { P1: { weapon: 'rifle' } });
  const order = [];
  for (let i = 0; i < 3; i++) {
    inputs.P1.swap = true;
    const ev = step(match, inputs);
    assert.ok(ev.some((e) => e.type === 'swap' && e.playerId === 'P1'));
    assert.equal(inputs.P1.swap, false, '한 번 누르면 한 번만');
    order.push([P1.slot, P1.weapon]);
  }
  assert.deepEqual(order, [['secondary', 'smg'], ['grenade', 'grenade'], ['primary', 'rifle']], '주무기 자체는 바뀌지 않음');
  inputs.P1.aiming = true;
  assert.equal(shots(run(match, inputs, 0.3), 'P1'), 0, '전환 직후 0.4초는 쏘지 못함');
  assert.ok(shots(run(match, inputs, 0.2), 'P1') >= 1);

  P1.alive = false; P1.hp = 0;
  inputs.P1.swap = true;
  step(match, inputs);
  assert.equal(P1.weapon, 'rifle');
});

test('기관단총: 한 발 4, 4초 연사하면 과열되어 2초 쉬고, 쉬는 동안엔 식음', () => {
  assert.equal(WEAPONS.smg.damage, 4);
  const { match, inputs, P1, P2 } = playing(2);
  P1.slot = 'secondary'; P1.weapon = 'smg';
  bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, MAX_HP - 4);

  const g = playing(2);
  g.P1.slot = 'secondary'; g.P1.weapon = 'smg';
  g.inputs.P1.aiming = true;
  const firstFour = run(g.match, g.inputs, 4);
  assert.equal(shots(firstFour, 'P1'), 40, '0.1초 간격으로 4초 = 40발');
  assert.ok(firstFour.some((e) => e.type === 'overheat' && e.playerId === 'P1'));
  assert.equal(shots(run(g.match, g.inputs, 1.9), 'P1'), 0, '과열 2초 동안 발사 없음');
  assert.ok(shots(run(g.match, g.inputs, 0.3), 'P1') >= 1, '2초 뒤 다시 발사');

  const c = playing(2);
  c.P1.slot = 'secondary'; c.P1.weapon = 'smg';
  c.inputs.P1.aiming = true; run(c.match, c.inputs, 3);
  c.inputs.P1.aiming = false; run(c.match, c.inputs, 2);
  c.inputs.P1.aiming = true;
  assert.ok(!run(c.match, c.inputs, 2).some((e) => e.type === 'overheat'), '쉬면 식어서 바로 과열되지 않음');
});

test('수류탄: 조준 후 떼면 던지고, 엄폐물을 넘어 적 레일에서 터져 반경 240 안 적에게 50, 20초 쿨타임', () => {
  assert.equal(WEAPONS.grenade.splash.radius, WEAPONS.rpg.splash.radius * 2);
  const { match, inputs, P1, P2 } = playing(2);
  const cover = coverById(match, 'center');
  P1.x = P1.previousX = cover.x; P2.x = P2.previousX = cover.x + 200; // 가운데 엄폐물 뒤, 착탄점에서 200px
  P1.slot = 'grenade'; P1.weapon = 'grenade';
  inputs.P1.aiming = true;
  assert.equal(shots(run(match, inputs, 0.5), 'P1'), 0, '누르는 동안은 안 던짐');
  inputs.P1.aiming = false;
  const events = run(match, inputs, 2);
  assert.equal(shots(events, 'P1'), 1);
  assert.equal(cover.hp, COVER.hp, '엄폐물에 막히지 않고 넘어감');
  const boom = events.find((e) => e.type === 'explode');
  assert.ok(Math.abs(boom.y - RAIL_Y.isb) < 1e-6, '적 레일 선에서 터짐');
  assert.equal(boom.radius, 240);
  assert.equal(P2.hp, MAX_HP - 50);

  inputs.P1.aiming = true; run(match, inputs, 0.2); inputs.P1.aiming = false;
  assert.equal(shots(run(match, inputs, 0.2), 'P1'), 0, '쿨타임 중엔 못 던짐');
  // 주무기로 바꿔도 쿨타임은 계속 흐른다
  run(match, inputs, 18);
  inputs.P1.aiming = true; step(match, inputs); inputs.P1.aiming = false;
  assert.equal(shots(step(match, inputs), 'P1'), 1, '20초 뒤 다시 던짐');
});

test('R-10 드론: 레이저 캐논 고정, 무기 전환 불가, 체력 400, 0.1초마다 4 피해 레이저가 즉시 닿음', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { characterId: 'r10', weapon: 'rpg' } });
  assert.equal(P1.name, 'R-10');
  assert.equal(P1.hp, 400);
  assert.equal(P1.maxHp, 400);
  assert.equal(P1.weapon, 'laser', '고른 무기와 상관없이 레이저');
  inputs.P1.swap = true;
  assert.ok(!step(match, inputs).some((e) => e.type === 'swap'));
  assert.equal(P1.weapon, 'laser');

  P1.x = P1.previousX = 300; P2.x = P2.previousX = 300; // 엄폐물 없는 줄
  inputs.P1.aiming = true;
  const events = run(match, inputs, 1);
  assert.equal(shots(events, 'P1'), 10, '0.1초 간격');
  assert.equal(match.projectiles.length, 0, '탄환이 아니라 레이저');
  const lasers = events.filter((e) => e.type === 'laser');
  assert.equal(lasers.length, 10);
  assert.ok(Math.abs(lasers[0].y2 - P2.y) < BODY_RADIUS + 1, '적에게 닿은 곳에서 멈춤');
  assert.equal(P2.hp, MAX_HP - 40);
});

test('R-10 배터리: 30발 쏘면 방전돼 못 쏘고, 마지막 발사 2초 뒤 가득 참', () => {
  const { match, inputs, P1 } = playing(2, { P1: { characterId: 'r10' } });
  P1.x = P1.previousX = 300; // 적과 엄폐물이 없는 줄
  match.players[1].x = match.players[1].previousX = 1400;
  inputs.P1.aiming = true;
  assert.equal(shots(run(match, inputs, 3), 'P1'), 30);
  assert.equal(P1.battery, 0);
  assert.equal(shots(run(match, inputs, 1.9), 'P1'), 0, '방전 중');
  run(match, inputs, 0.2);
  assert.ok(P1.battery > 0, '2초 뒤 회복');
  inputs.P1.aiming = false;
  run(match, inputs, 2.1);
  assert.equal(P1.battery, WEAPONS.laser.battery.shots, '가득');
});

test('레이저는 엄폐물에 막히고 엄폐물을 4씩 깎음', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { characterId: 'r10' } });
  const cover = coverById(match, 'center');
  P1.x = P1.previousX = cover.x; P2.x = P2.previousX = cover.x;
  inputs.P1.aiming = true;
  const events = step(match, inputs);
  const laser = events.find((e) => e.type === 'laser');
  assert.ok(Math.abs(laser.y2 - (cover.y + cover.h / 2)) <= 6, '엄폐물 아래 면에서 멈춤');
  assert.equal(cover.hp, COVER.hp - 4);
  assert.equal(P2.hp, MAX_HP);
});
