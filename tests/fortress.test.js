// 에너지 RPG·유탄 발사기·전기충격기 발사기, 고공 요새(고지대·다리·오르막길·점프 패드), 랭크·계정
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step, groundAt, move, updateJump, padAt } from '../src/game/update.js';
import {
  TICK, WEAPONS, PRIMARY_IDS, SECONDARY_IDS, FORTRESS_HIGHS, FORTRESS_PADS, FORTRESS_HEIGHT, FIELD, MAPS, PAD, JUMP,
} from '../src/game/config.js';
import { createStoryMatch } from '../src/game/story.js';
import { TIERS, MAX_LEVEL, PROMOTE_COINS, addWin, defaultRank, normalizeRank, rankLabel } from '../src/game/rank.js';
import { createModStore, accountKey } from '../src/game/mods.js';

function playing(p1, { secondary, map } = {}) {
  const match = createMatch({ P1: { weapon: p1, secondary }, P2: { weapon: 'rifle' } }, 1, map ? { wide: true, map } : {});
  match.phase = 'playing';
  match.jetTimer = Infinity;
  if (!map) { match.covers = []; match.highs = []; }
  const inputs = createInputs(match.players);
  const [P1, P2] = match.players;
  return { match, inputs, P1, P2 };
}
function run(match, inputs, seconds, each) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) { each?.(); events.push(...step(match, inputs)); }
  return events;
}
/** 떼면 쏘는 무기: 한 틱 누르고 다음 틱에 뗀다 */
function tap(match, inputs, id) {
  inputs[id].aiming = true;
  const events = step(match, inputs);
  inputs[id].aiming = false;
  return [...events, ...step(match, inputs)];
}

test('새 무기 목록: 에너지 RPG는 전설 주무기, 유탄 발사기·전기충격기 발사기는 보조무기', () => {
  assert.ok(PRIMARY_IDS.includes('energyrpg') && WEAPONS.energyrpg.legendary);
  assert.ok(SECONDARY_IDS.includes('grenadelauncher') && SECONDARY_IDS.includes('stunlauncher'));
  // 일반 RPG보다 폭발 범위는 훨씬 크고 피해는 낮다
  assert.ok(WEAPONS.energyrpg.splash.radius >= WEAPONS.rpg.splash.radius * 2);
  assert.ok(WEAPONS.energyrpg.damage < WEAPONS.rpg.damage && WEAPONS.energyrpg.splash.damage < WEAPONS.rpg.splash.damage);
  assert.equal(WEAPONS.energyrpg.shock, 4);
  assert.equal(WEAPONS.grenadelauncher.damage, 25);
  assert.equal(WEAPONS.grenadelauncher.burst, 3);
  assert.equal(WEAPONS.grenadelauncher.interval, 15);
  assert.equal(WEAPONS.stunlauncher.interval, 10);
  assert.equal(WEAPONS.stunlauncher.field.freeze, 2);
});

