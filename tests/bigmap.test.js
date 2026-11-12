// 거대한 경기장(모든 스테이지 넓이 10배)·꾹 누르는 점프·위아래 시선·구조물 관통 금지·탄속 3배·이동 속도 4배
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, createInputs } from '../src/game/state.js';
import { step, spawnProjectile, updateJump } from '../src/game/update.js';
import { createStoryMatch } from '../src/game/story.js';
import { applyMap, buildExtras, BIG_FIELD, STAGE_FIELD, HALL_CEILING, MAP_IDS } from '../src/game/maps.js';
import { groundAt, structureHit } from '../src/game/terrain.js';
import { TICK, JUMP, WEAPONS, SHOT_HEIGHT, ARENA_WIDTH, ARENA_HEIGHT, FIELD, MAX_SPEED, PITCH } from '../src/game/config.js';
import { applyView } from '../src/input/view.js';

function playing(opts = { wide: true }) {
  const match = createMatch({ P1: { weapon: 'pistol' }, P2: { weapon: 'pistol' } }, 1, opts);
  match.phase = 'playing';
  match.jetTimer = Infinity;
  const inputs = createInputs(match.players);
  const [P1, P2] = match.players;
  return { match, inputs, P1, P2 };
}
const area = (b) => (b.maxX - b.minX) * (b.maxY - b.minY);

/** 땅에서 뛰어 최고 높이·내려선 곳까지의 가로 거리 */
function jumpWith(holdSeconds, move = 0) {
  const { match, inputs, P1 } = playing();
  match.highs = []; match.covers = []; match.pads = [];
  P1.x = P1.previousX = 800; P1.y = P1.previousY = 500;
  inputs.P1.jump = true;
  let peak = 0, t = 0;
  const x0 = P1.x;
  do {
    inputs.P1.jumpHeld = t < holdSeconds;
    inputs.P1.moveAxis = move;
    step(match, inputs);
    peak = Math.max(peak, P1.z);
    t += TICK;
  } while ((P1.z > 0 || t < 0.1) && t < 6);
  return { peak, dist: P1.x - x0 };
}

test('점프: 살짝 누르면 원래처럼 약 120, 꾹 누를수록 훨씬 높이·멀리 뛴다', () => {
  const tap = jumpWith(0);
  assert.ok(Math.abs(tap.peak - JUMP.jump ** 2 / (2 * JUMP.gravity)) < 8, `살짝: ${tap.peak}`);
  const half = jumpWith(JUMP.holdTime / 2);
  const full = jumpWith(5);
  assert.ok(half.peak > tap.peak * 2 && full.peak > half.peak, `반쯤 ${half.peak}, 끝까지 ${full.peak}`);
  assert.ok(full.peak > 800, `꾹 누르면 매우 높이 ${full.peak}`);
  // 멀리: 같은 쪽으로 걸으며 뛰면 꾹 누른 점프가 훨씬 멀리 간다(공중에 오래 떠 있고 공중에서 더 빠름)
  const tapFar = jumpWith(0, 1), fullFar = jumpWith(5, 1);
  assert.ok(fullFar.dist > tapFar.dist * 3, `거리 ${tapFar.dist.toFixed(0)} → ${fullFar.dist.toFixed(0)}`);
  // 공중에서 다시 누른다고 더 오르지 않는다(땅에서 뛸 때만 모음)
  const { match, P1 } = playing();
  match.highs = [];
  P1.z = 200; P1.vz = -10;
  updateJump(match, P1, true, TICK, [], true);
  assert.ok(P1.vz < 0, '공중에서는 새로 뛰지 못함');
});

test('이동 속도: 플레이어·요원 모두 원래의 4배(초당 1200)', () => {
  const { match, inputs, P1, P2 } = playing();
  assert.equal(P1.speed, 1200);
  assert.equal(P2.speed, 1200);
  assert.equal(MAX_SPEED, 1200);
  match.highs = []; match.covers = [];
  P1.x = P1.previousX = 0; P1.y = 500;
  inputs.P1.moveAxis = -1;
  for (let i = 0; i < 30; i++) step(match, inputs);
  assert.ok(Math.abs(P1.x + 600) < 2, `0.5초에 600: ${P1.x}`);
  const s = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, undefined, 1);
  assert.ok(s.players.filter((p) => p.team === 'isb').every((p) => p.speed === 1200), '스토리 요원도 4배');
});

