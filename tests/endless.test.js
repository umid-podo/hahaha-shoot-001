// 스토리 연속 플레이 모드: 옥상에서 요원이 3명씩 끝없이, 3웨이브마다 보상(1코인 + 1승리)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputs, createInput } from '../src/game/state.js';
import { step } from '../src/game/update.js';
import { createStoryMatch, defaultStory, ENDLESS, checkpoint, WAVES } from '../src/game/story.js';

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
});
