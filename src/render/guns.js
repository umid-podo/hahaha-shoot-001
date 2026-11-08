import * as THREE from '../vendor/three.module.min.js';
import { WEAPONS } from '../game/config.js';
import { modStore } from '../game/mods.js';
import { applyMods } from './parts.js';

/** 그 무기의 장탄 수(없거나 0이면 무제한) */
const WEAPON_MAG = (id) => (WEAPONS[id]?.mag > 0 ? WEAPONS[id].mag : Infinity);

/**
 * 1인칭 3D 화면의 손에 든 총(뷰모델)과 실제 총알 모양의 탄. 그림 파일 없이 three.js 도형으로 만든다.
 * 총 모델 좌표: 단위 cm, 총구가 +X, 위가 +Y, 총의 오른쪽(탄피 배출구 쪽)이 +Z. 총열 중심선이 y = 0.
 * 실제 총의 옆모습(윤곽)을 다각형으로 그려 두께만큼 밀어 만든다(ExtrudeGeometry). 손은 검은 양복 소매·흰 셔츠 소맷부리·맨손.
 *   권총: 글록 계열 폴리머 권총 · 쌍권총: 투톤(은색 슬라이드) 권총 두 자루를 양손에 하나씩
 *   돌격소총: M4 카빈(레일·도트 조준경·곡선 탄창) · 기관단총: MP5 · 저격총: 볼트액션 저격총(조준경·머즐 브레이크)
 *   샷건: 펌프액션 샷건(나무 개머리판) · RPG: RPG-7(나무 열 차폐판·PGO-7 조준경·탄두) · 아킴보 석궁: 권총형 석궁 두 자루
 *   단검: 전투 나이프 · 즉사기: 분홍빛 코일 에너지 총 · 레이저 캐논(R-10): 손 없는 쌍열 포
 * 쏠 때: 뒤로 튀는 반동, 총구 불꽃(빛 + 잠깐 밝아지는 점광원), 총구 연기(world3d가 경기장에 띄움).
 */

const cache = new Map();
function mat(color, { metal = 0.2, rough = 0.6, emissive = null, intensity = 1 } = {}) {
  const key = [color, metal, rough, emissive, intensity].join('|');
  if (!cache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...(emissive ? { emissive, emissiveIntensity: intensity } : {}) });
    m.userData.shared = true;
    cache.set(key, m);
  }
  return cache.get(key);
}
/** 재질의 역할: 'metal'(쇠 부분)·'furniture'(손잡이·개머리판 같은 몸통). 총 색깔 파츠가 이 역할대로 색을 바꾼다 */
const role = (m, r) => { m.userData.role = r; return m; };
const STEEL = () => role(mat('#2A2C31', { metal: 0.85, rough: 0.38 }), 'metal');
const BLUED = () => role(mat('#1A1C20', { metal: 0.8, rough: 0.45 }), 'metal');
const POLY = () => role(mat('#1E1F23', { metal: 0.1, rough: 0.78 }), 'furniture');
const POLY2 = () => role(mat('#2D2F34', { metal: 0.1, rough: 0.7 }), 'furniture');
const MAGMAT = () => role(mat('#2E3035', { metal: 0.5, rough: 0.5 }), 'metal');
const BLACK = () => mat('#060708', { metal: 0.2, rough: 0.9 });
const STAINLESS = () => role(mat('#B8BCC4', { metal: 0.95, rough: 0.22 }), 'metal');
const WOOD = () => role(mat('#7A4724', { metal: 0, rough: 0.55 }), 'furniture');
const WOOD_DARK = () => role(mat('#4E2C15', { metal: 0, rough: 0.6 }), 'furniture');
const OLIVE = () => role(mat('#5B6440', { metal: 0.05, rough: 0.7 }), 'furniture');
const BRASS = () => mat('#C9A34B', { metal: 1, rough: 0.28 });
const COPPER = () => mat('#C06E3C', { metal: 1, rough: 0.3 });
const SKIN = () => mat('#E9BC97', { metal: 0, rough: 0.68 });
const SLEEVE = () => mat('#15171C', { metal: 0, rough: 0.92 });
const CUFF = () => mat('#EDEFF2', { metal: 0, rough: 0.8 });

// ── 도형 도우미 ──
/** 옆모습 다각형(x 앞, y 위)을 두께 depth로 민 판. holes는 뚫린 구멍(방아쇠울 안쪽 등) */
function slab(points, depth, material, { bevel = 0.18, holes = [], z = 0 } = {}) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const core = Math.max(0.02, depth - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: core, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
  });
  geo.translate(0, 0, -core / 2 + z);
  return new THREE.Mesh(geo, material);
}
/** x0에서 x1까지 X축을 따라 놓인 원통(뒤 반지름 rBack, 앞 반지름 rFront) */
function tube(rBack, rFront, x0, x1, material, { y = 0, z = 0, seg = 20 } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rBack, rFront, x1 - x0, seg), material);
  m.rotation.z = Math.PI / 2; // 원통의 위(+Y, rBack)가 뒤(-X)로
  m.position.set((x0 + x1) / 2, y, z);
  return m;
}
function box(w, h, d, material, x, y, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}
function capsule(r, len, material) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), material);
}
/** X축을 따라 돌린 회전체(points: [x, 반지름]) — 탄두·총알 */
function lathe(points, material, seg = 18) {
  const geo = new THREE.LatheGeometry(points.map(([x, r]) => new THREE.Vector2(r, x)), seg);
  geo.rotateZ(-Math.PI / 2); // 회전축(+Y)을 +X로
  return new THREE.Mesh(geo, material);
}
/** 피카티니 레일(위에 홈이 줄지어 있는 레일) */
function rail(x0, x1, y, material) {
  const g = new THREE.Group();
  g.add(box(x1 - x0, 0.5, 2.1, material, (x0 + x1) / 2, y));
  for (let x = x0 + 0.5; x < x1 - 0.3; x += 1.0) g.add(box(0.5, 0.45, 2.1, material, x, y + 0.45));
  return g;
}

/** 탄창 묶음: 장전할 때 dir(총 좌표, 아래쪽) 방향으로 빠졌다가 새 탄창이 들어온다. base는 탄창 바닥(받치는 손이 갈 자리) */
function magazine(g, parts, dir, base) {
  const m = new THREE.Group();
  for (const p of parts) m.add(p);
  g.add(m);
  const v = new THREE.Vector2(dir[0], dir[1]).normalize();
  return { obj: m, dir: [v.x, v.y], base };
}

/** g 안의 묶음(개조할 때 통째로 숨기거나 바꾸는 부분: 기본 조준경·개머리판) */
function sub(g) { const m = new THREE.Group(); g.add(m); return m; }

// ── 손 ──
/**
 * 권총 손잡이를 쥔 오른손. 손잡이 기준 좌표(원점 = 손잡이 가운데, y = 손잡이 축 위쪽, x = 앞, z = 오른쪽)에서 만든다.
 * w: 손잡이 두께(z), d: 손잡이 앞뒤 폭(x). 팔(소매)은 아래 뒤 오른쪽(카메라 쪽)으로 뻗는다.
 */
function gripHand(w, d, { arm = [-26, -14, 12], tilt = 0 } = {}) {
  const g = new THREE.Group();
  // 팔 방향은 총 좌표로 받아 손잡이 기준 좌표로 돌린다
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  arm = [c * arm[0] - sn * arm[1], sn * arm[0] + c * arm[1], arm[2]];
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), SKIN()); // 손등(둥글게)
  palm.scale.set(d / 2 + 1.4, 5.0, 1.7);
  palm.position.set(-0.3, 0, w / 2 + 0.9);
  g.add(palm);
  const heel = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), SKIN()); // 손바닥 아래(손목 쪽 두툼한 곳)
  heel.scale.set(d / 2 + 0.8, 2.4, w / 2 + 1.2);
  heel.position.set(-d / 2 + 0.2, -3.4, 0.3);
  g.add(heel);
  // 손가락 넷: 손잡이 앞쪽을 감싼다
  [2.6, 0.6, -1.4, -3.3].forEach((y, i) => {
    const f = capsule(0.95, w + 1.2 - i * 0.25, SKIN());
    f.rotation.x = Math.PI / 2;
    f.position.set(d / 2 + 0.75, y, 0.25);
    g.add(f);
  });
  // 엄지: 왼쪽 위로 앞을 향해
  const thumb = capsule(1.0, 4.2, SKIN());
  thumb.rotation.z = Math.PI / 2 - 0.25;
  thumb.position.set(0.6, 4.0, -w / 2 - 0.8);
  g.add(thumb);
  g.add(forearm([-d / 2 - 0.6, -3.8, w / 2 + 0.6], arm));
  return g;
}
/** 총열 덮개 아래를 받친 왼손. 원점 = 받치는 곳(총열 덮개 중심), r = 총열 덮개 반지름 */
function supportHand(r, { arm = [-24, -20, -14] } = {}) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), SKIN());
  palm.scale.set(4.8, 1.7, 4.2);
  palm.position.set(0, -r - 1.2, 0);
  g.add(palm);
  // 손가락: 먼 쪽(왼쪽, -Z)으로 감아 올라감
  [-2.7, -0.9, 0.9, 2.7].forEach((x) => {
    const f = capsule(0.9, r * 1.1 + 0.8, SKIN());
    f.position.set(x, -r * 0.35, -r - 0.8);
    f.rotation.x = 0.25;
    g.add(f);
  });
  const thumb = capsule(1.0, 4.0, SKIN());
  thumb.rotation.z = Math.PI / 2;
  thumb.position.set(1.2, -r * 0.4, r + 0.9);
  g.add(thumb);
  g.add(forearm([-3.6, -r - 2.2, 0], arm));
  return g;
}
/** 손목(from)에서 팔꿈치 쪽(from + dir)으로 뻗은 양복 소매와 흰 소맷부리 */
function forearm(from, dir) {
  const g = new THREE.Group();
  const a = new THREE.Vector3(...from);
  const v = new THREE.Vector3(...dir);
  const len = v.length();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, v.clone().normalize());
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.8, 2.2, 18), CUFF());
  cuff.quaternion.copy(q);
  cuff.position.copy(a).addScaledVector(v, 1.1 / len);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.4, len, 18), SLEEVE());
  sleeve.quaternion.copy(q);
  sleeve.position.copy(a).addScaledVector(v, (2.0 + len / 2) / len);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.3, 2.4, 14), SKIN());
  wrist.quaternion.copy(q);
  wrist.position.copy(a);
  g.add(wrist, cuff, sleeve);
  return g;
}
/** 손잡이 기준 좌표의 손을 총 좌표의 (x, y)에 손잡이 기울기 tilt(아래가 뒤로 기운 각도)로 붙인다 */
function placeHand(hand, x, y, tilt) {
  hand.position.set(x, y, 0);
  hand.rotation.z = -tilt;
  return hand;
}