test('탄속: 모든 총기가 원래 표의 3배(던지는 무기는 그대로)', () => {
  assert.equal(WEAPONS.rifle.speed, 760 * 3);
  assert.equal(WEAPONS.pistol.speed, 720 * 3);
  assert.equal(WEAPONS.sniper.speed, 1600 * 3);
  assert.equal(WEAPONS.energyrifle.speed, 2400 * 3);
  assert.equal(WEAPONS.lightning.speed, 1300 * 3);
  assert.equal(WEAPONS.grenade.speed, 700, '수류탄은 던지는 무기');
  // 화염방사기는 사거리가 그대로 짧다
  assert.ok(Math.abs(WEAPONS.flamethrower.speed * WEAPONS.flamethrower.flame.life - 650 * 0.45) < 1);
});

test('모든 스테이지 넓이 10배: 2인 대결(넓은 옥상·고공 요새)과 스토리 모든 스테이지', () => {
  assert.ok(Math.abs(area(BIG_FIELD) / area(FIELD) - 10) < 0.2);
  assert.ok(Math.abs(area(STAGE_FIELD) / (ARENA_WIDTH * ARENA_HEIGHT) - 10) < 0.2);
  for (const map of ['wide', 'fortress']) assert.deepEqual(playing({ wide: true, map }).match.bounds, BIG_FIELD, map);
  const pick = { characterId: 'earth-arrow', weapon: 'rifle' };
  const roof = createStoryMatch(pick, undefined, 1);
  assert.deepEqual(roof.bounds, BIG_FIELD, '옥상');
  for (const [wave, map] of [[4, 'corridor'], [8, 'sky'], [12, 'road'], [16, 'bridge']]) {
    const m = createStoryMatch(pick, undefined, 1, { wave, hp: 500, skip: true });
    assert.equal(m.map, map);
    assert.deepEqual(m.bounds, STAGE_FIELD, map);
    assert.ok(m.wide);
  }
});

test('거대한 고지대·건축물·점프 패드·고저차가 스테이지마다(점대칭, 늘 같은 배치)', () => {
  for (const id of MAP_IDS) {
    const e = buildExtras(id);
    assert.equal(buildExtras(id), e, '같은 배치');
    if (id === 'sky') { assert.ok(e.covers.length > 0 && e.highs.length === 0, '하늘은 방공 기구만'); continue; }
    assert.ok(e.highs.length >= 20, `${id}: 건축물 ${e.highs.length}`);
    assert.ok(e.pads.length >= 2, `${id}: 점프 패드 ${e.pads.length}`);
    assert.ok(Math.max(...e.highs.map((h) => h.height)) >= 500, `${id}: 거대한 고지대`);
    assert.ok(new Set(e.highs.map((h) => h.height)).size >= 6, `${id}: 다양한 높낮이`);
    assert.ok(e.highs.some((h) => h.bridge) && e.highs.some((h) => h.ramp), `${id}: 다리·오르막길`);
    // 점대칭: 모든 건축물에 짝이 있다
    for (const h of e.highs) assert.ok(e.highs.some((g) => g.x === ARENA_WIDTH - h.x && g.y === ARENA_HEIGHT - h.y && g.height === h.height), h.id);
  }
  // 점프 패드는 그 패드 근처 건물 꼭대기보다 높이 띄운다
  const { match } = playing({ wide: true, map: 'wide' });
  for (const pad of match.pads.filter((p) => p.id.includes('-p'))) {
    assert.ok(pad.power ** 2 / (2 * JUMP.gravity) > 300, pad.id);
    assert.equal(groundAt(match, pad.x, pad.y, 0), pad.h ?? 0, `${pad.id}는 바닥에`);
  }
});

