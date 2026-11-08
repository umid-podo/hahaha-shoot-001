import * as THREE from '../vendor/three.module.min.js';
import { designOf } from '../game/mods.js';

/**
 * 총기 개조 파츠의 3D 모델. 좌표는 guns.js와 같다(단위 cm, 총구 쪽 +X, 위 +Y, 총의 오른쪽 +Z).
 * 파츠마다 designOf(item)의 값(종류·길이·굵기·장식 수·색·발광)으로 그때그때 모양을 만든다.
 * 등급(rank 0~3)이 높을수록 잔장식(홈·링·나사·레일)이 늘고, 레어부터 색 장식, 엘리트는 금빛·크롬 재질과 빛나는 줄이 붙는다.
 *
 *   총구: 소염기(새장형)·머즐 브레이크(옆 구멍)·보정기(위 구멍)·소음기(긴 통)            — 총구 끝(+X)에 붙음
 *   스코프: 도트·접이식 가늠자·홀로그램·프리즘(ACOG형)·장거리·열상                         — 위 레일 자리에 붙음
 *   개머리판: 고정식·접이식·스켈레톤(구멍)·정밀(뺨받침 조절)·윙(엘리트)                    — 몸통 뒤(-X)에 붙음
 *   탄창: 표준·곡선·확장·쌍탄창(테이프로 묶은 두 개)·드럼·4열                             — 탄창 자리 아래로
 *   총 색깔: 단색·투톤·위장·호랑이·디지털·카본·황금·크롬·네온(빛나는 줄)·용비늘           — 몸통·쇠 부분 재질을 바꿈
 */

const cache = new Map();
function mat(color, { metal = 0.6, rough = 0.4, emissive = null, intensity = 1, map = null, emissiveMap = null, transparent = false, opacity = 1 } = {}) {
  const key = [color, metal, rough, emissive, intensity, map?.uuid, emissiveMap?.uuid, transparent, opacity].join('|');
  if (!cache.has(key)) {
    const m = new THREE.MeshStandardMaterial({
      color, metalness: metal, roughness: rough, map, transparent, opacity,
      ...(emissive ? { emissive, emissiveIntensity: intensity, emissiveMap } : {}),
    });
    m.userData.shared = true;
    cache.set(key, m);
  }
  return cache.get(key);
}
const role = (m, r) => { m.userData.role = r; return m; };
const BLACK = () => mat('#08090A', { metal: 0.2, rough: 0.9 });
const GLASS = (tint = '#3A5A8A') => mat(tint, { metal: 0.9, rough: 0.05, transparent: true, opacity: 0.55 });

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
}
function tube(rBack, rFront, x0, x1, m, { y = 0, z = 0, seg = 20 } = {}) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rBack, rFront, x1 - x0, seg), m);
  o.rotation.z = Math.PI / 2;
  o.position.set((x0 + x1) / 2, y, z);
  return o;
}
function slab(points, depth, m, { bevel = 0.25, holes = [] } = {}) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const core = Math.max(0.02, depth - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: core, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  geo.translate(0, 0, -core / 2);
  return new THREE.Mesh(geo, m);
}
/** 세로(Y축) 원통 */
function vcyl(r, h, m, x, y, z = 0) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), m);
  o.position.set(x, y, z);
  return o;
}
/** 옆(Z축)으로 누운 원통 */
function zcyl(r, h, m, x, y, z = 0, seg = 24) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.rotation.x = Math.PI / 2;
  o.position.set(x, y, z);
  return o;
}
/** Z를 보는 고리(드럼 탄창 옆면) */
function zring(r, tubeR, m, x, y, z) {
  const o = new THREE.Mesh(new THREE.TorusGeometry(r, tubeR, 8, 32), m);
  o.position.set(x, y, z);
  return o;
}
function ring(r, tubeR, m, x, y = 0) {
  const o = new THREE.Mesh(new THREE.TorusGeometry(r, tubeR, 8, 24), m);
  o.rotation.y = Math.PI / 2;
  o.position.set(x, y, 0);
  return o;
}
function disc(r, m, x, y = 0, facing = 1) {
  const o = new THREE.Mesh(new THREE.CircleGeometry(r, 24), m);
  o.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  o.position.set(x, y, 0);
  return o;
}

