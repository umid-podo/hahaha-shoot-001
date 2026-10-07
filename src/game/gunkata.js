import { BOSS_NAME, R10_NAME, startCutscene, startKillcam } from './story.js';
import { createRng } from './state.js';
import { TICK } from './config.js';

/**
 * 건 카타 모드(스토리 모드). 요원을 쓰러뜨릴 때마다(스미스 요원·R-10 포함) 이 모드로 들어간다.
 * 화면이 옆에서 본 시점으로 바뀌어 주인공(왼쪽)과 쓰러뜨린 적(오른쪽)이 마주 보고, 조작은 1·2·3·4 버튼만 남는다.
 * 적이 무작위로 공격하는데, 공격하기 WARN_TIME(0.5초) 전부터 눌러야 할 버튼이 빛난다.
 * 빛나는 동안 맞는 버튼을 누르면 대응(주인공의 반격), 못 누르거나 다른 버튼을 누르면 체력 DAMAGE(100)가 깎인다.
 * 일반 요원은 GOAL.agent(3)번, 보스(스미스 요원·R-10)는 GOAL.boss(10)번 대응하면 끝나고 원래 장면으로 이어진다:
 *   일반 요원 → 처치 컷씬(킬캠: 마지막 한마디·웨이브 마무리 장면), 스미스 요원 → 엔딩 컷씬(발차기), R-10 → RPG 엔딩 컷씬.
 * 공격(요원·스미스 요원 / R-10):
 *   1 점프 사격 / 상공 레이저 → 몸을 숙여 피하며 위의 적을 쏴 떨어뜨림
 *   2 슬라이딩 사격 / 저공 돌진 → 공중제비를 돌며 적을 맞춤
 *   3 정면 권총 / 정면 레이저 → 총(레이저 포신)을 쳐내고 적에게 권총을 쏨
 *   4 단검 찌르기 / 프로펠러 돌진 → 단검으로 쳐냄
 * 체력이 0이 되면 패배(2인 협동이면 살아 있는 동료가 이어받는다).
 */
export const KATA_MOVES = {
  1: { id: 1, name: '점프 사격', counter: '숙여서 격추', hint: '숙이기' },
  2: { id: 2, name: '슬라이딩 사격', counter: '공중제비 사격', hint: '공중제비' },
  3: { id: 3, name: '정면 권총', counter: '권총 쳐내고 사격', hint: '쳐내기' },
  4: { id: 4, name: '단검 찌르기', counter: '단검으로 쳐냄', hint: '단검 막기' },
};
/** R-10(드론)의 공격 이름과 주인공의 대응(버튼은 같다) */
export const DRONE_MOVES = {
  1: { id: 1, name: '상공 레이저', counter: '숙여서 격추', hint: '숙이기' },
  2: { id: 2, name: '저공 돌진', counter: '공중제비 사격', hint: '공중제비' },
  3: { id: 3, name: '정면 레이저', counter: '포신 쳐내고 사격', hint: '쳐내기' },
  4: { id: 4, name: '프로펠러 돌진', counter: '단검으로 쳐냄', hint: '단검 막기' },
};
export const KATA_KEYS = [1, 2, 3, 4];
/** 끝내려면 대응해야 하는 횟수: 일반 요원 3번, 보스 10번 */
export const GOAL = { agent: 3, boss: 10 };
export const DAMAGE = 100;
export const WARN_TIME = 0.5;   // 버튼이 빛나는(눌러야 하는) 시간 = 공격까지 남은 시간
export const RESOLVE_TIME = 0.9; // 반격·피격 장면
export const INTRO_TIME = { agent: 1.3, boss: 2.2 };
export const OUTRO_TIME = { agent: 0.8, boss: 1.4 };
const GAP = [0.55, 1.1];        // 공격 사이 쉬는 시간

export const movesOf = (kata) => (kata?.drone ? DRONE_MOVES : KATA_MOVES);

/**
 * 보스를 쓰러뜨렸을 때 엔딩 컷씬 전에 건 카타로 들어가는지(이 웨이브의 보스와 아직 안 했을 때).
 * 스미스 요원과 R-10은 플레이어 id가 같아('BOSS') 웨이브 번호로 센다.
 */
export function needsGunKata(match) {
  const boss = match.story && match.players.find((p) => p.boss && !p.alive);
  return !!boss && !match.story.kataDone?.includes(match.story.wave);
}

/** 화면에 쓸 적 이름(일반 요원 이름 뒤의 ' (AI)'는 뺀다) */
export const foeName = (foe) => foe.name.replace(/ \(AI\)$/, '');

/** 적 foe와의 첫 대사 */
function introLine(foe) {
  if (foe.characterId === 'r10') return `${R10_NAME}: 삐빅! 근접 전투 모드 가동!`;
  if (foe.name === BOSS_NAME) return `${BOSS_NAME}: 총알로는 안 끝난다… 건 카타로 붙자!`;
  return `${foeName(foe)}: 아직 안 끝났어! 덤벼라!`;
}

/**
 * 쓰러뜨린 적 foe와 건 카타를 시작한다. 주인공은 foe를 쓰러뜨린 쪽(없으면 살아 있는 주인공).
 * after: 끝나면 이어질 장면 — { kind: 'killcam', waveEnd }(일반 요원) 또는 { kind: 'cutscene' }(보스).
 * 경고음·전환 효과음 이벤트를 events에 넣는다.
 */
