// 스토리 모드: 웨이브 구성(인원·무기·체력), 헬리콥터·전투기·건쉽 연출, 중간보스(스미스 요원), 2스테이지 복도(엘리베이터·포탑·R-10),
// 승패, 밸런스 설정, 저장하기·이어하기
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputs } from '../src/game/state.js';
import { step, spawnProjectile } from '../src/game/update.js';
import { updateAI, nearestTarget } from '../src/game/ai.js';
import {
  createStoryMatch, defaultStory, normalizeStory, WAVES, STORY_WEAPONS, BOSS_NAME, R10_NAME, CUTSCENE_TIME, R10_CUTSCENE_TIME,
  LAST_WORDS, MAX_ALLIES, allyPicks, extraAgents, STAIRS_TIME, ROOF_STAIRS, CORRIDOR_STAIRS, checkpoint, normalizeStorySave, waveLabel, currentWave, COOP_SLOT, AGENT_WEAPON_CHOICES,
} from '../src/game/story.js';
import { glowingKey, GOAL, DAMAGE, WARN_TIME, KATA_KEYS, DRONE_MOVES } from '../src/game/gunkata.js';
import { TICK, RAIL_Y, WEAPONS, SECONDARY_IDS, TURRET, COVER } from '../src/game/config.js';

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
/** 건 카타: 빛나는 버튼을 바로 눌러 10번 대응하고 엔딩 컷씬까지 돌린다. */
function playKata(match, inputs) {
  const events = [];
  for (let i = 0; i < 20000 && match.phase === 'gunkata'; i++) {
    const key = glowingKey(match.gunkata);
    if (key) inputs[match.gunkata.heroId].kata = key;
    events.push(...step(match, inputs));
  }
  return events;
}
/** 한 틱 진행하고, 요원을 쓰러뜨려 건 카타가 나오면 끝까지(빛나는 버튼을 바로 눌러) 돌린다. */
function stepKata(match, inputs) {
  const events = step(match, inputs);
  if (match.phase === 'gunkata') events.push(...playKata(match, inputs));
  return events;
}
/** 경기장의 요원을 모두 쓰러뜨리고, 처치 컷씬(킬캠)·건 카타가 나오면 끝날 때까지 돌린다. */
function killAll(match, inputs) {
  for (const p of enemies(match)) p.hp = 0;
  const events = step(match, inputs);
  for (let i = 0; i < 20 && ['killcam', 'gunkata'].includes(match.phase); i++) {
    if (match.phase === 'gunkata') events.push(...playKata(match, inputs));
    while (match.phase === 'killcam') events.push(...step(match, inputs));
  }
  return events;
}
/** 컷씬·카운트다운이 끝날 때까지 돌린다. */
function runOut(match, inputs, phases = ['cutscene', 'countdown', 'killcam']) {
  const events = [];
  for (let i = 0; i < 5000 && phases.includes(match.phase); i++) events.push(...step(match, inputs));
  return events;
}
/** 옥상(1~3웨이브 + 스미스 요원)을 깨고 복도 1웨이브 요원이 나와 싸울 때까지 */
function toCorridor(match, inputs) {
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  killAll(match, inputs);
  const events = runOut(match, inputs);
  events.push(...untilFight(match, inputs));
  return events;
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

  // 중간보스: 헬리콥터가 오고 → 전투기가 미사일로 격추 → 건쉽에서 스미스 요원
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

  // 스미스 요원을 쓰러뜨리면 엔딩 컷씬 뒤 2스테이지 복도로(체력 100% 회복)
  P1.hp = 123;
  killAll(match, inputs);
  assert.equal(match.phase, 'cutscene');
  const all = [];
  for (let t = 0; t < CUTSCENE_TIME + STAIRS_TIME + 0.1 && match.phase === 'cutscene'; t += TICK) all.push(...step(match, inputs));
  assert.ok(all.some((e) => e.type === 'stage' && e.stage === 'corridor'));
  assert.equal(match.phase, 'countdown', '복도에서 카운트다운부터');
  assert.equal(match.story.stage, 'corridor');
  assert.equal(P1.hp, P1.maxHp, '스테이지를 깨면 체력 100% 회복');
  assert.equal(enemies(match).length, 0, '스미스 요원은 치움');
  assert.ok(match.covers.every((c) => c.hp === COVER.hp), '복도 엄폐물은 새것');
  runOut(match, inputs);

  // 복도 1웨이브: 엘리베이터에서 보통 요원 1명, RPG·저격총 뺀 무작위 무기
  events = untilFight(match, inputs);
  assert.ok(events.some((e) => e.type === 'elevator'));
  assert.equal(match.story.wave, 4);
  wave = enemies(match);
  assert.equal(wave.length, 1);
  assert.ok(STORY_WEAPONS.includes(wave[0].primary));
  assert.equal(match.story.brains[0].diff.name, '보통');
  assert.equal(wave[0].y, RAIL_Y.isb, '엘리베이터에서 걸어 나와 레일로');

  // 복도 2웨이브: 쉬움 돌격소총 + 보통 돌격소총(기획의 저격총에서 바뀜)
  killAll(match, inputs);
  untilFight(match, inputs);
  wave = enemies(match);
  assert.deepEqual(wave.map((p) => p.primary), ['rifle', 'rifle']);
  assert.deepEqual(match.story.brains.map((b) => b.diff.name), ['쉬움', '보통']);

  // 복도 3웨이브: 쉬움 요원 4명(쌍권총·권총·권총·돌격소총)
  killAll(match, inputs);
  untilFight(match, inputs);
  wave = enemies(match);
  assert.deepEqual(wave.map((p) => p.primary), ['dual', 'pistol', 'pistol', 'rifle']);
  assert.ok(match.story.brains.every((b) => b.diff.name === '쉬움'));
  for (const p of wave) assert.ok(p.x >= 80 && p.x <= 1520);

  // 보스전: 천장을 부수고 R-10(체력 600, 레이저 캐논, 큰 히트박스) → 도발 장면
  killAll(match, inputs);
  events = untilFight(match, inputs);
  assert.ok(events.some((e) => e.type === 'ceiling-break'));
  const [r10] = enemies(match);
  assert.equal(r10.name, R10_NAME);
  assert.equal(r10.characterId, 'r10');
  assert.equal(r10.boss, true);
  assert.equal(r10.primary, 'laser');
  assert.equal(r10.hp, 600);
  assert.ok(r10.radius > 30, '히트박스가 조금 큼');
  assert.equal(match.phase, 'killcam', 'R-10 도발 장면');
  assert.ok(match.killcam.shots.some((s) => s.caption.includes('도발하기!')));
  runOut(match, inputs, ['killcam']);
  assert.equal(match.phase, 'playing');

  // R-10을 쓰러뜨리면 RPG 엔딩 컷씬 뒤 승리
  killAll(match, inputs);
  assert.equal(match.phase, 'cutscene');
  assert.equal(match.cutscene.kind, 'r10');
  runOut(match, inputs, ['cutscene']);
  assert.equal(match.phase, 'result');
  assert.equal(match.winner, 'earth');
  assert.equal(match.story.roster.length, 7 + 1 + 2 + 4 + 1, '결과 화면용: 나온 요원 전원');
});