/** 파츠 재질 세트: 쇠(등급 색), 장식, 발광 */
function palette(d) {
  const metal = role(mat(d.metal, { metal: d.rank >= 3 ? 1 : 0.85, rough: d.rank >= 3 ? 0.18 : 0.38 - d.rank * 0.05 }), 'part');
  const accent = mat(d.accent, { metal: 0.7, rough: 0.3, emissive: d.rank >= 2 ? d.accent : null, intensity: d.rank >= 3 ? 0.6 : 0.15 });
  const glow = d.glow ? mat(d.glow, { metal: 0, rough: 0.4, emissive: d.glow, intensity: 2.2 }) : accent;
  return { metal, accent, glow };
}

// ── 총구 ──
/** 총구 끝(원점)에서 +X로. bore: 총열 굵기 기준 반지름. 돌려주는 값 { obj, length, flash(불꽃 크기 배율) } */
export function makeMuzzle(item, bore = 1) {
  const d = designOf(item);
  const P = palette(d);
  const g = new THREE.Group();
  const r = Math.max(0.6, bore) * d.thick;
  let length;
  if (d.kind === 'suppressor') {
    length = r * 13 * d.length;
    const R = r * 1.9;
    g.add(tube(R * 0.85, R, 0, 1.2, P.metal));
    g.add(tube(R, R, 1.2, length - 1.2, P.metal, { seg: 28 }));
    g.add(tube(R, R * 0.8, length - 1.2, length, P.metal, { seg: 28 }));
    g.add(disc(R * 0.3, BLACK(), length + 0.01));
    // 방열 링(등급이 높을수록 많고 색이 들어감)
    const n = 2 + d.rings;
    for (let i = 0; i < n; i++) g.add(tube(R * 1.04, R * 1.04, 2 + (i * (length - 5)) / n, 2.5 + (i * (length - 5)) / n, d.rank >= 2 ? P.accent : BLACK(), { seg: 28 }));
    if (d.rank >= 1) for (let a = 0; a < 6; a++) {
      const fl = box(length * 0.55, 0.25, 0.3, BLACK(), length * 0.5, Math.cos(a) * R, Math.sin(a) * R);
      fl.rotation.x = a;
      g.add(fl);
    }
    if (d.glow) g.add(tube(R * 1.06, R * 1.06, length * 0.62, length * 0.7, P.glow, { seg: 28 }));
    return { obj: g, length, flash: 0.35 };
  }
  if (d.kind === 'brake') {
    length = r * 6 * d.length;
    const R = r * 1.5;
    g.add(slab([[0, -R], [length, -R * 0.9], [length, R * 0.9], [0, R]], R * 2, P.metal, { bevel: 0.2 }));
    const n = Math.max(2, Math.min(5, d.ports));
    for (let i = 0; i < n; i++) {
      const x = (i + 0.7) * (length / (n + 0.6));
      for (const z of [-1, 1]) g.add(box(length / (n + 3), R * 1.2, 0.4, BLACK(), x, 0, z * R * 0.92));
    }
    if (d.rank >= 2) g.add(box(length * 0.9, 0.25, R * 2.05, P.accent, length * 0.5, R * 0.95));
    if (d.glow) for (const z of [-1, 1]) g.add(box(length * 0.8, 0.2, 0.1, P.glow, length * 0.5, -R * 0.6, z * R * 1.0));
    g.add(disc(r * 0.45, BLACK(), length + 0.01));
    return { obj: g, length, flash: 1.3 };
  }
  if (d.kind === 'comp') {
    length = r * 5.5 * d.length;
    const R = r * 1.35;
    g.add(tube(R, R, 0, length * 0.8, P.metal, { seg: 20 }));
    g.add(tube(R, R * 0.6, length * 0.8, length, P.metal, { seg: 20 }));
    const n = Math.max(2, Math.min(6, d.ports));
    for (let i = 0; i < n; i++) g.add(vcyl(0.3, 0.6, BLACK(), (i + 0.6) * (length * 0.75 / n), R * 0.95));
    for (let i = 0; i < d.rings; i++) g.add(tube(R * 1.05, R * 1.05, 0.3 + i * 0.9, 0.6 + i * 0.9, d.rank >= 2 ? P.accent : BLACK()));
    if (d.glow) g.add(tube(R * 1.07, R * 1.07, length * 0.5, length * 0.58, P.glow));
    g.add(disc(r * 0.45, BLACK(), length + 0.01));
    return { obj: g, length, flash: 0.8 };
  }
  // 소염기(새장형)
  length = r * 5 * d.length;
  const R = r * 1.1;
  g.add(tube(R, R, 0, length, P.metal, { seg: 18 }));
  const n = Math.max(3, Math.min(6, d.ports));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const sl = box(length * 0.6, 0.3, 0.5, BLACK(), length * 0.6, Math.cos(a) * R, Math.sin(a) * R);
    sl.rotation.x = -a;
    g.add(sl);
  }
  if (d.rank >= 1) g.add(tube(R * 1.06, R * 1.06, 0, 0.6, d.rank >= 2 ? P.accent : BLACK()));
  if (d.glow) g.add(tube(R * 1.08, R * 1.08, length - 0.6, length - 0.2, P.glow));
  g.add(disc(r * 0.5, BLACK(), length + 0.01));
  return { obj: g, length, flash: 0.75 };
}

