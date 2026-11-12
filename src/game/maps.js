import {
  ARENA_WIDTH, ARENA_HEIGHT, FIELD, JUMP, COVER, PAD, HIGHS, WIDE_HIGHS, WIDE_COVERS, FORTRESS_HIGHS, FORTRESS_COVERS, FORTRESS_PADS,
} from './config.js';

/**
 * 거대한 경기장(2인 대결의 넓은 옥상·고공 요새, 스토리 모드 모든 스테이지).
 * 모든 스테이지는 원래 크기의 넓이 MAP_AREA배(가로·세로 각 √MAP_AREA배)이고, 원래 있던 자리(가운데)는 그대로 두고
 * 그 둘레를 스테이지 분위기에 맞는 거대한 건축물·고지대·다리·오르막길·점프 패드·엄폐물로 채운다.
 * 배치는 경기장 가운데(800, 500)를 기준으로 점대칭이라 양 팀이 공평하고, 스테이지마다 늘 같은 배치다(고정 시드).
 */
export const MAP_AREA = 10;
export const MAP_SCALE = Math.sqrt(MAP_AREA);
const CX = ARENA_WIDTH / 2, CY = ARENA_HEIGHT / 2;

/** 고정 시드 난수(mulberry32, state.js의 createRng와 같다 — 서로 불러오지 않으려고 따로 둔다) */
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 가운데(CX, CY)를 기준으로 w×h 넓이를 MAP_SCALE배로 키운 범위(100 단위로 반올림) */
function scaled(w, h) {
  const hw = Math.round((w * MAP_SCALE) / 200) * 100, hh = Math.round((h * MAP_SCALE) / 200) * 100;
  return { minX: CX - hw, maxX: CX + hw, minY: CY - hh, maxY: CY + hh };
}
/** 원래 넓은 맵(5000×4000)을 10배 넓이로: 약 15800×12600 */
export const BIG_FIELD = scaled(FIELD.maxX - FIELD.minX, FIELD.maxY - FIELD.minY);
/** 원래 크기 경기장(1600×1000)을 10배 넓이로: 약 5000×3200 (복도·하늘·도로·대교) */
export const STAGE_FIELD = scaled(ARENA_WIDTH, ARENA_HEIGHT);
/** 복도(본부 대형 홀)의 천장 높이: 탄·점프가 천장을 뚫지 못한다 */
export const HALL_CEILING = 2000;

/** 점프 패드 하나가 height까지 띄워 올리는 데 필요한 속도(조금 여유를 둔다) */
export const padPower = (height) => Math.round(Math.sqrt(2 * JUMP.gravity * (height + 140)));

/**
 * 스테이지별 맵 설정. keep: 새 건축물을 놓지 않는 가운데 자리(원래 배치·연출 자리), lanes: 건물을 놓지 않는 가로 띠(배·탱크가 지나는 길),
 * theme: 건축물 모양, count: 만들 건축물 무리 수(점대칭 쌍이므로 실제로는 두 배), covers: 덧놓을 엄폐물 쌍 수,
 * gap: 무리 사이 최소 간격(기본 140), size: 무리의 가로·세로 크기 배율(좁은 둘레에 맞춰 줄임, 높이는 그대로).
 */
const MAPS = {
  wide: { bounds: BIG_FIELD, keep: [pad(FIELD, 150)], theme: 'roof', count: 30, covers: 40, seed: 11 },
  fortress: { bounds: BIG_FIELD, keep: [pad(FIELD, 150)], theme: 'roof', count: 30, covers: 40, seed: 23 },
  corridor: { bounds: STAGE_FIELD, keep: [arenaKeep(120)], theme: 'hall', count: 12, covers: 16, seed: 37, ceiling: HALL_CEILING, gap: 70, size: 0.75 },
  sky: { bounds: STAGE_FIELD, keep: [arenaKeep(250)], theme: 'sky', count: 0, covers: 9, seed: 41 },
  road: { bounds: STAGE_FIELD, keep: [arenaKeep(120)], lanes: [[380, 160]], theme: 'convoy', count: 12, covers: 16, seed: 53, gap: 70, size: 0.75 },
  bridge: { bounds: STAGE_FIELD, keep: [arenaKeep(120)], lanes: [[CY, 260]], theme: 'bridge', count: 12, covers: 16, seed: 67, gap: 70, size: 0.75 },
};
export const MAP_IDS = Object.keys(MAPS);
export const mapBounds = (id) => ({ ...(MAPS[id] ?? MAPS.wide).bounds });

