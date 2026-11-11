/**
 * 랭크·계정. 계정은 1~4번 네 개이고, 계정마다 랭크·코인·배낭·산 무기·스토리 저장을 따로 둔다(다른 계정에 영향 없음).
 * 랭크는 등급 7가지(초보 → 역전의 전사) × 레벨 1~30. 2인 대결에서 이기거나, 스토리 모드를 스테이지 건너뛰기 없이 끝까지 깨면 1레벨씩 오른다.
 * 30레벨이 되면 20코인을 받고 다음 등급(1레벨)으로 승급한다. 마지막 등급(역전의 전사)은 30레벨이 끝(그때도 20코인).
 */
export const TIERS = [
  { id: 'novice', name: '초보 등급', color: '#A7ADB7', icon: '🔰' },
  { id: 'normal', name: '일반 등급', color: '#6FCF7A', icon: '🟢' },
  { id: 'middle', name: '중수 등급', color: '#4C8DFF', icon: '🔷' },
  { id: 'master', name: '고수 등급', color: '#B45CFF', icon: '💠' },
  { id: 'warrior', name: '전사 등급', color: '#FF7A3D', icon: '⚔️' },
  { id: 'expert', name: '전문가 등급', color: '#FFC53D', icon: '🏅' },
  { id: 'veteran', name: '역전의 전사 등급', color: '#FF4F6E', icon: '👑' },
];
export const MAX_LEVEL = 30;
/** 승급(30레벨)할 때 받는 코인 */
export const PROMOTE_COINS = 20;
/** 계정 번호 */
export const ACCOUNTS = [1, 2, 3, 4];
export const accountName = (n) => `계정 ${n}`;

export function defaultRank() {
  return { tier: 0, level: 1, wins: 0 };
}

/** 저장된 랭크를 읽을 수 있는 값으로(깨졌으면 처음부터) */
export function normalizeRank(saved) {
  const tier = Math.floor(Number(saved?.tier));
  const level = Math.floor(Number(saved?.level));
  const wins = Math.floor(Number(saved?.wins));
  const t = Number.isFinite(tier) ? Math.min(TIERS.length - 1, Math.max(0, tier)) : 0;
  return {
    tier: t,
    level: Number.isFinite(level) ? Math.min(MAX_LEVEL, Math.max(1, level)) : 1,
    wins: Number.isFinite(wins) && wins > 0 ? wins : 0,
  };
}

/** '중수 등급 Lv.12' */
export const rankLabel = (rank) => `${TIERS[rank.tier].name} Lv.${rank.level}`;
/** 다음 승급까지의 진행도(0~1). 마지막 등급 30레벨이면 1 */
export const rankProgress = (rank) => (rank.level - 1) / (MAX_LEVEL - 1);
export const isMaxRank = (rank) => rank.tier === TIERS.length - 1 && rank.level >= MAX_LEVEL;

/**
 * 승리 한 번: 1레벨 올린다. 30레벨이 되면 PROMOTE_COINS 코인을 받고 다음 등급 1레벨로 승급(마지막 등급은 30레벨에 머묾).
 * 돌려주는 값: { rank(새 랭크), levelUp(레벨이 올랐는지), promoted(승급했는지), coins(받은 코인), from(이전 랭크) }.
 * 이미 마지막 등급 30레벨이면 승리 수만 센다.
 */
export function addWin(current) {
  const from = normalizeRank(current);
  const rank = { ...from, wins: from.wins + 1 };
  if (isMaxRank(from)) return { rank, levelUp: false, promoted: false, coins: 0, from };
  rank.level += 1;
  let promoted = false, coins = 0;
  if (rank.level >= MAX_LEVEL) {
    coins = PROMOTE_COINS;
    if (rank.tier < TIERS.length - 1) {
      rank.tier += 1;
      rank.level = 1;
      promoted = true;
    } else {
      rank.level = MAX_LEVEL;
    }
  }
  return { rank, levelUp: true, promoted, coins, from };
}

/** 랭크 결과를 한 줄 알림으로 */
export function rankMessage(result) {
  if (!result.levelUp) return `${rankLabel(result.rank)} · 최고 랭크!`;
  if (result.promoted) return `승급! ${TIERS[result.rank.tier].name} 달성 · 코인 +${result.coins}`;
  if (result.coins) return `${rankLabel(result.rank)} 달성! 최고 랭크 · 코인 +${result.coins}`;
  return `랭크 레벨 업! ${rankLabel(result.rank)}`;
}
