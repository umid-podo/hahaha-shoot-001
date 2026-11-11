// 새 무기: 화염방사기(짧은 사거리 불꽃), 에너지 돌격소총(빠른 볼트, 3번 튕김), 에너지 쌍권총(빠른 연사·250발·낮은 피해)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step, spawnProjectile } from '../src/game/update.js';
import { TICK, WEAPONS, PRIMARY_IDS, LEGENDARY_IDS, COVER } from '../src/game/config.js';

function playing(p1Weapon) {
  const match = createMatch({ P1: { weapon: p1Weapon }, P2: { weapon: 'pistol' } }, 1);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  match.covers = [];
  match.highs = [];
  const inputs = createInputs(match.players);
  const [P1, P2] = match.players;
  return { match, inputs, P1, P2 };
}
function run(match, inputs, seconds) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) events.push(...step(match, inputs));
  return events;
}
const shots = (events, id) => events.filter((e) => e.type === 'fire' && e.playerId === id).length;

test('새 주무기: 화염방사기는 누구나, 에너지 무기 둘은 전설(상점 구매) 무기', () => {
  for (const id of ['flamethrower', 'energyrifle', 'energydual']) assert.ok(PRIMARY_IDS.includes(id));
  assert.deepEqual(LEGENDARY_IDS, ['energyrifle', 'energydual']);
  assert.ok(!WEAPONS.flamethrower.legendary);
});

test('화염방사기: 불꽃은 짧게 날아가다 사라지고(사거리 짧음), 가까우면 큰 피해', () => {
  const { match, inputs, P1, P2 } = playing('flamethrower');
  assert.equal(P1.weapon, 'flamethrower');
  // 멀리 있는 상대: 불꽃이 닿기 전에 사라진다
  P2.x = P1.x; P2.y = P1.y - 600;
  inputs.P1.aim = -Math.PI / 2;
  inputs.P1.aiming = true;
  run(match, inputs, 1);
  assert.equal(P2.hp, P2.maxHp, '600 거리는 안 닿음');
  assert.ok(match.projectiles.every((b) => b.flame && Math.hypot(b.x - b.startX, b.y - b.startY) < 400));
  // 가까운 상대: 1초에 많은 피해
  P2.y = P1.y - 180;
  const before = P2.hp;
  run(match, inputs, 1);
  assert.ok(before - P2.hp >= 40, `가까우면 큰 피해 ${before - P2.hp}`);
});

test('에너지 돌격소총: 탄속이 매우 빠르고, 엄폐물에 3번까지 튕긴 뒤에는 막힌다', () => {
  assert.ok(WEAPONS.energyrifle.speed >= WEAPONS.rifle.speed * 3);
  const { match, inputs, P1 } = playing('energyrifle');
  const cover = { id: 'c', x: P1.x, y: P1.y - 200, w: 200, h: 40, hp: Infinity, steel: true };
  match.covers = [cover];
  const b = spawnProjectile(match, P1, -Math.PI / 2);
  assert.equal(b.bounces, 3);
  const ev = run(match, inputs, 0.12);
  assert.ok(ev.some((e) => e.type === 'bounce'), '엄폐물에서 튕김');
  assert.ok(b.vy > 0, '반사돼 돌아온다');
  assert.equal(b.bounces, 2);
});

test('에너지 돌격소총: 경기장 끝(벽)에서도 튕기고, 3번 다 쓰면 사라진다', () => {
  const { match, inputs, P1, P2 } = playing('energyrifle');
  P2.x = -9999; // 비켜 둔다
  P1.x = 800; P1.y = 500;
  const b = spawnProjectile(match, P1, 0);
  const ev = run(match, inputs, 2.3);
  assert.equal(ev.filter((e) => e.type === 'bounce').length, 3);
  assert.ok(!match.projectiles.includes(b), '튕길 횟수를 다 쓰면 밖으로 나가 사라짐');
});

test('에너지 돌격소총: 튕긴 볼트로도 상대를 맞힌다', () => {
  const { match, inputs, P1, P2 } = playing('energyrifle');
  match.covers = [{ id: 'c', x: 800, y: 300, w: 600, h: 40, hp: Infinity, steel: true }];
  P1.x = 800; P1.y = 600; P2.x = 820; P2.y = 700; // 위 엄폐물로 쏘면 되돌아와 뒤의 상대에게
  spawnProjectile(match, P1, -Math.PI / 2);
  const hp = P2.hp;
  run(match, inputs, 0.6);
  assert.equal(P2.hp, hp - WEAPONS.energyrifle.damage);
});

test('에너지 쌍권총: 아주 빠르게 연사하고, 250발을 다 쏘면 1.2초 장전, 한 발 피해는 낮다', () => {
  const { match, inputs, P1, P2 } = playing('energydual');
  P1.y = 900;
  P2.x = -9999; // 쏘는 길에서 비켜 둔다(쓰러지면 경기가 끝남)
  inputs.P1.aim = -Math.PI / 2;
  inputs.P1.aiming = true;
  const ev = run(match, inputs, 5);
  assert.ok(shots(ev, 'P1') >= 80, `5초에 ${shots(ev, 'P1')}발`);
  assert.ok(!ev.some((e) => e.type === 'reload'), '5초(약 83발)로는 250발을 다 못 씀');
  assert.equal(WEAPONS.energydual.mag, 250);
  const more = run(match, inputs, 12);
  const reload = more.find((e) => e.type === 'reload');
  assert.ok(reload, '250발을 다 쏘면 장전');
  assert.equal(reload.time, 1.2);
  assert.ok(more.some((e) => e.type === 'reloaded'));
  assert.equal(shots(ev, 'P1') + shots(more, 'P1') - 250 > 0, true, '장전 뒤 다시 쏨');
  assert.ok(WEAPONS.energydual.damage < WEAPONS.rifle.damage);
  assert.ok(WEAPONS.energydual.speed >= WEAPONS.pistol.speed * 3);
  const hands = new Set(ev.filter((e) => e.type === 'fire').map((e) => e.hand));
  assert.deepEqual([...hands].sort(), [-1, 1], '두 자루를 번갈아');
});

test('튕기는 탄은 부서지는 엄폐물도 깎는다', () => {
  const { match, inputs, P1 } = playing('energyrifle');
  const cover = { id: 'c', x: P1.x, y: P1.y - 200, w: 200, h: 40, hp: COVER.hp };
  match.covers = [cover];
  spawnProjectile(match, P1, -Math.PI / 2);
  run(match, inputs, 0.1);
  assert.equal(cover.hp, COVER.hp - WEAPONS.energyrifle.damage);
});
