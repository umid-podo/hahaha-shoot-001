import { WEAPONS, CHARACTERS, JET, COVER, RULES } from './config.js';

/**
 * 밸런스 메뉴에서 조정하는 수치 목록. 값은 config.js의 객체(WEAPONS·CHARACTERS·JET·COVER·RULES)를 그 자리에서 바꾸므로
 * 게임 로직은 따로 알 필요 없이 다음 경기(또는 다음 발사)부터 새 값을 쓴다.
 * id는 저장·복사용 경로('weapons.rifle.damage'), path는 ROOT에서 값까지의 키 목록이다.
 */
const ROOT = {
  rules: RULES,
  characters: Object.fromEntries(CHARACTERS.map((c) => [c.id, c])),
  weapons: WEAPONS,
  cover: COVER,
  jet: JET,
};

const SEC = '초';
function param(group, label, path, { min = 0, max, step = 1, unit = '' } = {}) {
  return { id: path.join('.'), group, label, path, min, max, step, unit };
}

const hp = (id, name) => [
  param(name, '체력', ['characters', id, 'maxHp'], { min: 1, max: 5000, step: 10 }),
  param(name, '히트 박스 반지름', ['characters', id, 'radius'], { min: 5, max: 150, step: 1 }),
  param(name, '이동 속도(초당)', ['characters', id, 'speed'], { min: 20, max: 1500, step: 10 }),
];
const gun = (id, extra = []) => [
  param(WEAPONS[id].name, '한 발 피해', ['weapons', id, 'damage'], { max: 1000, step: 1 }),
  param(WEAPONS[id].name, WEAPONS[id].trigger === 'release' ? '쿨타임' : '발사 간격', ['weapons', id, 'interval'],
    { min: 0.02, max: 30, step: 0.01, unit: SEC }),
  ...(WEAPONS[id].speed ? [param(WEAPONS[id].name, '탄속(초당)', ['weapons', id, 'speed'], { min: 50, max: 5000, step: 10 })] : []),
  ...extra.map(([label, key, opts]) => param(WEAPONS[id].name, label, ['weapons', id, ...key], opts)),
];

export const SECTIONS = [
  { title: '캐릭터', params: CHARACTERS.flatMap((c) => hp(c.id, c.name)) },
  {
    title: '주무기',
    params: [
      ...gun('rifle'),
      ...gun('pistol'),
      ...gun('dual', [['점사 수', ['burst'], { min: 1, max: 10 }], ['점사 간격', ['burstGap'], { min: 0.02, max: 1, step: 0.01, unit: SEC }]]),
      ...gun('rpg', [
        ['폭발 피해', ['splash', 'damage'], { max: 1000 }],
        ['폭발 반경', ['splash', 'radius'], { max: 800, step: 5 }],
        ['유도 회전(rad/초)', ['homing', 'turnRate'], { max: 10, step: 0.1 }],
      ]),
      ...gun('sniper'),
    ],
  },
  {
    title: '드론 무기 · 보조무기 · 아이템',
    params: [
      ...gun('laser', [
        ['배터리(발)', ['battery', 'shots'], { min: 1, max: 500 }],
        ['완충 대기', ['battery', 'recharge'], { max: 30, step: 0.1, unit: SEC }],
      ]),
      ...gun('smg', [
        ['과열까지 연사', ['heat', 'max'], { min: 0.1, max: 30, step: 0.1, unit: SEC }],
        ['과열 시 대기', ['heat', 'cooldown'], { max: 30, step: 0.1, unit: SEC }],
        ['초당 식는 양', ['heat', 'decay'], { max: 10, step: 0.1 }],
      ]),
      param('수류탄', '쿨타임', ['weapons', 'grenade', 'interval'], { min: 0.5, max: 120, step: 0.5, unit: SEC }),
      param('수류탄', '던지는 속도(초당)', ['weapons', 'grenade', 'speed'], { min: 50, max: 3000, step: 10 }),
      param('수류탄', '폭발 피해', ['weapons', 'grenade', 'splash', 'damage'], { max: 1000 }),
      param('수류탄', '폭발 반경', ['weapons', 'grenade', 'splash', 'radius'], { max: 800, step: 5 }),
    ],
  },
  {
    title: '엄폐물 · 전투기 · 공통',
    params: [
      param('엄폐물', '내구도', ['cover', 'hp'], { min: 1, max: 5000, step: 10 }),
      param('엄폐물', 'RPG 직격 배수', ['cover', 'rpgMultiplier'], { max: 10, step: 0.1 }),
      param('전투기', '비행 속도(초당)', ['jet', 'speed'], { min: 20, max: 1500, step: 10 }),
      param('전투기', '첫 등장 최소', ['jet', 'firstDelay', 0], { max: 120, step: 0.5, unit: SEC }),
      param('전투기', '첫 등장 최대', ['jet', 'firstDelay', 1], { max: 120, step: 0.5, unit: SEC }),
      param('전투기', '재등장 최소', ['jet', 'delay', 0], { max: 120, step: 0.5, unit: SEC }),
      param('전투기', '재등장 최대', ['jet', 'delay', 1], { max: 120, step: 0.5, unit: SEC }),
      param('전투기', '미사일 간격', ['jet', 'missile', 'interval'], { min: 0.1, max: 10, step: 0.1, unit: SEC }),
      param('전투기', '미사일 피해', ['jet', 'missile', 'damage'], { max: 1000 }),
      param('전투기', '미사일 속도(초당)', ['jet', 'missile', 'speed'], { min: 50, max: 3000, step: 10 }),
      param('전투기', '미사일 폭발 피해', ['jet', 'missile', 'splash', 'damage'], { max: 1000 }),
      param('전투기', '미사일 폭발 반경', ['jet', 'missile', 'splash', 'radius'], { max: 800, step: 5 }),
      param('공통', '무기 전환 후 대기', ['rules', 'swapTime'], { max: 5, step: 0.05, unit: SEC }),
      param('공통', '탄환 수명', ['rules', 'bulletLife'], { min: 0.2, max: 10, step: 0.1, unit: SEC }),
    ],
  },
];
export const PARAMS = SECTIONS.flatMap((s) => s.params);
const BY_ID = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