test('무작위 무기는 RPG·저격총·아킴보 석궁을 뺀 무기 중 하나', () => {
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
  assert.deepEqual(settings.waves.map((w) => w.hp), [500, 300, 200, 800, 500, 300, 200, 600]);
  assert.deepEqual(settings.waves.map((w) => w.difficulty), ['normal', 'normal', 'normal', 'normal', 'normal', 'mixed', 'easy', 'normal']);
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

  const fixed = normalizeStory({ waves: [{ hp: -5, difficulty: 'mixed', damage: 'x' }, null, {}, { secondary: 'rpg' }, {}, { difficulty: 'hard' }] });
  assert.equal(fixed.waves[0].hp, 1, '범위 밖은 잘라냄');
  assert.equal(fixed.waves[0].difficulty, 'normal', "'기획대로'는 요원마다 난이도가 정해진 웨이브만");
  assert.equal(fixed.waves[0].damage, 100);
  assert.equal(fixed.waves[3].secondary, 'random');
  assert.equal(fixed.waves[5].difficulty, 'hard');
  assert.equal(fixed.waves.length, 8, '예전(옥상만) 저장값도 복도 기본값으로 채움');
  assert.equal(WAVES.length, 8);
});

test('요원·보스가 올 때마다 경고음(alarm): 전투 시작, 헬리콥터, 보스 건쉽', () => {
  const { match, inputs } = story();
  const alarms = [];
  const collect = (events) => alarms.push(...events.filter((e) => e.type === 'alarm'));
  collect(step(match, inputs));
  assert.equal(alarms.length, 1, '1웨이브 요원 등장');
  for (let w = 0; w < 3; w++) {
    killAll(match, inputs);
    collect(untilFight(match, inputs));
  }
  assert.equal(alarms.filter((a) => !a.boss).length, 4, '1웨이브 + 헬리콥터 3번(2·3웨이브, 중간보스 직전)');
  assert.equal(alarms.filter((a) => a.boss).length, 1, '건쉽(스미스 요원)');
});

test('엔딩 컷씬: 스미스 요원이 달려들며 권총 6발을 모두 피하고, 발차기에 건물 밖으로 떨어짐', () => {
  const { match, inputs } = story();
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  const [P1] = match.players;
  const hp = P1.hp;
  killAll(match, inputs);
  const c = match.cutscene;
  assert.ok(c);
  const events = [];
  let closest = Infinity;
  while (match.phase === 'cutscene') {
    events.push(...step(match, inputs));
    for (const b of c.bullets) closest = Math.min(closest, Math.hypot(b.x - c.smith.x, b.y - c.smith.y));
    if (!c.kicked) assert.ok(c.smith.y >= 92 - 1e-6 && c.smith.y <= P1.y, '옥상 위를 달려듦');
  }
  const shots = events.filter((e) => e.type === 'fire' && e.weapon === 'pistol');
  assert.equal(shots.length, 6, '주인공이 권총을 쏨');
  assert.equal(events.filter((e) => e.type === 'dodge').length, 6, '모두 피함');
  assert.ok(closest > 30 + 5 + 20, `총알이 몸에 닿지 않음(가장 가까이 ${closest.toFixed(0)})`);
  assert.equal(events.filter((e) => e.type === 'kick').length, 1, '발차기');
  assert.ok(c.smith.x < 22 || c.smith.x > 1578, '난간(옥상 끝)을 넘어 건물 밖으로');
  assert.ok(c.smith.alpha <= 0.01 && c.smith.scale < 0.3, '떨어져 사라짐');
  assert.equal(P1.hp, P1.maxHp, '컷씬 동안 다치지 않고, 끝나면 체력 회복');
  assert.ok(hp <= P1.maxHp);
  assert.equal(match.phase, 'countdown', '결과 대신 2스테이지로');
  assert.equal(match.story.stage, 'corridor');
  assert.equal(events.filter((e) => e.type === 'result').length, 0);
});

test('엔딩 컷씬: 보스·주인공이 어디에 있든 총알은 모두 빗나감', () => {
  for (const [bx, hx] of [[90, 1500], [1510, 100], [800, 800], [300, 320], [1400, 1200]]) {
    const { match, inputs } = story();
    for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
    const [P1] = match.players;
    P1.x = hx;
    enemies(match)[0].x = bx;
    killAll(match, inputs);
    const c = match.cutscene;
    let closest = Infinity;
    while (match.phase === 'cutscene') {
      step(match, inputs);
      if (!c.kicked) for (const b of c.bullets) closest = Math.min(closest, Math.hypot(b.x - c.smith.x, b.y - c.smith.y));
    }
    assert.ok(closest > 45, `보스 ${bx}, 주인공 ${hx}: 가장 가까이 ${closest.toFixed(0)}`);
    assert.equal(match.story.stage, 'corridor');
  }
});

test('요원을 쓰러뜨릴 때마다 킬캠: 경기가 멈추고 확대·마지막 한마디, 웨이브 마지막 요원은 웨이브별 장면', () => {
  const { match, inputs } = story();
  killAll(match, inputs);
  untilFight(match, inputs); // 2웨이브(요원 2명)
  const [a, b] = enemies(match);
  const P1 = match.players[0];

  // 첫 요원: 짧은 킬캠, 그동안 탄·플레이어·AI는 멈춤
  a.hp = 0;
  stepKata(match, inputs);
  assert.equal(match.phase, 'killcam');
  const k = match.killcam;
  assert.equal(k.victimId, a.id);
  assert.equal(k.waveEnd, false);
  assert.equal(k.shots.length, 1);
  assert.ok(LAST_WORDS.some((line) => k.shot.caption.includes(line)), '마지막 한마디');
  const x = P1.x;
  inputs.P1.moveAxis = 1;
  const events = [];
  while (match.phase === 'killcam') events.push(...step(match, inputs));
  inputs.P1.moveAxis = 0;
  assert.equal(P1.x, x, '킬캠 동안 멈춤');
  assert.ok(events.some((e) => e.type === 'killcam'));
  assert.equal(match.phase, 'playing');
  assert.equal(match.story.phase, 'fight', '남은 요원이 있으면 웨이브 계속');

  // 웨이브 마지막 요원: 주인공 장면까지
  b.hp = 0;
  stepKata(match, inputs);
  assert.equal(match.killcam.waveEnd, true);
  assert.ok(match.killcam.shots.some((s) => s.mode === 'hero'));
  const end = [];
  while (match.phase === 'killcam') end.push(...step(match, inputs));
  assert.ok(end.some((e) => e.type === 'hero-pose'));
  step(match, inputs);
  assert.equal(match.story.phase, 'clear', '킬캠이 끝나면 웨이브 클리어');
});