function pad(r, m) { return { minX: r.minX - m, maxX: r.maxX + m, minY: r.minY - m, maxY: r.maxY + m }; }
function arenaKeep(m) { return { minX: -m, maxX: ARENA_WIDTH + m, minY: -m, maxY: ARENA_HEIGHT + m }; }
const rectOf = (o) => ({ minX: o.x - o.w / 2, maxX: o.x + o.w / 2, minY: o.y - o.h / 2, maxY: o.y + o.h / 2 });
const overlaps = (a, b, m = 0) => a.minX - m < b.maxX && a.maxX + m > b.minX && a.minY - m < b.maxY && a.maxY + m > b.minY;
const inside = (r, B, m) => r.minX >= B.minX + m && r.maxX <= B.maxX - m && r.minY >= B.minY + m && r.maxY <= B.maxY - m;
const span = (rng, a, b) => a + rng() * (b - a);
const roundTo = (v, k = 10) => Math.round(v / k) * k;

/**
 * 건축물 무리 하나(원점 기준 { highs, pads, covers }). theme별로 모양(kind)과 높이가 다르다.
 * kind: 'tower'(빌딩·탑), 'block'(본부 홀의 거대 구조물), 'trailer'(도로의 대형 트레일러), 'pylon'(대교 주탑), 'bus'(대교에 멈춘 버스),
 * 'container'(컨테이너). bridge: 밑으로 지나가는 다리, ramp: 오르막길.
 */
const TEMPLATES = {
  // 거대한 빌딩 하나 + 꼭대기로 띄워 주는 점프 패드
  tower(rng, t) {
    const w = roundTo(span(rng, 380, 640)), h = roundTo(span(rng, 360, 600));
    const height = roundTo(span(rng, ...t.tall));
    const side = rng() < 0.5 ? 1 : -1;
    return {
      highs: [{ x: 0, y: 0, w, h, height, kind: t.kind }],
      pads: [{ x: side * (w / 2 + 160), y: 0, power: padPower(height) }],
      covers: [{ x: -side * (w / 2 + 120), y: h / 2 - 40, w: 44, h: 200 }],
    };
  },
  // 계단식 탑: 꾹 눌러 뛰면 한 칸씩 올라간다
  stepped(rng, t) {
    const top = roundTo(span(rng, ...t.stepTop));
    const w = roundTo(span(rng, 620, 760)), h = roundTo(span(rng, 500, 640));
    const k = [0.34, 0.67, 1];
    return {
      highs: k.map((f, i) => ({ x: 0, y: 0, w: roundTo(w * (1 - i * 0.3)), h: roundTo(h * (1 - i * 0.3)), height: roundTo(top * f), kind: t.kind })),
      pads: [],
      covers: [{ x: 0, y: h / 2 + 110, w: 200, h: 44 }],
    };
  },
  // 두 탑과 그 사이 높은 다리(밑으로 지나다닐 수 있음) + 다리 밑 점프 패드
  twin(rng, t) {
    const height = roundTo(span(rng, ...t.mid));
    const gap = roundTo(span(rng, 760, 980)), s = roundTo(span(rng, 260, 340));
    const along = rng() < 0.5 ? 'x' : 'y';
    const A = along === 'x' ? [-gap / 2, 0] : [0, -gap / 2], B = along === 'x' ? [gap / 2, 0] : [0, gap / 2];
    const len = gap + s * 0.5;
    return {
      highs: [
        { x: A[0], y: A[1], w: s, h: s, height, kind: t.kind },
        { x: B[0], y: B[1], w: s, h: s, height, kind: t.kind },
        { x: 0, y: 0, w: along === 'x' ? len : 150, h: along === 'x' ? 150 : len, height, bridge: true },
      ],
      pads: [{ x: along === 'x' ? 0 : 200, y: along === 'x' ? 200 : 0, power: padPower(height) }],
      covers: [{ x: along === 'x' ? 0 : -210, y: along === 'x' ? -210 : 0, w: along === 'x' ? 220 : 44, h: along === 'x' ? 44 : 220 }],
    };
  },
  // 높은 단과 그 위로 걸어 올라가는 오르막길(+ 단 위 엄폐물)
  plateau(rng, t) {
    const height = roundTo(span(rng, ...t.low));
    const w = roundTo(span(rng, 480, 600)), h = roundTo(span(rng, 380, 460));
    const len = roundTo(Math.max(500, height * 2.2)), dir = rng() < 0.5 ? 1 : -1;
    // 오르막길은 단의 남(dir 1)·북(-1)쪽 면에 붙어 단 쪽으로 오른다
    const ry = dir * (h / 2 + len / 2 - 2);
    return {
      highs: [
        { x: 0, y: 0, w, h, height, kind: t.kind },
        { x: -w / 2 + 120, y: ry, w: 200, h: len, height, ramp: { axis: 'y', dir: -dir } },
      ],
      pads: [],
      covers: [{ x: w / 4, y: 0, w: 180, h: 44 }],
    };
  },
  // 컨테이너·차량 무리(낮은 고지대 여러 개)와 점프 패드
  yard(rng, t) {
    const highs = [];
    const n = 3 + Math.floor(rng() * 3);
    // 420 간격으로 늘어놓아 서로 겹치지 않게(긴 쪽이 360 이하)
    for (let i = 0; i < n; i++) {
      const long = rng() < 0.5;
      const [w, h] = long ? t.unit : [t.unit[1], t.unit[0]];
      highs.push({
        x: roundTo((i - (n - 1) / 2) * 420), y: roundTo(span(rng, -150, 150)),
        w, h, height: t.yardH[Math.floor(rng() * t.yardH.length)], kind: t.yardKind, color: t.colors[Math.floor(rng() * t.colors.length)],
      });
    }
    return { highs, pads: [{ x: 0, y: 420, power: padPower(t.tall[1]) }], covers: [] };
  },
};