// ── 스코프 ──
/** 레일 위(원점, 바닥이 y=0)에 붙는 조준경. size: 총 크기 배율(권총은 작게) */
export function makeScope(item, size = 1) {
  const d = designOf(item);
  const P = palette(d);
  const g = new THREE.Group();
  const reticle = mat(d.rank >= 2 ? d.accent : '#FF2030', { metal: 0, rough: 1, emissive: d.rank >= 2 ? d.accent : '#FF2030', intensity: 2 });
  const mount = (x, w = 2.4) => g.add(box(w, 1.4, 2.4, P.metal, x, 0.7));
  if (d.kind === 'iron') {
    g.add(box(8, 0.8, 2.2, P.metal, 0, 0.4));
    g.add(slab([[-4, 0.6], [-2.4, 0.6], [-2.6, 3.4], [-3.8, 3.4]], 2.0, P.metal, { bevel: 0.15 }));
    g.add(ring(0.55, 0.22, BLACK(), -3.2, 3.0));
    g.add(slab([[2.6, 0.6], [4, 0.6], [3.6, 3.2], [3.0, 3.2]], 1.0, P.metal, { bevel: 0.1 }));
    if (d.rank >= 1) g.add(box(0.2, 0.2, 0.2, reticle, 3.3, 3.3));
  } else if (d.kind === 'dot') {
    mount(0, 3.4);
    g.add(tube(1.7, 1.7, -3, 3, P.metal, { y: 3.0 }));
    g.add(tube(1.9, 1.9, 2.2, 3.2, d.rank >= 1 ? P.accent : P.metal, { y: 3.0 }));
    g.add(disc(1.45, GLASS('#2A3A4E'), -3.02, 3.0, -1));
    g.add(disc(0.14, reticle, -3.06, 3.0, -1));
    if (d.rank >= 1) g.add(vcyl(0.6, 1.2, P.metal, 0, 4.9));
    if (d.glow) g.add(tube(1.75, 1.75, -0.8, -0.4, P.glow, { y: 3.0 }));
  } else if (d.kind === 'holo') {
    g.add(box(8, 1.8, 3.2, P.metal, 0, 0.9));
    g.add(slab([[-1.4, 1.8], [-0.6, 1.8], [-0.6, 5.8], [-1.4, 5.8]], 3.6, P.metal, { bevel: 0.15 }));
    g.add(slab([[2.6, 1.8], [3.4, 1.8], [3.4, 5.8], [2.6, 5.8]], 3.6, P.metal, { bevel: 0.15 }));
    g.add(box(4.8, 0.6, 3.6, P.metal, 1, 5.9));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.6), GLASS('#6FA8C8'));
    glass.rotation.y = Math.PI / 2;
    glass.position.set(1, 3.8, 0);
    g.add(glass);
    const ret = ring(0.6, 0.06, reticle, 0.95, 3.8);
    g.add(ret, box(0.05, 0.12, 0.12, reticle, 0.95, 3.8));
    if (d.rank >= 2) g.add(box(2.4, 1.0, 0.1, P.accent, -2.5, 1.0, 1.65));
    if (d.glow) g.add(box(4.8, 0.15, 0.15, P.glow, 1, 6.25, 1.7), box(4.8, 0.15, 0.15, P.glow, 1, 6.25, -1.7));
  } else if (d.kind === 'acog') {
    mount(-1.5, 4);
    g.add(slab([[-5, 1.4], [3, 1.4], [3, 4.2], [-3, 5.6], [-5, 4.6]], 3.4, P.metal, { bevel: 0.4 }));
    g.add(tube(2.1, 2.3, 3, 7, P.metal, { y: 3.6, seg: 24 }));
    g.add(disc(1.9, GLASS('#2C4A72'), 7.02, 3.6));
    g.add(tube(1.1, 1.2, -6.6, -5, P.metal, { y: 3.6 }));
    g.add(disc(1.0, GLASS('#1A2A3E'), -6.62, 3.6, -1));
    g.add(disc(0.12, reticle, -6.66, 3.6, -1));
    if (d.rank >= 3) { g.add(box(2.4, 1.0, 1.8, P.metal, -1, 6.1)); g.add(box(1.6, 0.1, 1.2, reticle, -1, 6.65)); } // 위에 붙은 미니 도트
    if (d.rank >= 2) g.add(tube(2.4, 2.4, 6.4, 7.1, P.accent, { y: 3.6, seg: 24 }));
    if (d.glow) g.add(tube(2.36, 2.36, 4, 4.4, P.glow, { y: 3.6, seg: 24 }));
  } else if (d.kind === 'thermal') {
    mount(-3, 3); mount(4, 3);
    g.add(slab([[-8, 2], [7, 2], [8, 3], [8, 7.2], [-8, 7.2]], 4.4, P.metal, { bevel: 0.5 }));
    g.add(tube(2.6, 2.9, 8, 12, P.metal, { y: 4.6, seg: 28 }));
    g.add(disc(2.6, mat('#120A08', { metal: 0.9, rough: 0.1, emissive: d.accent, intensity: 0.35 }), 12.02, 4.6));
    g.add(ring(2.75, 0.16, P.glow, 12.05, 4.6));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.8), mat('#000000', { metal: 0, rough: 1, emissive: d.accent, intensity: 1.6 }));
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(-8.06, 4.6, 0);
    g.add(screen);
    for (let i = 0; i < 3; i++) g.add(vcyl(0.4, 0.8, P.accent, -4 + i * 2.6, 7.6));
  } else {
    // 장거리 스코프
    const L = 14 * d.length;
    mount(-L * 0.35, 2); mount(L * 0.35, 2);
    g.add(tube(1.4, 1.4, -L / 2, L / 2, P.metal, { y: 4.4 }));
    g.add(tube(1.4, 2.6 * d.thick, L / 2, L / 2 + 5, P.metal, { y: 4.4, seg: 28 }));
    g.add(tube(2.2, 1.4, -L / 2 - 5, -L / 2, P.metal, { y: 4.4, seg: 28 }));
    g.add(disc(2.4 * d.thick, GLASS('#2C4A80'), L / 2 + 5.02, 4.4));
    g.add(disc(1.9, GLASS('#1A2A3E'), -L / 2 - 5.02, 4.4, -1));
    for (const x of [-L * 0.35, L * 0.35]) g.add(tube(1.7, 1.7, x - 0.6, x + 0.6, d.rank >= 2 ? P.accent : P.metal, { y: 4.4 }));
    g.add(vcyl(0.9, 1.8, P.metal, 0, 6.2), zcyl(0.9, 1.8, P.metal, 0, 4.4, 1.9, 14));
    if (d.rank >= 2) g.add(tube(2.7 * d.thick, 2.7 * d.thick, L / 2 + 4.2, L / 2 + 5, P.accent, { y: 4.4, seg: 28 }));
    if (d.glow) { g.add(ring(2.45 * d.thick, 0.12, P.glow, L / 2 + 5.05, 4.4)); g.add(tube(1.48, 1.48, -1.6, -1.2, P.glow, { y: 4.4 })); }
  }
  g.scale.setScalar(size);
  return { obj: g };
}

