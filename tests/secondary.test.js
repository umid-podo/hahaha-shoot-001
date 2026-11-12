// 보조무기 최대 3개, 샷건 유도, 화염폭탄·카타나·폭동 진압 방패·섬광탄 권총
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step, slotsOf, weaponOfSlot } from '../src/game/update.js';
import { createAI, updateAI } from '../src/game/ai.js';
import { TICK, WEAPONS, MAX_SECONDARIES, normalizeSecondaries, SECONDARY_IDS, DEFAULT_SECONDARY } from '../src/game/config.js';

function playing(P1 = {}, P2 = {}) {
  const match = createMatch({ P1: { weapon: 'pistol', ...P1 }, P2: { weapon: 'pistol', ...P2 } }, 1);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  match.covers = [];
  match.highs = [];
  const inputs = createInputs(match.players);
  const [a, b] = match.players;
  a.x = a.previousX = 800; a.y = a.previousY = 800;
  b.x = b.previousX = 800; b.y = b.previousY = 400;
  inputs.P1.aim = -Math.PI / 2; // P2 쪽(위)
  inputs.P2.aim = Math.PI / 2;
  return { match, inputs, P1: a, P2: b };
}
function run(match, inputs, seconds) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) events.push(...step(match, inputs));
  return events;
}
/** 떼면 쓰는 무기: 한 틱 누르고 뗀다 */
function tap(match, inputs, id = 'P1') {
  inputs[id].aiming = true;
  const ev = step(match, inputs);
  inputs[id].aiming = false;
  return [...ev, ...step(match, inputs)];
}
function hold(match, inputs, slot, id = 'P1') {
  inputs[id].select = slot;
  return run(match, inputs, 0.5);
}

test('보조무기는 최대 3개: 고른 순서대로 보조무기 1·2·3 칸, 전환은 주무기→1→2→3→주무기', () => {
  assert.equal(MAX_SECONDARIES, 3);
  assert.deepEqual(normalizeSecondaries(['katana', 'katana', 'nope', 'shotgun', 'firebomb', 'smg']), ['katana', 'shotgun', 'firebomb']);
  assert.deepEqual(normalizeSecondaries(undefined), [DEFAULT_SECONDARY]);
  for (const id of ['firebomb', 'katana', 'riotshield', 'flaregun']) assert.ok(SECONDARY_IDS.includes(id), id);
  const { match, inputs, P1, P2 } = playing({ secondaries: ['katana', 'riotshield', 'flaregun'] }, { secondary: 'shotgun' });
  assert.deepEqual(P1.secondaries, ['katana', 'riotshield', 'flaregun']);
  assert.equal(P1.secondary, 'katana');
  assert.deepEqual(P2.secondaries, ['shotgun'], '예전 선택(secondary 하나)도 받는다');
  assert.deepEqual(slotsOf(P1), ['primary', 'secondary', 'secondary2', 'secondary3']);
  assert.equal(weaponOfSlot(P1, 'secondary3'), 'flaregun');
  const seen = [];
  for (let i = 0; i < 4; i++) {
    inputs.P1.swap = true;
    run(match, inputs, 0.5);
    seen.push(P1.weapon);
  }
  assert.deepEqual(seen, ['katana', 'riotshield', 'flaregun', 'pistol']);
  hold(match, inputs, 'secondary3');
  assert.equal(P1.weapon, 'flaregun', '칸을 바로 고름');
  hold(match, inputs, 'secondary3', 'P2');
  assert.equal(P2.weapon, 'pistol', '없는 칸은 무시');
});

test('샷건 유도: 옆으로 비켜 겨눠도 탄이 적 쪽으로 휘어 맞는다', () => {
  assert.ok(WEAPONS.shotgun.homing?.turnRate > 0);
  const { match, inputs, P2 } = playing({ secondary: 'shotgun' });
  hold(match, inputs, 'secondary');
  inputs.P1.aim = -Math.PI / 2 + 0.35; // 20도 빗겨
  tap(match, inputs);
  run(match, inputs, 1);
  assert.ok(P2.hp < P2.maxHp, `유도로 명중 ${P2.maxHp - P2.hp}`);
});

test('화염폭탄: 던지면 떨어진 자리에서 터지고 바닥에 불길이 남아 그 안의 적에게 계속 피해, 쿨타임 10초', () => {
  const w = WEAPONS.firebomb;
  assert.equal(w.interval, 10);
  const { match, inputs, P1, P2 } = playing({ secondary: 'firebomb' });
  P2.y = P2.previousY = P1.y - w.range;
  hold(match, inputs, 'secondary');
  tap(match, inputs);
  const ev = run(match, inputs, 1.5);
  assert.ok(ev.some((e) => e.type === 'explode'), '터짐');
  assert.ok(ev.some((e) => e.type === 'field' && e.kind === 'fire'), '불길');
  const after = P2.hp;
  run(match, inputs, 2);
  assert.ok(after - P2.hp >= w.fire.dps * 1.5, `불길 속에서 계속 피해 ${after - P2.hp}`);
  // 불길 밖으로 나가면 더 안 탄다
  P2.x = P2.previousX = 2000;
  const out = P2.hp;
  run(match, inputs, 1);
  assert.equal(P2.hp, out);
  assert.ok((P1.cooldowns.firebomb ?? 0) > 0 && P1.cooldowns.firebomb <= 10, '쿨타임');
  // 불길은 life초 뒤 꺼진다
  run(match, inputs, w.fire.life);
  assert.equal(match.fields.length, 0);
});

