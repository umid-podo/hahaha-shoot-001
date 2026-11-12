import { defaultStory, normalizeStory, normalizeStorySave, normalizeAllyPicks, STAGE_ORDER } from '../game/story.js';
import { accountKey } from '../game/mods.js';
import { ACCOUNTS, normalizeRank, defaultRank } from '../game/rank.js';

// ── 계정(1~4) ──
// 지금 플레이하는 계정. 랭크·스토리 저장(·배낭·코인은 mods.js)은 계정마다 따로 저장한다.
let account = 1;
const ACCOUNT_KEY = 'haha2.account.v1';
export const currentAccount = () => account;
/** 이 계정으로 바꾼다(저장 이름이 그 계정 것으로 바뀜). 마지막에 고른 계정은 다음 실행 때 미리 골라 둔다 */
export function useAccount(n) {
  account = ACCOUNTS.includes(n) ? n : 1;
  try { localStorage.setItem(ACCOUNT_KEY, String(account)); } catch { /* 저장 불가 환경은 무시 */ }
  return account;
}
/** 마지막에 플레이한 계정(없으면 1) */
export function lastAccount() {
  try {
    const n = Number(localStorage.getItem(ACCOUNT_KEY));
    return ACCOUNTS.includes(n) ? n : 1;
  } catch {
    return 1;
  }
}

const RANK_KEY = 'haha2.rank.v1';
/** 계정의 랭크 { tier, level, wins }(없으면 초보 등급 1레벨) */
export function loadRank(n = account) {
  try {
    const saved = JSON.parse(localStorage.getItem(accountKey(RANK_KEY, n)));
    return saved ? normalizeRank(saved) : defaultRank();
  } catch {
    return defaultRank();
  }
}
export function saveRank(rank, n = account) {
  try { localStorage.setItem(accountKey(RANK_KEY, n), JSON.stringify(normalizeRank(rank))); } catch { /* 저장 불가 환경은 무시 */ }
}

const KEY = 'haha2.settings.v1';

/** JSON 파싱 실패·저장 불가 시 기본값으로 실행한다. */
export function loadSettings() {
  const defaults = {
    muted: false,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 저장 불가 환경은 무시 */ }
}

const BALANCE_KEY = 'haha2.balance.v1';

/** 밸런스 메뉴에서 바꾼 값 { 수치 id: 값 }. 없거나 읽을 수 없으면 빈 객체. */
export function loadBalance() {
  try {
    return JSON.parse(localStorage.getItem(BALANCE_KEY)) ?? {};
  } catch {
    return {};
  }
}

const BALANCE_DEFAULTS_KEY = 'haha2.balancedefaults.v1';

