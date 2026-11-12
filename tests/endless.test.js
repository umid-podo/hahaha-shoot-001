// 스토리 연속 플레이 모드: 옥상에서 요원이 3명씩 끝없이, 3웨이브마다 보상(1코인 + 1승리)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputs, createInput } from '../src/game/state.js';
import { step } from '../src/game/update.js';
import { createStoryMatch, defaultStory, ENDLESS, checkpoint, WAVES, endlessBoost } from '../src/game/story.js';

test('연속 플레이: 옥상(고공 요새)에서 요원이 3명씩 끝없이 오고, 3웨이브마다 보상 이벤트, 저장은 안 됨', () => {
  const settings = { ...defaultStory(), gunkata: false };
  const match = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, settings, 7, null, null, 0, { endless: true });
  assert.equal(match.story.stage, 'rooftop');
  assert.equal(match.map, 'fortress');
  assert.ok(match.story.endless);
  match.phase = 'playing';
  const inputs = createInputs(match.players);
  const hero = match.players[0];
  const sizes = [];
  const hps = [];
  const rewards = [];
  let fightingWave = null;
  for (let i = 0; i < 60 * 400 && rewards.length < 3; i++) {
    hero.hp = hero.maxHp; // 주인공은 쓰러지지 않게
    for (const p of match.players) inputs[p.id] ??= createInput(p);
    const agents = match.players.filter((p) => p.team === 'isb');
    if (match.story.phase === 'fight' && match.phase === 'playing') {
      if (fightingWave !== match.story.endless.cleared) {
        fightingWave = match.story.endless.cleared;
        sizes.push(agents.filter((p) => p.alive).length);
        hps.push(Math.max(...agents.filter((p) => p.alive).map((p) => p.maxHp)));
      }
      for (const p of agents) p.hp = 0;
    }
    for (const e of step(match, inputs)) if (e.type === 'endless-reward') rewards.push(e.cleared);
    assert.notEqual(match.phase, 'result', '주인공이 서 있으면 끝나지 않는다');
  }
  assert.deepEqual(rewards, [3, 6, 9]);
  assert.ok(sizes.length >= 9 && sizes.every((n) => n === ENDLESS.count), `요원 3명씩: ${sizes}`);
  assert.equal(match.story.stage, 'rooftop', '옥상에서 벗어나지 않음');
  assert.ok(!WAVES[match.story.wave].boss);
  assert.equal(checkpoint(match), null, '연속 플레이는 저장하지 않음');
  // 웨이브마다 요원이 강해진다
  for (let i = 1; i < hps.length; i++) assert.ok(hps[i] > hps[i - 1], `체력이 점점 오름: ${hps}`);
  const late = match.players.filter((p) => p.team === 'isb').at(-1);
  assert.ok(late.damageScale > 1 && late.speed > 300, '피해·속도도 오름');
  assert.ok(match.story.brains.at(-1).diff.name === '어려움', '많이 깨면 어려움 난이도');
});

test('연속 플레이 강화 배율: 체력은 계속, 피해·속도는 한도까지, 난이도는 3웨이브부터 보통·6웨이브부터 어려움', () => {
  assert.deepEqual(endlessBoost(0), { hp: 1, damage: 1, speed: 1, difficulty: null });
  assert.equal(endlessBoost(3).difficulty, 'normal');
  assert.equal(endlessBoost(6).difficulty, 'hard');
  assert.ok(endlessBoost(10).hp > endlessBoost(5).hp);
  assert.equal(endlessBoost(1000).damage, ENDLESS.grow.damageMax);
  assert.equal(endlessBoost(1000).speed, ENDLESS.grow.speedMax);
});

test('웨이브를 깨면 서 있는 주인공의 체력이 가득 찬다(일반 스토리·연속 플레이)', () => {
  for (const endless of [false, true]) {
    const settings = { ...defaultStory(), gunkata: false };
    const match = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, settings, 3, null, null, 0, { endless });
    match.phase = 'playing';
    const inputs = createInputs(match.players);
    const hero = match.players[0];
    let healed = false;
    for (let i = 0; i < 60 * 60 && !healed; i++) {
      for (const p of match.players) inputs[p.id] ??= createInput(p);
      const agents = match.players.filter((p) => p.team === 'isb' && p.alive && !p.entering);
      if (match.story.phase === 'fight' && match.phase === 'playing' && agents.length) {
        hero.hp = 123;
        for (const p of agents) p.hp = 0;
      }
      for (const e of step(match, inputs)) if (e.type === 'heal' && e.playerId === hero.id) healed = true;
    }
    assert.ok(healed, `${endless ? '연속' : '일반'}: 회복 이벤트`);
    assert.equal(hero.hp, hero.maxHp);
  }
});