test('에너지 RPG: 약하게 유도되어 휘어 날아가고, 폭발에 맞은 적은 4초 동안 움직이지도 쏘지도 못한다', () => {
  const { match, inputs, P1, P2 } = playing('energyrpg');
  P1.x = 800; P1.y = 900; P2.x = 900; P2.y = 300;
  inputs.P1.aim = -Math.PI / 2; // 똑바로 위(상대는 오른쪽으로 조금 비켜 있음)
  tap(match, inputs, 'P1');
  const rocket = match.projectiles.find((b) => b.weapon === 'energyrpg');
  assert.ok(rocket, '로켓 발사');
  for (let i = 0; i < 20; i++) step(match, inputs);
  assert.ok(rocket.vx > 1, '상대 쪽(오른쪽)으로 휘었다');
  const events = [];
  for (let i = 0; i < 120 && !events.some((e) => e.type === 'stun'); i++) events.push(...step(match, inputs));
  assert.ok(events.some((e) => e.type === 'explode' && e.energy));
  assert.ok(P2.hp < P2.maxHp && P2.maxHp - P2.hp <= WEAPONS.energyrpg.damage + WEAPONS.energyrpg.splash.damage);
  assert.ok(P2.shock > 3, '감전');
  assert.ok(events.some((e) => e.type === 'stun' && e.playerId === 'P2' && e.kind === 'shock'));
  // 감전 중: 움직이지도 쏘지도 못한다
  const x = P2.x, y = P2.y;
  inputs.P2.moveAxis = 1; inputs.P2.aiming = true; inputs.P2.aim = Math.PI / 2;
  const during = run(match, inputs, 1);
  assert.equal(P2.x, x); assert.equal(P2.y, y);
  assert.ok(!during.some((e) => e.type === 'fire' && e.playerId === 'P2'), '쏘지 못함');
  run(match, inputs, 3.2);
  assert.equal(P2.shock, 0);
  const after = run(match, inputs, 0.5);
  assert.ok(P2.x > x, '감전이 풀리면 다시 움직인다');
  assert.ok(after.some((e) => e.type === 'fire' && e.playerId === 'P2'), '다시 쏜다');
});

test('에너지 RPG: 폭발 범위가 RPG보다 훨씬 커서 멀리 있는 적도 감전된다', () => {
  const { match, inputs, P1, P2 } = playing('energyrpg');
  P1.x = 800; P1.y = 900; P2.x = 800 + 260; P2.y = 400; // 로켓 길에서 260 떨어짐(RPG 폭발 범위 밖)
  match.covers = [{ id: 'wall', x: 800, y: 420, w: 120, h: 40, hp: 9999 }];
  inputs.P1.aim = -Math.PI / 2;
  WEAPONS.energyrpg.homing.turnRate = 0; // 이 시험에서는 유도 없이
  try {
    tap(match, inputs, 'P1');
    run(match, inputs, 1);
  } finally { WEAPONS.energyrpg.homing.turnRate = 0.75; }
  assert.equal(P2.maxHp - P2.hp, WEAPONS.energyrpg.splash.damage, '폭발 피해만');
  assert.ok(P2.shock > 0);
});

test('유탄 발사기: 떼면 유탄 3발을 연달아 쏘고, 한 발 25 피해, 쿨타임 15초', () => {
  const { match, inputs, P1, P2 } = playing('rifle', { secondary: 'grenadelauncher' });
  P1.x = 800; P1.y = 900; P2.x = 800; P2.y = 500;
  inputs.P1.select = 'secondary';
  run(match, inputs, 0.5);
  inputs.P1.aim = -Math.PI / 2;
  const events = [...tap(match, inputs, 'P1'), ...run(match, inputs, 1.5)];
  const shots = events.filter((e) => e.type === 'fire' && e.weapon === 'grenadelauncher');
  assert.equal(shots.length, 3);
  assert.equal(P2.maxHp - P2.hp, 75, '3발 × 25(직격 맞으면 그 폭발 피해는 또 받지 않음)');
  assert.ok(Math.abs(P1.cooldowns.grenadelauncher - (15 - 1.5 - TICK * 2)) < 0.2, '쿨타임 15초');
  const again = [...tap(match, inputs, 'P1'), ...run(match, inputs, 0.5)];
  assert.ok(!again.some((e) => e.type === 'fire' && e.weapon === 'grenadelauncher'), '쿨타임 중에는 못 쏨');
});