test('웨이브 마무리 장면: 1웨이브 무전 지원 요청, 3웨이브 스미스 요원 무전, 보스는 킬캠 없이 엔딩 컷씬', () => {
  const { match, inputs } = story();
  const modes = [];
  for (let w = 0; w < 3; w++) {
    for (const p of enemies(match)) p.hp = 0;
    stepKata(match, inputs);
    modes.push(match.killcam.shots.map((s) => s.mode));
    while (match.phase === 'killcam') step(match, inputs);
    untilFight(match, inputs);
  }
  assert.ok(modes[0].includes('radio'));
  assert.ok(modes[1].includes('hero'));
  assert.ok(modes[2].includes('smith'));
  for (const p of enemies(match)) p.hp = 0;
  step(match, inputs);
  assert.equal(match.phase, 'gunkata', '스미스 요원은 킬캠 대신 건 카타');
  assert.equal(match.killcam ?? null, null);
  playKata(match, inputs);
  assert.equal(match.phase, 'cutscene', '건 카타 뒤 엔딩 컷씬');
});

/** 선분(x1,y1)-(x2,y2)과 점(px,py) 사이 가장 가까운 거리 */
function segmentDistance(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1, dy = y2 - y1;
  const k = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x1 + dx * k - px, y1 + dy * k - py);
}

test('복도 포탑: 전투 중 약 5초 동안 플레이어 쪽으로 쏘고 10초 쉼, 포탄 25·폭발 10, 요원은 안 맞음, 전투기 없음', () => {
  const { match, inputs } = story();
  toCorridor(match, inputs);
  assert.equal(match.story.phase, 'fight');
  assert.equal(match.jet, null);
  assert.equal(match.story.turrets.length, 2);
  const [agent] = enemies(match);
  agent.hp = agent.maxHp = 99999; // 웨이브가 끝나지 않게
  const P1 = match.players[0];
  P1.hp = P1.maxHp = 99999;
  match.covers = []; // 엄폐물 없이 포탄 확인
  const fires = [];
  let jets = 0;
  for (let t = 0; t < 40; t += TICK) {
    for (const e of step(match, inputs)) if (e.type === 'turret-fire') fires.push(t);
    if (match.jet) jets++;
    for (const b of match.projectiles) if (b.ownerId === 'turret') assert.equal(b.team, 'isb');
  }
  assert.equal(jets, 0, '복도에는 전투기가 나오지 않음');
  // 처음 4초 뒤 5초 동안 1초마다 두 포탑이 한 발씩(10발), 10초 쉬고 다시 10발, …
  const first = fires.filter((t) => t < TURRET.firstDelay + TURRET.burst + 0.1);
  assert.equal(first.length, 2 * TURRET.burst / TURRET.interval);
  assert.ok(Math.abs(first[0] - TURRET.firstDelay) < 0.1);
  const gap = fires.find((t) => t > first.at(-1) + 0.5) - first.at(-1);
  assert.ok(gap > TURRET.rest, `쉬는 시간 ${gap.toFixed(1)}초`);
  assert.equal(agent.hp, 99999, '요원은 포탄에 맞지 않음');
  assert.ok(match.stats.P1.takenFrom.turret > 0, '플레이어는 맞음');
});

test('포탄 피해: 직격 25, 폭발 범위 10', () => {
  const { match, inputs } = story();
  toCorridor(match, inputs);
  enemies(match)[0].hp = 99999;
  match.covers = [];
  const P1 = match.players[0];
  match.story.turretTimer = 0; // 바로 쏜다
  P1.x = 800;
  let hp = P1.hp;
  let hits = [];
  for (let t = 0; t < 3 && hits.length === 0; t += TICK) {
    hits = step(match, inputs).filter((e) => e.type === 'hit' && e.victimId === 'P1').map((e) => e.damage);
  }
  assert.deepEqual(hits, [TURRET.damage], '서 있으면 직격');
  // 옆으로 비켜서면 폭발 범위 피해만
  match.projectiles = [];
  hp = P1.hp;
  match.story.turretTimer = 100;
  match.story.turretFiring = false;
  match.projectiles.push({
    id: 999, ownerId: 'turret', team: 'isb', weapon: 'turret', x: P1.x + 80, y: P1.y - 30, previousX: P1.x + 80, previousY: P1.y - 30,
    vx: 0, vy: 600, life: 2, damage: TURRET.damage, connected: false, splash: { ...TURRET.splash }, endY: RAIL_Y.earth,
  });
  for (let i = 0; i < 10; i++) step(match, inputs);
  assert.equal(hp - P1.hp, TURRET.splash.damage);
});

test('복도 장면: 1웨이브 "요원들은 복도로 와라!", 2웨이브 "나 이제 승급인데!!!"·"에잇크.", 3웨이브 쿠쿵 → 천장에서 R-10', () => {
  const { match, inputs } = story();
  toCorridor(match, inputs);
  const captions = () => match.killcam.shots.map((s) => s.caption).join(' / ');

  for (const p of enemies(match)) p.hp = 0;
  stepKata(match, inputs);
  assert.match(captions(), /요원들은 복도로 와라!/);
  runOut(match, inputs, ['killcam']);
  untilFight(match, inputs);

  const [a, b] = enemies(match);
  a.hp = 0;
  stepKata(match, inputs);
  assert.equal(match.killcam.shot.caption, '요원: 나 이제 승급인데!!!');
  runOut(match, inputs, ['killcam']);
  b.hp = 0;
  stepKata(match, inputs);
  assert.match(captions(), /주인공: 에잇크\./);
  runOut(match, inputs, ['killcam']);
  untilFight(match, inputs);

  for (const p of enemies(match)) p.hp = 0;
  stepKata(match, inputs);
  const modes = match.killcam.shots.map((s) => s.mode);
  assert.deepEqual(modes, ['kill', 'hero', 'rumble', 'what']);
  assert.match(captions(), /이 정도냐\? 들어와—.*\(쿠쿵!\).*…이게 뭐야\?/);
  const events = runOut(match, inputs, ['killcam']);
  assert.ok(events.some((e) => e.type === 'rumble'));
  const arrival = untilFight(match, inputs);
  assert.ok(arrival.some((e) => e.type === 'ceiling-break'), '천장이 부서짐');
  assert.ok(arrival.some((e) => e.type === 'land'), 'R-10이 내려앉음');
  assert.equal(enemies(match)[0].name, R10_NAME);
});