// ── 총 모델(손 포함) ──
/** 글록 계열 권총. two-tone이면 은색 슬라이드. 손잡이 기울기 0.2rad */
function pistolModel({ twoTone = false } = {}) {
  const g = new THREE.Group();
  const slide = twoTone ? STAINLESS() : STEEL();
  g.add(slab([[-10, -0.9], [8.6, -0.9], [8.6, 1.15], [8.1, 1.6], [-9.6, 1.6], [-10, 1.2]], 2.5, slide, { bevel: 0.2 }));
  for (let i = 0; i < 6; i++) g.add(box(0.16, 1.5, 2.62, BLACK(), -9.3 + i * 0.4, 0.45)); // 뒤쪽 미끄럼 방지 홈
  g.add(box(3.0, 0.9, 0.06, BLACK(), 1.2, 0.9, 1.27)); // 탄피 배출구
  g.add(box(2.6, 0.55, 0.05, twoTone ? STEEL() : BRASS(), 1.2, 0.85, 1.29)); // 배출구 안의 약실(놋쇠빛)
  g.add(tube(0.5, 0.5, 8.55, 8.7, BLACK(), { seg: 14 })); // 총구 구멍
  g.add(box(0.45, 0.5, 0.35, BLACK(), 7.9, 1.85)); // 가늠쇠
  g.add(box(0.5, 0.55, 0.65, BLACK(), -8.9, 1.85, 0.6)); // 가늠자(가운데 홈)
  g.add(box(0.5, 0.55, 0.65, BLACK(), -8.9, 1.85, -0.6));
  const frame = [[-10.2, -0.9], [8.2, -0.9], [8.2, -1.9], [4.6, -2.1], [4.4, -3.6], [3.4, -4.4], [0.0, -4.5], [-1.4, -3.0],
    [-2.2, -4.0], [-3.4, -12.6], [-3.9, -13.2], [-9.0, -13.2], [-9.5, -12.6], [-9.8, -3.4], [-10.8, -2.1]];
  const guard = [[3.6, -2.05], [3.5, -3.3], [2.9, -3.8], [0.3, -3.85], [-0.8, -2.9], [-1.0, -2.05]];
  g.add(slab(frame, 2.8, POLY(), { bevel: 0.3, holes: [guard] }));
  // 탄창: 손잡이 안의 몸통(평소엔 손잡이에 가려 안 보임) + 바닥판
  const mag = magazine(g, [
    slab([[-3.7, -3.2], [-8.7, -3.2], [-9.2, -13.0], [-4.0, -13.0]], 2.2, MAGMAT(), { bevel: 0.1 }),
    box(5.9, 0.55, 2.9, POLY2(), -6.5, -13.4),
  ], [-0.2, -1], [-6.5, -13.7]);
  const trigger = box(0.35, 1.5, 0.45, BLACK(), 1.5, -2.9);
  trigger.rotation.z = 0.25;
  g.add(trigger);
  // 손잡이 미끄럼 방지 무늬(오른쪽 면)
  for (let y = -11.5; y < -4.5; y += 1.1) g.add(box(4.2, 0.12, 0.05, BLACK(), -6.4 + (y + 8) * 0.14, y, 1.42));
  mag.hideOnMod = [mag.obj.children[1]]; // 개조 탄창은 바닥판 자리에 붙는다(손잡이 안 탄창 몸통은 그대로)
  g.userData = {
    muzzle: [8.8, 0, 0], grip: { x: -6.3, y: -7.4, tilt: 0.2, w: 2.8, d: 5.4 }, mag, pivot: [1.4, -3.0],
    mods: { size: 0.55, bore: 0.55, scope: [-3.4, 1.6], magFit: { top: [-6.5, -13.6], w: 5.4, len: 3.6, depth: 2.7, curve: 0, pistol: true } },
  };
  return g;
}

/** M4 카빈: 위 리시버·레일·도트 조준경·총열 덮개·가늠쇠 기둥·소염기·곡선 탄창·접이식 개머리판 */
function rifleModel() {
  const g = new THREE.Group();
  g.add(slab([[-14, -1.6], [6, -1.6], [6, 2.0], [-14, 2.0]], 3.0, STEEL(), { bevel: 0.25 }));
  g.add(rail(-13.6, 5.6, 2.25, BLUED()));
  g.add(box(5.2, 1.6, 0.06, BLUED(), -5.5, 0.2, 1.53)); // 배출구 덮개
  g.add(tube(0.55, 0.55, -11.8, -10.4, STEEL(), { y: 1.0, z: 1.9 })); // 전진기
  g.add(box(2.6, 0.7, 3.6, BLUED(), -14.6, 1.6)); // 장전 손잡이
  // 도트 조준경(개조 스코프를 달면 숨김)
  const sight = sub(g);
  sight.add(box(4.0, 1.4, 2.2, BLUED(), -4, 3.3));
  sight.add(tube(2.0, 2.0, -7.2, -0.6, BLUED(), { y: 5.3 }));
  sight.add(tube(2.15, 2.15, -1.0, 0.2, BLUED(), { y: 5.3 }));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(1.7, 20), mat('#1C2A3A', { metal: 0.9, rough: 0.05 }));
  lens.rotation.y = -Math.PI / 2;
  lens.position.set(-7.25, 5.3, 0);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), new THREE.MeshBasicMaterial({ color: '#FF2030' }));
  dot.rotation.y = -Math.PI / 2;
  dot.position.set(-7.3, 5.3, 0);
  sight.add(lens, dot);
  sight.add(tube(0.9, 0.9, -4.6, -3.4, BLUED(), { y: 7.4, seg: 12 }));
  // 총열 덮개(팔각) · 델타 링
  const hg = tube(2.2, 2.2, 6.6, 22, POLY(), { seg: 8 });
  hg.rotation.x = Math.PI / 8;
  g.add(hg);
  for (let x = 8; x < 21; x += 2.2) g.add(box(1.2, 0.5, 0.05, BLACK(), x, 0.6, 2.05)); // 덮개 숨구멍
  g.add(tube(2.5, 2.5, 6, 6.8, BLUED()));
  g.add(rail(7, 21.6, 2.2, BLUED()));
  // 총열 · 가늠쇠 받침(A자) · 소염기
  g.add(tube(0.75, 0.7, 22, 36, STEEL(), { seg: 14 }));
  g.add(tube(1.05, 1.05, 25, 27.4, BLUED()));
  g.add(slab([[24.8, 0.4], [27.4, 0.4], [26.6, 4.0], [25.6, 4.0]], 1.2, BLUED(), { bevel: 0.1 }));
  g.add(box(0.35, 1.0, 0.35, BLACK(), 26.1, 4.4));
  g.add(tube(0.95, 0.95, 36, 40, BLUED(), { seg: 14 }));
  for (const a of [0.4, 1.2, 2.0]) {
    const s = box(2.4, 0.3, 0.6, BLACK(), 38.4, Math.cos(a) * 0.9, Math.sin(a) * 0.9);
    s.rotation.x = -a;
    g.add(s);
  }
  g.add(tube(0.6, 0.6, 39.9, 40.05, BLACK(), { seg: 12 }));
  // 아래 리시버 · 탄창 삽입구 · 곡선 탄창
  g.add(slab([[-14, -1.6], [4, -1.6], [4, -3.2], [-1, -3.6], [-14, -3.4]], 2.8, STEEL(), { bevel: 0.25 }));
  g.add(slab([[-4.6, -1.6], [2.6, -1.6], [2.7, -5.8], [-4.5, -5.8]], 3.1, STEEL(), { bevel: 0.25 }));
  const mag = magazine(g, [
    slab([[-4.2, -5.4], [2.3, -5.4], [3.7, -13.8], [4.6, -19.6], [-1.4, -20.4], [-2.5, -14.2]], 2.4, MAGMAT(), { bevel: 0.25 }),
    slab([[4.6, -19.6], [5.0, -20.6], [-1.6, -21.4], [-1.4, -20.4]], 2.8, POLY(), { bevel: 0.2 }),
  ], [0.15, -1], [1.6, -21.4]);
  // 방아쇠울 · 방아쇠 · 손잡이
  g.add(box(6.6, 0.45, 1.3, STEEL(), -8.2, -5.7));
  g.add(box(0.5, 2.3, 1.3, STEEL(), -4.9, -4.6));
  const trig = box(0.35, 1.7, 0.45, BLACK(), -6.4, -4.4);
  trig.rotation.z = 0.25;
  g.add(trig);
  g.add(slab([[-12.4, -3.0], [-8.6, -3.0], [-10.8, -13.6], [-15.0, -13.2]], 3.0, POLY(), { bevel: 0.45 }));
  // 완충 튜브 · 개머리판 · 고무 받침
  g.add(tube(1.5, 1.5, -28, -14, BLUED(), { y: -0.2 }));
  const stock = sub(g);
  stock.add(slab([[-38, 2.2], [-27, 1.6], [-26, -2.6], [-27.5, -6.2], [-38, -9.6], [-39, -9.6], [-39, 2.2]], 3.8, POLY(), { bevel: 0.35 }));
  stock.add(box(0.9, 12, 4.0, BLACK(), -39.4, -3.6));
  g.userData = {
    muzzle: [40.3, 0, 0], grip: { x: -12.1, y: -8.3, tilt: 0.2, w: 3.0, d: 4.0 }, support: { x: 14.5, r: 2.2 }, mag,
    mods: { size: 1, bore: 0.95, scope: [-4, 2.7], sight, stock, stockAt: [-27, -0.2], stockFit: { len: 12, top: 2.4, bottom: -9.4 },
      magFit: { top: [-0.9, -5.4], w: 6.4, len: 15, depth: 2.4, curve: 0.25 } },
  };
  return g;
}