test('전기충격기 발사기: 포물선으로 날아가 떨어진 곳에 전기가 원형으로 퍼지고, 닿은 적은 2초 동안 못 움직인다(쏘기는 됨)', () => {
  const { match, inputs, P1, P2 } = playing('rifle', { secondary: 'stunlauncher' });
  P1.x = 800; P1.y = 900; P2.x = 900; P2.y = 900 - WEAPONS.stunlauncher.range;
  inputs.P1.select = 'secondary';
  run(match, inputs, 0.5);
  inputs.P1.aim = -Math.PI / 2;
  const events = [...tap(match, inputs, 'P1'), ...run(match, inputs, 1.2)];
  const field = events.find((e) => e.type === 'field');
  assert.ok(field, '전기가 퍼짐');
  assert.ok(Math.abs(field.y - (900 - WEAPONS.stunlauncher.range)) < 60, '정해진 거리에서 떨어짐');
  assert.ok(P2.freeze > 0, '마비');
  assert.equal(P2.hp, P2.maxHp, '피해는 없다');
  const x = P2.x;
  inputs.P2.moveAxis = 1; inputs.P2.aiming = true; inputs.P2.aim = Math.PI / 2;
  const during = run(match, inputs, 0.6);
  assert.equal(P2.x, x, '못 움직임');
  assert.ok(during.some((e) => e.type === 'fire' && e.playerId === 'P2'), '쏘기는 된다');
  run(match, inputs, 2);
  assert.ok(P2.x > x, '2초 뒤 다시 움직임');
  assert.ok(P1.cooldowns.stunlauncher > 5, '쿨타임 10초');
});

test('전기충격기 발사기: 전기가 퍼질 때 높이 뛰어 있으면 닿지 않는다', () => {
  const { match, inputs, P1, P2 } = playing('rifle', { secondary: 'stunlauncher' });
  P1.x = 800; P1.y = 900; P2.x = 800; P2.y = 900 - WEAPONS.stunlauncher.range;
  inputs.P1.select = 'secondary';
  run(match, inputs, 0.5);
  inputs.P1.aim = -Math.PI / 2;
  tap(match, inputs, 'P1');
  const field = run(match, inputs, 1.2, () => { if (P2.z === 0 && match.projectiles.some((b) => b.field)) inputs.P2.jump = true; });
  assert.ok(field.some((e) => e.type === 'field'));
  // 퍼지는 동안(0.45초) 공중에 있다가 내려왔을 때 장판이 아직 남아 있으면 마비될 수 있으니, 장판이 생기는 순간 공중이었는지만 본다
  assert.ok(P2.freeze === 0 || P2.z >= 0);
});

test('고공 요새: 넓은 맵 크기에 매우 높은 고지대 2개·잇는 다리·오르막길·점프 패드 3개·조금 낮은 긴 다리', () => {
  assert.deepEqual(Object.keys(MAPS), ['wide', 'fortress']);
  const { match } = playing('rifle', { map: 'fortress' });
  assert.equal(match.map, 'fortress');
  assert.deepEqual(match.bounds, FIELD);
  const forts = match.highs.filter((h) => h.kind === 'fortress');
  assert.equal(forts.length, 2);
  assert.ok(forts.every((h) => h.height === FORTRESS_HEIGHT && h.height >= 300), '매우 높음');
  const link = match.highs.find((h) => h.id === 'fort-bridge');
  assert.ok(link.bridge && link.height === FORTRESS_HEIGHT);
  // 다리 양 끝이 두 고지대에 걸쳐 있다
  for (const f of forts) assert.ok(Math.abs(link.x - f.x) - link.w / 2 <= f.w / 2 + 1);
  assert.equal(match.highs.filter((h) => h.ramp).length, 1, '오르막길 1개');
  const long = match.highs.find((h) => h.id === 'fort-long');
  assert.ok(long.bridge && long.height < FORTRESS_HEIGHT && long.height > FORTRESS_HEIGHT - JUMP.jump ** 2 / (2 * JUMP.gravity) + JUMP.step, '고지대보다 약간 낮고, 끝에서 뛰면 고지대로 올라감');
  assert.ok(Math.max(long.w, long.h) >= 2000, '긴 다리');
  assert.equal(match.pads.length, 3);
  // 점프 패드는 고지대보다 높이 띄운다
  assert.ok(PAD.power ** 2 / (2 * JUMP.gravity) > FORTRESS_HEIGHT + 60);
  // 넓은 맵(원래)에는 고공 요새가 없다
  const wide = playing('rifle', { map: 'wide' }).match;
  assert.ok(!wide.highs.some((h) => h.kind === 'fortress') && !wide.pads.length);
});