export function startGunKata(match, foe, after, events = [], seed = match.tick) {
  const killer = match.stats?.[foe.id]?.killedBy?.ownerId;
  const alive = match.players.filter((p) => p.team === 'earth' && p.alive && !p.ai); // 버튼을 누르는 사람 주인공만
  const hero = alive.find((p) => p.id === killer) ?? alive[0];
  const size = foe.boss ? 'boss' : 'agent';
  match.phase = 'gunkata';
  match.projectiles = [];
  match.jet = null;
  if (match.story) { match.story.banner = null; match.story.carrier = null; }
  match.gunkata = {
    t: 0, heroId: hero.id, foeId: foe.id, boss: !!foe.boss, drone: foe.characterId === 'r10',
    goal: GOAL[size], intro: INTRO_TIME[size], outro: OUTRO_TIME[size], after,
    done: 0, misses: 0, attack: null, last: [], gap: INTRO_TIME[size],
    rng: createRng(((seed * 2654435761) >>> 0) ^ (0x6a7a + foe.id.length * 977 + match.nextProjectileId)),
    finish: null, takeover: null, caption: introLine(foe),
  };
  events.push({ type: 'alarm', boss: !!foe.boss }, { type: 'gunkata', foeId: foe.id });
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

/** 건 카타가 끝나면: 일반 요원은 처치 컷씬(킬캠), 보스는 엔딩 컷씬 */
function finishKata(match, foe) {
  const { after } = match.gunkata;
  match.gunkata = null;
  if (after?.kind === 'killcam') {
    startKillcam(match, foe, after.waveEnd);
    return;
  }
  match.story.kataDone = [...(match.story.kataDone ?? []), match.story.wave];
  startCutscene(match);
}

/** 건 카타 한 틱(step()이 phase 'gunkata'일 때 부른다). */
export function updateGunKata(match, inputs, dt, events) {
  const k = match.gunkata;
  k.t += dt;
  const press = takePress(inputs);
  const hero = match.players.find((p) => p.id === k.heroId);
  const foe = match.players.find((p) => p.id === k.foeId);
  const moves = movesOf(k);

  // 다 대응했으면 잠깐 마무리 뒤 다음 장면
  if (k.finish !== null) {
    k.finish += dt;
    if (k.finish >= k.outro) finishKata(match, foe);
    return;
  }

  const a = k.attack;
  if (!a) {
    k.gap -= dt;
    if (k.t >= k.intro * 0.6 && k.t < k.intro) k.caption = '빛나는 버튼을 눌러 반격하라! (1·2·3·4)';
    if (k.gap > 0) return;
    k.attack = { kind: nextKind(k), state: 'warn', t: 0, press: 0 };
    k.caption = `${foeName(foe)}의 ${moves[k.attack.kind].name}!`;
    events.push({ type: 'kata-warn', key: k.attack.kind });
    return;
  }
  a.t += dt;
  if (a.state === 'warn') {
    if (press && press === a.kind) {
      // 대응 성공: 주인공의 반격
      Object.assign(a, { state: 'counter', t: 0, press });
      k.done++;
      k.caption = `${moves[a.kind].counter}! (${k.done}/${k.goal})`;
      events.push({ type: 'kata-counter', key: a.kind, done: k.done });
      events.push(a.kind === 4 ? { type: 'kick', x: 0, y: 0 } : { type: 'fire', playerId: hero.id, weapon: 'pistol' });
      return;
    }
    if (press || a.t >= WARN_TIME - 1e-9) {
      // 못 눌렀거나 다른 버튼: 적의 공격이 맞는다
      Object.assign(a, { state: 'hit', t: 0, press, wrong: !!press });
      k.misses++;
      hero.hp = Math.max(0, hero.hp - DAMAGE);
      hero.hurt = 0.3;
      const stats = match.stats?.[hero.id];
      if (stats) {
        stats.taken += DAMAGE;
        stats.takenFrom[foe.id] = (stats.takenFrom[foe.id] ?? 0) + DAMAGE;
      }
      k.caption = press ? `틀린 버튼! -${DAMAGE}` : `늦었다! -${DAMAGE}`;
      const weapon = k.drone ? 'laser' : 'pistol';
      events.push(a.kind === 4 ? { type: 'kick', x: 0, y: 0 } : { type: 'fire', playerId: foe.id, weapon });
      events.push({ type: 'kata-hit', key: a.kind, damage: DAMAGE });
      if (hero.hp <= 0) heroDown(match, k, hero, foe, events);
    }
    return;
  }
  // 반격·피격 장면이 끝나면 다음 공격
  if (a.t >= RESOLVE_TIME) {
    k.attack = null;
    k.gap = GAP[0] + k.rng() * (GAP[1] - GAP[0]);
    if (k.done >= k.goal) {
      k.finish = 0;
      k.caption = k.boss ? `건 카타 완료! ${foeName(foe)}이 비틀거린다!` : `건 카타 완료! ${foeName(foe)} 쓰러짐!`;
      events.push({ type: 'kata-clear' });
    }
  }
}

/** 건 카타 중 주인공이 쓰러짐: 동료가 살아 있으면 이어받고, 없으면 패배 */
function heroDown(match, k, hero, foe, events) {
  hero.alive = false;
  const stats = match.stats?.[hero.id];
  if (stats) {
    stats.killedBy ??= { ownerId: foe.id, weapon: k.drone ? 'laser' : 'pistol' };
    stats.downAt = match.tick * TICK;
  }
  events.push({ type: 'down', playerId: hero.id, x: hero.x, y: hero.y });
  const partner = match.players.find((p) => p.team === 'earth' && p.alive && !p.ai);
  if (partner) {
    k.heroId = partner.id;
    k.takeover = partner.id;
    k.caption = `${hero.id}가 쓰러졌다! ${partner.id}가 이어받는다!`;
    return;
  }
  k.attack = null;
  match.phase = 'result';
  match.winner = 'isb';
  events.push({ type: 'result', winner: 'isb' });
}