test('R-10 AI: 레이저 탄환 3점사를 약 3초 동안(5번) 쏘고 2초 재장전', () => {
  const { match, inputs } = story();
  toCorridor(match, inputs);
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  runOut(match, inputs, ['killcam']);
  const [r10] = enemies(match);
  const P1 = match.players[0];
  P1.hp = P1.maxHp = 99999;
  match.covers = [];
  match.story.turretTimer = Infinity;
  const brain = match.story.brains.find((b) => b.playerId === r10.id);
  const shots = [];
  for (let t = 0; t < 10; t += TICK) {
    updateAI(brain, match, inputs);
    for (const e of step(match, inputs)) if (e.type === 'fire' && e.playerId === r10.id) shots.push(match.tick * TICK);
  }
  // 15발(3점사 5번, 약 3초) 쏘고, 2초 쉬고, 다시 15발
  assert.ok(shots.length >= 30, `${shots.length}발`);
  const pause = shots[15] - shots[14];
  assert.ok(pause >= 2 - 1e-6 && pause < 2.2, `재장전 ${pause.toFixed(2)}초`);
  assert.ok(Math.abs(shots[14] - shots[0] - 2.96) < 0.05, `약 3초 동안 연사(${(shots[14] - shots[0]).toFixed(2)}초)`);
  assert.ok(shots[1] - shots[0] < 0.1 && shots[3] - shots[2] > 0.5, '3발씩 끊어 쏨');
});

test('R-10 엔딩 컷씬: 레이저를 마구 쏘지만 모두 빗나가고, RPG로 R-10 폭발 → 승리', () => {
  for (const heroX of [100, 800, 1500]) {
    const { match, inputs } = story();
    toCorridor(match, inputs);
    for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
    runOut(match, inputs, ['killcam']);
    const P1 = match.players[0];
    P1.x = heroX;
    const hp = P1.hp;
    killAll(match, inputs);
    const c = match.cutscene;
    assert.equal(c.kind, 'r10');
    const events = [];
    const captions = new Set();
    while (match.phase === 'cutscene') {
      const tick = step(match, inputs);
      events.push(...tick);
      captions.add(c.caption);
      for (const e of tick.filter((ev) => ev.type === 'laser')) {
        const d = segmentDistance(e.x1, e.y1, e.x2, e.y2, c.hero.x, c.hero.y);
        assert.ok(d > P1.radius + 10, `주인공 ${heroX}: 레이저가 ${d.toFixed(0)}까지 다가옴`);
      }
    }
    assert.ok(events.filter((e) => e.type === 'laser').length >= 10, '레이저 난사');
    assert.ok(captions.has('주인공: 후, RPG가 남아있었지.'));
    assert.ok(captions.has('R-10: 그게 무슨-'));
    assert.equal(events.filter((e) => e.type === 'fire' && e.weapon === 'rpg').length, 1, 'RPG 발사');
    assert.ok(events.filter((e) => e.type === 'explode').length >= 3, 'R-10 폭발');
    assert.equal(c.r10.alpha, 0);
    assert.equal(P1.hp, hp, '주인공은 다치지 않음');
    assert.equal(match.phase, 'result');
    assert.equal(match.winner, 'earth');
    assert.ok(c.t >= R10_CUTSCENE_TIME);
  }
});

test('저장하기: 지금 웨이브(웨이브 사이면 다음 웨이브)와 체력, 스미스 요원 컷씬 중이면 복도 1웨이브·체력 가득', () => {
  const { match, inputs } = story();
  const P1 = match.players[0];
  P1.hp = 321;
  assert.deepEqual(checkpoint(match), { wave: 0, hp: 321, label: '옥상 1웨이브' });
  killAll(match, inputs);
  assert.equal(checkpoint(match).wave, 1, '웨이브를 깨면 다음 웨이브');
  untilFight(match, inputs);
  assert.equal(checkpoint(match).wave, 1);
  for (let w = 0; w < 2; w++) { killAll(match, inputs); untilFight(match, inputs); }
  assert.equal(checkpoint(match).label, '옥상 중간보스');
  killAll(match, inputs);
  assert.equal(match.phase, 'cutscene');
  assert.deepEqual(checkpoint(match), { wave: 4, hp: P1.maxHp, label: '복도 1웨이브' });
  runOut(match, inputs);
  assert.equal(currentWave(match.story), 4);
  untilFight(match, inputs);
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  runOut(match, inputs, ['killcam']);
  assert.equal(checkpoint(match).label, '복도 보스전');
  killAll(match, inputs);
  assert.equal(checkpoint(match), null, '스토리를 깬 뒤에는 저장 안 함');
  P1.alive = false;
  assert.equal(checkpoint(match), null);
});

test('이어하기: 저장한 웨이브의 요원이 오는 장면부터 저장한 체력으로', () => {
  // 복도 2웨이브부터
  const match = createStoryMatch({ characterId: 'earth-pizza', weapon: 'rpg' }, undefined, 3, { wave: 5, hp: 222 });
  match.phase = 'playing';
  const inputs = createInputs(match.players);
  const [P1] = match.players;
  assert.equal(P1.characterId, 'earth-pizza');
  assert.equal(P1.hp, 222);
  assert.equal(match.story.stage, 'corridor');
  assert.equal(enemies(match).length, 0);
  assert.equal(currentWave(match.story), 5);
  const events = untilFight(match, inputs);
  assert.ok(events.some((e) => e.type === 'elevator'));
  assert.equal(match.story.wave, 5);
  assert.deepEqual(enemies(match).map((p) => p.primary), ['rifle', 'rifle']);
  assert.equal(match.jet, null);

  // 옥상 중간보스부터: 헬리콥터 격추 → 건쉽
  const smith = createStoryMatch({ characterId: 'earth-arrow' }, undefined, 3, { wave: 3, hp: 9999 });
  smith.phase = 'playing';
  smith.jetTimer = Infinity;
  const smithInputs = createInputs(smith.players);
  assert.equal(smith.players[0].hp, smith.players[0].maxHp, '체력은 최대를 넘지 않음');
  const e2 = untilFight(smith, smithInputs);
  assert.ok(e2.some((e) => e.type === 'heli-down'));
  assert.equal(enemies(smith)[0].name, BOSS_NAME);

  // 저장값 검사
  assert.equal(normalizeStorySave(null), null);
  assert.equal(normalizeStorySave({ wave: 99, hp: 10, pick: {} }), null);
  assert.equal(normalizeStorySave({ wave: 2, hp: 0, pick: {} }), null);
  assert.equal(normalizeStorySave({ wave: 2, hp: 10 }), null);
  assert.deepEqual(normalizeStorySave({ wave: 6, hp: 10.4, pick: { characterId: 'r10', weapon: 'laser', secondary: 'smg' }, savedAt: 5 }),
    { wave: 6, hp: 10, label: waveLabel(6), pick: { characterId: 'r10', weapon: 'laser', secondary: 'smg' }, savedAt: 5 });
});