function holder(path) {
  let obj = ROOT;
  for (const key of path.slice(0, -1)) obj = obj[key];
  return obj;
}
export function getValue(p) { return holder(p.path)[p.path.at(-1)]; }

/** 이 모듈을 처음 불러올 때(=config.js 기본값)의 값 */
const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p.id, getValue(p)]));
export const defaultValue = (p) => DEFAULTS[p.id];
export const isChanged = (p) => getValue(p) !== DEFAULTS[p.id];

/** 범위 밖은 자르고, 점사 수처럼 정수 칸(step 1 이상)은 반올림한다. 숫자가 아니면 null. */
export function normalize(p, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(p.max, Math.max(p.min, n));
  return p.step >= 1 ? Math.round(clamped) : Math.round(clamped * 1000) / 1000;
}

/** 값을 바꾼다. 실제로 반영된 값(잘못된 입력이면 원래 값)을 돌려준다. */
export function setValue(p, value) {
  const v = normalize(p, value);
  if (v === null) return getValue(p);
  holder(p.path)[p.path.at(-1)] = v;
  // 최소·최대 쌍(전투기 등장 대기)은 뒤집히지 않게 맞춘다.
  const pair = holder(p.path);
  if (Array.isArray(pair) && pair.length === 2 && pair[0] > pair[1]) {
    if (p.path.at(-1) === 0) pair[1] = pair[0]; else pair[0] = pair[1];
  }
  return v;
}

export function resetAll() {
  for (const p of PARAMS) holder(p.path)[p.path.at(-1)] = DEFAULTS[p.id];
}

/** 기본값과 다른 수치만 { id: value } */
export function overrides() {
  return Object.fromEntries(PARAMS.filter(isChanged).map((p) => [p.id, getValue(p)]));
}

/** 저장해 둔 { id: value }를 적용한다. 모르는 id·잘못된 값은 무시한다. */
export function applyOverrides(values) {
  if (!values || typeof values !== 'object') return;
  for (const [id, value] of Object.entries(values)) {
    if (BY_ID[id]) setValue(BY_ID[id], value);
  }
}

/** 현재 수치 전체를 사람이 읽을 수 있는 글로 (기본값과 다르면 "← 기본 x" 표시). 복사해서 전달하는 용도. */
export function summaryText() {
  const lines = ['HAHA 2 Shoot 밸런스 설정'];
  for (const section of SECTIONS) {
    lines.push('', `[${section.title}]`);
    let group = null;
    for (const p of section.params) {
      if (p.group !== group) { group = p.group; lines.push(`- ${group}`); }
      const mark = isChanged(p) ? `  ← 기본 ${DEFAULTS[p.id]}` : '';
      lines.push(`  ${p.label}: ${getValue(p)}${p.unit}${mark}`);
    }
  }
  const changed = overrides();
  lines.push('', `변경값(JSON): ${JSON.stringify(changed)}`);
  return lines.join('\n');
}
