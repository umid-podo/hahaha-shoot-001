// 싱글플레이 AI: 설정(체력·탄속·칸별 피해) 반영, 조준 대상, 탄 피하기, 사격·무기 전환·수류탄
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step, spawnProjectile } from '../src/game/update.js';
import { createAI, updateAI, aimAtTarget, AI_CHARACTERS, DIFFICULTY_IDS } from '../src/game/ai.js';
import { TICK, WEAPONS, MIN_X, MAX_X } from '../src/game/config.js';

function single(ai = {}, player = {}, seed = 1) {
  const match = createMatch({
    P1: { weapon: 'pistol', ...player },
    P2: { characterId: 'isb-agent-1', weapon: 'rifle', ai: true, ...ai },
  }, seed);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  const inputs = createInputs(match.players);
  const [P1, P2] = match.players;
  return { match, inputs, P1, P2 };
}
function run(match, inputs, brain, seconds, each) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) {
    each?.(t);
    updateAI(brain, match, inputs);
    events.push(...step(match, inputs));
  }
  return events;
}

test('AI 설정: 체력·탄속 배율·칸별 피해가 경기에 반영되고, 이름에 (AI) 표시', () => {
  const { match, P2 } = single({ maxHp: 1234, bulletSpeedScale: 1.5, damage: { primary: 11, secondary: 9, grenade: 80 } });
  assert.equal(P2.ai, true);
  assert.equal(P2.name, '요원 1 (AI)');
  assert.equal(P2.hp, 1234);
  assert.equal(P2.maxHp, 1234);
  const b = spawnProjectile(match, P2, Math.PI / 2);
  assert.equal(b.damage, 11, '주무기 피해');
  assert.ok(Math.abs(b.vy - WEAPONS.rifle.speed * 1.5) < 1e-6, '탄속 1.5배');
  P2.weapon = 'smg';
  assert.equal(spawnProjectile(match, P2, Math.PI / 2).damage, 9, '보조무기 피해');
  const g = spawnProjectile(match, P2, Math.PI / 2, 'grenade');
  assert.equal(g.splash.damage, 80, '수류탄 폭발 피해');
  assert.equal(WEAPONS.grenade.splash.damage, 50, '무기표 기본값은 그대로');

  const rpg = single({ weapon: 'rpg', damage: { primary: 80 } });
  const r = spawnProjectile(rpg.match, rpg.P2, Math.PI / 2);
  assert.equal(r.damage, 80);
  assert.equal(r.splash.damage, 20, 'RPG 폭발 피해는 직격과 같은 비율(2배)');

  const human = single();
  assert.equal(human.P1.ai, false);
  assert.equal(spawnProjectile(human.match, human.P1, -Math.PI / 2).damage, WEAPONS.pistol.damage, '사람은 기본 피해');
});

test('AI 캐릭터 후보는 요원들뿐', () => {
  assert.deepEqual(AI_CHARACTERS, ['isb-agent-1', 'isb-agent-2']);
  assert.deepEqual(DIFFICULTY_IDS, ['easy', 'normal', 'hard']);
});

test('AI는 언제나 상대 플레이어를 향해 조준 (쉬움은 지금 위치, 어려움은 이동 방향 앞)', () => {
  for (const level of DIFFICULTY_IDS) {
    const { match, inputs, P1, P2 } = single({}, {}, 3);
    const brain = createAI('P2', level, 3);
    run(match, inputs, brain, 6, (t) => { inputs.P1.moveAxis = Math.sin(t * 2) > 0 ? 1 : -1; });
    for (let i = 0; i < 60; i++) {
      inputs.P1.moveAxis = i % 40 < 20 ? 1 : -1;
      updateAI(brain, match, inputs);
      const aim = inputs.P2.aim;
      assert.ok(aim >= 0 && aim <= Math.PI, `${level}: 상단 팀 조준 반원`);
      const direct = Math.atan2(P1.y - P2.y, P1.x - P2.x);
      // 예측해도 상대가 움직일 수 있는 거리 안쪽만 겨눈다
      const maxLead = Math.atan2(P1.y - P2.y, Math.min(MAX_X, P1.x + 300) - P2.x);
      assert.ok(Math.abs(aim - direct) <= Math.abs(maxLead - direct) + 0.2, `${level}: 플레이어 쪽`);
      if (level === 'easy') assert.ok(Math.abs(aim - direct) < 1e-9, '쉬움은 지금 위치를 정확히 겨눔');
      step(match, inputs);
    }
  }
  const me = { x: 800, y: 92, team: 'isb' };
  const target = { x: 800, previousX: 800 - 5, y: 892 };
  assert.ok(aimAtTarget(me, target, 720, 1) < Math.PI / 2, '오른쪽으로 움직이는 대상은 오른쪽 앞을 겨눔');
  assert.equal(aimAtTarget(me, target, 720, 0), Math.PI / 2);
});

