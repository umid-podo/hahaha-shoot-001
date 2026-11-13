// 강습 건쉽(상점 100코인 탈것): 구매·선택, 체력, 무기, 비행(고도 올리고 내리기·호버링)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step } from '../src/game/update.js';
import { createAI, updateAI } from '../src/game/ai.js';
import { createModStore, VEHICLE_SHOP, SHOP_BY_ID } from '../src/game/mods.js';
import { TICK, WEAPONS, CHARACTERS, FLIGHT, MAX_HP } from '../src/game/config.js';

const GUNSHIP = CHARACTERS.find((c) => c.id === 'assault-gunship');

function playing(P1 = {}, P2 = {}, opts = { wide: true }) {
  const match = createMatch({ P1: { characterId: 'assault-gunship', ...P1 }, P2: { weapon: 'rifle', ...P2 } }, 1, opts);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  const inputs = createInputs(match.players);
  const [a, b] = match.players;
  return { match, inputs, P1: a, P2: b };
}
function run(match, inputs, seconds, each) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) { each?.(); events.push(...step(match, inputs)); }
  return events;
}

test('상점에서 100코인으로 사면 캐릭터 선택에 나온다(사기 전에는 숨김)', () => {
  const item = VEHICLE_SHOP.find((g) => g.character === 'assault-gunship');
  assert.equal(item.price, 100);
  assert.equal(SHOP_BY_ID[item.id], item);
  assert.equal(GUNSHIP.shop, item.id);
  assert.ok(GUNSHIP.hidden, '사기 전에는 선택 목록에 없음');
  const mem = new Map([['haha2.mods.v1', JSON.stringify({ items: [], coins: 99, starter: 100, owned: [] })]]);
  const store = createModStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  assert.equal(store.ownsCharacter(GUNSHIP), false);
  assert.equal(store.canBuy(item.id), false, '99코인이면 못 삼');
  store.addCoins(1);
  store.buy(item.id);
  assert.equal(store.ownsCharacter(GUNSHIP), true);
  assert.equal(store.coins, 0);
  assert.ok(store.ownsCharacter(CHARACTERS.find((c) => c.id === 'earth-arrow')), '일반 캐릭터는 언제나');
});

test('강습 건쉽: 체력이 월등히 높고 양쪽 캐논(주무기)·유도미사일 50·유탄 20(보조무기), 수류탄 없음', () => {
  const others = CHARACTERS.filter((c) => !c.hidden).map((c) => c.maxHp);
  assert.ok(GUNSHIP.maxHp >= 2 * Math.max(...others) && GUNSHIP.maxHp >= 6 * MAX_HP, `체력 ${GUNSHIP.maxHp}`);
  const { P1 } = playing({ weapon: 'rpg', secondaries: ['katana'] });
  assert.equal(P1.hp, GUNSHIP.maxHp);
  assert.equal(P1.primary, 'gscannon', '고른 무기와 상관없이 캐논');
  assert.deepEqual(P1.secondaries, ['gsmissile', 'gsgrenade']);
  assert.ok(P1.flier && P1.noItem);
  assert.equal(WEAPONS.gscannon.arrows, 2, '양쪽에서 나란히');
  assert.equal(WEAPONS.gsmissile.damage, 50);
  assert.ok(WEAPONS.gsmissile.homing?.turnRate > 0, '유도');
  assert.equal(WEAPONS.gsgrenade.damage, 20);
  assert.ok(WEAPONS.gsgrenade.burst > 1);
});