// ── 개머리판 ──
/** 몸통 뒤(원점)에서 -X로. fit: { len(길이), top(위 끝 높이), bottom(아래 끝 높이) } */
export function makeStock(item, fit) {
  const d = designOf(item);
  const P = palette(d);
  const g = new THREE.Group();
  const body = role(mat(d.rank >= 2 ? '#24262B' : pick3(d, ['#1E1F23', '#5A4A35', '#3E4630']), { metal: 0.1, rough: 0.7 }), 'furniture');
  const L = fit.len * d.length, T = fit.top, B = fit.bottom;
  const pad = (x) => g.add(box(1.0, T - B + 0.4, 3.9, BLACK(), x - 0.5, (T + B) / 2));
  if (d.kind === 'folding') {
    for (const [y0, y1] of [[T - 0.8, T - 0.8], [-0.6, B + 1.2]]) {
      const a = new THREE.Vector3(0, y0 * 0.4, 0), b = new THREE.Vector3(-L, y1, 0);
      const len = a.distanceTo(b);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, len, 12), P.metal);
      t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      t.position.copy(a).add(b).multiplyScalar(0.5);
      g.add(t);
    }
    g.add(box(1.6, 2.2, 2.4, P.metal, -0.8, 0));
    g.add(slab([[-L, T], [-L + 1.4, T], [-L + 1.4, B], [-L, B]], 4.0, body, { bevel: 0.4 }));
    if (d.rank >= 1) g.add(box(0.4, (T - B) * 0.6, 4.1, P.accent, -L + 0.7, (T + B) / 2));
    return { obj: g };
  }
  if (d.kind === 'skeleton') {
    const outer = [[0, T * 0.7], [-L * 0.75, T], [-L, T], [-L, B], [-L * 0.85, B], [0, B * 0.45]];
    const holes = [
      [[-L * 0.18, T * 0.35], [-L * 0.62, T * 0.55], [-L * 0.62, B * 0.45], [-L * 0.18, B * 0.2]],
      [[-L * 0.7, T * 0.6], [-L * 0.88, T * 0.65], [-L * 0.88, B * 0.75], [-L * 0.7, B * 0.6]],
    ];
    g.add(slab(outer, 3.6, body, { bevel: 0.35, holes }));
    pad(-L);
    if (d.rank >= 2) g.add(box(L * 0.5, 0.3, 3.7, P.accent, -L * 0.45, T * 0.48));
    return { obj: g };
  }
  if (d.kind === 'precision' || d.kind === 'wing') {
    const wing = d.kind === 'wing';
    const outer = wing
      ? [[0, T * 0.6], [-L * 0.5, T * 0.9], [-L * 0.95, T * 1.25], [-L, T], [-L, B], [-L * 0.6, B * 0.85], [-L * 0.3, B * 0.35], [0, B * 0.3]]
      : [[0, T * 0.7], [-L, T * 0.8], [-L, B], [-L * 0.75, B], [-L * 0.55, B * 0.45], [-L * 0.25, B * 0.4], [0, B * 0.35]];
    g.add(slab(outer, wing ? 3.4 : 4.0, body, { bevel: 0.5, holes: wing ? [] : [[[-L * 0.15, B * 0.1], [-L * 0.48, B * 0.1], [-L * 0.48, B * 0.3], [-L * 0.15, B * 0.3]]] }));
    // 뺨받침(위로 조절)·조절 나사
    g.add(slab([[-L * 0.2, T * 0.75], [-L * 0.8, T * 0.85], [-L * 0.8, T * 0.85 + 1.6], [-L * 0.2, T * 0.75 + 1.6]], 3.2, wing ? P.accent : P.metal, { bevel: 0.3 }));
    for (const x of [-L * 0.3, -L * 0.7]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4.6, 12), P.accent);
      k.rotation.x = Math.PI / 2;
      k.position.set(x, T * 0.6, 0);
      g.add(k);
    }
    pad(-L);
    if (!wing && d.rank >= 2) g.add(box(0.8, 3.2, 1.2, P.metal, -L * 0.88, B - 1.4)); // 외다리 받침
    if (wing) {
      for (const z of [-1, 1]) g.add(box(L * 0.75, 0.25, 0.1, P.glow, -L * 0.5, (T + B) * 0.3, z * 1.75));
      g.add(slab([[-L * 0.95, T * 1.25], [-L * 0.75, T * 1.6], [-L * 0.62, T * 1.0]], 0.8, P.accent, { bevel: 0.1 }));
    }
    return { obj: g };
  }
  // 고정식
  g.add(slab([[0, T * 0.75], [-L * 0.9, T], [-L, T], [-L, B], [-L * 0.85, B], [0, B * 0.4]], 3.8, body, { bevel: 0.4 }));
  pad(-L);
  if (d.rank >= 1) for (let i = 0; i < d.rings; i++) g.add(box(0.3, (T - B) * 0.4, 3.9, d.rank >= 2 ? P.accent : BLACK(), -L * (0.3 + i * 0.12), (T + B) * 0.4));
  return { obj: g };
}
function pick3(d, list) { return list[Math.floor(d.length * 97) % list.length]; }

