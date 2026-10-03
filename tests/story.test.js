// 스토리 모드: 웨이브 구성(인원·무기·체력), 헬리콥터·전투기·건쉽 연출, 보스(스미스 요원), 승패, 밸런스 설정
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputs } from '../src/game/state.js';
import { step, spawnProjectile } from '../src/game/update.js';
import { updateAI } from '../src/game/ai.js';
import {
  createStoryMatch, defaultStory, normalizeStory, WAVES, STORY_WEAPONS, BOSS_NAME,
} from '../src/game/story.js';
import { TICK, RAIL_Y, WEAPONS, SECONDARY_IDS } from '../src/game/config.js';

function story(settings, seed = 7) {
  const match = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, settings, seed);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  const inputs = createInputs(match.players);
  return { match, inputs };
}
const enemies = (match) => match.players.filter((p) => p.team === 'isb');
/** 다음 웨이브 요원이 모두 내려와 싸울 수 있을 때까지(또는 경기가 끝날 때까지) 틱을 돌린다. */
function untilFight(match, inputs, max = 20) {
  const events = [];
  for (let t = 0; t < max; t += TICK) {
    events.push(...step(match, inputs));
    if (match.phase !== 'playing' || match.story.phase === 'fight') break;
  }
  return events;
}
function killAll(match, inputs) {
  for (const p of enemies(match)) p.hp = 0;
  return step(match, inputs);
}

test('스토리 모드 전체 흐름: 1웨이브 → 헬기 2명 → 헬기 3명 → 전투기 격추·건쉽 스미스 요원 → 승리', () => {
  const { match, inputs } = story();
  const [P1] = match.players;
  assert.equal(P1.team, 'earth');

  // 1웨이브: 보통 난이도 요원 1명, 돌격소총, 처음부터 서 있음
  let wave = enemies(match);
  assert.equal(wave.length, 1);
  assert.equal(wave[0].primary, 'rifle');
  assert.equal(wave[0].hp, 500);
  assert.equal(wave[0].entering, null);
  assert.equal(wave[0].primaryOnly, true, '일반 요원은 보조무기·수류탄 없음');
  assert.equal(match.story.brains[0].diff.name, '보통');

  // 쓰러뜨려도 경기는 끝나지 않고 다음 웨이브로
  killAll(match, inputs);
  assert.equal(match.phase, 'playing');
  step(match, inputs);
  assert.equal(match.story.phase, 'clear');
  let events = untilFight(match, inputs);
  assert.ok(events.some((e) => e.type === 'wave' && e.wave === 1));
  assert.equal(match.story.wave, 1);
  wave = enemies(match);
  assert.equal(wave.length, 2, '2웨이브: 요원 2명(쓰러진 1웨이브 요원은 치움)');
  for (const p of wave) {
    assert.equal(p.hp, 300);
    assert.ok(STORY_WEAPONS.includes(p.primary));
    assert.equal(p.y, RAIL_Y.isb, '헬리콥터에서 레일까지 내려옴');
    assert.equal(p.entering, null);
  }
  assert.ok(match.story.carrier, '요원을 내려 준 헬리콥터가 떠나는 중');
  assert.equal(match.story.carrier.kind, 'heli');

  killAll(match, inputs);
  untilFight(match, inputs);
  wave = enemies(match);
  assert.equal(match.story.wave, 2);
  assert.equal(wave.length, 3, '3웨이브: 요원 3명');
  for (const p of wave) { assert.equal(p.hp, 200); assert.ok(STORY_WEAPONS.includes(p.primary)); }

  // 보스전: 헬리콥터가 오고 → 전투기가 미사일로 격추 → 건쉽에서 스미스 요원
  killAll(match, inputs);
  events = untilFight(match, inputs);
  assert.ok(events.some((e) => e.type === 'heli-down'), '전투기가 헬리콥터를 격추');
  assert.ok(events.some((e) => e.type === 'explode'));
  assert.equal(match.story.carrier.kind, 'gunship');
  const [boss] = enemies(match);
  assert.equal(enemies(match).length, 1);
  assert.equal(boss.name, BOSS_NAME);
  assert.equal(boss.boss, true);
  assert.equal(boss.primary, 'pistol');
  assert.equal(boss.hp, 800);
  assert.equal(boss.primaryOnly, false, '스미스 요원만 보조무기·수류탄 사용');
  assert.ok(SECONDARY_IDS.includes(boss.secondary));

  // 스미스 요원을 쓰러뜨리면 승리
  killAll(match, inputs);
  assert.equal(match.phase, 'result');
  assert.equal(match.winner, 'earth');
  assert.equal(match.story.roster.length, 7, '결과 화면용: 나온 요원 전원(1+2+3+1)');
});