/* ───────── 2인 협동 ───────── */
function coop(resume = null, seed = 7) {
  const match = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, undefined, seed, resume,
    { characterId: 'earth-pizza', weapon: 'pistol' });
  match.phase = 'playing';
  match.jetTimer = Infinity;
  const inputs = createInputs(match.players);
  return { match, inputs };
}

test('2인 협동: P2도 지구방위팀으로 함께, 한 명이 쓰러져도 계속하고 둘 다 쓰러지면 패배', () => {
  const { match, inputs } = coop();
  const [P1, P2] = match.players;
  assert.equal(match.story.coop, true);
  assert.deepEqual([P1.id, P1.team, P2.id, P2.team], ['P1', 'earth', 'P2', 'earth']);
  assert.equal(P2.characterId, 'earth-pizza');
  assert.equal(P2.primary, 'pistol');
  assert.equal(P2.y, RAIL_Y.earth);
  assert.ok(P1.x < P2.x, '두 주인공은 떨어져 선다');
  assert.equal(enemies(match).length, 1, '1웨이브 요원 수는 그대로');

  P1.hp = 0;
  step(match, inputs);
  assert.equal(P1.alive, false);
  assert.equal(match.phase, 'playing', '동료가 서 있으면 계속');
  assert.equal(checkpoint(match).hp, 0, '쓰러진 P1은 체력 0으로 저장');
  assert.equal(checkpoint(match).hp2, P2.hp);

  P2.hp = 0;
  step(match, inputs);
  assert.equal(match.phase, 'result');
  assert.equal(match.winner, 'isb');
  assert.equal(checkpoint(match), null);

  // 1인 스토리에는 P2가 없다
  assert.equal(story().match.players.filter((p) => p.team === 'earth').length, 1);
  assert.equal(COOP_SLOT.team, 'earth');
});

test('2인 협동: 요원·포탑은 가까운 주인공을 노리고, 킬캠은 쓰러뜨린 주인공을 비춤', () => {
  const { match, inputs } = coop();
  const [P1, P2] = match.players;
  const [agent] = enemies(match);
  agent.x = P2.x + 30;
  assert.equal(nearestTarget(match, agent), P2);
  agent.x = P1.x - 30;
  assert.equal(nearestTarget(match, agent), P1);
  P1.alive = false;
  assert.equal(nearestTarget(match, agent), P2, '쓰러진 주인공은 노리지 않음');
  P1.alive = true;

  // P2가 쓰러뜨리면 킬캠의 주인공 장면은 P2
  match.stats[agent.id].killedBy = { ownerId: 'P2', weapon: 'pistol' };
  agent.hp = 0;
  step(match, inputs);
  assert.equal(match.phase, 'gunkata');
  assert.equal(match.gunkata.heroId, 'P2', '쓰러뜨린 주인공이 건 카타');
  playKata(match, inputs);
  assert.equal(match.phase, 'killcam');
  assert.deepEqual(match.killcam.hero, { x: P2.x, y: P2.y });

  // 복도 포탑: 포탑마다 가까운 주인공 쪽으로 쏜다
  const corridor = coop({ wave: 4, hp: 500, hp2: 500 });
  const [C1, C2] = corridor.match.players;
  C1.x = 200; C2.x = 1400;
  untilFight(corridor.match, corridor.inputs);
  for (const e of enemies(corridor.match)) e.hp = 99999;
  for (let t = 0; t < TURRET.firstDelay + 1; t += TICK) {
    if (step(corridor.match, corridor.inputs).some((e) => e.type === 'turret-fire')) break;
  }
  const shells = corridor.match.projectiles.filter((b) => b.ownerId === 'turret');
  assert.equal(shells.length, 2);
  // 왼쪽 포탑은 왼쪽의 P1을, 오른쪽 포탑은 오른쪽의 P2를 겨눈다
  const [left, right] = [...corridor.match.story.turrets].sort((a, b) => a.x - b.x);
  const aimAt = (t, p) => Math.atan2(p.y - t.y, p.x - t.x);
  assert.ok(Math.abs(left.aim - aimAt(left, C1)) < 1e-6);
  assert.ok(Math.abs(right.aim - aimAt(right, C2)) < 1e-6);
});

test('2인 협동: 스테이지를 깨면 쓰러진 동료도 체력 가득으로 일어남, 저장·이어하기', () => {
  const { match, inputs } = coop();
  const [P1, P2] = match.players;
  P2.hp = 0;
  step(match, inputs);
  while (match.phase === 'killcam') step(match, inputs);
  assert.equal(P2.alive, false);
  P1.hp = 123;
  toCorridor(match, inputs);
  assert.equal(match.story.stage, 'corridor');
  assert.equal(P1.hp, P1.maxHp);
  assert.equal(P2.alive, true);
  assert.equal(P2.hp, P2.maxHp);
  assert.ok(P1.x < P2.x);

  // 저장값: P2 체력·선택도 함께
  P2.hp = 77;
  assert.deepEqual(checkpoint(match), { wave: 4, hp: P1.maxHp, hp2: 77, coop: true, label: '복도 1웨이브' });
  const pick = { characterId: 'earth-arrow', weapon: 'rifle', secondary: 'smg' };
  const pick2 = { characterId: 'earth-pizza', weapon: 'pistol', secondary: 'dagger' };
  assert.deepEqual(normalizeStorySave({ wave: 4, hp: 0, hp2: 77, coop: true, pick, pick2, savedAt: 1 }),
    { wave: 4, hp: 0, hp2: 77, coop: true, label: waveLabel(4), pick, pick2, savedAt: 1 });
  assert.equal(normalizeStorySave({ wave: 4, hp: 0, hp2: 0, coop: true, pick, pick2 }), null, '둘 다 쓰러진 저장은 없음');
  assert.equal(normalizeStorySave({ wave: 4, hp: 5, hp2: 5, coop: true, pick }), null, 'P2 선택이 없으면 무효');

  // 이어하기: 쓰러진 채 저장한 P1은 쓰러진 채로, P2는 저장한 체력으로
  const resumed = coop({ wave: 5, hp: 0, hp2: 77 }).match;
  const [R1, R2] = resumed.players;
  assert.equal(R1.alive, false);
  assert.equal(R2.hp, 77);
  assert.equal(resumed.story.stage, 'corridor');
});

