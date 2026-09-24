// 핵심 로직 검증: 이동·조준·자동 발사·총기별 피해·체력/쓰러짐·전투기 방어 (DOM 경로는 브라우저에서 확인)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs, cancelInputs } from '../src/game/state.js';
import { step, spawnProjectile } from '../src/game/update.js';
import { segmentRectTime } from '../src/game/collision.js';
import { aimFromDrag, moveAxisFromDrag } from '../src/input/pointer.js';
import { MIN_X, MAX_X, RAIL_Y, TICK, MAX_HP, WEAPONS, JET } from '../src/game/config.js';

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

test('총기별 피해: 돌격소총 5, 권총 10, 쌍권총 10, RPG 20', () => {
  for (const [weapon, dmg] of [['rifle', 5], ['pistol', 10], ['dual', 10], ['rpg', 20]]) {
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
  assert.equal(P2.hp, 90);
  assert.equal(P4.hp, MAX_HP);
  assert.equal(match.projectiles.length, 0);
});

test('연사한 탄은 무적 없이 모두 피해', () => {
  const { match, inputs, P1, P2 } = playing(2, { P1: { weapon: 'rifle' } });
  bulletNear(match, P1, P2, UP); bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, 90);
  bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, 85);
  assert.equal(match.projectiles.length, 0);
});

test('RPG: 직접 명중 20 + 주변 적 폭발 피해 4, 아군·먼 적은 무사', () => {
  const { match, inputs, P1, P2, P3, P4 } = playing(4, { P1: { weapon: 'rpg' } });
  P2.x = P2.previousX = 500; P4.x = P4.previousX = 580; // 80px 옆
  bulletNear(match, P1, P2, UP);
  const events = step(match, inputs);
  assert.equal(P2.hp, 80);
  assert.equal(P4.hp, 96);
  assert.equal(P3.hp, MAX_HP);
  assert.ok(events.some((e) => e.type === 'explode'));
  P4.x = P4.previousX = 1000;
  bulletNear(match, P1, P2, UP);
  step(match, inputs);
  assert.equal(P2.hp, 60);
  assert.equal(P4.hp, 96, '폭발 범위 밖');
});

test('체력 0이면 쓰러지고, 쓰러진 플레이어는 움직이거나 쏘거나 맞지 않음', () => {
  const { match, inputs, P1, P2, P4 } = playing(4, { P1: { weapon: 'rpg' } });
  P2.hp = 20;
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
  assert.equal(P2.hp, 90);
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
  match.jet = { x: 600, previousX: 600, y: JET.y, dir: 1 };
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

test('자리별 팀 고정, 캐릭터·총기는 자유 선택, 체력 100으로 시작', () => {
  assert.deepEqual(createMatch(2).players.map((p) => [p.id, p.team, p.characterId, p.weapon]),
    [['P1', 'earth', 'earth-arrow', 'rifle'], ['P2', 'isb', 'isb-agent-1', 'dual']]);
  const four = createMatch(4, {
    P1: { characterId: 'isb-agent-2', weapon: 'rpg' }, P2: { characterId: 'earth-pizza', weapon: 'rifle' },
    P3: { characterId: 'earth-pizza', weapon: 'nope' }, P4: {},
  }).players;
  assert.deepEqual(four.map((p) => p.team), ['earth', 'isb', 'earth', 'isb']);
  assert.deepEqual(four.map((p) => p.characterId), ['isb-agent-2', 'earth-pizza', 'earth-pizza', 'isb-agent-2']);
  assert.deepEqual(four.map((p) => p.weapon), ['rpg', 'rifle', 'pistol', 'rpg'], '잘못된 총기는 기본값');
  assert.equal(four[0].name, '요원 2');
  assert.deepEqual(four.map((p) => p.x), [360, 360, 840, 840]);
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