/** MP5: 둥근 리시버·장전 손잡이 튜브·둥근 가늠쇠 고리·곡선 탄창·접이식 개머리판(두 막대) */
function smgModel() {
  const g = new THREE.Group();
  g.add(tube(1.95, 1.95, -16, 8, STEEL(), { y: 0.2 }));
  g.add(slab([[-16, -2.0], [8, -2.0], [8, 0.6], [-16, 0.6]], 3.4, STEEL(), { bevel: 0.25 }));
  g.add(tube(0.9, 0.9, 3, 15.4, STEEL(), { y: 1.7 }));
  g.add(box(1.0, 0.8, 1.8, BLUED(), 12.2, 1.9, -1.4)); // 장전 손잡이(왼쪽)
  g.add(box(4.2, 1.2, 0.06, BLACK(), -4, 0.6, 1.98)); // 배출구
  g.add(slab([[8, -2.4], [17, -2.4], [17, 0.9], [8, 0.9]], 4.4, POLY(), { bevel: 0.9 }));
  for (let x = 9.5; x < 16; x += 1.6) g.add(box(0.5, 2.0, 0.06, BLACK(), x, -0.8, 2.25));
  g.add(tube(0.95, 0.95, 17, 19.6, STEEL()));
  g.add(tube(0.62, 0.62, 19.6, 21, STEEL(), { seg: 14 }));
  g.add(tube(0.45, 0.45, 20.9, 21.05, BLACK(), { seg: 12 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.28, 8, 20), BLUED());
  ring.rotation.y = Math.PI / 2;
  ring.position.set(15.2, 3.5, 0);
  g.add(ring, box(0.6, 1.4, 0.5, BLUED(), 15.2, 2.4));
  const drum = tube(0.9, 0.9, -14.5, -12.5, BLUED(), { y: 2.6 });
  g.add(drum);
  // 곡선 탄창
  const mag = magazine(g, [
    slab([[1.2, -2.0], [4.8, -2.0], [6.8, -9], [9.8, -15.4], [6.8, -16.6], [3.6, -9.6]], 2.1, MAGMAT(), { bevel: 0.2 }),
  ], [0.4, -1], [8.3, -16.4]);
  g.add(slab([[-10, -2], [-1, -2], [-1.5, -5.6], [-4.6, -5.8], [-7.4, -14], [-11.6, -13.4], [-10.6, -5.0], [-11.5, -2]], 3.0, POLY(), {
    bevel: 0.35, holes: [[[-2.1, -2.6], [-2.3, -4.9], [-4.9, -5.0], [-5.1, -2.6]]],
  }));
  const trig = box(0.35, 1.5, 0.4, BLACK(), -3.4, -3.6);
  trig.rotation.z = 0.25;
  g.add(trig);
  const stock = sub(g);
  for (const z of [-1.3, 1.3]) stock.add(tube(0.45, 0.45, -30, -15.6, STEEL(), { z, y: -0.6, seg: 10 }));
  stock.add(slab([[-31, 3.0], [-29.6, 3.0], [-29.6, -7.0], [-31, -7.0]], 4.6, POLY(), { bevel: 0.4 }));
  g.userData = {
    muzzle: [21.2, 0, 0], grip: { x: -8.8, y: -8.8, tilt: 0.3, w: 3.0, d: 4.0 }, support: { x: 12.5, r: 2.4 }, mag,
    mods: { size: 0.85, bore: 0.7, scope: [-6, 2.15], stock, stockAt: [-16, -0.4], stockFit: { len: 14, top: 2.6, bottom: -7.4 },
      magFit: { top: [3, -2.0], w: 3.6, len: 14, depth: 2.1, curve: 0.45 } },
  };
  return g;
}

/** 볼트액션 저격총: 국방색 개머리판·볼트 손잡이·조준경(대물렌즈·접안렌즈·다이얼)·머즐 브레이크·접은 양각대 */
function sniperModel() {
  const g = new THREE.Group();
  g.add(tube(1.7, 1.7, -14, 10, STEEL()));
  g.add(tube(1.25, 0.85, 10, 58, STEEL(), { seg: 16 }));
  g.add(tube(1.35, 1.35, 58, 63, BLUED(), { seg: 16 }));
  for (const x of [59.3, 60.8, 62.3]) for (const z of [-1, 1]) g.add(box(0.7, 0.9, 0.3, BLACK(), x, 0, z * 1.25));
  g.add(tube(0.6, 0.6, 62.95, 63.1, BLACK(), { seg: 12 }));
  // 볼트 손잡이(오른쪽, 끝에 둥근 손잡이)
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 4.4, 10), STEEL());
  bolt.rotation.x = Math.PI / 2 - 0.5;
  bolt.position.set(-10.5, -0.6, 2.8);
  g.add(bolt);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 10), BLUED());
  knob.position.set(-10.5, -1.6, 4.6);
  g.add(knob);
  // 개머리판
  // 앞(손잡이까지)과 뒤(개머리판: 개조하면 바뀜)로 나눈다
  g.add(slab([[-17, 1.6], [-14, -1.0], [14, -1.0], [14, -4.0], [-3.6, -4.4], [-5.8, -5.6], [-8.4, -13.2], [-12.8, -13.0], [-13.8, -6.6], [-17, -6.3]], 4.0, OLIVE(), { bevel: 0.6 }));
  const stock = sub(g);
  stock.add(slab([[-17.6, -6.3], [-22, -6.0], [-46, -8.6], [-54, -11.8], [-55, -11.8], [-55, 2.8], [-46, 2.8], [-38, 1.0], [-24, 1.4], [-17.6, 1.6]], 4.0, OLIVE(), { bevel: 0.6 }));
  stock.add(slab([[-40, 1.4], [-27, 1.6], [-26, 3.6], [-40, 3.8]], 3.4, role(mat('#4A5234', { metal: 0.05, rough: 0.7 }), 'furniture'), { bevel: 0.4 }));
  stock.add(box(1.0, 15, 4.2, BLACK(), -55.6, -4.5));
  g.add(box(5.2, 0.4, 1.3, STEEL(), -6.9, -6.9));
  g.add(box(0.4, 2.8, 1.3, STEEL(), -4.4, -5.5));
  const trig = box(0.35, 1.6, 0.45, BLACK(), -6.2, -5.6);
  trig.rotation.z = 0.25;
  g.add(trig);
  const mag = magazine(g, [box(5.0, 3.0, 2.6, STEEL(), 1.5, -5.0)], [0, -1], [1.5, -6.6]); // 탄창
  // 조준경(개조 스코프를 달면 숨김)
  const sight = sub(g);
  sight.add(tube(1.45, 1.45, -12, 12, BLUED(), { y: 5.8 }));
  sight.add(tube(1.45, 2.7, 12, 18, BLUED(), { y: 5.8, seg: 24 }));
  sight.add(tube(2.3, 1.45, -18.5, -12, BLUED(), { y: 5.8, seg: 24 }));
  const front = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), mat('#20385E', { metal: 0.9, rough: 0.05, emissive: '#2C5AA8', intensity: 0.25 }));
  front.rotation.y = Math.PI / 2;
  front.position.set(18.05, 5.8, 0);
  sight.add(front);
  sight.add(tube(1.0, 1.0, -0.8, 0.8, BLUED(), { y: 8.0, seg: 14 }).rotateZ(Math.PI / 2));
  const side = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.2, 14), BLUED());
  side.rotation.x = Math.PI / 2;
  side.position.set(0, 5.8, 2.1);
  sight.add(side);
  for (const x of [-7, 7]) { sight.add(tube(1.8, 1.8, x - 0.7, x + 0.7, BLACK(), { y: 5.8 })); sight.add(box(1.4, 3.4, 1.6, BLACK(), x, 3.2)); }
  // 접은 양각대
  for (const z of [-0.9, 0.9]) g.add(tube(0.3, 0.3, 16, 38, BLACK(), { y: -1.9, z, seg: 8 }));
  g.userData = {
    muzzle: [63.3, 0, 0], grip: { x: -10.4, y: -8.6, tilt: 0.3, w: 3.4, d: 4.2 }, support: { x: 6, r: 3.0 }, mag,
    mods: { size: 1.1, bore: 1.35, scope: [0, 1.6], sight, stock, stockAt: [-17, -1.2], stockFit: { len: 38, top: 4.2, bottom: -10.6 },
      magFit: { top: [1.5, -3.6], w: 5, len: 4.5, depth: 2.6, curve: 0 } },
  };
  return g;
}