/** 테마: 건축물 모양(kind)·높이 범위·고를 무리 종류와 비율 */
const THEMES = {
  roof: {
    kind: 'tower', tall: [520, 900], stepTop: [480, 640], mid: [380, 560], low: [220, 320],
    yardKind: 'container', unit: [320, 100], yardH: [92, 184], colors: ['#B4472F', '#2F6FB4', '#3E8A4A', '#C9A23A'],
    mix: ['tower', 'tower', 'stepped', 'twin', 'twin', 'plateau', 'yard'],
  },
  hall: {
    kind: 'block', tall: [520, 860], stepTop: [420, 600], mid: [340, 520], low: [200, 300],
    yardKind: 'container', unit: [260, 120], yardH: [110, 220], colors: ['#6E5A3A', '#5E6672', '#7A6A4A'],
    mix: ['tower', 'stepped', 'twin', 'plateau', 'yard'],
  },
  convoy: {
    kind: 'trailer', tall: [500, 700], stepTop: [420, 560], mid: [320, 460], low: [160, 240],
    yardKind: 'trailer', unit: [360, 110], yardH: [150, 200], colors: ['#C9CED6', '#B4472F', '#2F6FB4'],
    mix: ['tower', 'stepped', 'twin', 'plateau', 'yard'],
  },
  bridge: {
    kind: 'pylon', tall: [700, 1000], stepTop: [440, 600], mid: [360, 520], low: [200, 300],
    yardKind: 'bus', unit: [300, 100], yardH: [150], colors: ['#E0A22A', '#3A6FB4', '#B4472F'],
    mix: ['tower', 'stepped', 'twin', 'plateau', 'yard'],
  },
};

/** 무리(원점 기준)를 (ox, oy)로 옮긴 것, mirror면 경기장 가운데 기준 점대칭(오르막길 방향도 뒤집음) */
function place(group, ox, oy, mirror, tag) {
  const at = (o) => {
    const x = ox + o.x, y = oy + o.y;
    return mirror ? { x: 2 * CX - x, y: 2 * CY - y } : { x, y };
  };
  const highs = group.highs.map((g, i) => ({
    ...g, id: `${tag}-h${i}`, ...at(g), ...(g.ramp ? { ramp: { ...g.ramp, dir: mirror ? -g.ramp.dir : g.ramp.dir } } : {}),
  }));
  const pads = group.pads.map((p, i) => ({ ...p, id: `${tag}-p${i}`, ...at(p) }));
  const covers = group.covers.map((c, i) => ({ ...c, id: `${tag}-c${i}`, ...at(c) }));
  return { highs, pads, covers };
}

