import { defaultStory, normalizeStory } from '../game/story.js';

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
    aiWeapon: 'pistol', aiSecondary: 'smg', difficulty: 'normal', aiHp: 500, aiBulletSpeed: 100, aiRadius: 30,
    aiDamage: { primary: null, secondary: null, grenade: null },
  };
}

export function loadSingle() {
  const defaults = defaultSingle();
  try {
    const saved = JSON.parse(localStorage.getItem(SINGLE_KEY)) ?? {};
    return { ...defaults, ...saved, aiDamage: { ...defaults.aiDamage, ...saved.aiDamage } };
  } catch {
    return defaults;
  }
}

export function saveSingle(single) {
  try { localStorage.setItem(SINGLE_KEY, JSON.stringify(single)); } catch { /* 저장 불가 환경은 무시 */ }
}

const STORY_KEY = 'haha2.story.v1';

/** 스토리 모드 웨이브별 요원 밸런스(defaultStory() 모양). */
export function loadStory() {
  try {
    return normalizeStory(JSON.parse(localStorage.getItem(STORY_KEY)));
  } catch {
    return defaultStory();
  }
}

export function saveStory(story) {
  try { localStorage.setItem(STORY_KEY, JSON.stringify(story)); } catch { /* 저장 불가 환경은 무시 */ }
}