/** 펌프액션 샷건: 총열·통 탄창·홈 파인 펌프·나무 개머리판 */
function shotgunModel() {
  const g = new THREE.Group();
  g.add(slab([[-12, -2.4], [8, -2.4], [8, 1.9], [-10, 1.9], [-12, 1.0]], 3.0, BLUED(), { bevel: 0.25 }));
  g.add(box(6.0, 1.6, 0.06, BLACK(), -1, 0.2, 1.53));
  g.add(tube(1.0, 1.0, 8, 52, BLUED(), { seg: 16 }));
  g.add(box(44, 0.35, 0.5, BLUED(), 30, 1.25));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), BRASS());
  bead.position.set(51.6, 1.6, 0);
  g.add(bead);
  g.add(tube(0.8, 0.8, 51.9, 52.05, BLACK(), { seg: 14 }));
  g.add(tube(1.05, 1.05, 8, 44, BLUED(), { y: -2.5 }));
  g.add(tube(1.18, 1.18, 44, 45.6, STEEL(), { y: -2.5 }));
  g.add(tube(2.0, 2.0, 14, 30, WOOD_DARK(), { y: -2.2 }));
  for (let x = 15; x < 29.5; x += 1.5) g.add(tube(2.06, 2.06, x, x + 0.35, BLACK(), { y: -2.2 }));
  g.add(box(6.0, 0.45, 1.3, BLUED(), -5.8, -4.8));
  g.add(box(0.5, 2.4, 1.3, BLUED(), -2.9, -3.6));
  const trig = box(0.35, 1.6, 0.45, BLACK(), -4.4, -3.6);
  trig.rotation.z = 0.25;
  g.add(trig);
  g.add(slab([[-12, 1.0], [-12, -2.4], [-9.6, -3.4], [-12.6, -6.8], [-20, -7.4], [-20, 0.6], [-14, 1.4]], 3.6, WOOD(), { bevel: 0.45 }));
  const stock = sub(g);
  stock.add(slab([[-20.6, -7.4], [-22, -7.6], [-46, -10.6], [-47, -10.6], [-47, 1.6], [-46, 1.6], [-24, 0.4], [-20.6, 0.6]], 3.6, WOOD(), { bevel: 0.45 }));
  stock.add(box(1.2, 12.6, 3.8, BLACK(), -47.6, -4.5));
  g.userData = {
    muzzle: [52.2, 0, 0], grip: { x: -13.4, y: -4.4, tilt: 0.55, w: 3.4, d: 3.8 }, support: { x: 22, r: 2.0, y: -2.2 },
    mods: { size: 1.05, bore: 1.0, scope: [-3, 1.9], stock, stockAt: [-20, -3.2], stockFit: { len: 27, top: 3.6, bottom: -7.6 } },
  };
  return g;
}

/** RPG-7: 발사관·나무 열 차폐판·뒤 나팔관·손잡이·PGO-7 조준경(왼쪽)·탄두(장전돼 있을 때) */
function rpgModel() {
  const g = new THREE.Group();
  g.add(tube(2.0, 2.0, -38, 40, BLUED(), { seg: 22 }));
  g.add(tube(4.6, 2.0, -56, -38, BLUED(), { seg: 22 }));
  g.add(tube(4.7, 4.7, -56.6, -55.6, STEEL(), { seg: 22 }));
  g.add(tube(2.35, 2.35, 39, 40.2, STEEL(), { seg: 22 }));
  g.add(tube(3.0, 3.0, -14, 12, WOOD(), { seg: 22 }));
  for (const x of [-14.4, 11.6]) g.add(tube(3.1, 3.1, x, x + 0.8, STEEL(), { seg: 22 }));
  g.add(slab([[2.2, -2.0], [6.4, -2.0], [5.0, -11.6], [0.8, -11.2]], 3.0, WOOD_DARK(), { bevel: 0.5 }));
  g.add(box(5.4, 0.45, 1.3, STEEL(), 9.2, -5.2));
  g.add(box(0.4, 3.0, 1.3, STEEL(), 11.8, -3.6));
  const trig = box(0.35, 1.6, 0.45, BLACK(), 8.2, -3.5);
  trig.rotation.z = 0.25;
  g.add(trig);
  g.add(slab([[-22, -2.0], [-18.6, -2.0], [-19.6, -10.6], [-23.4, -10.2]], 3.0, WOOD_DARK(), { bevel: 0.5 }));
  // PGO-7 조준경(왼쪽, 개조 스코프를 달면 숨김)
  const sight = sub(g);
  sight.add(box(9, 3.2, 2.2, mat('#2F3A2A', { metal: 0.3, rough: 0.6 }), 4, 3.0, -3.4));
  sight.add(tube(1.3, 1.3, -3, 0, BLACK(), { y: 3.6, z: -3.4 }));
  sight.add(tube(1.7, 1.4, -5, -3, BLACK(), { y: 3.6, z: -3.4 }));
  g.add(box(0.4, 1.4, 0.4, BLACK(), 22, 2.6));
  // 탄두(PG-7): 추진 막대 + 국방색 원뿔형 탄두 + 신관
  const warhead = new THREE.Group();
  warhead.add(tube(1.6, 1.6, 40, 47, OLIVE(), { seg: 16 }));
  warhead.add(lathe([[47, 1.6], [48, 3.6], [52, 4.3], [56, 4.3], [61, 3.0], [64, 1.4], [65, 0.9]], mat('#4F5A35', { metal: 0.3, rough: 0.55 }), 22));
  warhead.add(lathe([[65, 0.9], [66.6, 0.6], [67.2, 0.0]], STEEL(), 14));
  g.add(warhead);
  g.userData = { muzzle: [40.5, 0, 0], back: [-57, 0, 0], grip: { x: 3.6, y: -6.6, tilt: 0.15, w: 3.0, d: 4.2 }, support: { x: 24, r: 2.0 }, warhead,
    mods: { size: 1, bore: 2.0, scope: [2, 2.0], sight } };
  return g;
}

/** 권총형 석궁: 몸통·손잡이·활(양쪽 날개)·시위·장전된 화살 */
function crossbowModel() {
  const g = new THREE.Group();
  g.add(slab([[-14, -1], [14, -1], [14, 1.2], [-12, 1.2], [-14, 0]], 2.2, POLY(), { bevel: 0.25 }));
  g.add(box(26, 0.3, 0.8, STEEL(), 1, 1.35));
  g.add(slab([[-6, -1], [-2.5, -1], [-4.6, -10], [-8.6, -9.6]], 2.6, POLY(), { bevel: 0.4 }));
  g.add(box(4.0, 0.4, 1.2, STEEL(), -2.6, -4.2));
  const limbs = [];
  for (const s of [-1, 1]) {
    const limb = box(1.2, 1.1, 8.6, mat('#2C3A4A', { metal: 0.4, rough: 0.4 }), 12.4, 0.4, s * 4.3);
    limb.rotation.y = s * 0.32;
    g.add(limb);
    limbs.push([11.0, 0.4, s * 8.4]);
  }
  for (const [x, y, z] of limbs) {
    const a = new THREE.Vector3(x, y, z), b = new THREE.Vector3(-2, 1.2, 0);
    const len = a.distanceTo(b);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 6), mat('#D8D2C0', { rough: 0.9 }));
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    s.position.copy(a).add(b).multiplyScalar(0.5);
    g.add(s);
  }
  const bolt = new THREE.Group();
  bolt.add(tube(0.3, 0.3, -2, 15, mat('#3A3A3A', { metal: 0.2, rough: 0.6 }), { y: 1.75, seg: 8 }));
  bolt.add(lathe([[15, 0.55], [17.2, 0.0]], STEEL(), 10).translateY(1.75));
  for (const a of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const v = box(2.6, 0.05, 1.0, mat('#D9443A', { rough: 0.8 }), -0.6, 1.75 + Math.cos(a) * 0.5, Math.sin(a) * 0.5);
    v.rotation.x = a;
    bolt.add(v);
  }
  g.add(bolt);
  g.userData = { muzzle: [17.4, 1.75, 0], grip: { x: -5.6, y: -5.4, tilt: 0.22, w: 2.6, d: 3.8 }, arrow: bolt, mods: { size: 0.65, scope: [-7, 1.5] } };
  return g;
}