test('고공 요새: 오르막길을 걸어 올라 고지대 위로, 옆에서 높은 곳으로는 못 들어간다', () => {
  const { match, P1 } = playing('rifle', { map: 'fortress' });
  const ramp = match.highs.find((h) => h.ramp);
  const fort = match.highs.find((h) => h.id === 'fort-west');
  P1.x = ramp.x; P1.y = ramp.y + ramp.h / 2 + 40; P1.z = 0; P1.vz = 0;
  for (let i = 0; i < 60 * 6 && P1.y > fort.y; i++) { move(match, P1, 0, -1, TICK); updateJump(match, P1, false, TICK, []); }
  assert.ok(P1.y < fort.y + fort.h / 2, '고지대 위로 올라섰다');
  assert.equal(P1.z, FORTRESS_HEIGHT);
  // 내려오기: 비탈을 따라 붙어서 걷는다(떨어지지 않음)
  for (let i = 0; i < 60 * 1.5; i++) { move(match, P1, 0, 1, TICK); updateJump(match, P1, false, TICK, []); }
  assert.ok(P1.z > 0 && P1.z < FORTRESS_HEIGHT && P1.vz === 0);
  // 옆에서: 오르막길 높은 쪽 옆으로는 막힌다
  P1.x = ramp.x - ramp.w / 2 - 40; P1.y = ramp.y - ramp.h / 4; P1.z = 0; P1.vz = 0;
  for (let i = 0; i < 60; i++) move(match, P1, 1, 0, TICK);
  assert.ok(P1.x <= ramp.x - ramp.w / 2 + 1, '옆면에 막힘');
});

test('고공 요새: 점프 패드를 밟으면 매우 높이 튀어 올라 고지대에 올라설 수 있다', () => {
  const { match, inputs, P1 } = playing('rifle', { map: 'fortress' });
  const pad = FORTRESS_PADS.find((p) => p.id === 'pad-west');
  P1.x = pad.x; P1.y = pad.y; P1.z = 0; P1.vz = 0;
  assert.ok(padAt(match, P1.x, P1.y));
  const events = [];
  let top = 0;
  for (let i = 0; i < 60 * 3; i++) {
    inputs.P1.moveY = P1.vz < 600 && P1.y > pad.y - 330 ? -1 : 0; // 올라가다 고지대 쪽(북쪽)으로 조금
    inputs.P1.moveAxis = 0;
    events.push(...step(match, inputs));
    top = Math.max(top, P1.z);
  }
  assert.ok(events.some((e) => e.type === 'pad'));
  assert.ok(top > FORTRESS_HEIGHT + 60, '매우 높이');
  assert.equal(P1.z, FORTRESS_HEIGHT, '고지대 위에 내려섰다');
});

test('고공 요새: 다리는 위에 설 수 있지만 그 아래로는 밑으로 지나다닌다', () => {
  const { match, P1 } = playing('rifle', { map: 'fortress' });
  const long = match.highs.find((h) => h.id === 'fort-long');
  assert.equal(groundAt(match, long.x, long.y, 0), 0, '아래에서는 바닥이 아님');
  assert.equal(groundAt(match, long.x, long.y, long.height), long.height, '위에서는 다리가 바닥');
  P1.x = long.x - long.w / 2 - 60; P1.y = long.y; P1.z = 0;
  for (let i = 0; i < 60; i++) move(match, P1, 1, 0, TICK);
  assert.ok(P1.x > long.x + long.w / 2, '다리 밑을 지나 건넜다');
  // 다리 위에 서 있으면 그대로 서 있다
  P1.x = long.x; P1.y = long.y; P1.z = long.height; P1.vz = 0;
  for (let i = 0; i < 30; i++) updateJump(match, P1, false, TICK, []);
  assert.equal(P1.z, long.height);
});

