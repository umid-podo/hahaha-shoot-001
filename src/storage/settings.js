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
