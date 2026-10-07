import { WAVES, BOSS_NAME, startCutscene } from './story.js';
import { createRng } from './state.js';
import { TICK } from './config.js';

/**
 * 건 카타 모드(스토리 모드 옥상 중간보스). 스미스 요원을 쓰러뜨리면 엔딩 컷씬 대신 이 모드로 들어간다.
 * 화면이 옆에서 본 시점으로 바뀌어 주인공(왼쪽)과 스미스 요원(오른쪽)이 마주 보고, 조작은 1·2·3·4 버튼만 남는다.
 * 스미스 요원이 무작위로 공격하는데, 공격하기 WARN_TIME(0.5초) 전부터 눌러야 할 버튼이 빛난다.
 * 빛나는 동안 맞는 버튼을 누르면 대응(주인공의 반격), 못 누르거나 다른 버튼을 누르면 체력 DAMAGE(100)가 깎인다.
 * GOAL(10)번 대응하면 건 카타가 끝나고 스미스 요원 엔딩 컷씬(발차기로 건물 밖으로)이 나온다.
 *   1 점프 사격: 스미스 요원이 뛰어올라 쏜다 → 주인공이 몸을 숙여 피하며 공중의 스미스 요원을 쏴 떨어뜨림
 *   2 슬라이딩 사격: 미끄러져 들어오며 쏜다 → 주인공이 공중제비를 돌며 스미스 요원을 맞춤
 *   3 정면 권총: 정면에서 권총을 겨눈다 → 주인공이 권총을 쳐내고 스미스 요원에게 권총을 쏨
 *   4 단검 찌르기: 단검으로 찌르려 달려든다 → 주인공이 단검으로 쳐냄
 * 체력이 0이 되면 패배(2인 협동이면 살아 있는 동료가 이어받는다).
 */
export const KATA_MOVES = {
  1: { id: 1, name: '점프 사격', counter: '숙여서 격추', hint: '숙이기' },
  2: { id: 2, name: '슬라이딩 사격', counter: '공중제비 사격', hint: '공중제비' },
  3: { id: 3, name: '정면 권총', counter: '권총 쳐내고 사격', hint: '쳐내기' },
  4: { id: 4, name: '단검 찌르기', counter: '단검으로 쳐냄', hint: '단검 막기' },
};
export const KATA_KEYS = [1, 2, 3, 4];
export const GOAL = 10;
export const DAMAGE = 100;
export const WARN_TIME = 0.5;   // 버튼이 빛나는(눌러야 하는) 시간 = 공격까지 남은 시간
export const RESOLVE_TIME = 0.9; // 반격·피격 장면
export const INTRO_TIME = 2.2;
export const OUTRO_TIME = 1.4;
const GAP = [0.55, 1.1];        // 공격 사이 쉬는 시간

/** 스미스 요원을 쓰러뜨렸을 때 엔딩 컷씬 대신 건 카타로 들어가는지(옥상 중간보스, 아직 안 했을 때) */
export function needsGunKata(match) {
  return !!match.story && WAVES[match.story.wave].boss === 'smith' && !match.story.gunkataDone;
}

/** 건 카타 시작. hero는 스미스 요원을 쓰러뜨린 주인공(없으면 살아 있는 주인공). 경고음·전환 효과음 이벤트를 events에 넣는다. */
export function startGunKata(match, events = [], seed = match.tick) {
  const boss = match.players.find((p) => p.boss);
  const killer = match.stats?.[boss.id]?.killedBy?.ownerId;
  const alive = match.players.filter((p) => p.team === 'earth' && p.alive);
  const hero = alive.find((p) => p.id === killer) ?? alive[0];
  match.phase = 'gunkata';
  match.projectiles = [];
  match.jet = null;
  if (match.story) { match.story.banner = null; match.story.carrier = null; }
  match.gunkata = {
    t: 0, heroId: hero.id, bossId: boss.id, done: 0, misses: 0, attack: null, last: [],
    gap: INTRO_TIME, rng: createRng((seed * 2654435761) >>> 0 ^ 0x6a7a),
    finish: null, takeover: null, caption: `${BOSS_NAME}: 총알로는 안 끝난다… 건 카타로 붙자!`,
  };
  events.push({ type: 'alarm', boss: true }, { type: 'gunkata' });
}

/** 지금 빛나는(눌러야 하는) 버튼. 없으면 null. */
export function glowingKey(kata) {
  return kata?.attack?.state === 'warn' ? kata.attack.kind : null;
}

/** 다음 공격 종류: 같은 공격이 세 번 이어지지 않게 무작위 */
function nextKind(kata) {
  let kind;
  do kind = KATA_KEYS[Math.floor(kata.rng() * KATA_KEYS.length) % KATA_KEYS.length];
  while (kata.last.length >= 2 && kata.last.every((k) => k === kind));
  kata.last = [...kata.last, kind].slice(-2);
  return kind;
}

