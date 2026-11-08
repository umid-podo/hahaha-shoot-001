/**
 * 총기 개조(개조 모드). 작업실에서 랜덤 뽑기로 파츠(개머리판·총구·스코프·탄창·총 색깔)를 뽑아 배낭에 모으고,
 * 총마다 하나씩 장착한다. 파츠는 모양만 바꾸고(게임 수치는 그대로) 1인칭 화면의 손에 든 총에도 보인다.
 *
 * 파츠 하나는 { id, slot, grade, seed, name }. 디자인(종류·길이·색·무늬·발광 등)은 seed로 그때그때 만들어 낸다(designOf).
 * 같은 seed면 늘 같은 모양이라 저장은 seed만 하면 되고, 뽑을 때마다 새 seed라 디자인이 계속 새로 나온다.
 * 등급이 높을수록 종류가 다양해지고(소음기·드럼 탄창·열상 조준경…) 재질·무늬·금빛·발광 장식이 붙어 더 멋있어진다.
 */

export const GRADES = [
  { id: 'common', name: '일반', color: '#A7ADB7', weight: 60 },
  { id: 'uncommon', name: '희귀', color: '#4CC26A', weight: 25 },
  { id: 'rare', name: '레어', color: '#4C8DFF', weight: 11 },
  { id: 'elite', name: '엘리트', color: '#FFB020', weight: 4 },
];
export const GRADE = Object.fromEntries(GRADES.map((g, i) => [g.id, { ...g, rank: i }]));

export const PART_SLOTS = [
  { id: 'stock', name: '개머리판', icon: '▰' },
  { id: 'muzzle', name: '총구', icon: '◉' },
  { id: 'scope', name: '스코프', icon: '⊕' },
  { id: 'mag', name: '탄창', icon: '▮' },
  { id: 'skin', name: '총 색깔', icon: '◆' },
];
export const SLOT = Object.fromEntries(PART_SLOTS.map((s) => [s.id, s]));

/** 개조할 수 있는 총과 그 총에 붙일 수 있는 파츠 칸 */
export const MOD_WEAPONS = {
  rifle: ['stock', 'muzzle', 'scope', 'mag', 'skin'],
  smg: ['stock', 'muzzle', 'scope', 'mag', 'skin'],
  sniper: ['stock', 'muzzle', 'scope', 'mag', 'skin'],
  shotgun: ['stock', 'muzzle', 'scope', 'skin'],
  pistol: ['muzzle', 'scope', 'mag', 'skin'],
  dual: ['muzzle', 'scope', 'mag', 'skin'],
  rpg: ['scope', 'skin'],
  crossbow: ['scope', 'skin'],
};
export const canMount = (weapon, slot) => !!MOD_WEAPONS[weapon]?.includes(slot);

