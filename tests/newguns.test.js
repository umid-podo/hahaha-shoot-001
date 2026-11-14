// 새 주무기: 3점사 소총·개틀링·AK-47·투척용 쌍수단검, 연속 플레이 웨이브마다 1코인
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step } from '../src/game/update.js';
import { ENDLESS } from '../src/game/story.js';
import { TICK, WEAPONS, PRIMARY_IDS } from '../src/game/config.js';

function playing(weapon) {
  const match = createMatch({ P1: { weapon }, P2: { weapon: 'pistol' } }, 1);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  match.covers = []; match.highs = [];
  const inputs = createInputs(match.players);
  const [P1, P2] = match.players;
  P2.hp = P2.maxHp = 1e6;
  return { match, inputs, P1, P2 };
}
function run(match, inputs, seconds) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) events.push(...step(match, inputs));
  return events;
}
const fires = (ev, w) => ev.filter((e) => e.type === 'fire' && e.weapon === w).length;

test('연속 플레이는 웨이브를 하나 깰 때마다 1코인', () => {
  assert.equal(ENDLESS.reward, 1);
});

test('주무기에 3점사 소총·개틀링·AK-47·투척용 쌍수단검이 있고 누구나 고를 수 있다', () => {
  for (const id of ['burstrifle', 'gatling', 'ak47', 'throwknives']) {
    assert.ok(PRIMARY_IDS.includes(id), id);
    assert.ok(!WEAPONS[id].hidden && !WEAPONS[id].legendary, `${id}는 처음부터`);
    assert.equal(playing(id).P1.weapon, id);
  }
});

test('3점사 소총: 한 번 당기면 3발이 빠르게, 개틀링은 아주 빠른 연사, AK-47은 돌격소총보다 한 발이 세다', () => {
  const b = playing('burstrifle');
  b.inputs.P1.aiming = true;
  const ev = run(b.match, b.inputs, WEAPONS.burstrifle.interval - TICK);
  assert.equal(fires(ev, 'burstrifle'), 3, '3점사');
  const g = playing('gatling');
  g.inputs.P1.aiming = true;
  const gev = run(g.match, g.inputs, 1);
  assert.ok(fires(gev, 'gatling') >= 18, `개틀링 1초 ${fires(gev, 'gatling')}발`);
  assert.ok(WEAPONS.gatling.mag >= 100, '큰 탄통');
  assert.ok(WEAPONS.ak47.damage > WEAPONS.rifle.damage && WEAPONS.ak47.interval > WEAPONS.rifle.interval * 0.5);
});

test('투척용 쌍수단검: 단검 2개를 빠르게 연달아 던지고(빠른 탄속), 2개 다 던지면 돌리며 다시 채운다', () => {
  const w = WEAPONS.throwknives;
  assert.equal(w.burst, 2);
  assert.equal(w.mag, 2);
  assert.ok(w.speed >= WEAPONS.rifle.speed * 1.5, '탄속이 빠르다');
  const { match, inputs, P1 } = playing('throwknives');
  inputs.P1.aiming = true;
  const ev = run(match, inputs, w.burstGap + 2 * TICK);
  inputs.P1.aiming = false;
  assert.equal(fires(ev, 'throwknives'), 2, '2연속');
  const knives = match.projectiles.filter((b) => b.weapon === 'throwknives');
  assert.equal(knives.length, 2);
  assert.notEqual(knives[0].x, knives[1].x, '양손에서 번갈아');
  // 2개 다 던졌으면 장전(돌리기)
  const rl = run(match, inputs, TICK);
  assert.ok(P1.reload && P1.reload.weapon === 'throwknives' || rl.some((e) => e.type === 'reload'), '다시 채우는 중');
  run(match, inputs, w.reload + 0.1);
  assert.equal(P1.ammo.throwknives, 2, '다시 2개');
  // 단검은 멀리까지는 날아가지 않는다(life)
  assert.ok(w.speed * w.life < 4000, `사거리 ${w.speed * w.life}`);
});