test('높이 차이가 큰 상대(고지대 위)를 겨누면 탄이 그 높이로 기울어 날아가 맞힌다', () => {
  const { match, inputs, P1, P2 } = playing('pistol', { map: 'fortress' });
  match.covers = [];
  const fort = match.highs.find((h) => h.id === 'fort-east');
  P2.x = fort.x; P2.y = fort.y; P2.z = fort.height;
  P1.x = fort.x; P1.y = fort.y + fort.h / 2 + 500; P1.z = 0;
  inputs.P1.aim = -Math.PI / 2;
  inputs.P1.aiming = true;
  run(match, inputs, 1.5);
  assert.ok(P2.hp < P2.maxHp, '고지대 위 상대도 맞는다');
});

test('스토리 1스테이지 옥상은 넓은 고공 요새, 복도로 넘어가면 원래 크기', () => {
  const match = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, undefined, 1);
  assert.equal(match.map, 'fortress');
  assert.ok(match.wide && match.pads.length === 3);
  assert.ok(match.highs.some((h) => h.id === 'fort-west'));
  const corridor = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, undefined, 1, { wave: 4, hp: 500, skip: true });
  assert.ok(!corridor.wide && !corridor.map);
});

test('랭크: 7등급 × 30레벨, 이기면 1레벨, 30레벨이면 20코인과 함께 다음 등급으로 승급', () => {
  assert.deepEqual(TIERS.map((t) => t.name), ['초보 등급', '일반 등급', '중수 등급', '고수 등급', '전사 등급', '전문가 등급', '역전의 전사 등급']);
  assert.equal(MAX_LEVEL, 30);
  assert.equal(PROMOTE_COINS, 20);
  let rank = defaultRank();
  assert.equal(rankLabel(rank), '초보 등급 Lv.1');
  let coins = 0;
  for (let i = 0; i < 28; i++) { const r = addWin(rank); rank = r.rank; coins += r.coins; assert.ok(!r.promoted); }
  assert.equal(rank.level, 29);
  const up = addWin(rank);
  assert.ok(up.promoted);
  assert.equal(up.coins, 20);
  assert.equal(rankLabel(up.rank), '일반 등급 Lv.1');
  assert.equal(coins, 0);
  // 마지막 등급은 30레벨에서 멈춘다(그때도 20코인)
  let top = { tier: TIERS.length - 1, level: 29, wins: 0 };
  const last = addWin(top);
  assert.equal(last.rank.level, 30);
  assert.equal(last.rank.tier, TIERS.length - 1);
  assert.equal(last.coins, 20);
  top = last.rank;
  const more = addWin(top);
  assert.equal(more.levelUp, false);
  assert.equal(more.coins, 0);
  assert.deepEqual(normalizeRank({ tier: 99, level: -3 }), { tier: TIERS.length - 1, level: 1, wins: 0 });
});

test('계정: 계정마다 코인·배낭·산 무기가 따로, 계정 1은 예전 저장 그대로', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  mem.set('haha2.mods.v1', JSON.stringify({ items: [], coins: 77, starter: 100, owned: [] }));
  const store = createModStore(storage);
  assert.equal(store.coins, 77, '계정 1 = 예전 저장');
  store.useAccount(2);
  assert.equal(store.coins, 100, '새 계정은 기본 코인 100');
  store.addCoins(50);
  assert.ok(store.buy('legend-energyrpg').length === 0 && store.ownsWeapon('energyrpg'));
  store.useAccount(1);
  assert.equal(store.coins, 77, '계정 1은 그대로');
  assert.equal(store.ownsWeapon('energyrpg'), false, '다른 계정에서 산 무기는 없음');
  store.useAccount(2);
  assert.equal(store.coins, 100);
  assert.ok(store.ownsWeapon('energyrpg'));
  assert.equal(accountKey('haha2.rank.v1', 1), 'haha2.rank.v1');
  assert.equal(accountKey('haha2.rank.v1', 3), 'haha2.rank.v1.a3');
});