test('요원별 주무기: 모든 요원(R-10 빼고)의 주무기를 정할 수 있고, 기본은 기획 무기(복도 2웨이브는 둘 다 돌격소총)', () => {
  const settings = defaultStory();
  assert.deepEqual(settings.waves.map((w) => w.weapons), [
    ['rifle'], ['random', 'random'], ['random', 'random', 'random'], ['pistol'],
    ['random'], ['rifle', 'rifle'], ['dual', 'pistol', 'pistol', 'rifle'], [],
  ]);
  assert.deepEqual(AGENT_WEAPON_CHOICES, ['random', 'rifle', 'pistol', 'dual', 'rpg', 'sniper', 'crossbow']);

  // 정한 무기대로 나온다(무작위가 아니면 RPG·저격총·석궁도)
  settings.waves[0].weapons = ['sniper'];
  settings.waves[1].weapons = ['rpg', 'crossbow'];
  settings.waves[3].weapons = ['dual'];
  const { match, inputs } = story(settings);
  assert.equal(enemies(match)[0].primary, 'sniper');
  killAll(match, inputs); untilFight(match, inputs);
  assert.deepEqual(enemies(match).map((p) => p.primary), ['rpg', 'crossbow']);
  killAll(match, inputs); untilFight(match, inputs);
  for (const p of enemies(match)) assert.ok(STORY_WEAPONS.includes(p.primary), '무작위는 그대로');
  killAll(match, inputs); untilFight(match, inputs);
  assert.equal(enemies(match)[0].name, BOSS_NAME);
  assert.equal(enemies(match)[0].primary, 'dual');

  // 저장값 검사: 모르는 무기·빠진 칸은 기본값, 예전 저장값(weapons 없음)도 기본값
  const fixed = normalizeStory({ waves: [{ weapons: ['laser'] }, { weapons: ['sniper'] }, {}, {}, {}, { weapons: ['rifle', 'sniper'] }] });
  assert.deepEqual(fixed.waves[0].weapons, ['rifle']);
  assert.deepEqual(fixed.waves[1].weapons, ['sniper', 'random']);
  assert.deepEqual(fixed.waves[5].weapons, ['rifle', 'sniper']);
  assert.deepEqual(fixed.waves[7].weapons, []);
});

test('계단 컷씬: 스미스 요원 컷씬 뒤 주인공이 옥상 계단실로 내려가고, 어두워진 동안 복도로 바뀌어 계단 문에서 나옴', () => {
  const { match, inputs } = coop();
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  const [P1, P2] = match.players;
  P2.hp = 0;
  step(match, inputs);
  while (match.phase === 'killcam') step(match, inputs);
  killAll(match, inputs);
  assert.equal(match.cutscene.kind, 'smith');
  while (match.cutscene?.kind === 'smith') step(match, inputs);
  const c = match.cutscene;
  assert.equal(c.kind, 'stairs');
  assert.equal(match.phase, 'cutscene');
  assert.equal(enemies(match).length, 0, '스미스 요원은 떨어졌다');
  assert.equal(c.heroes.length, 2, '2인 협동이면 둘 다(쓰러진 동료도 일어나) 내려감');
  assert.equal(checkpoint(match).wave, 4, '계단 컷씬 중 저장하면 복도 1웨이브');

  const events = [];
  let reachedDoor = false, fadedOut = false, stageWhileDark = null;
  while (match.phase === 'cutscene') {
    const ev = step(match, inputs);
    events.push(...ev);
    if (!c.switched && c.heroes.every((h) => Math.abs(h.x - ROOF_STAIRS.x) < 1 && h.alpha < 0.05)) reachedDoor = true;
    if (c.fade > 0.99) fadedOut = true;
    if (ev.some((e) => e.type === 'stage')) stageWhileDark = c.fade;
    assert.equal(match.story.stage === 'corridor', c.switched || !match.cutscene, '어두워진 뒤에야 복도');
  }
  assert.ok(reachedDoor, '옥상 계단실 문으로 걸어가 계단을 내려감');
  assert.ok(fadedOut);
  assert.ok(stageWhileDark > 0.99, '화면이 어두울 때 복도로 바뀜');
  assert.ok(c.t >= STAIRS_TIME);
  assert.ok(c.heroes[0].x > CORRIDOR_STAIRS.x && c.heroes[1].x > c.heroes[0].x, '복도 계단 문에서 나와 자리로');
  assert.equal(match.phase, 'countdown');
  assert.equal(match.story.stage, 'corridor');
  assert.deepEqual([P1.hp, P2.hp, P2.alive], [P1.maxHp, P2.maxHp, true], '체력 100% 회복, 동료도 일어남');
  assert.deepEqual([P1.x, P2.x], [c.heroes[0].x, c.heroes[1].x], '컷씬이 끝난 자리에서 시작');
  assert.equal(events.filter((e) => e.type === 'result').length, 0);
});

/* ───────── 건 카타 ───────── */
/** 스미스 요원을 쓰러뜨려 건 카타에 들어간 경기 */
function toKata(seed = 7, partner = false) {
  const { match, inputs } = partner ? coop(null, seed) : story(undefined, seed);
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  for (const p of enemies(match)) p.hp = 0;
  const events = step(match, inputs);
  return { match, inputs, events };
}
/** 다음 공격 경고(버튼이 빛남)가 나올 때까지 */
function untilWarn(match, inputs) {
  const events = [];
  for (let i = 0; i < 2000 && match.phase === 'gunkata' && !glowingKey(match.gunkata); i++) events.push(...step(match, inputs));
  return events;
}