/** 이번 틱에 누른 1~4 버튼(사람 플레이어 입력 칸의 kata). 읽으면 비운다. */
function takePress(inputs) {
  let press = 0;
  for (const frame of Object.values(inputs)) {
    if (frame.kata) press ||= frame.kata;
    frame.kata = 0;
  }
  return press;
}

/** 건 카타 한 틱(step()이 phase 'gunkata'일 때 부른다). */
export function updateGunKata(match, inputs, dt, events) {
  const k = match.gunkata;
  k.t += dt;
  const press = takePress(inputs);
  const hero = match.players.find((p) => p.id === k.heroId);
  const boss = match.players.find((p) => p.id === k.bossId);

  // 10번 대응: 잠깐 마무리 뒤 엔딩 컷씬
  if (k.finish !== null) {
    k.finish += dt;
    if (k.finish >= OUTRO_TIME) {
      match.gunkata = null;
      match.story.gunkataDone = true;
      startCutscene(match);
    }
    return;
  }

  const a = k.attack;
  if (!a) {
    k.gap -= dt;
    if (k.t >= INTRO_TIME * 0.6 && k.t < INTRO_TIME) k.caption = '빛나는 버튼을 눌러 반격하라! (1·2·3·4)';
    if (k.gap > 0) return;
    k.attack = { kind: nextKind(k), state: 'warn', t: 0, press: 0 };
    k.caption = `${BOSS_NAME}의 ${KATA_MOVES[k.attack.kind].name}!`;
    events.push({ type: 'kata-warn', key: k.attack.kind });
    return;
  }
  a.t += dt;
  if (a.state === 'warn') {
    if (press && press === a.kind) {
      // 대응 성공: 주인공의 반격
      Object.assign(a, { state: 'counter', t: 0, press });
      k.done++;
      k.caption = `${KATA_MOVES[a.kind].counter}! (${k.done}/${GOAL})`;
      events.push({ type: 'kata-counter', key: a.kind, done: k.done });
      events.push(a.kind === 4 ? { type: 'kick', x: 0, y: 0 } : { type: 'fire', playerId: hero.id, weapon: 'pistol' });
      return;
    }
    if (press || a.t >= WARN_TIME - 1e-9) {
      // 못 눌렀거나 다른 버튼: 스미스 요원의 공격이 맞는다
      Object.assign(a, { state: 'hit', t: 0, press, wrong: !!press });
      k.misses++;
      hero.hp = Math.max(0, hero.hp - DAMAGE);
      hero.hurt = 0.3;
      const stats = match.stats?.[hero.id];
      if (stats) {
        stats.taken += DAMAGE;
        stats.takenFrom[boss.id] = (stats.takenFrom[boss.id] ?? 0) + DAMAGE;
      }
      k.caption = press ? `틀린 버튼! -${DAMAGE}` : `늦었다! -${DAMAGE}`;
      events.push(a.kind === 4 ? { type: 'kick', x: 0, y: 0 } : { type: 'fire', playerId: boss.id, weapon: 'pistol' });
      events.push({ type: 'kata-hit', key: a.kind, damage: DAMAGE });
      if (hero.hp <= 0) heroDown(match, k, hero, boss, events);
    }
    return;
  }
  // 반격·피격 장면이 끝나면 다음 공격
  if (a.t >= RESOLVE_TIME) {
    k.attack = null;
    k.gap = GAP[0] + k.rng() * (GAP[1] - GAP[0]);
    if (k.done >= GOAL) {
      k.finish = 0;
      k.caption = `건 카타 완료! ${BOSS_NAME}이 비틀거린다!`;
      events.push({ type: 'kata-clear' });
    }
  }
}

/** 건 카타 중 주인공이 쓰러짐: 동료가 살아 있으면 이어받고, 없으면 패배 */
function heroDown(match, k, hero, boss, events) {
  hero.alive = false;
  const stats = match.stats?.[hero.id];
  if (stats) {
    stats.killedBy ??= { ownerId: boss.id, weapon: 'pistol' };
    stats.downAt = match.tick * TICK;
  }
  events.push({ type: 'down', playerId: hero.id, x: hero.x, y: hero.y });
  const partner = match.players.find((p) => p.team === 'earth' && p.alive);
  if (partner) {
    k.heroId = partner.id;
    k.takeover = partner.id;
    k.caption = `${hero.id}가 쓰러졌다! ${partner.id}가 이어받는다!`;
    return;
  }
  match.gunkata.attack = null;
  match.phase = 'result';
  match.winner = 'isb';
  events.push({ type: 'result', winner: 'isb' });
}