// ── 탄창 ──
/** 탄창 자리 위(원점)에서 아래(-Y)로. fit: { w(앞뒤 폭), len(길이), depth(두께), curve(앞으로 휘는 정도), pistol(권총 바닥판 연장) } */
export function makeMag(item, fit) {
  const d = designOf(item);
  const P = palette(d);
  const g = new THREE.Group();
  const body = role(mat(d.rank >= 2 ? '#2B2E34' : '#2E3035', { metal: 0.5, rough: 0.5 }), 'metal');
  const plate = d.rank >= 2 ? P.accent : role(mat('#1E1F23', { metal: 0.1, rough: 0.78 }), 'furniture');
  const W = fit.w, D = fit.depth, C = fit.curve;
  if (fit.pistol) {
    // 권총: 손잡이 아래로 늘어난 연장 탄창 + 바닥판
    const ext = d.kind === 'drum' ? 0 : fit.len * ({ straight: 0.6, curved: 0.8, extended: 1.6, coupled: 1.4, casket: 2.0 }[d.kind] ?? 1) * d.length;
    if (d.kind === 'drum') {
      g.add(zcyl(W * 0.62, D * 1.5, body, 0, -W * 0.55, 0, 28), zring(W * 0.3, 0.2, P.accent, 0, -W * 0.55, D * 0.76));
      if (d.glow) g.add(zring(W * 0.62, 0.12, P.glow, 0, -W * 0.55, D * 0.78));
      return { obj: g, length: W * 1.2 };
    }
    g.add(slab([[-W / 2 + 0.2, 0.2], [W / 2 - 0.2, 0.2], [W / 2 - 0.2, -ext], [-W / 2 + 0.2, -ext]], D, body, { bevel: 0.15 }));
    g.add(box(W + 0.5, 0.7, D + 0.3, plate, 0, -ext - 0.35));
    if (d.rank >= 1) for (let i = 1; i <= Math.min(3, d.rings); i++) g.add(box(0.15, ext * 0.8, 0.06, BLACK(), -W / 2 + (i * W) / 4, -ext / 2, D / 2 + 0.01));
    if (d.glow) g.add(box(W + 0.6, 0.15, D + 0.35, P.glow, 0, -ext - 0.05));
    return { obj: g, length: ext + 0.7 };
  }
  const lenMul = { straight: 1, curved: 1, extended: 1.45, coupled: 1, drum: 0.45, casket: 1.25 }[d.kind] ?? 1;
  const L = fit.len * lenMul * (d.kind === 'drum' ? 1 : d.length * 0.9 + 0.1);
  const bend = (d.kind === 'curved' || d.kind === 'extended' || d.kind === 'coupled' ? C + 0.1 : d.kind === 'casket' ? C * 0.3 : 0) * L;
  const W2 = d.kind === 'casket' ? W * 1.25 : W;
  const pts = [[-W / 2, 0.3], [W / 2, 0.3], [W / 2 + bend * 0.45, -L * 0.55], [W2 / 2 + bend, -L], [-W2 / 2 + bend, -L - 0.4], [-W / 2 + bend * 0.4, -L * 0.55]];
  const one = (z) => {
    const s = slab(pts, d.kind === 'casket' ? D * 1.5 : D, body, { bevel: 0.22 });
    s.position.z = z;
    g.add(s);
    const bp = box(W2 + 0.6, 0.9, (d.kind === 'casket' ? D * 1.5 : D) + 0.4, plate, bend, -L - 0.6, z);
    g.add(bp);
    if (d.rank >= 1) for (let i = 0; i < 2 + d.rank; i++) g.add(box(0.18, L * 0.55, 0.05, BLACK(), -W / 2 + 0.8 + i * (W / (2.5 + d.rank)) + bend * 0.3, -L * 0.45, z + (d.kind === 'casket' ? D * 0.76 : D / 2 + 0.01)));
  };
  if (d.kind === 'drum') {
    one(0);
    const R = W * 1.15;
    g.add(zcyl(R, D * 2.6, body, R * 0.2, -L - R * 0.8, 0, 32));
    for (const z of [-1, 1]) g.add(zcyl(R * 0.55, 0.3, P.accent, R * 0.2, -L - R * 0.8, z * D * 1.32));
    if (d.rank >= 3) g.add(zring(R, 0.18, P.glow, R * 0.2, -L - R * 0.8, D * 1.31));
    return { obj: g, length: L + R * 1.8 };
  }
  if (d.kind === 'coupled') {
    one(0);
    one(-D - 0.4);
    for (const y of [-L * 0.3, -L * 0.6]) g.add(box(W + 0.4, 1.4, D * 2 + 1.0, P.accent, bend * 0.4 * (-y / L) * 2, y, -(D + 0.4) / 2));
  } else {
    one(0);
  }
  if (d.glow) g.add(box(0.2, L * 0.7, 0.1, P.glow, W / 2 - 0.4 + bend * 0.4, -L * 0.45, D / 2 + 0.05));
  return { obj: g, length: L + 1 };
}