test('탄은 어떤 구조물도 뚫지 못한다: 건물 벽·다리 상판·천장·바닥', () => {
  const { match, inputs, P1, P2 } = playing();
  match.covers = [];
  const wall = { id: 'w', x: 0, y: 0, w: 200, h: 200, height: 600, kind: 'tower' };
  match.highs = [wall];
  P1.x = -400; P1.y = 0; P2.x = 400; P2.y = 0; P1.z = P2.z = 0;
  inputs.P1.aim = 0; inputs.P1.aiming = true;
  const ev = [];
  for (let i = 0; i < 60; i++) ev.push(...step(match, inputs));
  assert.equal(P2.hp, P2.maxHp, '건물 뒤 상대는 맞지 않음');
  assert.ok(ev.some((e) => e.type === 'block' && Math.abs(e.x - -100) < 10), '벽에서 막힘');
  // 건물보다 높은 곳(지붕 위)에서는 넘어간다
  P1.z = 600; P2.z = 600;
  P1.vz = P2.vz = 0;
  match.highs = [wall, { id: 'a', x: -400, y: 0, w: 120, h: 120, height: 600 }, { id: 'b', x: 400, y: 0, w: 120, h: 120, height: 600 }];
  for (let i = 0; i < 60; i++) step(match, inputs);
  assert.ok(P2.hp < P2.maxHp, '지붕 위끼리는 맞음');
  // 다리 상판 밑으로는 지나가지만 상판은 뚫지 못한다
  const bridge = { id: 'br', x: 0, y: 0, w: 300, h: 300, height: 300, bridge: true };
  const m2 = { highs: [bridge] };
  assert.equal(structureHit(m2, -200, 0, 84, 200, 0, 84), null, '다리 밑 통과');
  assert.ok(structureHit(m2, 0, 0, 84, 0, 10, 600), '아래에서 위로 쏘면 상판에 막힘');
  // 천장(복도 홀)과 바닥
  assert.ok(structureHit({ highs: [], ceiling: 1000 }, 0, 0, 900, 10, 0, 1100)?.kind === 'ceiling');
  assert.ok(structureHit({ highs: [] }, 0, 0, 50, 10, 0, -10)?.kind === 'floor');
});

test('복도(본부 홀)는 천장이 높고 뛰어도 천장을 뚫지 못한다', () => {
  const m = createStoryMatch({ characterId: 'earth-arrow', weapon: 'rifle' }, undefined, 1, { wave: 4, hp: 500, skip: true });
  assert.equal(m.ceiling, HALL_CEILING);
  const [P1] = m.players;
  P1.z = HALL_CEILING - 300; P1.vz = 3000;
  for (let i = 0; i < 20; i++) updateJump(m, P1, false, TICK, []);
  assert.ok(P1.z + 190 <= HALL_CEILING + 1, `머리가 천장 아래 ${P1.z}`);
  // 엘리베이터 탑·포탑 기둥은 천장까지 닿는 벽
  assert.ok(m.highs.some((h) => h.id === 'core-elevator' && h.height === HALL_CEILING));
});

test('위아래 시선: 마우스·키로 고개를 들고 숙이며(최대 PITCH.max), 탄도 그 각도로 날아간다', () => {
  const { match, inputs, P1 } = playing();
  match.highs = []; match.covers = [];
  inputs.P1.mousePitch = 0.5;
  applyView(inputs, [P1], TICK);
  assert.ok(Math.abs(inputs.P1.pitch - 0.5) < 1e-9);
  inputs.P1.look = 1;
  for (let i = 0; i < 200; i++) applyView(inputs, [P1], TICK);
  assert.equal(inputs.P1.pitch, PITCH.max, '위 끝까지');
  inputs.P1.look = -1;
  for (let i = 0; i < 400; i++) applyView(inputs, [P1], TICK);
  assert.equal(inputs.P1.pitch, -PITCH.max, '아래 끝까지');
  inputs.P1.look = 0;
  inputs.P1.pitch = 0.4;
  step(match, inputs);
  const b = spawnProjectile(match, P1, P1.aim);
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  assert.ok(Math.abs(speed - WEAPONS.pistol.speed) < 1e-6, '빠르기는 그대로');
  assert.ok(Math.abs(Math.atan2(b.vz, Math.hypot(b.vx, b.vy)) - 0.4) < 1e-9, '고개 든 각도로');
});

test('AI는 높은 구조물에 막히면 점프키를 꾹 눌러 높이 뛴다', async () => {
  const { createAI, updateAI } = await import('../src/game/ai.js');
  const match = createMatch({ P1: { weapon: 'rifle' }, P2: { characterId: 'isb-agent-1', weapon: 'rifle', ai: true } }, 3, { wide: true });
  match.phase = 'playing'; match.jetTimer = Infinity;
  const inputs = createInputs(match.players);
  const [P1, P2] = match.players;
  match.covers = []; match.pads = [];
  // 상대와 나 사이를 거대한 벽이 가로막는다(높이 400, 꾹 눌러야 넘음)
  match.highs = [{ id: 'wall', x: 800, y: 500, w: 3000, h: 200, height: 400, kind: 'tower' }];
  P1.x = 800; P1.y = 1100; P2.x = 800; P2.y = -100;
  const brain = createAI('P2', 'hard', 3);
  let peak = 0;
  for (let i = 0; i < 60 * 8; i++) {
    updateAI(brain, match, inputs);
    step(match, inputs);
    peak = Math.max(peak, P2.z);
  }
  assert.ok(peak > 300, `높이 뛰어오름 ${peak.toFixed(0)}`);
});