test('건 카타: 스미스 요원을 쓰러뜨리면 건 카타, 공격 0.5초 전 버튼이 빛나고 맞는 버튼이면 대응, 10번이면 엔딩 컷씬', () => {
  const { match, inputs, events } = toKata();
  assert.equal(match.phase, 'gunkata');
  const k = match.gunkata;
  assert.equal(k.heroId, 'P1');
  assert.equal(enemies(match)[0].alive, false);
  assert.equal(match.projectiles.length, 0);
  assert.equal(checkpoint(match), null, '건 카타 중에는 저장 안 함');
  const hero = match.players[0];
  const hp = hero.hp;

  const seen = new Set();
  assert.equal(k.goal, GOAL.boss);
  for (let n = 1; n <= GOAL.boss; n++) {
    const warn = untilWarn(match, inputs);
    const key = glowingKey(k);
    assert.ok(KATA_KEYS.includes(key));
    assert.ok(warn.some((e) => e.type === 'kata-warn' && e.key === key));
    seen.add(key);
    // 빛나는 동안(0.5초 안) 기다렸다 눌러도 된다
    for (let t = 0; t < WARN_TIME - 0.1; t += TICK) step(match, inputs);
    assert.equal(glowingKey(k), key, '0.5초 동안 빛남');
    inputs.P1.kata = key;
    const ev = step(match, inputs);
    assert.ok(ev.some((e) => e.type === 'kata-counter' && e.key === key));
    assert.equal(k.done, n);
    assert.equal(glowingKey(k), null);
  }
  assert.equal(hero.hp, hp, '모두 대응하면 피해 없음');
  assert.ok(seen.size >= 2, '공격은 무작위');
  const rest = [];
  while (match.phase === 'gunkata') rest.push(...step(match, inputs));
  assert.ok(rest.some((e) => e.type === 'kata-clear'));
  assert.equal(match.phase, 'cutscene', '10번 대응하면 엔딩 컷씬');
  assert.equal(match.cutscene.kind, 'smith');
  assert.equal(match.gunkata, null);
  assert.ok(events.some((e) => e.type === 'gunkata'));
});

test('건 카타: 0.5초 안에 못 누르거나 다른 버튼을 누르면 체력 100이 깎이고 대응 횟수는 그대로, 체력이 다하면 패배', () => {
  const { match, inputs } = toKata();
  const k = match.gunkata;
  const hero = match.players[0];
  hero.hp = 350;

  untilWarn(match, inputs);
  let ev = [];
  for (let t = 0; t < WARN_TIME + TICK && k.attack.state === 'warn'; t += TICK) ev.push(...step(match, inputs));
  assert.ok(ev.some((e) => e.type === 'kata-hit' && e.damage === DAMAGE), '0.5초 지나면 맞음');
  assert.equal(hero.hp, 350 - DAMAGE);
  assert.equal(k.done, 0);

  untilWarn(match, inputs);
  inputs.P1.kata = (glowingKey(k) % 4) + 1; // 다른 버튼
  step(match, inputs);
  assert.equal(k.attack.state, 'hit', '틀린 버튼도 맞음');
  assert.equal(hero.hp, 350 - 2 * DAMAGE);

  // 빛나지 않을 때 누른 버튼은 무시
  untilWarn(match, inputs);
  inputs.P1.kata = glowingKey(k);
  step(match, inputs);
  assert.equal(k.done, 1);
  while (k.attack) step(match, inputs);
  inputs.P1.kata = 1;
  step(match, inputs);
  assert.equal(hero.hp, 350 - 2 * DAMAGE);

  // 두 번 더 맞으면 체력 0 → 패배
  for (let i = 0; i < 2; i++) {
    untilWarn(match, inputs);
    while (match.phase === 'gunkata' && glowingKey(k)) step(match, inputs);
  }
  assert.equal(hero.hp, 0);
  assert.equal(hero.alive, false);
  assert.equal(match.phase, 'result');
  assert.equal(match.winner, 'isb');
  assert.equal(match.stats.P1.taken >= 4 * DAMAGE, true);
});

test('건 카타 2인 협동: 쓰러뜨린 주인공이 하고, 그 주인공이 쓰러지면 동료가 이어받음', () => {
  const { match, inputs } = toKata(7, true);
  const k = match.gunkata;
  const [P1, P2] = match.players;
  P1.hp = DAMAGE;
  untilWarn(match, inputs);
  while (glowingKey(k)) step(match, inputs);
  assert.equal(P1.alive, false);
  assert.equal(match.phase, 'gunkata');
  assert.equal(k.heroId, 'P2', '동료가 이어받음');
  untilWarn(match, inputs);
  inputs.P2.kata = glowingKey(k);
  step(match, inputs);
  assert.equal(k.done, 1);
  assert.ok(P2.alive);
});

test('건 카타: 일반 요원을 쓰러뜨릴 때마다 3번 대응하는 건 카타, 끝나면 처치 컷씬(킬캠)', () => {
  const { match, inputs } = story();
  const [agent] = enemies(match);
  agent.hp = 0;
  const ev = step(match, inputs);
  assert.equal(match.phase, 'gunkata', '요원을 쓰러뜨리면 바로 건 카타');
  assert.ok(ev.some((e) => e.type === 'gunkata' && e.foeId === agent.id));
  const k = match.gunkata;
  assert.equal(k.foeId, agent.id);
  assert.equal(k.goal, GOAL.agent);
  assert.equal(k.boss, false);
  assert.equal(k.drone, false);
  assert.ok(!k.caption.includes('(AI)'), '이름 뒤 (AI)는 뺌');
  let counters = 0;
  while (match.phase === 'gunkata') {
    const key = glowingKey(k);
    if (key) inputs.P1.kata = key;
    if (step(match, inputs).some((e) => e.type === 'kata-counter')) counters++;
  }
  assert.equal(counters, GOAL.agent);
  assert.equal(match.phase, 'killcam', '건 카타 뒤 처치 컷씬');
  assert.equal(match.killcam.victimId, agent.id);
  assert.equal(match.killcam.waveEnd, true, '1웨이브 마지막 요원이라 무전 장면까지');
  assert.ok(match.killcam.shots.some((s) => s.mode === 'radio'));
});

test('건 카타: R-10을 쓰러뜨리면 드론과 10번 건 카타(공격 이름은 드론용), 끝나면 R-10 엔딩 컷씬', () => {
  const { match, inputs } = story();
  toCorridor(match, inputs);
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  runOut(match, inputs, ['killcam']);
  const r10 = enemies(match)[0];
  assert.equal(r10.name, R10_NAME);
  r10.hp = 0;
  step(match, inputs);
  assert.equal(match.phase, 'gunkata');
  const k = match.gunkata;
  assert.equal(k.drone, true);
  assert.equal(k.boss, true);
  assert.equal(k.goal, GOAL.boss);
  untilWarn(match, inputs);
  assert.ok(Object.values(DRONE_MOVES).some((m) => k.caption.includes(m.name)), k.caption);
  playKata(match, inputs);
  assert.equal(match.phase, 'cutscene');
  assert.equal(match.cutscene.kind, 'r10');
  assert.deepEqual(match.story.kataDone, [3, 7], '스미스 요원(옥상 중간보스)·R-10(복도 보스전) 웨이브');
});