// ── 총 색깔 ──
const skinCache = new Map();
function patternTexture(d, kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  let a = (d.length * 1e6) >>> 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  g.fillStyle = d.base;
  g.fillRect(0, 0, 256, 256);
  if (kind === 'camo') {
    for (const color of d.pattern) {
      g.fillStyle = color;
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        const x = rnd() * 256, y = rnd() * 256, r = 14 + rnd() * 30;
        for (let k = 0; k < 9; k++) { const t = (k / 9) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6); g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.7); }
        g.fill();
      }
    }
  } else if (kind === 'tiger') {
    g.fillStyle = d.pattern[1];
    for (let i = 0; i < 12; i++) {
      const y = rnd() * 256;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x / 30 + i) * 10 + (rnd() - 0.5) * 8);
      for (let x = 256; x >= 0; x -= 32) g.lineTo(x, y + 5 + rnd() * 6);
      g.fill();
    }
  } else if (kind === 'digital') {
    for (const color of d.pattern) {
      g.fillStyle = color;
      for (let i = 0; i < 120; i++) g.fillRect(Math.floor(rnd() * 32) * 8, Math.floor(rnd() * 32) * 8, 8 * (1 + Math.floor(rnd() * 3)), 8);
    }
  } else if (kind === 'carbon') {
    for (let y = 0; y < 256; y += 8) for (let x = 0; x < 256; x += 8) {
      g.fillStyle = (x + y) % 16 === 0 ? '#2A2C30' : '#16171A';
      g.fillRect(x, y, 8, 8);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x, y, 8, 2);
    }
  } else if (kind === 'gold') {
    g.fillStyle = '#141210';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#E2B54A';
    g.lineWidth = 2;
    for (let i = 0; i < 10; i++) { // 덩굴무늬 새김
      g.beginPath();
      const y = rnd() * 256;
      g.moveTo(0, y);
      for (let x = 0; x < 256; x += 16) g.quadraticCurveTo(x + 8, y + (rnd() - 0.5) * 40, x + 16, y + Math.sin(x / 20) * 12);
      g.stroke();
    }
  } else if (kind === 'chrome') {
    const gr = g.createLinearGradient(0, 0, 256, 256);
    gr.addColorStop(0, '#F4F6F8'); gr.addColorStop(0.5, '#9AA2AE'); gr.addColorStop(1, '#E8ECF0');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  } else if (kind === 'neon' || kind === 'dragon') {
    g.fillStyle = kind === 'dragon' ? '#2A0E0A' : '#0E1016';
    g.fillRect(0, 0, 256, 256);
    if (kind === 'dragon') {
      for (let y = 0; y < 256; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < 256; x += 16) { // 비늘
        g.fillStyle = `hsl(${10 + rnd() * 20}, 60%, ${16 + rnd() * 14}%)`;
        g.beginPath(); g.arc(x, y, 9, 0, Math.PI); g.fill();
        g.strokeStyle = '#C9A24A'; g.lineWidth = 1; g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.06 / d.scale, 0.06 / d.scale);
  return t;
}
/** 네온·용비늘: 빛나는 줄(발광 지도) */
function glowTexture(d, kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#fff';
  let a = (d.length * 7e5) >>> 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  if (kind === 'neon') {
    g.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      let x = 0, y = rnd() * 256;
      g.moveTo(x, y);
      while (x < 256) { x += 20 + rnd() * 30; if (rnd() < 0.5) g.lineTo(x, y); else { y += (rnd() - 0.5) * 60; g.lineTo(x, y); } }
      g.stroke();
    }
  } else {
    g.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) { // 비늘 사이 갈라진 빛
      g.beginPath();
      let x = rnd() * 256, y = rnd() * 256;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.06 / d.scale, 0.06 / d.scale);
  return t;
}
/** 총 색깔 파츠의 재질 { furniture, metal } */
export function skinMaterials(item) {
  if (skinCache.has(item.seed)) return skinCache.get(item.seed);
  const d = designOf(item);
  const k = d.kind;
  let furniture, metal;
  const patterned = ['camo', 'tiger', 'digital', 'carbon', 'gold', 'neon', 'dragon'].includes(k);
  const map = patterned ? patternTexture(d, k) : null;
  const emissiveMap = k === 'neon' || k === 'dragon' ? glowTexture(d, k) : null;
  const glowColor = k === 'dragon' ? '#FF7A1A' : d.accent;
  if (k === 'twotone') furniture = new THREE.MeshStandardMaterial({ color: d.second, metalness: 0.1, roughness: 0.65 });
  else if (k === 'chrome') furniture = new THREE.MeshStandardMaterial({ color: '#F2F4F7', metalness: 0.3, roughness: 0.25 });
  else furniture = new THREE.MeshStandardMaterial({
    color: map ? '#FFFFFF' : d.base, map, metalness: k === 'carbon' ? 0.3 : k === 'gold' ? 0.4 : 0.1, roughness: k === 'carbon' ? 0.35 : 0.6,
    ...(emissiveMap ? { emissive: glowColor, emissiveMap, emissiveIntensity: 2.2 } : {}),
  });
  metal = new THREE.MeshStandardMaterial({ color: d.metalColor, metalness: 0.9, roughness: k === 'chrome' ? 0.08 : k === 'gold' ? 0.2 : 0.38 });
  for (const m of [furniture, metal]) m.userData.shared = true;
  const out = { furniture, metal };
  skinCache.set(item.seed, out);
  return out;
}