test('AI는 날아오는 탄을 움직여 피한다: 가만히 있는 상대보다 훨씬 덜 맞음', () => {
  const totals = {};
  for (const mode of ['still', 'hard']) {
    let taken = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const { match, inputs, P1, P2 } = single({ maxHp: 99999 }, { weapon: 'pistol' }, seed);
      P1.x = P1.previousX = 300; P1.hp = P1.maxHp = 99999;
      match.covers = [];
      const brain = createAI('P2', 'hard', seed);
      for (let t = 0; t < 10; t += TICK) {
        inputs.P1.aim = Math.atan2(P2.y - P1.y, P2.x - P1.x);
        inputs.P1.aiming = true;
        if (mode === 'hard') updateAI(brain, match, inputs);
        step(match, inputs);
      }
      taken += match.stats.P2.taken;
    }
    totals[mode] = taken;
  }
  assert.ok(totals.still > 0);
  assert.ok(totals.hard < totals.still * 0.3, `피하기: ${totals.hard} vs 가만히 ${totals.still}`);
});

test('AI 한 발 피하기: 정면으로 오는 탄을 옆으로 비킴', () => {
  const { match, inputs, P1, P2 } = single({ maxHp: 500 }, { weapon: 'sniper' }, 5);
  match.covers = [];
  const brain = createAI('P2', 'hard', 5);
  brain.dodgeDecisions = new Map();
  brain.diff = { ...brain.diff, dodge: 1 };
  P1.x = P1.previousX = P2.x;
  const b = spawnProjectile(match, P1, -Math.PI / 2);
  b.y = b.previousY = P2.y + 500; // 약 0.3초 뒤 도착
  run(match, inputs, brain, 1);
  assert.equal(match.stats.P2.taken, 0);
  assert.ok(Math.abs(P2.x - P1.x) > P2.radius, '옆으로 비킴');
});

test('AI는 플레이어를 쏘아 피해를 주고, 떼면 쏘는 무기도 쏜다', () => {
  for (const weapon of ['rifle', 'pistol', 'dual', 'rpg', 'sniper']) {
    const { match, inputs, P1 } = single({ weapon }, {}, 7);
    P1.x = P1.previousX = 300;
    const brain = createAI('P2', 'normal', 7);
    run(match, inputs, brain, 8);
    assert.ok(match.stats.P2.weapons[weapon]?.shots > 0, `${weapon} 발사`);
    assert.ok(match.stats.P1.taken > 0, `${weapon}: 가만히 있는 플레이어는 맞음`);
  }
});

test('AI는 보조무기로 바꿔 쓰고 수류탄도 던진다', () => {
  const { match, inputs, P1 } = single({ weapon: 'pistol' }, {}, 9);
  P1.hp = P1.maxHp = 99999;
  const brain = createAI('P2', 'hard', 9);
  run(match, inputs, brain, 30);
  const used = match.stats.P2.weapons;
  assert.ok(used.smg?.shots > 0, '기관단총 사용');
  assert.ok(used.grenade?.shots >= 1, '수류탄 사용');
  assert.ok(used.pistol?.shots > 0, '주무기 사용');
});

test('카운트다운·쓰러짐 중에는 AI가 쏘거나 움직이지 않음', () => {
  const { match, inputs, P2 } = single();
  match.phase = 'countdown';
  const brain = createAI('P2', 'hard', 1);
  updateAI(brain, match, inputs);
  assert.equal(inputs.P2.aiming, false);
  assert.equal(inputs.P2.moveAxis, 0);
  match.phase = 'playing';
  P2.alive = false;
  updateAI(brain, match, inputs);
  assert.equal(inputs.P2.aiming, false);
  assert.ok(P2.x >= MIN_X && P2.x <= MAX_X);
});