/** 전투 나이프(클립 포인트 칼날·가드·고무 손잡이) */
function daggerModel() {
  const g = new THREE.Group();
  g.add(slab([[0, -0.4], [13.5, -0.4], [18, 1.2], [14.2, 1.8], [12.5, 2.6], [0, 2.6]], 0.42, mat('#C8CDD4', { metal: 1, rough: 0.18 }), { bevel: 0.08 }));
  g.add(box(13, 0.3, 0.46, mat('#8E949C', { metal: 1, rough: 0.3 }), 6.5, 2.2));
  g.add(box(0.9, 4.6, 1.8, BLUED(), -0.5, 1.1));
  g.add(slab([[-11, -0.2], [-1, -0.2], [-1, 2.4], [-11, 2.6]], 2.2, POLY(), { bevel: 0.5 }));
  for (let x = -9.5; x < -2; x += 1.4) g.add(box(0.3, 2.9, 2.3, BLACK(), x, 1.2));
  g.add(box(1.0, 2.8, 2.0, BLUED(), -11.4, 1.2));
  g.userData = { muzzle: [18, 1.2, 0], grip: { x: -5.8, y: 1.2, tilt: Math.PI / 2, w: 2.2, d: 2.8 } };
  return g;
}

/** 즉사기: 검은 몸통에 분홍빛 코일이 감긴 에너지 총 */
function instakillModel() {
  const g = new THREE.Group();
  const glow = mat('#FF3B6B', { metal: 0.2, rough: 0.3, emissive: '#FF2A60', intensity: 1.4 });
  g.add(slab([[-16, -2.6], [10, -2.6], [12, -1], [12, 2.4], [-14, 3.0], [-16, 1.2]], 4.4, mat('#24171E', { metal: 0.6, rough: 0.35 }), { bevel: 0.5 }));
  g.add(tube(1.8, 1.8, 12, 30, mat('#2A2C31', { metal: 0.9, rough: 0.25 })));
  for (const x of [15, 19, 23]) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.45, 10, 24), glow);
    c.rotation.y = Math.PI / 2;
    c.position.set(x, 0, 0);
    g.add(c);
  }
  g.add(tube(2.4, 2.4, 29, 31, mat('#2A2C31', { metal: 0.9, rough: 0.25 })));
  const emitter = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), glow);
  emitter.rotation.y = Math.PI / 2;
  emitter.position.set(31.05, 0, 0);
  g.add(emitter);
  g.add(box(18, 0.5, 0.06, glow, -2, 0.6, 2.25));
  g.add(slab([[-9, -2.6], [-5, -2.6], [-7, -12.6], [-11.4, -12.2]], 3.2, POLY(), { bevel: 0.45 }));
  g.add(slab([[-30, 2.0], [-16, 1.2], [-16, -2.6], [-30, -8.0]], 3.6, POLY(), { bevel: 0.4 }));
  g.userData = { muzzle: [31.4, 0, 0], grip: { x: -8.4, y: -7.4, tilt: 0.2, w: 3.2, d: 4.0 }, support: { x: 21, r: 2.4 } };
  return g;
}

/** R-10 레이저 캐논: 손 없이 화면 아래 양쪽에서 나온 포신 두 개 */
function laserModel() {
  const g = new THREE.Group();
  const glow = mat('#FF2A2A', { emissive: '#FF2020', intensity: 1.6 });
  for (const z of [-1, 1]) {
    const side = new THREE.Group();
    side.add(tube(3.4, 3.0, -30, 4, mat('#C9CED6', { metal: 0.7, rough: 0.35 })));
    side.add(tube(1.8, 1.6, 4, 22, mat('#3A3F47', { metal: 0.8, rough: 0.3 })));
    side.add(tube(2.2, 2.2, 20, 22, glow));
    side.position.z = z * 16;
    g.add(side);
  }
  g.userData = { muzzles: [[22.3, 0, -16], [22.3, 0, 16]], noHands: true };
  return g;
}

/** 무기 id → 손에 든 모습. hands: 오른손(주) + 왼손(받침) 구성 */
function build(weapon, equipped = {}) {
  const root = new THREE.Group();
  const mod = (model) => applyMods(model, equipped); // 개조 파츠 장착(작업실에서 고른 것)
  /**
   * 손에 든 한 자루: item(손 포함) 안에 spin(총만, 방아쇠 둘레로 돌릴 수 있게) 안에 model.
   * 손은 item에 붙어 있어 총을 돌려도(쌍권총 장전) 손은 그 자리에 있다.
   */
  const gun = (model, hands = 'two') => {
    const g = new THREE.Group();
    const spin = new THREE.Group();
    const [px, py] = model.userData.pivot ?? [0, 0];
    spin.position.set(px, py, 0);
    model.position.set(-px, -py, 0);
    spin.add(model);
    g.add(spin);
    g.userData = { ...model.userData, model, spin };
    const { grip, support } = model.userData;
    if (!model.userData.noHands) {
      g.add(placeHand(gripHand(grip.w, grip.d, { tilt: grip.tilt }), grip.x, grip.y, grip.tilt));
      if (hands === 'two' && support) {
        const s = supportHand(support.r);
        s.position.set(support.x, support.y ?? 0, 0);
        g.add(s);
        g.userData.helper = { obj: s, home: s.position.clone() };
      } else if (hands === 'cup') {
        // 권총 두 손 쥐기: 왼손이 오른손을 감싼다(거울 손)
        const left = placeHand(gripHand(grip.w, grip.d, { arm: [-24, -16, 14], tilt: grip.tilt }), grip.x + 0.4, grip.y - 0.8, grip.tilt);
        left.scale.z = -1;
        left.position.z = -0.4;
        g.add(left);
        g.userData.helper = { obj: left, home: left.position.clone() };
      }
    }
    return g;
  };
  /** 뷰모델 자리: 카메라 기준(cm, 앞이 -Z). pose: { x, y, z, yaw, pitch, roll } */
  const set = (obj, pose) => { obj.userData.pose = pose; root.add(obj); return obj; };
  const items = [];
  switch (weapon) {
    case 'pistol':
      items.push(set(gun(mod(pistolModel()), 'cup'), { x: 6.5, y: -6.6, z: -31, yaw: 0.16, pitch: 0.03, k: 1.25 }));
      break;
    case 'dual':
    case 'dualrpg': {
      const r = set(gun(mod(pistolModel({ twoTone: true })), 'one'), { x: 12, y: -7.2, z: -31, yaw: 0.18, pitch: 0.03, roll: -0.15, k: 1.25 });
      const l = set(gun(mod(pistolModel({ twoTone: true })), 'one'), { x: -12, y: -7.2, z: -31, yaw: -0.18, pitch: 0.03, roll: 0.15, mirror: true, k: 1.25 });
      items.push(r, l);
      break;
    }
    case 'crossbow': {
      items.push(set(gun(mod(crossbowModel()), 'one'), { x: 12.5, y: -7.6, z: -31, yaw: 0.16, roll: -0.12, k: 1.25 }));
      items.push(set(gun(mod(crossbowModel()), 'one'), { x: -12.5, y: -7.6, z: -31, yaw: -0.16, roll: 0.12, mirror: true, k: 1.25 }));
      break;
    }
    case 'rifle':
      items.push(set(gun(mod(rifleModel())), { x: 12.5, y: -11, z: -30, yaw: 0.19, pitch: 0.03, roll: -0.06, k: 1.55 }));
      break;
    case 'smg':
      items.push(set(gun(mod(smgModel())), { x: 12, y: -10.5, z: -30, yaw: 0.2, pitch: 0.03, roll: -0.08, k: 1.5 }));
      break;
    case 'sniper':
    case 'jsniper':
      items.push(set(gun(mod(sniperModel())), { x: 12.5, y: -11.5, z: -32, yaw: 0.17, pitch: 0.02, roll: -0.06, k: 1.6 }));
      break;
    case 'shotgun':
      items.push(set(gun(mod(shotgunModel())), { x: 12.5, y: -11, z: -32, yaw: 0.18, pitch: 0.03, roll: -0.06, k: 1.55 }));
      break;
    case 'rpg':
      items.push(set(gun(mod(rpgModel())), { x: 13, y: -7.5, z: -30, yaw: 0.1, pitch: 0.02, k: 1.6 }));
      break;
    case 'dagger':
      items.push(set(gun(daggerModel(), 'one'), { x: 11, y: -11, z: -24, yaw: 0.25, pitch: 0.35, roll: -0.5 }));
      break;
    case 'instakill':
      items.push(set(gun(instakillModel()), { x: 12.5, y: -11, z: -30, yaw: 0.18, pitch: 0.03, roll: -0.06, k: 1.5 }));
      break;
    case 'laser':
      items.push(set(gun(laserModel()), { x: 0, y: -13, z: -26, yaw: 0, pitch: 0.04, k: 1.6 }));
      break;
    default:
      items.push(set(gun(mod(rifleModel())), { x: 12.5, y: -11, z: -30, yaw: 0.19, pitch: 0.03, roll: -0.06, k: 1.55 }));
  }
  root.userData.items = items;
  return root;
}