/* ───────── AI 동료 ───────── */
function withAllies(n, seed = 7) {
  const match = createStoryMatch({ characterId: 'codename-x', weapon: 'rifle' }, undefined, seed, null, null, n);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  const inputs = createInputs(match.players);
  return { match, inputs };
}
const allies = (match) => match.players.filter((p) => p.team === 'earth' && p.ai);

test('AI 동료: 최대 3명, 지구방위팀 AI로 함께 싸우고 사람이 고른 캐릭터와 겹치지 않음', () => {
  assert.equal(MAX_ALLIES, 3);
  const { match } = withAllies(2);
  const team = allies(match);
  assert.deepEqual(team.map((p) => p.id), ['A1', 'A2']);
  for (const p of team) {
    assert.equal(p.team, 'earth');
    assert.equal(p.y, RAIL_Y.earth);
    assert.notEqual(p.characterId, 'codename-x', '사람이 고른 캐릭터와 겹치지 않음');
  }
  assert.equal(new Set(match.players.filter((p) => p.team === 'earth').map((p) => p.x)).size, 3, '서로 떨어져 섬');
  assert.equal(match.story.allyBrains.length, 2);
  assert.equal(match.story.allies, 2);
  // 그림 속 무기를 든다(피자럭스 돌격소총, 코드네임 V 쌍권총 …)
  assert.deepEqual(allyPicks(3, ['earth-pizza']).map((p) => [p.characterId, p.weapon]),
    [['codename-x', 'rifle'], ['codename-v', 'dual'], ['codename-r', 'sniper']]);
  assert.equal(allyPicks(9).length, 3, '3명까지');
  assert.equal(withAllies(0).match.players.filter((p) => p.team === 'earth').length, 1);
});

test('AI 동료 수만큼 일반 웨이브마다 쉬움 돌격소총 요원이 더 나오고, 보스전은 그대로', () => {
  const { match, inputs } = withAllies(2);
  // 옥상 1웨이브: 요원 1명 + 덤 2명
  let wave = enemies(match);
  assert.equal(wave.length, 3);
  assert.deepEqual(wave.slice(1).map((p) => p.primary), ['rifle', 'rifle']);
  const diff = (p) => match.story.brains.find((b) => b.playerId === p.id).diff.name;
  assert.deepEqual(wave.slice(1).map(diff), ['쉬움', '쉬움']);
  assert.equal(wave[1].maxHp, wave[0].maxHp, '체력은 그 웨이브 설정과 같음');
  assert.match(match.story.banner.sub, /요원 1명 \+ 쉬움 2명/);
  // 2웨이브(헬기 2명) → 4명
  killAll(match, inputs);
  untilFight(match, inputs);
  assert.equal(enemies(match).length, 4);
  // 3웨이브 → 5명, 중간보스는 스미스 요원 혼자
  killAll(match, inputs);
  untilFight(match, inputs);
  assert.equal(enemies(match).length, 5);
  killAll(match, inputs);
  untilFight(match, inputs);
  assert.equal(enemies(match).length, 1);
  assert.equal(enemies(match)[0].name, BOSS_NAME);
  assert.deepEqual(WAVES.map((_, i) => extraAgents(i, 2)), [2, 2, 2, 0, 2, 2, 2, 0]);
});

test('AI 동료: 적을 조준해 싸우고, 사람이 모두 쓰러지면 동료가 남아도 패배, 건 카타는 사람이 함', () => {
  const { match, inputs } = withAllies(1);
  const [P1, A1] = match.players;
  const brain = match.story.allyBrains[0];
  for (let t = 0; t < 1; t += TICK) { updateAI(brain, match, inputs); step(match, inputs); }
  assert.ok(inputs.A1.aim < 0, '동료는 위쪽(ISB) 적을 겨눔');

  // 동료가 요원을 쓰러뜨려도 건 카타는 사람 주인공이 한다
  const [agent] = enemies(match);
  match.stats[agent.id].killedBy = { ownerId: 'A1', weapon: 'rifle' };
  agent.hp = 0;
  step(match, inputs);
  assert.equal(match.phase, 'gunkata');
  assert.equal(match.gunkata.heroId, 'P1');
  playKata(match, inputs);

  const lose = withAllies(2);
  lose.match.players[0].hp = 0;
  step(lose.match, lose.inputs);
  assert.ok(allies(lose.match).every((p) => p.alive));
  assert.equal(lose.match.phase, 'result', '사람이 쓰러지면 패배');
  assert.equal(lose.match.winner, 'isb');
  assert.ok(A1);
});

test('AI 동료: 스테이지를 깨면 쓰러진 동료도 일어나 함께 계단으로, 저장·이어하기에 동료 수', () => {
  const { match, inputs } = withAllies(2);
  const [, A1] = match.players;
  A1.hp = 0;
  step(match, inputs);
  for (let w = 0; w < 3; w++) { killAll(match, inputs); untilFight(match, inputs); }
  killAll(match, inputs);
  while (match.cutscene?.kind === 'smith') step(match, inputs);
  assert.equal(match.cutscene.kind, 'stairs');
  assert.equal(match.cutscene.heroes.length, 3, '동료도 함께 계단으로');
  assert.equal(checkpoint(match).allies, 2);
  runOut(match, inputs, ['cutscene']);
  assert.equal(match.story.stage, 'corridor');
  assert.ok(A1.alive && A1.hp === A1.maxHp, '쓰러진 동료도 일어남');
  assert.ok(match.cutscene === null);

  const pick = { characterId: 'earth-arrow', weapon: 'dual', secondary: 'smg' };
  assert.equal(normalizeStorySave({ wave: 2, hp: 100, pick, allies: 2 }).allies, 2);
  assert.equal(normalizeStorySave({ wave: 2, hp: 100, pick, allies: 9 }).allies, 3);
  assert.equal('allies' in normalizeStorySave({ wave: 2, hp: 100, pick }), false);
  const resumed = createStoryMatch(pick, undefined, 3, { wave: 5, hp: 100, allies: 2 }, null, 2);
  assert.equal(allies(resumed).length, 2);
  assert.equal(resumed.story.stage, 'corridor');
});