/** 밸런스 메뉴의 '내 기본값' { 수치 id: 값 }. 없거나 읽을 수 없으면 빈 객체. */
export function loadBalanceDefaults() {
  try {
    return JSON.parse(localStorage.getItem(BALANCE_DEFAULTS_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveBalanceDefaults(values) {
  try {
    if (values) localStorage.setItem(BALANCE_DEFAULTS_KEY, JSON.stringify(values));
    else localStorage.removeItem(BALANCE_DEFAULTS_KEY);
  } catch { /* 저장 불가 환경은 무시 */ }
}

export function saveBalance(values) {
  try {
    if (Object.keys(values).length) localStorage.setItem(BALANCE_KEY, JSON.stringify(values));
    else localStorage.removeItem(BALANCE_KEY);
  } catch { /* 저장 불가 환경은 무시 */ }
}

const SINGLE_KEY = 'haha2.single.v1';

/**
 * 싱글플레이 설정. aiDamage의 null은 '무기 기본 피해'를 뜻한다.
 * aiBulletSpeed는 탄속 배율(%), aiRadius는 AI 히트박스(몸 판정) 반지름이다.
 */
export function defaultSingle() {
  return {
    // mode: 'free'(자유 대전, AI 1명) 또는 'story'(스토리 모드, 웨이브)
    mode: 'free',
    // storyPlayers: 스토리 모드 인원. 1(혼자) 또는 2(2인 협동, P2도 지구방위팀)
    storyPlayers: 1,
    // storyAllies: 스토리 모드에 데려갈 AI 동료 수(0~3). 1명마다 일반 웨이브에 쉬움 돌격소총 요원 1명 추가
    storyAllies: 0,
    // storyAllyPicks: 동료 칸마다 직접 고른 { characterId, weapon }(MAX_ALLIES칸)
    storyAllyPicks: normalizeAllyPicks(),
    // storyStart: 스토리 모드를 시작할 스테이지('rooftop' 옥상·'corridor' 복도·'sky' 하늘). 건너뛴 스테이지는 체력 가득으로 시작
    storyStart: 'rooftop',
    // endlessMap: 연속 플레이 스테이지(story.js ENDLESS_MAPS의 id)
    endlessMap: 'fortress',
    aiWeapon: 'pistol', aiSecondary: 'smg', difficulty: 'normal', aiHp: 500, aiBulletSpeed: 100, aiRadius: 30,
    aiDamage: { primary: null, secondary: null, grenade: null },
  };
}

export function loadSingle() {
  const defaults = defaultSingle();
  try {
    const saved = JSON.parse(localStorage.getItem(SINGLE_KEY)) ?? {};
    const single = { ...defaults, ...saved, aiDamage: { ...defaults.aiDamage, ...saved.aiDamage } };
    if (single.storyPlayers !== 2) single.storyPlayers = 1;
    if (![0, 1, 2, 3].includes(single.storyAllies)) single.storyAllies = 0;
    single.storyAllyPicks = normalizeAllyPicks(single.storyAllyPicks);
    if (!STAGE_ORDER.includes(single.storyStart) && single.storyStart !== 'endless') single.storyStart = 'rooftop';
    return single;
  } catch {
    return defaults;
  }
}

export function saveSingle(single) {
  try { localStorage.setItem(SINGLE_KEY, JSON.stringify(single)); } catch { /* 저장 불가 환경은 무시 */ }
}

const STORY_KEY = 'haha2.story.v1';

/** 스토리 모드 웨이브별 요원 밸런스(defaultStory() 모양). 저장값이 없으면 '내 기본값'(없으면 원래 기본값). */
export function loadStory() {
  try {
    return normalizeStory(JSON.parse(localStorage.getItem(STORY_KEY)), loadStoryDefaults());
  } catch {
    return defaultStory();
  }
}

export function saveStory(story) {
  try { localStorage.setItem(STORY_KEY, JSON.stringify(story)); } catch { /* 저장 불가 환경은 무시 */ }
}

const STORY_SAVE_KEY = 'haha2.storysave.v1';

/**
 * 스토리 모드 저장(일시정지 화면의 '저장하기', 계정마다 따로): { wave, hp, label, pick: { characterId, weapon, secondary }, savedAt, clean }.
 * clean: 처음부터 스테이지 건너뛰기 없이 해 온 판(끝까지 깨면 랭크가 오른다).
 * 없거나 읽을 수 없으면 null.
 */
export function loadStorySave() {
  try {
    return normalizeStorySave(JSON.parse(localStorage.getItem(accountKey(STORY_SAVE_KEY, account))));
  } catch {
    return null;
  }
}

export function saveStorySave(save) {
  try { localStorage.setItem(accountKey(STORY_SAVE_KEY, account), JSON.stringify(save)); } catch { /* 저장 불가 환경은 무시 */ }
}

export function clearStorySave() {
  try { localStorage.removeItem(accountKey(STORY_SAVE_KEY, account)); } catch { /* 저장 불가 환경은 무시 */ }
}

const STORY_DEFAULTS_KEY = 'haha2.storydefaults.v1';

/** '내 기본값'으로 저장해 둔 스토리 설정(없으면 null). 스토리 설정 화면의 노란 표시·'기본값으로' 버튼이 이 값을 기준으로 한다. */
export function loadStoryDefaults() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORY_DEFAULTS_KEY));
    return saved ? normalizeStory(saved) : null;
  } catch {
    return null;
  }
}

export function saveStoryDefaults(story) {
  try { localStorage.setItem(STORY_DEFAULTS_KEY, JSON.stringify(story)); } catch { /* 저장 불가 환경은 무시 */ }
}

export function clearStoryDefaults() {
  try { localStorage.removeItem(STORY_DEFAULTS_KEY); } catch { /* 저장 불가 환경은 무시 */ }
}