// ── 총구 불꽃 ──
function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,240,1)');
  r.addColorStop(0.18, 'rgba(255,230,140,0.95)');
  r.addColorStop(0.45, 'rgba(255,150,40,0.55)');
  r.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  // 뾰족한 불꽃 갈래
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    g.save();
    g.translate(64, 64);
    g.rotate(a);
    const s = g.createLinearGradient(0, 0, 60, 0);
    s.addColorStop(0, 'rgba(255,240,180,0.9)');
    s.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = s;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(60 - (i % 2) * 18, 0); g.lineTo(0, 7); g.closePath(); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** 총 옆에서 본 불꽃(앞으로 뻗는 원뿔꼴) */
function flashSideTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(10, 32, 0, 10, 32, 118);
  r.addColorStop(0, 'rgba(255,255,230,1)');
  r.addColorStop(0.25, 'rgba(255,210,110,0.85)');
  r.addColorStop(0.6, 'rgba(255,130,30,0.4)');
  r.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = r;
  g.beginPath(); g.moveTo(0, 26); g.quadraticCurveTo(70, 0, 128, 32); g.quadraticCurveTo(70, 64, 0, 38); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let flashTex = null, flashSideTex = null, smokeTex = null;
export function getFlashTexture() { return (flashTex ??= flashTexture()); }
/** 부드러운 연기 덩어리 */
export function getSmokeTexture() {
  if (!smokeTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 5; i++) {
      const x = 32 + Math.cos(i * 1.7) * 9, y = 32 + Math.sin(i * 2.3) * 9;
      const r = g.createRadialGradient(x, y, 0, x, y, 24);
      r.addColorStop(0, 'rgba(225,225,228,0.55)');
      r.addColorStop(1, 'rgba(225,225,228,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    }
    smokeTex = new THREE.CanvasTexture(c);
    smokeTex.colorSpace = THREE.SRGBColorSpace;
  }
  return smokeTex;
}
const FLASH_COLOR = { laser: '#FF3030', instakill: '#FF4FA0' };
function makeFlash() {
  const g = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: getFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  front.rotation.y = Math.PI / 2; // 총구 앞을 보는 판
  g.add(front);
  flashSideTex ??= flashSideTexture();
  for (const a of [0, Math.PI / 2]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({
      map: flashSideTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    side.geometry.translate(0.5, 0, 0);
    side.rotation.x = a;
    g.add(side);
  }
  g.visible = false;
  return g;
}

/** 금속이 실제처럼 비치도록 하늘빛·바닥빛·조명판이 있는 주변 환경 맵. 렌더러마다 한 번 만든다(작업실 화면도 쓴다) */
const envMaps = new WeakMap();
export function environmentMap(renderer) {
  if (envMaps.has(renderer)) return envMaps.get(renderer);
  const env = new THREE.Scene();
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g2 = c.getContext('2d');
  const grad = g2.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#E8EEF8'); grad.addColorStop(0.45, '#8A94A8'); grad.addColorStop(0.55, '#4A4E58'); grad.addColorStop(1, '#1A1C22');
  g2.fillStyle = grad; g2.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })));
  const panel = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  for (const [x, y, z, w, h] of [[-40, 70, 40, 60, 20], [60, 40, -30, 20, 50], [0, 80, -60, 80, 14]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), panel);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  }
  // 화면 나누기용 가위 자르기(scissor)가 켜져 있으면 환경 맵 일부만 그려지므로 잠깐 끄고, 화면 칸 설정은 되돌린다
  const vp = renderer.getViewport(new THREE.Vector4()), sc = renderer.getScissor(new THREE.Vector4());
  const scissor = renderer.getScissorTest();
  renderer.setScissorTest(false);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const map = pmrem.fromScene(env, 0.02).texture;
  renderer.setScissorTest(scissor);
  renderer.setViewport(vp);
  renderer.setScissor(sc);
  pmrem.dispose();
  envMaps.set(renderer, map);
  return map;
}

/** 작업실 책상에 올려놓을 총(손 없이, 개조 파츠 장착). 쌍권총·석궁은 한 자루. 앞이 +X */
const SHOWCASE = { rifle: () => rifleModel(), smg: () => smgModel(), sniper: () => sniperModel(), shotgun: () => shotgunModel(), pistol: () => pistolModel(), dual: () => pistolModel({ twoTone: true }), rpg: () => rpgModel(), crossbow: () => crossbowModel() };
export function buildShowcase(weapon, equipped = {}) {
  const model = applyMods((SHOWCASE[weapon] ?? SHOWCASE.rifle)(), equipped);
  if (model.userData.warhead) model.userData.warhead.visible = true;
  return model;
}

/**
 * 다른 사람(적·동료)이 손에 든 총(3인칭). 캐릭터 그림 손 높이에서 조준 방향으로 겨눈다. 손은 그림에 있으므로 총만.
 * 쌍권총·석궁·쌍 RPG는 양손에 한 자루씩. 돌려주는 Group의 userData.items가 한 자루씩(장전 동작은 1인칭과 같은 applyReload).
 */