test('비행: 점프키로 오르고 회피키로 내리며, 손을 떼면 그 높이에 떠 있다(호버링). 바닥·천장 사이에서만', () => {
  const { match, inputs, P1 } = playing();
  match.highs = []; match.covers = [];
  assert.equal(P1.z, FLIGHT.hoverAlt, '처음엔 떠 있다');
  run(match, inputs, 0.2);
  assert.ok(Math.abs(P1.z - FLIGHT.hoverAlt) < 1, '가만히 있으면 떨어지지 않음');
  inputs.P1.jumpHeld = true;
  run(match, inputs, 1);
  inputs.P1.jumpHeld = false;
  const high = P1.z;
  assert.ok(high > FLIGHT.hoverAlt + 400, `올라감 ${high}`);
  run(match, inputs, 1);
  assert.ok(Math.abs(P1.z - high) < 120, '떼면 곧 멈춰 떠 있음');
  const hover = P1.z;
  run(match, inputs, 1);
  assert.ok(Math.abs(P1.z - hover) < 1e-6, '호버링');
  inputs.P1.descendHeld = true;
  run(match, inputs, 4);
  assert.equal(P1.z, FLIGHT.minAlt, '바닥 위 minAlt까지만');
  inputs.P1.descendHeld = false;
  inputs.P1.jumpHeld = true;
  run(match, inputs, 8);
  assert.equal(P1.z, FLIGHT.maxAlt, '최고 고도까지만');
  // 회피키는 돌진이 아니라 내리기
  inputs.P1.jumpHeld = false;
  inputs.P1.evade = true;
  const ev = run(match, inputs, 0.1);
  assert.ok(!ev.some((e) => e.type === 'evade'));
  // 고지대 위로 오면 그 위 minAlt보다 낮게 내려가지 않는다
  match.highs = [{ id: 'roof', x: P1.x, y: P1.y, w: 600, h: 600, height: 500 }];
  inputs.P1.descendHeld = true;
  run(match, inputs, 6);
  assert.equal(P1.z, 500 + FLIGHT.minAlt);
});

test('비행: 고기동 — 걷는 사람보다 빠르게 날고, 시선(위아래·양옆)으로 겨눈 쪽으로 캐논을 쏜다', () => {
  const { match, inputs, P1, P2 } = playing();
  match.highs = []; match.covers = [];
  assert.ok(P1.speed > P2.speed, '더 빠름');
  // 위에서 아래의 적을 겨눠 쏜다
  P1.x = P1.previousX = 800; P1.y = P1.previousY = 900; P1.z = 600;
  P2.x = P2.previousX = 800; P2.y = P2.previousY = 300; P2.z = 0;
  inputs.P1.aim = -Math.PI / 2;
  inputs.P1.pitch = Math.atan2(0 + 90 - (600 + 84), 600);
  inputs.P1.aiming = true;
  run(match, inputs, 1);
  assert.ok(P2.hp < P2.maxHp, `캐논 명중 ${P2.maxHp - P2.hp}`);
  const shots = match.projectiles.filter((b) => b.weapon === 'gscannon');
  assert.ok(shots.length === 0 || shots.every((b) => b.vz < 0), '아래로 날아감');
});

test('유도미사일·유탄 발사: 보조무기 칸에서 쏜다(미사일은 적 쪽으로 휘어 50, 유탄은 4발 각 20)', () => {
  const { match, inputs, P1, P2 } = playing();
  match.highs = []; match.covers = [];
  P1.x = P1.previousX = 800; P1.y = P1.previousY = 900; P1.z = 120;
  P2.x = P2.previousX = 1100; P2.y = P2.previousY = 300; P2.z = 0; P2.hp = P2.maxHp = 5000;
  inputs.P1.select = 'secondary';
  run(match, inputs, 0.5);
  assert.equal(P1.weapon, 'gsmissile');
  inputs.P1.aim = -Math.PI / 2; // 비켜 겨눠도 휘어 간다
  inputs.P1.pitch = -0.1;
  inputs.P1.aiming = true;
  const ev = run(match, inputs, 0.05);
  inputs.P1.aiming = false;
  run(match, inputs, 2);
  assert.ok(ev.some((e) => e.type === 'fire' && e.weapon === 'gsmissile'));
  assert.ok(5000 - P2.hp >= 50, `미사일 ${5000 - P2.hp}`);
  inputs.P1.select = 'secondary2';
  run(match, inputs, 0.5);
  assert.equal(P1.weapon, 'gsgrenade');
  inputs.P1.aiming = true;
  const first = step(match, inputs);
  inputs.P1.aiming = false;
  const fired = [...first, ...run(match, inputs, 1)].filter((e) => e.type === 'fire' && e.weapon === 'gsgrenade').length;
  assert.equal(fired, WEAPONS.gsgrenade.burst, '유탄 여러 발');
});

test('AI도 하늘에 떠 있는 건쉽을 겨눠 맞힌다', () => {
  const { match, inputs, P1, P2 } = playing({}, { weapon: 'rifle', ai: true });
  match.highs = []; match.covers = [];
  P1.x = P1.previousX = 800; P1.y = P1.previousY = 900; P1.z = 500;
  P2.x = P2.previousX = 800; P2.y = P2.previousY = 300;
  const brain = createAI('P2', 'hard', 4);
  run(match, inputs, 4, () => updateAI(brain, match, inputs));
  assert.ok(P1.hp < P1.maxHp, `맞음 ${P1.maxHp - P1.hp}`);
});