test('카타나: 앞을 가로로 크게 베어 부채꼴 안의 적 모두 맞고(단검보다 넓음), 뒤나 멀리는 안 맞음, 쿨타임 15초', () => {
  const w = WEAPONS.katana;
  assert.equal(w.interval, 15);
  assert.ok(w.slash.range > 2 * 30 && w.slash.arc >= 120, '단검(몸에 닿아야 함)보다 넓다');
  const { match, inputs, P1, P2 } = playing({ secondary: 'katana' });
  hold(match, inputs, 'secondary');
  // 옆 비스듬히(60도) 앞, 거리 200: 맞음
  P2.x = P2.previousX = P1.x + Math.cos(-Math.PI / 2 + 1.05) * 200;
  P2.y = P2.previousY = P1.y + Math.sin(-Math.PI / 2 + 1.05) * 200;
  const ev = tap(match, inputs);
  assert.ok(ev.some((e) => e.type === 'slash'));
  assert.equal(P2.hp, P2.maxHp - w.damage, '부채꼴 안');
  assert.equal(P1.cooldowns.katana > 14, true);
  // 쿨타임 뒤: 뒤쪽 적은 안 맞음
  run(match, inputs, 15);
  P2.hp = P2.maxHp;
  P2.x = P2.previousX = P1.x; P2.y = P2.previousY = P1.y + 150;
  tap(match, inputs);
  assert.equal(P2.hp, P2.maxHp, '뒤쪽은 안 맞음');
  run(match, inputs, 15);
  P2.y = P2.previousY = P1.y - (w.slash.range + 200);
  tap(match, inputs);
  assert.equal(P2.hp, P2.maxHp, '멀면 안 맞음');
});

test('폭동 진압 방패: 세우면 앞에서 오는 공격을 500까지 막고 뒤에서 오는 공격은 못 막음, 쿨타임 10초', () => {
  const w = WEAPONS.riotshield;
  assert.equal(w.interval, 10);
  assert.equal(w.shield.hp, 500);
  const { match, inputs, P1, P2 } = playing({ weapon: 'rifle' }, { secondary: 'riotshield' });
  hold(match, inputs, 'secondary', 'P2');
  inputs.P2.aiming = true;
  const up = step(match, inputs);
  inputs.P2.aiming = false;
  assert.ok(up.some((e) => e.type === 'shield-up'));
  assert.ok(P2.shield && P2.shield.hp === 500);
  // P2는 아래(P1 쪽)를 본다: P1의 소총은 앞에서 와서 막힌다
  inputs.P1.aiming = true;
  const ev = run(match, inputs, 1);
  inputs.P1.aiming = false;
  assert.equal(P2.hp, P2.maxHp, '앞쪽 탄은 막음');
  assert.ok(ev.some((e) => e.type === 'shield-hit') && P2.shield.hp < 500);
  // 뒤로 돌면 막지 못한다
  inputs.P2.aim = -Math.PI / 2;
  inputs.P1.aiming = true;
  run(match, inputs, 0.5);
  inputs.P1.aiming = false;
  assert.ok(P2.hp < P2.maxHp, '뒤에서 맞음');
  // 500을 넘게 막으면 깨진다
  inputs.P2.aim = Math.PI / 2;
  P2.shield = { hp: 30, t: 5, max: 500 };
  P2.hp = P2.maxHp;
  inputs.P1.aiming = true;
  const brk = run(match, inputs, 1);
  inputs.P1.aiming = false;
  assert.ok(brk.some((e) => e.type === 'shield-break'));
  assert.equal(P2.shield, null);
  assert.ok(P2.hp < P2.maxHp);
  assert.ok((P2.cooldowns.riotshield ?? 0) > 0, '쿨타임 도는 중');
});

test('섬광탄 권총: 곡선으로 날아가 떨어진 자리에서 번쩍, 보이는 적은 눈이 멀고(AI는 못 쏨), 구조물 뒤는 괜찮음', () => {
  const w = WEAPONS.flaregun;
  assert.ok(w.thrown && w.flash.radius > 0 && w.flash.blind > 0);
  const { match, inputs, P1, P2 } = playing({ secondary: 'flaregun' }, { weapon: 'rifle', ai: true });
  P2.y = P2.previousY = P1.y - w.range - 100;
  hold(match, inputs, 'secondary');
  tap(match, inputs);
  const shot = match.projectiles.find((b) => b.weapon === 'flaregun');
  assert.ok(shot?.thrown, '포물선으로 날아감');
  const ev = run(match, inputs, 1.5);
  assert.ok(ev.some((e) => e.type === 'flash'));
  assert.ok(P2.blind > 0, `눈이 멂 ${P2.blind}`);
  assert.equal(P1.blind, 0, '쏜 사람은 괜찮음');
  // AI는 눈이 먼 동안 쏘지 못한다
  const brain = createAI('P2', 'hard', 3);
  P2.blind = 2;
  updateAI(brain, match, inputs);
  assert.equal(inputs.P2.aiming, false);
  // 구조물 뒤에 숨으면 섬광이 안 보인다
  const b = playing({ secondary: 'flaregun' });
  b.P2.y = b.P2.previousY = b.P1.y - w.range - 150;
  b.match.highs = [{ id: 'wall', x: b.P1.x, y: b.P2.y + 75, w: 800, h: 40, height: 400 }];
  hold(b.match, b.inputs, 'secondary');
  tap(b.match, b.inputs);
  run(b.match, b.inputs, 1.5);
  assert.equal(b.P2.blind, 0, '벽 뒤는 괜찮음');
});