const HELD = {
  rifle: () => rifleModel(), smg: () => smgModel(), sniper: () => sniperModel(), jsniper: () => sniperModel(), shotgun: () => shotgunModel(),
  pistol: () => pistolModel(), dual: () => pistolModel({ twoTone: true }), rpg: () => rpgModel(), dualrpg: () => rpgModel(),
  crossbow: () => crossbowModel(), dagger: () => daggerModel(), instakill: () => instakillModel(),
};
const PAIRED = new Set(['dual', 'dualrpg', 'crossbow']);
export const hasHeldGun = (weapon) => !!HELD[weapon];
export function makeHeldGun(weapon, equipped = {}) {
  const root = new THREE.Group();
  const items = [];
  for (const side of PAIRED.has(weapon) ? [1, -1] : [1]) {
    const model = applyMods(HELD[weapon](), equipped);
    const item = new THREE.Group();
    const spin = new THREE.Group();
    const [px, py] = model.userData.pivot ?? [0, 0];
    spin.position.set(px, py, 0);
    model.position.set(-px, -py, 0);
    spin.add(model);
    item.add(spin);
    item.userData = { ...model.userData, model, spin, side };
    // 손잡이가 원점(손 자리)에 오게
    const grip = model.userData.grip ?? { x: 0, y: 0 };
    spin.position.x -= grip.x; spin.position.y -= grip.y;
    if (model.userData.warhead) model.userData.warhead.visible = true;
    root.add(item);
    items.push(item);
  }
  root.userData.items = items;
  root.userData.weapon = weapon;
  return root;
}
/** 3인칭 총의 장전 동작·탄두/화살 보이기. p: 그 플레이어(장전 중이면 p.reload) */
export function poseHeldGun(root, p) {
  const weapon = root.userData.weapon;
  const rl = p.reload && p.reload.weapon === weapon ? clamp01(1 - p.reload.t / p.reload.total) : null;
  const e = rl === null ? 0 : ease(rl / 0.15) * (1 - ease((rl - 0.85) / 0.15));
  const anim = reloadPose(weapon, rl, e);
  for (const item of root.userData.items) {
    const side = item.userData.side;
    item.position.set(0, anim.y * 0.6, side * (PAIRED.has(weapon) ? 9 : 0));
    item.userData.poseY = anim.y * 0.6;
    item.rotation.set(anim.roll * side, 0, anim.pitch * 1.4 + (rl !== null && !PAIRED.has(weapon) && weapon !== 'rpg' ? -0.35 * e : 0));
    applyReload(item, weapon, rl, p);
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => { const q = clamp01(v); return q * q * (3 - 2 * q); };
/** 0→1 구간 [a, b]에서의 부드러운 진행도 */
const span = (k, a, b) => ease((k - a) / (b - a));

/** 장전할 때 총 전체의 움직임(카메라 기준 cm·라디안). 탄창 총은 기울여 탄창 구멍을 보이고, RPG는 총구를 내리고, 석궁은 내린다 */
function reloadPose(weapon, rl, e) {
  const out = { x: 0, y: 0, z: 0, pitch: 0, roll: 0 };
  if (rl === null) return out;
  if (weapon === 'dual' || weapon === 'dualrpg') {
    out.y = 2.2 * e; out.roll = -0.25 * e; // 쌍권총: 조금 들어 올려 바깥으로 기울이고 돌린다
  } else if (weapon === 'rpg') {
    out.y = -2.5 * e; out.pitch = -0.16 * e; out.x = -2 * e;
  } else if (weapon === 'crossbow') {
    out.y = -5 * e; out.pitch = 0.35 * e; out.z = 2 * e;
  } else {
    // 탄창 총: 화면 가운데 쪽으로 들어 올리고 기울여 탄창 구멍이 보이게
    const pistol = weapon === 'pistol';
    out.y = (pistol ? 4.5 : 4.5) * e; out.x = (pistol ? -2 : -3) * e; out.z = (pistol ? -2 : -6) * e; out.roll = 0.6 * e; out.pitch = 0.18 * e;
  }
  return out;
}

/** 장전 중 부품 움직임: 탄창 빼고 끼우기(받치는 손이 새 탄창을 가져옴), RPG 새 로켓, 쌍권총 돌리기, 석궁 화살 다시 걸기 */
function applyReload(item, weapon, rl, p) {
  const u = item.userData;
  const ammo = Math.min(WEAPON_MAG(weapon), p.ammo?.[weapon] ?? Infinity);
  // 탄창
  const spinning = weapon === 'dual' || weapon === 'dualrpg'; // 쌍권총은 탄창을 갈지 않고 돌린다
  if (u.mag) {
    let d = 0, visible = true;
    if (rl !== null && !spinning) {
      if (rl < 0.38) d = span(rl, 0.1, 0.36) * 26; // 빈 탄창이 빠져 떨어짐
      else if (rl < 0.45) visible = false;
      else d = (1 - span(rl, 0.45, 0.75)) * 16; // 새 탄창이 올라와 끼워짐
    }
    u.mag.obj.visible = visible;
    u.mag.obj.position.set(u.mag.dir[0] * d, u.mag.dir[1] * d, 0);
  }
  // 받치는 손: 새 탄창(로켓)을 가지러 내려갔다 끼우고 돌아온다
  if (u.helper) {
    const h = u.helper;
    h.obj.position.copy(h.home);
    if (rl !== null && !spinning && (u.mag || u.warhead)) {
      const w = span(rl, 0.3, 0.45) * (1 - span(rl, 0.78, 0.95));
      let tx, ty;
      if (u.mag) {
        const d = rl < 0.45 ? 16 : (1 - span(rl, 0.45, 0.75)) * 16;
        tx = u.mag.base[0] + u.mag.dir[0] * d; ty = u.mag.base[1] + u.mag.dir[1] * d - 1.5;
      } else {
        tx = u.warhead.position.x + 52; ty = u.warhead.position.y - 4.5;
      }
      h.obj.position.x += (tx - h.home.x) * w;
      h.obj.position.y += (ty - h.home.y) * w;
    }
  }
  // RPG 로켓: 아래 앞에서 올라와 발사관 앞에 끼워진다
  if (u.warhead) {
    if (rl === null) {
      u.warhead.visible = ammo > 0;
      u.warhead.position.set(0, 0, 0);
    } else {
      u.warhead.visible = rl > 0.18;
      const k = span(rl, 0.18, 0.75);
      u.warhead.position.set((1 - k) * 10, -(1 - k) * 34, (1 - k) * -6);
      u.warhead.rotation.z = (1 - k) * 0.5;
    }
  }
  // 석궁 화살: 뒤에서 미끄러져 걸린다
  if (u.arrow) {
    if (rl === null) { u.arrow.visible = ammo > 0 && p.cooldown <= 0; u.arrow.position.x = 0; } else {
      u.arrow.visible = rl > 0.5;
      u.arrow.position.x = -(1 - span(rl, 0.5, 0.85)) * 14;
    }
  }
  // 쌍권총: 방아쇠울에 건 손가락으로 권총을 두 바퀴 휙휙 돌린다(그동안 탄이 채워짐)
  if (u.spin) u.spin.rotation.z = rl !== null && (weapon === 'dual' || weapon === 'dualrpg') ? span(rl, 0.08, 0.9) * Math.PI * 4 : 0;
}

/**
 * 뷰모델 그리기. world3d가 한 사람 화면(1인칭)을 그린 다음 render()를 불러 그 위에 손과 총을 덧그린다.
 * 사람마다 반동·불꽃 상태를 따로 갖는다(화면 나누기에서 둘이 같은 무기를 들어도 된다).
 */
export function createViewmodel() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VM_FOV, 1.6, 1, 600);
  const hemi = new THREE.HemisphereLight('#C8D4FF', '#3A3A44', 1.6);
  const key = new THREE.DirectionalLight('#FFFFFF', 1.8);
  key.position.set(-30, 60, 40);
  const rim = new THREE.DirectionalLight('#9FB8FF', 0.6);
  rim.position.set(40, 10, -60);
  const flashLight = new THREE.PointLight('#FFB050', 0, 90, 1.6); // 늘 장면에 두고 세기만 바꾼다(빛 개수가 바뀌면 다시 컴파일됨)
  scene.add(hemi, key, rim, flashLight);
  const models = new Map();
  const flashes = [];
  let envReady = false;
  /** 금속이 실제처럼 비치도록 하늘빛·바닥빛·조명판이 있는 주변 환경 맵(한 번만 만든다) */
  function makeEnvironment(renderer) {
    scene.environment = environmentMap(renderer);
    scene.environmentIntensity = 0.9;
    envReady = true;
  }
  const state = {}; // 사람별: { weapon, swap, kick: [오른, 왼], flash: [..], shot, sway }
  /** 무기 + 장착한 개조 파츠가 같으면 같은 모델. 바뀌면(작업실에서 장착) 새로 만들고 예전 것은 버린다 */
  const modelOf = (weapon) => {
    const store = modStore();
    const key = `${weapon}|${store.signature(weapon)}`;
    if (!models.has(key)) {
      for (const [k, m] of models) if (k.startsWith(`${weapon}|`)) { scene.remove(m); models.delete(k); }
      const m = build(weapon, store.equipped(weapon));
      m.visible = false;
      scene.add(m);
      models.set(key, m);
    }
    return models.get(key);
  };
  const flashOf = (i) => {
    while (flashes.length <= i) { const f = makeFlash(); scene.add(f); flashes.push(f); }
    return flashes[i];
  };
  const tmpV = new THREE.Vector3();

  return {
    /** 'fire' 이벤트: 반동과 불꽃 시작. 쌍권총·석궁은 오른손·왼손을 번갈아 쏜다 */
    fire(playerId, weapon) {
      const s = state[playerId] ??= { weapon, swap: 0, kick: [0, 0], flash: [0, 0], shot: 0, roll: [0, 0], smoke: [] };
      if (weapon === 'grenade' || weapon === 'missile' || weapon === 'overcool') return;
      // 석궁은 양손이 한꺼번에, 쌍권총·레이저 캐논은 번갈아 쏜다
      if (weapon === 'crossbow') { s.kick = [0.8, 0.8]; return; } // 칼·석궁은 불꽃이 없다
      const two = ['dual', 'dualrpg', 'laser'].includes(weapon);
      const hand = two ? s.shot++ % 2 : 0;
      s.kick[hand] = Math.min(1.2, s.kick[hand] + (weapon === 'rpg' || weapon === 'shotgun' || weapon === 'sniper' ? 1 : weapon === 'smg' ? 0.35 : 0.7));
      if (weapon === 'dagger') return;
      s.flash[hand] = weapon === 'shotgun' || weapon === 'rpg' ? 0.07 : 0.05;
      s.roll[hand] = Math.random() * Math.PI * 2;
      s.smoke.push(hand);
    },
    reset() { for (const id of Object.keys(state)) delete state[id]; },
    /**
     * p의 손·총을 지금 화면 칸에 그린다. 화면 칸 크기·종횡비는 world3d가 renderer에 맞춰 둔다.
     * 돌려주는 값: 이번에 불꽃이 난 총구들의 카메라 기준 위치(world3d가 그 자리에 연기를 띄운다).
     */
    render(renderer, p, aspect, { time, dt, moving, reducedMotion, paused, lights }) {
      if (!envReady) makeEnvironment(renderer);
      const weapon = p.weapon;
      const s = state[p.id] ??= { weapon: null, swap: 0, kick: [0, 0], flash: [0, 0], shot: 0, roll: [0, 0], smoke: [] };
      if (s.weapon !== weapon) { if (s.weapon) s.swap = 1; s.weapon = weapon; s.kick = [0, 0]; s.flash = [0, 0]; s.smoke = []; }
      if (!paused) {
        s.swap = Math.max(0, s.swap - dt * 3.2);
        for (let i = 0; i < 2; i++) { s.kick[i] = Math.max(0, s.kick[i] - dt * (weapon === 'smg' ? 9 : 6)); s.flash[i] = Math.max(0, s.flash[i] - dt); }
      }
      if (lights) {
        hemi.color.copy(lights.hemi.color); hemi.groundColor.copy(lights.hemi.groundColor);
        hemi.intensity = 0.6 + lights.hemi.intensity * 0.9;
        key.color.copy(lights.sun.color);
        key.intensity = 0.8 + lights.sun.intensity * 0.7;
      }
      for (const m of models.values()) m.visible = false;
      for (const f of flashes) f.visible = false;
      const root = modelOf(weapon);
      root.visible = true;
      const bob = reducedMotion ? 0 : moving ? Math.sin(time * 11) : 0;
      const breathe = reducedMotion ? 0 : Math.sin(time * 1.8);
      const lower = s.swap * s.swap * 14; // 무기를 바꾸면 내렸다 올린다
      const rl = p.reload && p.reload.weapon === weapon ? clamp01(1 - p.reload.t / p.reload.total) : null; // 장전 진행도
      flashLight.intensity = 0;
      const muzzles = [];
      root.userData.items.forEach((item, i) => {
        const pose = item.userData.pose;
        const hand = i % 2;
        const k = weapon === 'laser' ? Math.max(s.kick[0], s.kick[1]) : s.kick[hand];
        const mirror = pose.mirror ? -1 : 1;
        const far = pose.k ?? 1; // 같은 화면 자리에서 멀리(작게) 보이게 하는 배율
        item.position.set(
          (pose.x + bob * 0.7 * mirror) * far,
          (pose.y + Math.abs(bob) * -0.6 + breathe * 0.12 - lower) * far,
          pose.z * far + k * (weapon === 'rpg' ? 3 : 2.4),
        );
        // 장전 동작(rl: 0→1). 기울임 정도 e는 처음·끝에 부드럽게 들어갔다 나온다
        const e = rl === null ? 0 : ease(rl / 0.15) * (1 - ease((rl - 0.85) / 0.15));
        const anim = reloadPose(weapon, rl, e);
        item.position.y += anim.y * far;
        item.position.z += anim.z * far;
        item.position.x += anim.x * mirror * far;
        item.rotation.set(0, 0, 0);
        item.rotateY(Math.PI / 2 + (pose.yaw ?? 0)); // 총구(+X)가 화면 앞(-Z)으로
        item.rotateZ((pose.pitch ?? 0) + k * (weapon === 'rpg' ? 0.05 : 0.12) + s.swap * 0.6 + anim.pitch);
        item.rotateX((pose.roll ?? 0) + anim.roll * mirror);
        item.scale.set(1, 1, mirror);
        applyReload(item, weapon, rl, p);
        // 단검 돌진: 앞으로 찌른다
        if (weapon === 'dagger' && p.dash) item.position.z -= 8;
        // 총구 불꽃
        const list = item.userData.muzzles ?? (item.userData.muzzle ? [item.userData.muzzle] : []);
        list.forEach((mz, j) => {
          const h = list.length > 1 ? j : hand; // 레이저 캐논은 포신 둘을 번갈아
          const flashOn = s.flash[h] > 0;
          item.updateMatrixWorld(true);
          const mw = (item.userData.model ?? item).matrixWorld;
          tmpV.set(mz[0], mz[1], mz[2]).applyMatrix4(mw);
          if (flashOn) {
            const f = flashOf(muzzles.length);
            f.visible = true;
            f.position.copy(tmpV);
            f.quaternion.copy(item.quaternion);
            f.rotateX(s.roll[h]);
            const big = (weapon === 'shotgun' || weapon === 'rpg' ? 1.8 : weapon === 'sniper' ? 1.5 : weapon === 'smg' ? 0.8 : 1) * (item.userData.flashScale ?? 1); // 소음기면 작게
            const fl = Math.min(1.4, s.flash[h] / 0.05);
            f.scale.setScalar((6 + 4 * fl) * big);
            const color = FLASH_COLOR[weapon] ?? '#FFFFFF';
            for (const c of f.children) c.material.color.set(color);
            flashLight.position.copy(tmpV);
            flashLight.color.set(FLASH_COLOR[weapon] ?? '#FFB050');
            flashLight.intensity = 380 * fl * big;
          }
          muzzles.push({ pos: tmpV.clone(), hand: h });
          // RPG는 뒤 나팔관으로도 후폭풍 불꽃
          if (flashOn && weapon === 'rpg' && item.userData.back) {
            const b = item.userData.back;
            const f = flashOf(muzzles.length + 4);
            f.visible = true;
            f.position.copy(new THREE.Vector3(b[0], b[1], b[2]).applyMatrix4(mw));
            f.quaternion.copy(item.quaternion);
            f.rotateY(Math.PI);
            f.scale.setScalar(16);
          }
        });
      });
      camera.aspect = aspect;
      camera.fov = vmFov(aspect);
      camera.updateProjectionMatrix();
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = auto;
      // 이번 프레임에 새로 쏜 총구(연기를 띄울 자리)
      const smoke = [];
      for (const hand of s.smoke) {
        const m = muzzles.find((q) => q.hand === hand) ?? muzzles[0];
        if (m) smoke.push(m.pos);
      }
      s.smoke = [];
      return smoke;
    },
  };
}
/** 뷰모델 카메라의 시야각(도) */
export const VM_FOV = 54;
/**
 * 화면 칸 종횡비에 맞춘 뷰모델 세로 시야각: 좁은 칸(화면 나누기)에서도 가로로 보이는 범위를 넓은 화면과 같게 해
 * 총이 화면을 가득 덮지 않게 한다. world3d가 총구 연기 위치를 1인칭 카메라 기준으로 옮길 때도 쓴다.
 */