test('2·3웨이브 무기는 RPG·저격총·아킴보 석궁을 뺀 무기 중 무작위', () => {
  assert.deepEqual(STORY_WEAPONS, ['rifle', 'pistol', 'dual']);
  const seen = new Set();
  for (let seed = 1; seed < 30; seed++) {
    const { match, inputs } = story(undefined, seed);
    killAll(match, inputs);
    untilFight(match, inputs);
    for (const p of enemies(match)) seen.add(p.primary);
  }
  assert.deepEqual([...seen].sort(), ['dual', 'pistol', 'rifle']);
});

test('플레이어가 쓰러지면 패배, 일반 요원은 수류탄·무기 전환을 하지 않음', () => {
  const { match, inputs } = story();
  const [P1] = match.players;
  const [agent] = enemies(match);
  inputs[agent.id].item = true;
  inputs[agent.id].select = 'secondary';
  step(match, inputs);
  assert.equal(match.projectiles.length, 0, '수류탄 없음');
  assert.equal(agent.weapon, 'rifle');
  P1.hp = 0;
  step(match, inputs);
  assert.equal(match.phase, 'result');
  assert.equal(match.winner, 'isb');
});

test('내려오는 중인 요원은 맞지 않고 움직이지 않으며, AI도 쉰다', () => {
  const { match, inputs } = story();
  killAll(match, inputs);
  // 헬리콥터가 도착해 첫 요원이 내려오기 시작할 때까지
  for (let i = 0; i < 2000 && match.story.phase !== 'drop'; i++) step(match, inputs);
  const [first] = enemies(match);
  assert.ok(first.entering);
  const brain = match.story.brains.find((b) => b.playerId === first.id);
  updateAI(brain, match, inputs);
  assert.equal(inputs[first.id].aiming, false);
  const b = spawnProjectile(match, match.players[0], -Math.PI / 2);
  b.x = b.previousX = first.x;
  b.y = b.previousY = first.y + 30;
  const hp = first.hp;
  step(match, inputs);
  assert.equal(first.hp, hp, '무적');
});

test('스토리 밸런스: 웨이브별 체력·난이도·피해·탄속·이동 속도·히트박스, 보스 보조무기', () => {
  const settings = defaultStory();
  assert.deepEqual(settings.waves.map((w) => w.hp), [500, 300, 200, 800]);
  settings.waves[0] = { ...settings.waves[0], hp: 1234, difficulty: 'hard', damage: 200, bulletSpeed: 150, speed: 50, radius: 45 };
  settings.waves[3].secondary = 'shotgun';
  const { match, inputs } = story(settings);
  const [agent] = enemies(match);
  assert.equal(agent.hp, 1234);
  assert.equal(agent.radius, 45);
  assert.equal(agent.speed, 150);
  assert.equal(match.story.brains[0].diff.name, '어려움');
  const b = spawnProjectile(match, agent, Math.PI / 2);
  assert.equal(b.damage, WEAPONS.rifle.damage * 2, '피해 200%');
  assert.ok(Math.abs(b.vy - WEAPONS.rifle.speed * 1.5) < 1e-6, '탄속 150%');

  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  assert.equal(enemies(match)[0].secondary, 'shotgun');

  const fixed = normalizeStory({ waves: [{ hp: -5, difficulty: 'nope', damage: 'x' }, null, {}, { secondary: 'rpg' }] });
  assert.equal(fixed.waves[0].hp, 1, '범위 밖은 잘라냄');
  assert.equal(fixed.waves[0].difficulty, 'normal');
  assert.equal(fixed.waves[0].damage, 100);
  assert.equal(fixed.waves[3].secondary, 'random');
  assert.equal(WAVES.length, 4);
});