// ── 총에 장착 ──
/**
 * 총 모델(guns.js의 xxxModel())에 장착한 파츠를 붙인다. model.userData.mods에 붙일 자리가 있다:
 *   size(크기 배율), bore(총구 굵기), scope([x, y] 레일 위), sight(기본 조준경 묶음, 스코프를 달면 숨김),
 *   stock(기본 개머리판 묶음)·stockAt([x, y])·stockFit, magFit(탄창 자리·크기). 탄창은 model.userData.mag(장전 때 움직이는 묶음)에 넣는다.
 * equipped: { 칸: item }. 총구를 달면 불꽃 위치(muzzle)가 그만큼 앞으로, 소음기면 불꽃이 작아진다(flashScale).
 */
export function applyMods(model, equipped = {}) {
  const u = model.userData;
  const m = u.mods;
  if (!m) return model;
  if (equipped.muzzle && u.muzzle) {
    const part = makeMuzzle(equipped.muzzle, m.bore ?? 1);
    part.obj.position.set(u.muzzle[0] - 0.1, u.muzzle[1], u.muzzle[2]);
    model.add(part.obj);
    u.muzzle = [u.muzzle[0] + part.length, u.muzzle[1], u.muzzle[2]];
    u.flashScale = part.flash;
  }
  if (equipped.scope && m.scope) {
    if (m.sight) m.sight.visible = false;
    const part = makeScope(equipped.scope, m.size ?? 1);
    part.obj.position.set(m.scope[0], m.scope[1], 0);
    model.add(part.obj);
  }
  if (equipped.stock && m.stock && m.stockAt) {
    m.stock.visible = false;
    const part = makeStock(equipped.stock, m.stockFit);
    part.obj.position.set(m.stockAt[0], m.stockAt[1], 0);
    model.add(part.obj);
  }
  if (equipped.mag && m.magFit && u.mag) {
    for (const c of u.mag.hideOnMod ?? u.mag.obj.children.slice()) c.visible = false;
    const part = makeMag(equipped.mag, m.magFit);
    const [dx, dy] = u.mag.dir;
    part.obj.position.set(m.magFit.top[0], m.magFit.top[1], 0);
    part.obj.rotation.z = Math.atan2(dx, -dy); // 아래(-Y)를 탄창 방향으로
    u.mag.obj.add(part.obj);
    u.mag.base = [m.magFit.top[0] + dx * part.length, m.magFit.top[1] + dy * part.length];
  }
  if (equipped.skin) {
    const skin = skinMaterials(equipped.skin);
    model.traverse((o) => {
      if (!o.isMesh || !o.material?.userData) return;
      const r = o.material.userData.role;
      if (r === 'furniture') o.material = skin.furniture;
      else if (r === 'metal') o.material = skin.metal;
    });
  }
  return model;
}

/** 작업실 뽑기 연출용: 파츠 하나만 보여 주는 모델(가운데 정렬, 대략 크기 16cm) */
export function makePartPreview(item) {
  const g = new THREE.Group();
  let obj;
  if (item.slot === 'muzzle') obj = makeMuzzle(item, 1).obj;
  else if (item.slot === 'scope') obj = makeScope(item, 1).obj;
  else if (item.slot === 'stock') obj = makeStock(item, { len: 22, top: 2.6, bottom: -9 }).obj;
  else if (item.slot === 'mag') obj = makeMag(item, { w: 6, len: 15, depth: 2.4, curve: 0.25 }).obj;
  else {
    // 총 색깔: 색을 입힌 견본 판과 쇠 막대
    const skin = skinMaterials(item);
    obj = new THREE.Group();
    obj.add(slab([[-9, -5], [9, -5], [9, 5], [-9, 5]], 2.2, skin.furniture, { bevel: 0.6 }));
    obj.add(tube(1.2, 1.2, -10, 10, skin.metal, { y: 7 }));
  }
  const bb = new THREE.Box3().setFromObject(obj);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  const k = 16 / Math.max(size.x, size.y, size.z, 1);
  g.scale.setScalar(k);
  g.add(obj);
  return g;
}