/** 무리 전체(고지대·엄폐물·점프 패드)의 위에서 본 범위 */
function extent(group) {
  const all = [...group.highs, ...group.covers, ...group.pads.map((p) => ({ x: p.x, y: p.y, w: PAD.r * 2, h: PAD.r * 2 }))];
  return all.reduce((r, o) => {
    const q = rectOf(o);
    return { minX: Math.min(r.minX, q.minX), maxX: Math.max(r.maxX, q.maxX), minY: Math.min(r.minY, q.minY), maxY: Math.max(r.maxY, q.maxY) };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

const cache = new Map();
/**
 * 맵 id의 덧붙는 건축물 { highs, covers, pads } (늘 같은 배치). 원래 배치(가운데)는 applyMap이 따로 놓는다.
 */
export function buildExtras(id) {
  if (cache.has(id)) return cache.get(id);
  const cfg = MAPS[id];
  const out = { highs: [], covers: [], pads: [] };
  if (!cfg) return out;
  const rng = createRng(cfg.seed);
  const B = cfg.bounds;
  const used = [...cfg.keep];
  const gap = cfg.gap ?? 140;
  const blocked = (r) => used.some((u) => overlaps(r, u, gap))
    || (cfg.lanes ?? []).some(([y, half]) => r.minY < y + half && r.maxY > y - half)
    || overlaps(r, mirrorRect(r), gap) // 가운데에 걸쳐 제 짝과 겹치는 자리
    || !inside(r, B, 90);
  const theme = THEMES[cfg.theme];
  let made = 0;
  for (let tries = 0; theme && made < cfg.count && tries < cfg.count * 60; tries++) {
    // 처음에는 종류마다 하나씩(탑·계단식 탑·높은 다리·오르막길·무리가 모두 나오게), 그다음은 비율대로 무작위
    const kinds = [...new Set(theme.mix)];
    const kind = made < kinds.length ? kinds[made] : theme.mix[Math.floor(rng() * theme.mix.length)];
    const group = shrink(TEMPLATES[kind](rng, theme), cfg.size ?? 1);
    const ox = roundTo(span(rng, B.minX, B.maxX)), oy = roundTo(span(rng, B.minY, CY));
    const local = extent(group);
    const r = { minX: local.minX + ox, maxX: local.maxX + ox, minY: local.minY + oy, maxY: local.maxY + oy };
    if (blocked(r)) continue;
    used.push(r, mirrorRect(r));
    const tag = `${id}-${made}`;
    for (const part of [place(group, ox, oy, false, `${tag}a`), place(group, ox, oy, true, `${tag}b`)]) {
      out.highs.push(...part.highs);
      out.pads.push(...part.pads);
      out.covers.push(...part.covers);
    }
    made++;
  }
  // 덧놓는 엄폐물(점대칭 쌍): 건축물과 떨어진 빈 자리에
  const solids = () => [...used, ...out.highs.map(rectOf), ...out.covers.map(rectOf)];
  let covers = 0;
  for (let tries = 0; covers < cfg.covers && tries < cfg.covers * 60; tries++) {
    const long = rng() < 0.5;
    const c = { x: roundTo(span(rng, B.minX, B.maxX)), y: roundTo(span(rng, B.minY, CY)), w: long ? 200 : 44, h: long ? 44 : 200 };
    if (cfg.theme === 'sky') { c.w = 140; c.h = 140; c.kind = 'balloon'; }
    const r = rectOf(c);
    if (!inside(r, B, 120) || solids().some((u) => overlaps(r, u, 110)) || overlaps(r, mirrorRect(r), 110)
      || (cfg.lanes ?? []).some(([y, half]) => r.minY < y + half && r.maxY > y - half)) continue;
    const m = { ...c, x: 2 * CX - c.x, y: 2 * CY - c.y };
    out.covers.push({ ...c, id: `${id}-x${covers}a` }, { ...m, id: `${id}-x${covers}b` });
    covers++;
  }
  cache.set(id, out);
  return out;
}

/** 무리의 가로·세로 자리·크기만 k배(높이·점프 패드 세기는 그대로). 오르막길은 길이를 줄이지 않아 비탈이 너무 가팔라지지 않게 한다 */
function shrink(group, k) {
  if (k === 1) return group;
  const s = (o) => ({ ...o, x: roundTo(o.x * k), y: roundTo(o.y * k), ...(o.w ? { w: roundTo(o.w * k) } : {}), ...(o.h ? { h: roundTo(o.h * k) } : {}) });
  return { highs: group.highs.map((g) => (g.ramp ? { ...s(g), h: g.h, y: roundTo(g.y * k + Math.sign(g.y) * (g.h - g.h * k) / 2) } : s(g))), pads: group.pads.map(s), covers: group.covers.map(s) };
}

function mirrorRect(r) {
  return { minX: 2 * CX - r.maxX, maxX: 2 * CX - r.minX, minY: 2 * CY - r.maxY, maxY: 2 * CY - r.minY };
}

/**
 * 스토리 복도의 고정 구조물: 엘리베이터 탑(위쪽 벽 자리), 계단실(왼쪽 아래 문 자리), 벽 포탑이 달린 기둥 둘.
 * 천장까지 닿아 올라설 수 없다(넘어가려면 돌아간다).
 */
const CORRIDOR_CORE = [
  { id: 'core-elevator', x: CX, y: -120, w: 760, h: 220, height: HALL_CEILING, kind: 'block', core: true },
  { id: 'core-stairs', x: -75, y: 855, w: 190, h: 300, height: HALL_CEILING, kind: 'block', core: true },
  { id: 'core-turret-left', x: -14, y: 340, w: 60, h: 120, height: HALL_CEILING, kind: 'block', core: true },
  { id: 'core-turret-right', x: ARENA_WIDTH + 14, y: 680, w: 60, h: 120, height: HALL_CEILING, kind: 'block', core: true },
];

/**
 * 경기를 맵 id의 거대한 경기장으로 바꾼다: 이동 범위(bounds), 원래 배치 + 덧붙는 건축물(고지대·엄폐물·점프 패드), 천장.
 * wide·fortress는 2인 대결(옥상)용 원래 배치(WIDE_*·FORTRESS_*)를, 스토리 스테이지는 그 스테이지의 원래 배치를 가운데 둔다.
 * 원래 엄폐물(match.covers)은 그대로 두고 덧붙인다. 하늘(공중전)은 고지대 없이 떠 있는 방공 기구(엄폐물)만.
 */
export function applyMap(match, id) {
  const cfg = MAPS[id] ?? MAPS.wide;
  const extra = buildExtras(id in MAPS ? id : 'wide');
  match.wide = true;
  match.map = id === 'fortress' ? 'fortress' : id === 'wide' ? 'wide' : id;
  match.bounds = { ...cfg.bounds };
  match.ceiling = cfg.ceiling ?? null;
  const copyHigh = (h) => ({ ...h, ...(h.ramp ? { ramp: { ...h.ramp } } : {}) });
  let highs = [], pads = [], covers = [];
  if (id === 'fortress') {
    highs = [...HIGHS, ...FORTRESS_HIGHS];
    pads = FORTRESS_PADS.map((p) => ({ ...p, power: PAD.power }));
    covers = FORTRESS_COVERS;
  } else if (id === 'wide' || !(id in MAPS)) {
    highs = [...HIGHS, ...WIDE_HIGHS];
    covers = WIDE_COVERS;
  } else if (id === 'corridor') {
    highs = [...HIGHS, ...CORRIDOR_CORE];
  }
  match.highs = [...highs, ...extra.highs].map(copyHigh);
  match.pads = [...pads, ...extra.pads].map((p) => ({ r: PAD.r, power: PAD.power, h: 0, ...p }));
  match.covers = [...(match.covers ?? []), ...[...covers, ...extra.covers].map((c) => ({ ...c, hp: COVER.hp }))];
  match.fields = [];
  return match;
}