/** 0~1 난수(시드 고정). mulberry32 */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const between = (rng, a, b) => a + (b - a) * rng();
const hsl = (h, s, l) => `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;

/** 무게(weight)대로 등급을 고른다 */
export function rollGrade(rng) {
  const total = GRADES.reduce((n, g) => n + g.weight, 0);
  let r = rng() * total;
  for (const g of GRADES) { r -= g.weight; if (r < 0) return g.id; }
  return GRADES[0].id;
}

// ── 디자인 ──
/** 등급별로 나올 수 있는 종류(높은 등급은 아래 등급 종류도 더 멋진 모양으로 나온다) */
const KINDS = {
  muzzle: {
    common: ['flash', 'brake'],
    uncommon: ['flash', 'brake', 'comp'],
    rare: ['comp', 'suppressor', 'brake'],
    elite: ['suppressor', 'brake', 'comp'],
  },
  scope: {
    common: ['dot', 'iron'],
    uncommon: ['dot', 'holo'],
    rare: ['holo', 'acog', 'long'],
    elite: ['long', 'thermal', 'acog'],
  },
  stock: {
    common: ['fixed', 'folding'],
    uncommon: ['skeleton', 'fixed', 'folding'],
    rare: ['precision', 'skeleton'],
    elite: ['precision', 'wing'],
  },
  mag: {
    common: ['straight', 'curved'],
    uncommon: ['extended', 'coupled'],
    rare: ['drum', 'extended', 'coupled'],
    elite: ['drum', 'casket'],
  },
  skin: {
    common: ['solid'],
    uncommon: ['twotone', 'solid'],
    rare: ['camo', 'tiger', 'digital', 'carbon'],
    elite: ['gold', 'chrome', 'neon', 'dragon'],
  },
};
const KIND_NAME = {
  flash: '소염기', brake: '머즐 브레이크', comp: '보정기', suppressor: '소음기',
  dot: '도트 사이트', iron: '접이식 가늠자', holo: '홀로그램 사이트', acog: '프리즘 조준경', long: '장거리 스코프', thermal: '열상 스코프',
  fixed: '고정식 개머리판', folding: '접이식 개머리판', skeleton: '스켈레톤 개머리판', precision: '정밀 개머리판', wing: '윙 개머리판',
  straight: '표준 탄창', curved: '곡선 탄창', extended: '확장 탄창', coupled: '쌍탄창', drum: '드럼 탄창', casket: '4열 탄창',
  solid: '단색', twotone: '투톤', camo: '위장 무늬', tiger: '호랑이 줄무늬', digital: '디지털 위장', carbon: '카본',
  gold: '황금', chrome: '크롬', neon: '네온', dragon: '용비늘',
};
const ADJ = {
  common: ['표준', '강철', '훈련용', '기본형', '야전'],
  uncommon: ['전술', '정찰', '특수', '야간', '돌격'],
  rare: ['코발트', '스펙터', '사이클론', '블루 팬서', '썬더'],
  elite: ['황금 용', '피닉스', '오메가', '프레데터', '레전드'],
};
/** 등급별 장식 색 */
const ACCENTS = {
  common: ['#3A3D43', '#5A5F68', '#4A4F57'],
  uncommon: ['#2F8F4E', '#3AA0A0', '#C08A2E', '#7A8A3A'],
  rare: ['#3D7BFF', '#9B4DFF', '#00C2FF', '#FF4FA0'],
  elite: ['#FFB020', '#FF3B30', '#00E5FF', '#B45CFF'],
};
const BASES = {
  common: ['#1E1F23', '#3B3F45', '#5C4A32', '#4B5530', '#8C8577', '#D8D4CA'],
  uncommon: ['#1E1F23', '#2B3A2F', '#3A2F28', '#2A3140', '#6E6252'],
};

/** 파츠 디자인 값(3D로 만들 때 쓴다). 같은 item이면 늘 같은 값 */
export function designOf(item) {
  const rng = seededRng(item.seed ^ 0x9e3779b9);
  const grade = item.grade;
  const rank = GRADE[grade]?.rank ?? 0;
  const kind = pick(rng, KINDS[item.slot][grade]);
  const accent = pick(rng, ACCENTS[grade]);
  const metal = rank >= 3 ? pick(rng, ['#C9A24A', '#D8DCE4', '#2A2C31']) : rank >= 2 ? pick(rng, ['#2A2C31', '#3A4250', '#5A6070']) : pick(rng, ['#2A2C31', '#34373D']);
  const d = {
    kind, rank, accent, metal,
    glow: rank >= 3 ? accent : null, // 엘리트: 빛나는 장식
    detail: rank, // 홈·링·나사 같은 잔장식 수
    length: between(rng, 0.85, 1.25),
    thick: between(rng, 0.9, 1.15),
    rings: Math.floor(between(rng, 1, 2 + rank * 1.5)),
    ports: Math.floor(between(rng, 2, 4 + rank * 2)),
  };
  if (item.slot === 'skin') {
    const hue = rng() * 360;
    d.base = rank <= 1 ? pick(rng, BASES[grade]) : kind === 'gold' ? '#C9A24A' : kind === 'chrome' ? '#D9DDE4' : hsl(hue, rank >= 3 ? 30 : 25, rank >= 3 ? 14 : 30);
    d.second = kind === 'twotone' ? pick(rng, ['#C9B48A', '#7A8A5A', '#A8B0BA', '#C0603A', '#3A6EA8']) : hsl((hue + 40) % 360, 30, 22);
    d.pattern = [hsl(hue, 35, 38), hsl((hue + 25) % 360, 40, 22), hsl((hue + 330) % 360, 30, 50)];
    d.metalColor = kind === 'gold' ? '#F7CC5E' : kind === 'chrome' ? '#E6E9EE' : kind === 'dragon' ? '#2A1A12' : rank >= 2 ? hsl(hue, 15, 22) : '#25272C';
    d.shine = kind === 'gold' || kind === 'chrome' ? 1 : kind === 'carbon' ? 0.5 : rank >= 2 ? 0.6 : 0.3;
    d.scale = between(rng, 0.7, 1.4);
  }
  return d;
}

/** 파츠 이름(등급 형용사 + 종류 + 모델 번호) */
export function nameOf(item) {
  const rng = seededRng(item.seed ^ 0x51ed27);
  const d = designOf(item);
  const code = `${pick(rng, ['Mk.', 'X-', 'R-', 'V', 'S-', 'Z-'])}${Math.floor(rng() * 9) + 1}${item.grade === 'elite' ? pick(rng, ['', ' 커스텀', ' 리미티드']) : ''}`;
  return `${pick(rng, ADJ[item.grade])} ${KIND_NAME[d.kind]} ${code}`;
}

/** 파츠 하나 뽑기. slot을 주면 그 칸만, 아니면 칸도 무작위 */
export function rollItem(rng = Math.random, slot = null) {
  const s = slot ?? pick(rng, PART_SLOTS).id;
  const item = { slot: s, grade: rollGrade(rng), seed: Math.floor(rng() * 2 ** 32) >>> 0 };
  item.name = nameOf(item);
  return item;
}

// ── 배낭·장착 저장 ──
const KEY = 'haha2.mods.v1';
/** localStorage를 쓸 수 없는 곳(테스트·사생활 보호 모드)에서는 메모리에만 둔다 */
function defaultStorage() {
  try { if (globalThis.localStorage) { globalThis.localStorage.getItem(KEY); return globalThis.localStorage; } } catch { /* 저장 불가 */ }
  const mem = new Map();
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
}

/**
 * 배낭(뽑은 파츠 목록)과 총별 장착 상태. 바뀔 때마다 저장하고, 구독한 함수(onChange)를 부른다.
 * state: { items: [{ id, slot, grade, seed, name }], equips: { 무기: { 칸: 파츠 id } }, nextId, draws }
 */
export function createModStore(storage = defaultStorage()) {
  let state = { items: [], equips: {}, nextId: 1, draws: 0 };
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (saved && Array.isArray(saved.items)) {
      state = {
        items: saved.items.filter((i) => SLOT[i?.slot] && GRADE[i?.grade] && Number.isFinite(i?.seed)).map((i) => ({ ...i, name: i.name ?? nameOf(i) })),
        equips: saved.equips && typeof saved.equips === 'object' ? saved.equips : {},
        nextId: Number.isFinite(saved.nextId) ? saved.nextId : 1,
        draws: Number.isFinite(saved.draws) ? saved.draws : 0,
      };
      state.nextId = Math.max(state.nextId, ...state.items.map((i) => i.id + 1), 1);
    }
  } catch { /* 깨진 저장은 버린다 */ }
  const listeners = new Set();
  let version = 0;
  const save = () => {
    version++;
    try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* 저장 불가 */ }
    for (const fn of listeners) fn(state);
  };
  const byId = (id) => state.items.find((i) => i.id === id) ?? null;
  return {
    get items() { return state.items; },
    get draws() { return state.draws; },
    /** 바뀔 때마다 늘어나는 번호(3D 모델을 다시 만들지 판단) */
    get version() { return version; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** 뽑기 count번: 뽑은 파츠들을 배낭에 넣고 돌려준다 */
    draw(count = 1, rng = Math.random) {
      const got = [];
      for (let n = 0; n < count; n++) {
        const item = { id: state.nextId++, ...rollItem(rng) };
        state.items.push(item);
        got.push(item);
      }
      state.draws += count;
      save();
      return got;
    },
    /** 총에 파츠 장착(그 칸에 붙일 수 없는 총이면 false) */
    equip(weapon, itemId) {
      const item = byId(itemId);
      if (!item || !canMount(weapon, item.slot)) return false;
      state.equips[weapon] = { ...state.equips[weapon], [item.slot]: item.id };
      save();
      return true;
    },
    unequip(weapon, slot) {
      if (!state.equips[weapon]?.[slot]) return;
      const next = { ...state.equips[weapon] };
      delete next[slot];
      state.equips[weapon] = next;
      save();
    },
    /** 파츠 분해(배낭에서 지움). 장착한 총에서도 떨어진다 */
    remove(itemId) {
      state.items = state.items.filter((i) => i.id !== itemId);
      for (const w of Object.keys(state.equips)) {
        for (const [slot, id] of Object.entries(state.equips[w])) if (id === itemId) delete state.equips[w][slot];
      }
      save();
    },
    /** 그 총에 장착한 파츠 { 칸: item } (붙일 수 있는 칸만) */
    equipped(weapon) {
      const out = {};
      for (const [slot, id] of Object.entries(state.equips[weapon] ?? {})) {
        const item = byId(id);
        if (item && canMount(weapon, slot)) out[slot] = item;
      }
      return out;
    },
    /** 장착 상태를 한 줄 글자로(같으면 같은 3D 모델을 다시 쓴다) */
    signature(weapon) {
      const e = this.equipped(weapon);
      return Object.keys(e).sort().map((s) => `${s}:${e[s].seed}:${e[s].grade}`).join('|');
    },
    isEquipped(weapon, itemId) {
      return Object.values(state.equips[weapon] ?? {}).includes(itemId);
    },
  };
}

let shared = null;
/** 게임 전체에서 함께 쓰는 배낭(작업실 화면과 1인칭 손에 든 총이 같은 것을 본다) */
export function modStore() {
  return (shared ??= createModStore());
}