export function vmFov(aspect) {
  if (aspect >= 1.6) return VM_FOV;
  return (2 * Math.atan(Math.tan((VM_FOV / 2) * Math.PI / 180) * 1.6 / aspect) * 180) / Math.PI;
}

// ── 실제 총알 모양의 탄 ──
const BULLET_LEN = 22; // 날아가는 탄이 잘 보이도록 실제보다 크게(경기장 1단위 ≈ 1.3cm)
let bulletParts = null;
function parts() {
  if (bulletParts) return bulletParts;
  const r = 2.8;
  // 탄두(구리): 둥근 뾰족 끝
  const tip = new THREE.LatheGeometry([[0, 0], [r, 0], [r, 7], [r * 0.92, 10], [r * 0.7, 13.5], [r * 0.38, 16], [0.3, 17.4], [0, 17.6]].map(([x, y]) => new THREE.Vector2(x, y)), 16);
  tip.rotateZ(-Math.PI / 2);
  tip.translate(BULLET_LEN - 17.6, 0, 0);
  // 놋쇠 몸통(뒤쪽, 홈 하나)
  const body = new THREE.LatheGeometry([[0, 0], [r * 1.02, 0], [r * 1.02, 1.2], [r * 0.8, 1.6], [r * 0.8, 2.4], [r * 1.02, 2.8], [r * 1.02, BULLET_LEN - 16.8], [0, BULLET_LEN - 16.8]].map(([x, y]) => new THREE.Vector2(x, y)), 16);
  body.rotateZ(-Math.PI / 2);
  const trail = new THREE.CylinderGeometry(1.6, 0.2, 1, 8, 1, true);
  trail.rotateZ(Math.PI / 2); // 위(굵은 쪽)가 -X(탄 바로 뒤)… 아래 위치에서 맞춘다
  trail.translate(-0.5, 0, 0);
  bulletParts = {
    tip, body, trail,
    pellet: new THREE.SphereGeometry(2.6, 12, 10),
    copper: new THREE.MeshStandardMaterial({ color: '#D07A42', metalness: 1, roughness: 0.28, emissive: '#5A2A10', emissiveIntensity: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: '#D6B055', metalness: 1, roughness: 0.25, emissive: '#4A3810', emissiveIntensity: 0.6 }),
    lead: new THREE.MeshStandardMaterial({ color: '#8A8E96', metalness: 0.8, roughness: 0.4, emissive: '#2A2C30', emissiveIntensity: 0.6 }),
    trails: new Map(),
  };
  for (const m of [bulletParts.copper, bulletParts.brass, bulletParts.lead]) m.userData.shared = true;
  return bulletParts;
}
function trailMat(color) {
  const P = parts();
  if (!P.trails.has(color)) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    m.userData.shared = true;
    P.trails.set(color, m);
  }
  return P.trails.get(color);
}
/** 함께 쓰는 탄 도형(효과를 버릴 때 지우지 않게) */
export function sharedShotGeometries() {
  const P = parts();
  return [P.tip, P.body, P.trail, P.pellet];
}
/**
 * 총알 하나(앞이 +X): 구리 탄두 + 놋쇠 몸통 + 뒤로 옅게 남는 빛줄기(팀 색). kind: 'bullet' | 'pellet'.
 * scale은 크기 배율(저격총 탄은 길게, 전투기 기관포는 크게).
 */
export function makeBullet({ trail = '#FFD27A', kind = 'bullet', scale = 1, trailLen = 55 } = {}) {
  const P = parts();
  const g = new THREE.Group();
  if (kind === 'pellet') {
    g.add(new THREE.Mesh(P.pellet, P.lead));
  } else {
    g.add(new THREE.Mesh(P.tip, P.copper), new THREE.Mesh(P.body, P.brass));
  }
  const t = new THREE.Mesh(P.trail, trailMat(trail));
  t.scale.set(trailLen, 1, 1);
  t.position.x = kind === 'pellet' ? -1 : 0;
  g.add(t);
  g.scale.setScalar(scale);
  return g;
}
/** 석궁 화살(앞이 +X): 나무 자루·쇠 촉·붉은 깃 */
export function makeArrow() {
  const g = new THREE.Group();
  g.add(tube(0.9, 0.9, -40, 8, mat('#6A4A2A', { rough: 0.7 }), { seg: 8 }));
  g.add(lathe([[8, 1.8], [16, 0]], mat('#B9BDC4', { metal: 1, rough: 0.3 }), 10));
  for (const a of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const v = box(10, 0.2, 3.2, mat('#D9443A', { rough: 0.8 }), -35, Math.cos(a) * 1.6, Math.sin(a) * 1.6);
    v.rotation.x = a;
    g.add(v);
  }
  return g;
}
