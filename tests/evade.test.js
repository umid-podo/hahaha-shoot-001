// 회피(빠른 돌진): 돌진 거리·방향, 2번 연속, 다 쓰면 쿨타임 뒤 다시 채움, 돌진 중 피해 30% 감소
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step, spawnProjectile } from '../src/game/update.js';
import { TICK, EVADE, WEAPONS } from '../src/game/config.js';

function playing() {
  const match = createMatch(undefined, 1);
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

test('회피: 누른 순간 움직이던 쪽으로 걸을 때보다 훨씬 빠르게 돌진한다', () => {
  const { match, inputs, P1 } = playing();
  const x0 = P1.x;
  inputs.P1.moveAxis = 1;
  inputs.P1.evade = true;
  const ev = run(match, inputs, EVADE.time);
  assert.ok(ev.some((e) => e.type === 'evade' && e.playerId === 'P1'));
  assert.equal(inputs.P1.evade, false, '한 번 누르면 한 번');
  const moved = P1.x - x0;
  assert.ok(Math.abs(moved - EVADE.speed * EVADE.time) < 2, `돌진 거리 ${moved}`);
  assert.ok(moved > P1.speed * EVADE.time * 3, '걷기보다 훨씬 빠름');
});

test('회피: 이동 입력이 없으면 바라보는 쪽(앞)으로 돌진한다', () => {
  const { match, inputs, P1 } = playing();
  const y0 = P1.y;
  inputs.P1.evade = true; // 지구방위팀은 위(-Y)를 본다
  run(match, inputs, EVADE.time);
  assert.ok(y0 - P1.y > EVADE.speed * EVADE.time * 0.9);
});

test('회피: 2번 연속 돌진할 수 있고, 2번 다 쓰면 쿨타임 0.5초 동안은 못 쓴다', () => {
  const { match, inputs, P1 } = playing();
  inputs.P1.moveAxis = 1;
  inputs.P1.evade = true;
  run(match, inputs, EVADE.time);
  assert.equal(P1.evadeCharges, 1);
  inputs.P1.moveAxis = -1;
  inputs.P1.evade = true;
  const second = run(match, inputs, EVADE.time);
  assert.ok(second.some((e) => e.type === 'evade'), '두 번째도 바로 된다');
  assert.equal(P1.evadeCharges, 0);
  // 세 번째: 쿨타임 중이라 안 나간다
  inputs.P1.moveAxis = 0;
  inputs.P1.evade = true;
  const third = run(match, inputs, TICK);
  assert.ok(!third.some((e) => e.type === 'evade'), '쿨타임 중엔 안 됨');
  assert.equal(P1.evade, null);
  // 0.5초가 지나면 다시 2번
  run(match, inputs, EVADE.cooldown - TICK * 2);
  assert.equal(P1.evadeCharges, 0, '아직 쿨타임');
  run(match, inputs, TICK * 2);
  assert.equal(P1.evadeCharges, EVADE.charges, '쿨타임이 끝나면 다시 가득');
  inputs.P1.evade = true;
  assert.ok(run(match, inputs, TICK).some((e) => e.type === 'evade'));
});

test('회피: 돌진 중 연달아 누르면 바로 새 방향으로 다시 돌진한다', () => {
  const { match, inputs, P1 } = playing();
  inputs.P1.moveAxis = 1;
  inputs.P1.evade = true;
  run(match, inputs, TICK * 3);
  inputs.P1.evade = true;
  inputs.P1.moveAxis = -1;
  const ev = run(match, inputs, TICK);
  assert.ok(ev.some((e) => e.type === 'evade'));
  assert.ok(P1.evade.dx < 0);
});

test('회피: 돌진하는 동안 받는 피해는 30% 줄고, 끝나면 그대로 받는다', () => {
  const { match, inputs, P1, P2 } = playing();
  const full = WEAPONS.pistol.damage;
  const hit = () => {
    const b = spawnProjectile(match, P2, Math.PI / 2);
    b.x = b.previousX = P1.x;
    b.y = b.previousY = P1.y - 40;
    const hp = P1.hp;
    step(match, inputs);
    return hp - P1.hp;
  };
  // 돌진 중(제자리에 묶어 두고 판정만 본다)
  P1.evade = { dx: 0, dy: 0, t: 0.5 };
  const reduced = hit();
  assert.equal(reduced, Math.round(full * EVADE.taken));
  run(match, inputs, 0.5);
  assert.equal(P1.evade, null);
  assert.equal(hit(), full);
});

test('회피: 카운트다운 중에 누른 것은 경기 시작 때 나가지 않는다', () => {
  const { match, inputs, P1 } = playing();
  match.phase = 'countdown';
  match.countdown = 0.05;
  inputs.P1.evade = true;
  run(match, inputs, 0.2);
  assert.equal(P1.evadeCharges, EVADE.charges);
});
