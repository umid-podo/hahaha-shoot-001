import * as THREE from '../vendor/three.module.min.js';

/**
 * 1인칭 3D 화면의 탈것·장치 모델. 그림 파일 없이 three.js 기본 도형으로 만든다(받은 참고 그림은 쓰지 않음).
 * 좌표: 경기장 위에서 본 (x, y)는 3D의 (X, Z)이고 Y가 위. 1단위 = 경기장 1px(몸 반지름 30 ≈ 40cm).
 * 모델은 앞(달리는 쪽·기수)이 +X를 보게 만든다(돌릴 때는 rotation.y = -각도).
 */

const cache = new Map();
/** 같은 색·성질의 재질은 한 번만 만든다 */
export function mat(color, { emissive = null, metal = 0.2, rough = 0.7, transparent = false, opacity = 1, basic = false, side = THREE.FrontSide } = {}) {
  const key = [color, emissive, metal, rough, transparent, opacity, basic, side].join('|');
  if (!cache.has(key)) {
    const m = basic
      ? new THREE.MeshBasicMaterial({ color, transparent, opacity, side })
      : new THREE.MeshStandardMaterial({
        color, metalness: metal, roughness: rough, transparent, opacity, side,
        ...(emissive ? { emissive, emissiveIntensity: 1 } : {}),
      });
    m.userData.shared = true; // 여러 곳에서 함께 쓰는 재질(버리지 않는다)
    cache.set(key, m);
  }
  return cache.get(key);
}

const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
const cyl = (rt, rb, h, material, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
const sphere = (r, material, w = 16, h = 12) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), material);
function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

/** 자동차(위에서 보면 l×w). team 'earth' 파란 스포츠카, 'isb' 검은 세단(주황 줄·경광등). 바퀴는 userData.wheels로 돌린다. */
export function makeCar(team = 'earth', { l = 150, w = 84 } = {}) {
  const g = new THREE.Group();
  const body = team === 'earth' ? mat('#2E7BE0', { metal: 0.5, rough: 0.35 }) : mat('#1F2229', { metal: 0.5, rough: 0.35 });
  g.add(at(box(l, 26, w, body), 0, 24, 0));
  g.add(at(box(l * 0.55, 22, w * 0.86, body), -l * 0.06, 47, 0));
  const glass = mat('#7FB2E6', { metal: 0.6, rough: 0.15, transparent: true, opacity: 0.85 });
  g.add(at(box(l * 0.12, 18, w * 0.8, glass), l * 0.24, 46, 0));
  g.add(at(box(l * 0.1, 16, w * 0.78, glass), -l * 0.36, 46, 0));
  const stripe = team === 'earth' ? mat('#FFFFFF') : mat('#D56A26');
  g.add(at(box(l * 1.01, 4, 10, stripe), 0, 37, 0));
  const lamp = mat('#FFF7D6', { emissive: '#FFF2B0' });
  const tail = mat('#FF3B30', { emissive: '#FF2A1A' });
  for (const s of [-1, 1]) {
    g.add(at(box(4, 8, 14, lamp), l / 2, 28, s * (w / 2 - 12)));
    g.add(at(box(4, 8, 14, tail), -l / 2, 28, s * (w / 2 - 12)));
  }
  const wheels = [];
  const tire = mat('#0D0F14', { rough: 0.9 });
  for (const wx of [-l * 0.3, l * 0.3]) {
    for (const s of [-1, 1]) {
      const wheel = cyl(13, 13, 10, tire, 14);
      wheel.rotation.x = Math.PI / 2;
      wheels.push(at(wheel, wx, 13, s * (w / 2 - 2)));
      g.add(wheel);
    }
  }
  if (team === 'isb') {
    const beacon = at(box(20, 6, 10, mat('#FF9D3F', { emissive: '#FF7A1A' })), -l * 0.06, 61, 0);
    g.add(beacon);
    g.userData.beacon = beacon;
  }
  g.userData.wheels = wheels;
  return g;
}

/** 엄폐물을 실은 평판 트럭(도로): 짐칸 길이 len, 폭 width. 앞(+X)에 운전석 */
export function makeTruck(len, width) {
  const g = new THREE.Group();
  g.add(at(box(len, 16, width, mat('#4A4F5A', { metal: 0.4 })), 0, 30, 0));
  g.add(at(box(70, 70, width - 6, mat('#B8862E', { metal: 0.3, rough: 0.5 })), len / 2 + 38, 55, 0));
  g.add(at(box(6, 30, width - 20, mat('#7FB2E6', { metal: 0.6, rough: 0.15 })), len / 2 + 72, 70, 0));
  const tire = mat('#0D0F14', { rough: 0.9 });
  for (const wx of [-len / 2 + 30, len / 2 - 30, len / 2 + 40]) {
    for (const s of [-1, 1]) {
      const wheel = cyl(16, 16, 12, tire, 14);
      wheel.rotation.x = Math.PI / 2;
      g.add(at(wheel, wx, 16, s * (width / 2 - 4)));
    }
  }
  return g;
}

/** 탱크: 무한궤도·몸체·포탑, 포신 두 개(위·아래 진영 쪽 = -Z·+Z). 앞은 +X */
export function makeTank() {
  const g = new THREE.Group();
  const olive = mat('#56663F', { rough: 0.8 });
  const dark = mat('#1C1F18', { rough: 0.9 });
  for (const s of [-1, 1]) g.add(at(box(230, 34, 24, dark), 0, 17, s * 50));
  g.add(at(box(200, 30, 90, olive), 0, 42, 0));
  const turret = new THREE.Group();
  turret.add(at(cyl(38, 42, 28, mat('#4B5A36', { rough: 0.7 })), 0, 0, 0));
  for (const s of [-1, 1]) {
    const barrel = cyl(6, 7, 90, mat('#3F4A2D'));
    barrel.rotation.x = Math.PI / 2;
    turret.add(at(barrel, 0, 4, s * 70));
  }
  turret.position.set(0, 70, 0);
  g.add(turret);
  const star = at(box(30, 2, 30, mat('#C0392B', { emissive: '#601010' })), -60, 58, 0);
  g.add(star);
  g.userData.turret = turret;
  return g;
}

/** 배(대교 아래 강): 갑판·조타실·대포 두 문(위·아래 진영 쪽). 앞은 +X */
export function makeShip() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(60, 40, 460, 6, 1), mat('#2B3A4D', { metal: 0.3 }));
  hull.rotation.z = Math.PI / 2;
  hull.scale.set(1, 1, 1.4);
  g.add(at(hull, 0, -20, 0));
  g.add(at(box(380, 12, 120, mat('#8A7A62')), 0, 26, 0));
  g.add(at(box(110, 70, 80, mat('#D9DEE6')), -70, 68, 0));
  g.add(at(box(100, 12, 84, mat('#C0392B')), -70, 108, 0));
  for (const s of [-1, 1]) {
    const gun = cyl(9, 11, 80, mat('#3A3F4D', { metal: 0.6 }));
    gun.rotation.x = Math.PI / 2;
    g.add(at(gun, 90, 50, s * 60));
    g.add(at(cyl(24, 24, 20, mat('#4A5060', { metal: 0.5 })), 90, 40, 0));
  }
  g.add(at(cyl(10, 10, 60, mat('#2A2E35')), -100, 130, 0));
  return g;
}

/** 헬리콥터(kind 'heli' 초록) 또는 건쉽(어두운 회색, 날개에 기관포). 앞은 +X, 회전 날개는 userData.rotor */
export function makeHelicopter(kind = 'heli', scale = 1) {
  const g = new THREE.Group();
  const gun = kind === 'gunship';
  const body = gun ? mat('#6A7282', { metal: 0.5, rough: 0.4 }) : mat('#5E7E48', { metal: 0.3, rough: 0.5 });
  const cabin = sphere(46, body);
  cabin.scale.set(1.5, 0.9, 0.9);
  g.add(cabin);
  const tail = cyl(8, 14, 150, body);
  tail.rotation.z = Math.PI / 2;
  g.add(at(tail, -120, 8, 0));
  g.add(at(box(10, 40, 4, body), -190, 26, 0));
  g.add(at(box(30, 22, 52, mat('#7FB2E6', { metal: 0.6, rough: 0.1 })), 44, 10, 0));
  for (const s of [-1, 1]) g.add(at(box(70, 4, 4, mat('#2A2E35')), 0, -46, s * 30));
  if (gun) {
    for (const s of [-1, 1]) {
      g.add(at(box(40, 6, 60, body), 0, -6, s * 60));
      const cannon = cyl(4, 4, 50, mat('#15171C', { metal: 0.7 }));
      cannon.rotation.z = Math.PI / 2;
      g.add(at(cannon, 20, -12, s * 84));
    }
    g.add(at(box(40, 3, 3, mat('#D56A26', { emissive: '#7A3A12' })), -40, 30, 0));
    // 항법등(밤하늘에서 보이게): 빨강·초록·꼬리 흰빛
    g.add(at(sphere(7, mat('#FF3B30', { emissive: '#FF2A1A' }), 8, 6), 0, -4, -92));
    g.add(at(sphere(7, mat('#3FE07A', { emissive: '#20C060' }), 8, 6), 0, -4, 92));
    g.add(at(sphere(6, mat('#FFFFFF', { emissive: '#FFFFFF' }), 8, 6), -195, 30, 0));
  }
  const rotor = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = box(210, 2, 12, mat('#15171C'));
    blade.rotation.y = (i * Math.PI) / 2;
    rotor.add(blade);
  }
  rotor.position.set(0, 46, 0);
  g.add(rotor);
  g.add(at(cyl(4, 4, 14, mat('#15171C')), 0, 38, 0));
  g.userData.rotor = rotor;
  g.scale.setScalar(scale);
  return g;
}

/** 전투기(경기장 위를 가로질러 날아감): 날렵한 회색 동체, 삼각 날개, 꼬리. 앞은 +X */
export function makeJet() {
  const g = new THREE.Group();
  const grey = mat('#8A93A3', { metal: 0.6, rough: 0.35 });
  const fus = cyl(10, 18, 220, grey);
  fus.rotation.z = -Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(10, 50, 12), grey);
  nose.rotation.z = -Math.PI / 2;
  g.add(at(nose, 135, 0, 0));
  const wing = new THREE.Shape();
  wing.moveTo(40, 0); wing.lineTo(-50, 110); wing.lineTo(-70, 110); wing.lineTo(-50, 0); wing.lineTo(-70, -110); wing.lineTo(-50, -110); wing.closePath();
  const wings = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 4, bevelEnabled: false }), grey);
  wings.rotation.x = Math.PI / 2;
  g.add(at(wings, 0, 2, 0));
  g.add(at(box(40, 50, 4, grey), -95, 28, 0));
  g.add(at(box(26, 10, 22, mat('#2A6FD0', { metal: 0.7, rough: 0.1 })), 60, 12, 0));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(12, 50, 10), mat('#FFB23F', { basic: true, transparent: true, opacity: 0.85 }));
  flame.rotation.z = Math.PI / 2;
  g.add(at(flame, -135, 0, 0));
  g.userData.flame = flame;
  return g;
}

/** 라이트닝(주인공 전용 쌍동 전투기): 가운데 짧은 조종석, 엔진이 달린 꼬리 붐 두 개, 긴 주날개, 꼬리 날개. 앞은 +X */
export function makeLightning(boostColor = '#5AAAFF') {
  const g = new THREE.Group();
  const silver = mat('#C9CED6', { metal: 0.7, rough: 0.3 });
  const blue = mat('#2A6FD0', { metal: 0.5, rough: 0.35 });
  g.add(at(box(320, 6, 34, silver), 10, 0, 0).rotateY(Math.PI / 2)); // 주날개(가로로 긴 날개를 Z로)
  const pod = cyl(12, 14, 110, silver);
  pod.rotation.z = Math.PI / 2;
  g.add(at(pod, 20, 4, 0));
  g.add(at(sphere(13, mat('#7FB2E6', { metal: 0.6, rough: 0.1 })), 46, 14, 0));
  const props = [];
  for (const s of [-1, 1]) {
    const boom = cyl(10, 8, 230, silver);
    boom.rotation.z = Math.PI / 2;
    g.add(at(boom, -30, 2, s * 60));
    g.add(at(box(40, 4, 22, blue), 20, 9, s * 60));
    g.add(at(box(30, 30, 3, silver), -135, 18, s * 60));
    const prop = new THREE.Group();
    prop.add(box(3, 70, 8, mat('#2A2E35')));
    prop.add(box(3, 8, 70, mat('#2A2E35')));
    prop.position.set(85, 2, s * 60);
    g.add(prop);
    props.push(prop);
  }
  g.add(at(box(14, 4, 140, silver), -140, 30, 0));
  const flame = new THREE.Group();
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(9, 50, 10), mat(boostColor, { basic: true, transparent: true, opacity: 0.8 }));
    f.rotation.z = Math.PI / 2;
    flame.add(at(f, -170, 2, s * 60));
  }
  flame.visible = false;
  g.add(flame);
  g.userData.props = props;
  g.userData.boost = flame;
  return g;
}

/** 거대 비행선 데스스타: 긴 타원 선체, 아래 곤돌라, 지느러미, 줄지은 불빛·포대. 앞은 +X */
export function makeDeathstar() {
  const g = new THREE.Group();
  const hull = sphere(130, mat('#6A7180', { metal: 0.45, rough: 0.5, emissive: '#1A1E28' }), 32, 18);
  hull.scale.set(3.6, 1.1, 1.3);
  g.add(hull);
  const band = sphere(132, mat('#C0392B', { emissive: '#5A0A0A' }), 32, 6);
  band.scale.set(3.62, 0.18, 1.32);
  g.add(band);
  g.add(at(box(260, 60, 90, mat('#2A2E35', { metal: 0.6 })), 0, -150, 0));
  for (let i = -3; i <= 3; i++) g.add(at(box(14, 10, 92, mat('#FFD45E', { emissive: '#FFB020' })), i * 34, -150, 0));
  for (const s of [-1, 1]) {
    g.add(at(box(120, 120, 8, mat('#2A2E35')), -440, 0, s * 4).rotateX(s * 0.8));
    g.add(at(box(120, 8, 160, mat('#2A2E35')), -440, 0, 0));
  }
  const lights = mat('#FF6B5A', { emissive: '#FF3B30' });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(at(sphere(8, lights, 8, 6), Math.cos(a) * 300, -90, Math.sin(a) * 150));
  }
  for (const s of [-1, 1]) {
    const gun = cyl(10, 10, 70, mat('#15171C', { metal: 0.7 }));
    gun.rotation.x = Math.PI / 2;
    g.add(at(gun, 120, -110, s * 80));
  }
  return g;
}

/** 복도 벽 포탑: 벽 받침 + 돌아가는 포대(userData.head, 포신은 +X). */
export function makeTurret() {
  const g = new THREE.Group();
  g.add(at(box(30, 80, 80, mat('#4A4F5A', { metal: 0.5 })), 0, 0, 0));
  const head = new THREE.Group();
  head.add(sphere(30, mat('#5E6672', { metal: 0.6, rough: 0.4 })));
  const barrel = cyl(7, 9, 70, mat('#2A2E35', { metal: 0.7 }));
  barrel.rotation.z = Math.PI / 2;
  head.add(at(barrel, 45, 0, 0));
  head.add(at(sphere(6, mat('#FF3B30', { emissive: '#FF2A1A' }), 8, 6), 22, 14, 0));
  head.position.set(30, 0, 0);
  g.add(head);
  g.userData.head = head;
  return g;
}

/** 낙하산 덮개(빨강·흰 줄무늬 반구) + 줄. 캐릭터 머리 위 height에 매단다. */
export function makeChute(height = 180) {
  const g = new THREE.Group();
  const canopy = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(
      new THREE.SphereGeometry(90, 6, 6, (i / 8) * Math.PI * 2, Math.PI / 4, 0, Math.PI / 2.4),
      mat(i % 2 ? '#F4F1E8' : '#D9443A', { side: THREE.DoubleSide, rough: 0.8 }),
    );
    canopy.add(seg);
  }
  canopy.scale.set(1, 0.6, 1);
  canopy.position.y = height;
  g.add(canopy);
  const lineMat = new THREE.LineBasicMaterial({ color: '#E6EBF5' });
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 70, height + 10, Math.sin(a) * 70), new THREE.Vector3(0, height * 0.45, 0));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  g.userData.canopy = canopy;
  return g;
}

/** 엄폐물(콘크리트 방호벽): 폭 w, 두께 d, 높이 h. 팀 진영 엄폐물은 윗면에 팀 색 띠, 강철 엄폐물은 금속판 */
/**
 * 고지대: 올라설 수 있는 높은 단(철골 비계 위 철판 + 한쪽 계단 모양 옆면 + 노랑·검정 가장자리 줄). g는 { w, h(앞뒤 폭), height }.
 */
export function makeHigh(g) {
  if (g.kind === 'container') return makeContainer(g);
  if (g.style === 'white' && !g.bridge && !g.ramp) return makeWhiteBlock(g);
  if (g.kind === 'tower' || g.kind === 'block' || g.kind === 'pylon') return makeBuilding(g);
  if (g.kind === 'trailer' || g.kind === 'bus') return makeVehicleBlock(g);
  if (g.bridge) return g.style === 'white' ? makeWhiteBridge(g) : makeBridgeDeck(g);
  if (g.ramp) return g.style === 'white' ? makeWhiteRamp(g) : makeRamp(g);
  if (g.kind === 'fortress') return makeFortress(g);
  const out = new THREE.Group();
  const H = g.height;
  const steel = mat('#5E6672', { metal: 0.7, rough: 0.4 });
  const deck = mat('#7C858F', { metal: 0.6, rough: 0.5 });
  const dark = mat('#2A2E35', { metal: 0.5, rough: 0.6 });
  // 옆면(콘크리트 블록)과 위 철판
  out.add(at(box(g.w, H - 6, g.h, mat('#9A948A', { rough: 0.9 })), 0, (H - 6) / 2, 0));
  out.add(at(box(g.w + 4, 6, g.h + 4, deck), 0, H - 3, 0));
  // 철판 미끄럼 방지 줄
  for (let x = -g.w / 2 + 12; x < g.w / 2 - 6; x += 16) out.add(at(box(2, 0.6, g.h - 10, dark), x, H + 0.3, 0));
  // 가장자리 경고 줄(노랑·검정)
  const yellow = mat('#FFC53D', { rough: 0.6 }), black = mat('#1A1C20', { rough: 0.6 });
  for (const [w, d, x, z] of [[g.w + 6, 3, 0, g.h / 2 + 2], [g.w + 6, 3, 0, -g.h / 2 - 2], [3, g.h + 6, g.w / 2 + 2, 0], [3, g.h + 6, -g.w / 2 - 2, 0]]) {
    const along = w > d;
    const len = along ? w : d;
    const n = Math.floor(len / 14);
    for (let i = 0; i < n; i++) {
      const seg = box(along ? 14 : 3, 4, along ? 3 : 14, i % 2 ? black : yellow);
      seg.position.set(along ? -len / 2 + 7 + i * 14 : x, H - 2, along ? z : -len / 2 + 7 + i * 14);
      out.add(seg);
    }
  }
  // 옆면 철골 기둥·가로대
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.add(at(box(6, H, 6, steel), sx * (g.w / 2 - 3), H / 2, sz * (g.h / 2 - 3)));
  for (const sz of [-1, 1]) out.add(at(box(g.w - 6, 4, 2, steel), 0, H * 0.5, sz * (g.h / 2 + 0.5)));
  // 오르기 쉬운 쪽 표시: 낮은 받침 계단 두 칸(장식)
  out.add(at(box(40, H * 0.33, 24, mat('#8A847A', { rough: 0.9 })), -g.w / 2 + 30, H * 0.165, g.h / 2 + 12));
  out.add(at(box(40, H * 0.66, 12, mat('#8A847A', { rough: 0.9 })), -g.w / 2 + 30, H * 0.33, g.h / 2 + 6));
  return out;
}

/** 화물 컨테이너(골판 옆면·문짝 쪽 막대·위 철판). g: { w, h, height, color } — 긴 쪽이 w(가로) 또는 h(세로) */
export function makeContainer(g) {
  const out = new THREE.Group();
  const H = g.height;
  const body = mat(g.color ?? '#B4472F', { metal: 0.4, rough: 0.55 });
  const dark = mat('#2A2E35', { metal: 0.6, rough: 0.5 });
  out.add(at(box(g.w, H, g.h, body), 0, H / 2, 0));
  // 골판(긴 면을 따라 세로 홈)
  const long = g.w >= g.h;
  const L = long ? g.w : g.h, T = long ? g.h : g.w;
  for (let i = -L / 2 + 8; i < L / 2 - 4; i += 12) {
    for (const s of [-1, 1]) {
      const rib = box(long ? 4 : 1.5, H - 10, long ? 1.5 : 4, body);
      rib.position.set(long ? i : s * (T / 2 + 0.8), H / 2, long ? s * (T / 2 + 0.8) : i);
      out.add(rib);
    }
  }
  // 모서리 기둥·위 테두리
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.add(at(box(5, H + 1, 5, dark), sx * (g.w / 2 - 2), H / 2, sz * (g.h / 2 - 2)));
  out.add(at(box(g.w + 1, 3, g.h + 1, dark), 0, H - 1, 0));
  // 문짝 쪽(짧은 면) 잠금 막대
  for (const s of [-1, 1]) for (const k of [-0.25, 0.25]) {
    const bar = box(long ? 1.5 : 3, H - 14, long ? 3 : 1.5, mat('#C9CED6', { metal: 0.9, rough: 0.3 }));
    bar.position.set(long ? s * (g.w / 2 + 1) : k * g.w, H / 2, long ? k * g.h : s * (g.h / 2 + 1));
    out.add(bar);
  }
  return out;
}

export function makeCover(c, teamColor, h = 100) {
  const g = new THREE.Group();
  const concrete = c.steel ? mat('#7D8A99', { metal: 0.8, rough: 0.3 }) : mat('#8F8A80', { rough: 0.9 });
  const block = box(c.w, h, c.h, concrete);
  block.position.y = h / 2;
  g.add(block);
  g.add(at(box(c.w + 2, 8, c.h + 2, mat(teamColor ?? '#FFD45E')), 0, h - 4, 0));
  g.userData.block = block;
  return g;
}

/** 노랑·검정 경고 줄을 가장자리 둘레에 붙인다(높이 H, 위에서 본 w×d) */
function hazardEdge(out, w, d, H, { sides = [true, true, true, true] } = {}) {
  const yellow = mat('#FFC53D', { rough: 0.6 }), black = mat('#1A1C20', { rough: 0.6 });
  const edges = [[w + 6, 3, 0, d / 2 + 2], [w + 6, 3, 0, -d / 2 - 2], [3, d + 6, w / 2 + 2, 0], [3, d + 6, -w / 2 - 2, 0]];
  edges.forEach(([ew, ed, x, z], i) => {
    if (!sides[i]) return;
    const along = ew > ed;
    const len = along ? ew : ed;
    const n = Math.floor(len / 24);
    for (let k = 0; k < n; k++) {
      const seg = box(along ? 24 : 4, 5, along ? 4 : 24, k % 2 ? black : yellow);
      seg.position.set(along ? -len / 2 + 12 + k * 24 : x, H - 2, along ? z : -len / 2 + 12 + k * 24);
      out.add(seg);
    }
  });
}

/**
 * 고공 요새의 매우 높은 고지대: 콘크리트 벽(가로 띠·창문 줄), 위 철판 바닥과 가장자리 경고 줄, 모서리 철골 기둥, 위 귀퉁이 경고등.
 */
function makeFortress(g) {
  const out = new THREE.Group();
  const H = g.height;
  const concrete = mat('#8C877E', { rough: 0.95 });
  out.add(at(box(g.w, H - 8, g.h, concrete), 0, (H - 8) / 2, 0));
  out.add(at(box(g.w + 8, 8, g.h + 8, mat('#6F7882', { metal: 0.6, rough: 0.5 })), 0, H - 4, 0));
  // 바닥 철판 줄무늬
  const dark = mat('#2A2E35', { metal: 0.5, rough: 0.6 });
  for (let x = -g.w / 2 + 30; x < g.w / 2 - 20; x += 40) out.add(at(box(3, 0.8, g.h - 30, dark), x, H + 0.4, 0));
  hazardEdge(out, g.w, g.h, H + 2);
  // 벽의 가로 띠와 불 켜진 창문 줄
  const band = mat('#6E6A62', { rough: 1 });
  const lit = mat('#FFE6A0', { emissive: '#FFB84A' }), off = mat('#2A3040', { metal: 0.4, rough: 0.3 });
  for (let y = 70; y < H - 30; y += 90) {
    out.add(at(box(g.w + 4, 6, g.h + 4, band), 0, y, 0));
    let i = 0;
    for (let x = -g.w / 2 + 50; x < g.w / 2 - 30; x += 70) {
      for (const sz of [1, -1]) out.add(at(box(30, 26, 2, (i++ * 7 + y) % 3 ? off : lit), x, y + 32, sz * (g.h / 2 + 1)));
    }
    for (let z = -g.h / 2 + 50; z < g.h / 2 - 30; z += 70) {
      for (const sx of [1, -1]) out.add(at(box(2, 26, 30, (i++ * 5 + y) % 3 ? off : lit), sx * (g.w / 2 + 1), y + 32, z));
    }
  }
  const steel = mat('#5E6672', { metal: 0.7, rough: 0.4 });
  const lamp = mat('#FF3B30', { emissive: '#FF2A1A' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.add(at(box(14, H, 14, steel), sx * (g.w / 2 - 7), H / 2, sz * (g.h / 2 - 7)));
    out.add(at(sphere(8, lamp, 10, 8), sx * (g.w / 2 - 7), H + 12, sz * (g.h / 2 - 7)));
  }
  return out;
}

/** 높은 다리: 위에 서는 철판 상판(가장자리 경고 줄·낮은 난간 기둥), 상판 아래 철골 보, 일정 간격의 기둥(밑으로 지나다닐 수 있음) */
function makeBridgeDeck(g) {
  const out = new THREE.Group();
  const H = g.height;
  const long = g.w >= g.h;
  const L = long ? g.w : g.h, W = long ? g.h : g.w;
  const deck = new THREE.Group();
  deck.add(at(box(L, 14, W, mat('#7C858F', { metal: 0.6, rough: 0.5 })), 0, H - 7, 0));
  deck.add(at(box(L, 18, W * 0.5, mat('#4A525C', { metal: 0.6, rough: 0.5 })), 0, H - 23, 0));
  const dark = mat('#2A2E35', { metal: 0.5, rough: 0.6 });
  for (let x = -L / 2 + 20; x < L / 2 - 10; x += 30) deck.add(at(box(2, 0.8, W - 16, dark), x, H + 0.4, 0));
  hazardEdge(deck, L, W, H + 2, { sides: [true, true, false, false] });
  // 기둥: 다리 아래 두 줄, 300마다(가장자리 쪽에 붙여 밑으로 걸어 지나갈 수 있게 가늘게)
  const steel = mat('#5E6672', { metal: 0.7, rough: 0.4 });
  for (let x = -L / 2 + 150; x <= L / 2 - 150; x += 300) {
    for (const sz of [-1, 1]) deck.add(at(box(10, H - 30, 10, steel), x, (H - 30) / 2, sz * (W / 2 - 8)));
  }
  // 상판 가장자리 낮은 난간 기둥과 빛나는 띠(밤에도 다리가 보이게)
  const glow = mat('#7FE7FF', { emissive: '#2AB8E0' });
  for (const sz of [-1, 1]) {
    deck.add(at(box(L, 3, 3, glow), 0, H + 18, sz * (W / 2 - 2)));
    for (let x = -L / 2 + 10; x <= L / 2 - 10; x += 60) deck.add(at(box(3, 18, 3, steel), x, H + 9, sz * (W / 2 - 2)));
  }
  if (!long) deck.rotation.y = Math.PI / 2;
  out.add(deck);
  return out;
}

/** 오르막길: 비탈진 철판 길(미끄럼 방지 홈), 양옆 낮은 벽, 아래를 막는 콘크리트 받침. g.ramp.axis·dir 쪽으로 오른다 */
function makeRamp(g) {
  const out = new THREE.Group();
  const H = g.height;
  const alongX = g.ramp.axis === 'x';
  const L = alongX ? g.w : g.h, W = alongX ? g.h : g.w;
  const inner = new THREE.Group();
  // 옆에서 본 삼각형 받침(+X 쪽이 높다)
  const shape = new THREE.Shape([new THREE.Vector2(-L / 2, 0), new THREE.Vector2(L / 2, 0), new THREE.Vector2(L / 2, H), new THREE.Vector2(-L / 2, 0)]);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false }), mat('#8C877E', { rough: 0.95 }));
  body.position.z = -W / 2;
  inner.add(body);
  // 비탈 위 철판과 미끄럼 방지 홈
  const slope = Math.atan2(H, L), len = Math.hypot(L, H);
  const plate = at(box(len, 4, W, mat('#7C858F', { metal: 0.6, rough: 0.5 })), 0, H / 2 + 2, 0);
  plate.rotation.z = slope;
  inner.add(plate);
  const grip = mat('#FFC53D', { rough: 0.6 });
  for (let i = 1; i < 12; i++) {
    const k = i / 12;
    const bar = at(box(5, 2, W - 20, grip), -L / 2 + L * k, H * k + 4, 0);
    bar.rotation.z = slope;
    inner.add(bar);
  }
  // 위쪽 화살표 표시(오르는 방향)
  const steel = mat('#5E6672', { metal: 0.7, rough: 0.4 });
  for (const sz of [-1, 1]) {
    const wall = at(box(len, 22, 6, steel), 0, H / 2 + 12, sz * (W / 2 - 3));
    wall.rotation.z = slope;
    inner.add(wall);
  }
  // 오르는 방향(+축 dir)으로 돌린다
  const dir = g.ramp.dir;
  if (alongX) inner.rotation.y = dir > 0 ? 0 : Math.PI;
  else inner.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  out.add(inner);
  return out;
}

/** 점프 패드: 바닥의 둥근 판(푸르게 빛나는 고리·위쪽 화살표). userData.glow를 깜빡여 보인다 */
export function makeJumpPad(r = 70) {
  const out = new THREE.Group();
  out.add(at(cyl(r, r + 6, 8, mat('#2A2E35', { metal: 0.6, rough: 0.4 }), 28), 0, 4, 0));
  const glow = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, 6, 8, 32), new THREE.MeshBasicMaterial({ color: '#5FEFFF' }));
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 9;
  out.add(glow);
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.6, 28), new THREE.MeshBasicMaterial({ color: '#1B6E86' }));
  core.rotation.x = -Math.PI / 2;
  core.position.y = 8.6;
  out.add(core);
  // 위쪽 화살표 세 겹
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#BFF8FF', transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const arrows = [];
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Mesh(new THREE.ConeGeometry(r * 0.35, 30, 4, 1, true), arrowMat);
    a.position.y = 30 + i * 40;
    out.add(a);
    arrows.push(a);
  }
  out.userData = { glow, arrows, r };
  return out;
}

/* ───────── 거대한 경기장의 건축물(maps.js) ─────────
 * 창문·패널은 메시 대신 반복 텍스처로 그려(건물마다 메시 10여 개) 수십 채를 늘어놓아도 가볍다.
 */
const facades = new Map();
/** 겉면 무늬 텍스처(한 칸): 'tower' 밤 빌딩 창문, 'block' 본부 홀 철판 패널, 'pylon' 대교 주탑 콘크리트, 'trailer'·'bus' 차체 */
function facadeTexture(style) {
  if (facades.has(style)) return facades.get(style);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const rnd = (() => { let a = style.length * 977; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  if (style === 'tower') {
    g.fillStyle = '#1E2433'; g.fillRect(0, 0, 128, 128);
    for (let y = 8; y < 128; y += 32) for (let x = 6; x < 128; x += 30) {
      const lit = rnd() < 0.42;
      g.fillStyle = lit ? (rnd() < 0.5 ? '#FFD98A' : '#FFF1C8') : '#2E3A52';
      g.fillRect(x, y, 20, 18);
    }
    g.fillStyle = '#3A4252'; g.fillRect(0, 0, 128, 3);
  } else if (style === 'block') {
    g.fillStyle = '#6A707C'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#5A606B'; g.fillRect(0, 0, 62, 128); g.fillRect(66, 64, 62, 64);
    g.strokeStyle = '#3A3F48'; g.lineWidth = 3; g.strokeRect(2, 2, 124, 124);
    for (let i = 0; i < 8; i++) { g.fillStyle = '#2A2E35'; g.fillRect(10 + (i % 4) * 28, 12 + Math.floor(i / 4) * 64, 4, 4); }
    g.fillStyle = '#7FE7FF'; g.fillRect(90, 20, 22, 6);
  } else if (style === 'pylon') {
    g.fillStyle = '#7A3A2A'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#6A3022'; g.fillRect(0, 56, 128, 16);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(rnd() * 128, rnd() * 128, 4, 4); }
    g.fillStyle = 'rgba(244,247,251,0.7)'; g.fillRect(0, 54, 128, 3);
  } else if (style === 'trailer') {
    g.fillStyle = '#C9CED6'; g.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 16) { g.fillStyle = '#AEB4BE'; g.fillRect(x, 0, 4, 128); }
    g.fillStyle = '#D9443A'; g.fillRect(0, 100, 128, 10);
  } else {
    g.fillStyle = '#E0A22A'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#26303E'; for (let x = 6; x < 128; x += 32) g.fillRect(x, 20, 26, 40);
    g.fillStyle = '#1A1C20'; g.fillRect(0, 96, 128, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  facades.set(style, t);
  return t;
}
/** 겉면 재질(무늬·색마다 하나만 만들어 함께 쓴다. 반복 횟수는 tiledBox가 면마다 UV로 정한다). 밤 빌딩 창문은 스스로 빛난다 */
const facadeMats = new Map();
function facadeMat(style, tint = '#FFFFFF') {
  const key = `${style}|${tint}`;
  if (!facadeMats.has(key)) {
    const t = facadeTexture(style);
    const glow = style === 'tower';
    const m = new THREE.MeshStandardMaterial({
      map: t, color: tint, roughness: style === 'tower' ? 0.5 : 0.85, metalness: style === 'tower' ? 0.3 : 0.15,
      ...(glow ? { emissive: '#FFFFFF', emissiveMap: t, emissiveIntensity: 0.55 } : {}),
    });
    m.userData.shared = true;
    facadeMats.set(key, m);
  }
  return facadeMats.get(key);
}
/**
 * 상자(w×h×d)의 UV를 면마다 그 면 크기/tile만큼 늘려, 같은 텍스처·재질을 크기가 다른 상자들이 함께 써도 무늬 크기가 같게 한다.
 * three.js 상자 면 순서: +X·-X(d×h), +Y·-Y(w×d), +Z·-Z(w×h), 면마다 꼭짓점 4개.
 */
function tiledBox(w, h, d, tile) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const size = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [u, v] = size[f].map((n) => Math.max(1, Math.round(n / tile)));
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
/** 윗면 가장자리 노랑 띠(네 변, 얇은 상자 넷) */
function rimStripes(out, w, d, H, color = '#FFC53D') {
  const m = mat(color, { rough: 0.6, emissive: '#3A2A00' });
  out.add(at(box(w + 6, 5, 6, m), 0, H + 1, d / 2));
  out.add(at(box(w + 6, 5, 6, m), 0, H + 1, -d / 2));
  out.add(at(box(6, 5, d + 6, m), w / 2, H + 1, 0));
  out.add(at(box(6, 5, d + 6, m), -w / 2, H + 1, 0));
}

/**
 * 건물·구조물(고지대): 'tower' 밤 빌딩(창문 불빛·옥상 환풍기·경고등·안테나), 'block' 본부 홀의 철판 구조물(위 띠·푸른 표시등),
 * 'pylon' 대교 주탑(붉은 콘크리트·눈 덮인 꼭대기·항공 경고등). g.core: 천장까지 닿는 벽 기둥(장식 없이).
 */
export function makeBuilding(g) {
  const out = new THREE.Group();
  const H = g.height, style = g.kind;
  const per = style === 'tower' ? 120 : style === 'pylon' ? 200 : 160;
  const face = facadeMat(style);
  const top = mat(style === 'pylon' ? '#F4F7FB' : style === 'block' ? '#7C858F' : '#5A5F68', { metal: 0.4, rough: 0.7 });
  const body = new THREE.Mesh(tiledBox(g.w, H, g.h, per), [face, face, top, top, face, face]);
  body.position.y = H / 2;
  out.add(body);
  if (g.core) return out;
  rimStripes(out, g.w, g.h, H, style === 'pylon' ? '#F4F7FB' : '#FFC53D');
  const lamp = mat('#FF3B30', { emissive: '#FF2A1A' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.add(at(sphere(9, lamp, 8, 6), sx * (g.w / 2 - 10), H + 14, sz * (g.h / 2 - 10)));
  if (style === 'tower') {
    // 옥상 환풍기·물탱크·안테나
    out.add(at(box(Math.min(120, g.w * 0.25), 50, Math.min(90, g.h * 0.25), mat('#7A828E', { metal: 0.6, rough: 0.4 })), -g.w * 0.22, H + 25, g.h * 0.2));
    out.add(at(cyl(40, 40, 90, mat('#A9B0BC', { metal: 0.5 }), 14), g.w * 0.24, H + 45, -g.h * 0.2));
    out.add(at(cyl(3, 5, 220, mat('#C9CED6', { metal: 0.8 }), 6), g.w * 0.3, H + 110, g.h * 0.3));
    out.add(at(sphere(7, lamp, 8, 6), g.w * 0.3, H + 222, g.h * 0.3));
  } else if (style === 'block') {
    // 위 노랑·검정 띠와 푸른 표시등 줄
    const glow = mat('#7FE7FF', { emissive: '#2AB8E0' });
    out.add(at(box(g.w + 2, 6, 4, glow), 0, H - 30, g.h / 2 + 1));
    out.add(at(box(g.w + 2, 6, 4, glow), 0, H - 30, -g.h / 2 - 1));
  } else if (style === 'pylon') {
    // 눈 덮인 꼭대기 테두리와 항공 경고등 기둥
    out.add(at(box(g.w + 20, 20, g.h + 20, mat('#6A3022', { rough: 0.8 })), 0, H - 60, 0));
    out.add(at(cyl(6, 8, 160, mat('#3A3F4D'), 8), 0, H + 80, 0));
    out.add(at(sphere(16, lamp, 10, 8), 0, H + 168, 0));
  }
  return out;
}

/** 도로의 대형 트레일러('trailer')·대교에 멈춘 버스('bus'): 바닥 차대·바퀴 위 상자 차체(위에 설 수 있음) */
export function makeVehicleBlock(g) {
  const out = new THREE.Group();
  const H = g.height, chassis = Math.min(40, H * 0.25);
  const long = g.w >= g.h, L = long ? g.w : g.h, W = long ? g.h : g.w;
  const inner = new THREE.Group();
  const style = g.kind;
  const sideMat = facadeMat(style, g.color ?? '#FFFFFF');
  const end = mat(style === 'bus' ? '#26303E' : '#AEB4BE', { metal: 0.4, rough: 0.6 });
  const roof = mat(style === 'bus' ? '#C9CED6' : '#9AA3B1', { metal: 0.4, rough: 0.6 });
  const body = new THREE.Mesh(tiledBox(L, H - chassis, W, 128), [end, end, roof, roof, sideMat, sideMat]);
  body.position.y = chassis + (H - chassis) / 2;
  inner.add(body);
  inner.add(at(box(L * 0.96, chassis, W * 0.7, mat('#1A1C20', { metal: 0.5, rough: 0.6 })), 0, chassis / 2, 0));
  const tire = mat('#141518', { rough: 0.9 });
  for (let i = 0; i < 3; i++) {
    const x = -L / 2 + L * (0.15 + i * 0.35);
    for (const s of [-1, 1]) {
      const w = cyl(chassis * 0.8, chassis * 0.8, 14, tire, 12);
      w.rotation.x = Math.PI / 2;
      inner.add(at(w, x, chassis * 0.8, s * (W / 2 - 8)));
    }
  }
  rimStripes(inner, L, W, H, style === 'bus' ? '#FFFFFF' : '#FFC53D');
  if (!long) inner.rotation.y = Math.PI / 2;
  out.add(inner);
  return out;
}

/** 하늘의 방공 기구(엄폐물): 은빛 기구와 지느러미, 아래로 늘어진 줄. c는 엄폐물({ w, h }) */
export function makeBalloon(c) {
  const out = new THREE.Group();
  const r = Math.max(c.w, c.h) / 2;
  const skin = mat('#B8C0CC', { metal: 0.5, rough: 0.35 });
  const body = sphere(r, skin, 18, 12);
  body.scale.set(1.5, 0.8, 0.8);
  body.position.y = 70;
  out.add(body);
  for (const [y, z] of [[r * 0.6, 0], [0, r * 0.6], [0, -r * 0.6]]) out.add(at(box(r * 0.6, y ? r * 0.5 : 6, z ? r * 0.5 : 6, skin), -r * 1.3, 70 + y, z));
  out.add(at(cyl(1.5, 1.5, 900, mat('#46505F'), 4), 0, 70 - 450, 0));
  out.add(at(sphere(8, mat('#FF3B30', { emissive: '#FF2A1A' }), 8, 6), r * 1.4, 70, 0));
  out.userData.block = body;
  return out;
}

/* ───────── 구름 위 하얀 섬(cloud 맵): 하얀 타일 블록 ───────── */
let whiteTile = null;
/** 하얀 타일 무늬(옅은 회색 줄눈과 모서리 점) 한 칸 = 120 */
function whiteTileTexture() {
  if (whiteTile) return whiteTile;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#F4F6FA'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#C9D0DB'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 125, 125);
  g.strokeStyle = 'rgba(160,170,186,0.35)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  g.fillStyle = '#B8C0CC';
  for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128], [64, 64]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  whiteTile = new THREE.CanvasTexture(c);
  whiteTile.colorSpace = THREE.SRGBColorSpace;
  whiteTile.wrapS = whiteTile.wrapT = THREE.RepeatWrapping;
  return whiteTile;
}
/** 하얀 타일 재질(하나만 만들어 함께 쓴다, 무늬 크기는 tiledBox UV로) */
let whiteShared = null;
export function whiteMat() {
  if (!whiteShared) {
    whiteShared = new THREE.MeshStandardMaterial({ map: whiteTileTexture(), color: '#FFFFFF', roughness: 0.75, metalness: 0.02 });
    whiteShared.userData.shared = true;
  }
  return whiteShared;
}
const WHITE_TILE = 120;
/** 하얀 블록(탑·기둥·계단): 면마다 크기에 맞춰 타일을 되풀이하고, 꼭대기 가장자리에 옅은 하늘색 빛 띠 */
export function makeWhiteBlock(g) {
  const out = new THREE.Group();
  const H = g.height;
  const body = new THREE.Mesh(tiledBox(g.w, H, g.h, WHITE_TILE), whiteMat());
  body.position.y = H / 2;
  out.add(body);
  rimStripes(out, g.w, g.h, H - 2, '#BFF4FF');
  return out;
}
/** 하얀 공중 다리: 두꺼운 하얀 상판과 아래 아치 모양 받침(가운데는 뚫려 밑으로 지나다님) */
function makeWhiteBridge(g) {
  const out = new THREE.Group();
  const H = g.height, long = g.w >= g.h, L = long ? g.w : g.h, W = long ? g.h : g.w;
  const inner = new THREE.Group();
  const deck = new THREE.Mesh(tiledBox(L, 30, W, WHITE_TILE), whiteMat());
  deck.position.y = H - 15;
  inner.add(deck);
  // 상판 아래 양 끝을 둥글게 받치는 아치 턱
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(tiledBox(Math.min(160, L * 0.15), 60, W, WHITE_TILE), whiteMat());
    c.position.set(s * (L / 2 - Math.min(80, L * 0.075)), H - 60, 0);
    inner.add(c);
  }
  rimStripes(inner, L, W, H - 2, '#BFF4FF');
  if (!long) inner.rotation.y = Math.PI / 2;
  out.add(inner);
  return out;
}
/** 하얀 오르막길(계단처럼 보이는 타일 비탈) */
function makeWhiteRamp(g) {
  const out = makeRamp(g);
  const white = mat('#EEF1F6', { rough: 0.75 });
  out.traverse((m) => { if (m.isMesh) m.material = white; });
  return out;
}
/** 하얀 엄폐물(낮은 하얀 블록 + 하늘색 띠) */
export function makeWhiteCover(c, h = 84) {
  const g = new THREE.Group();
  // 깎이면 색을 바꾸므로 재질은 엄폐물마다 따로
  const m = whiteMat().clone();
  m.userData.shared = false;
  const block = new THREE.Mesh(tiledBox(c.w, h, c.h, 60), m);
  block.position.y = h / 2;
  g.add(block);
  g.add(at(box(c.w + 2, 5, c.h + 2, mat('#7FE7FF', { emissive: '#2AB8E0' })), 0, h - 2, 0));
  g.userData.block = block;
  g.userData.white = true;
  return g;
}

/* ───────── 강습 건쉽(상점 탈것): 원작 디자인 ─────────
 * 앞이 +X. 가운데 아래로 좁아지는 육각 조종석(앞 유리), 그 위로 넓게 펼친 각진 장갑 지붕 두 겹과 뒤쪽 계단 꼬리판,
 * 양옆 각진 팔에 매단 팔각 엔진 포드(앞쪽 덕트 팬이 돈다), 포드마다 아래 쌍 캐논. 원점은 발 높이(z), 몸 가운데는 위로 약 70.
 * userData.fans: 돌릴 팬, userData.lights: 깜빡일 표시등.
 */
export function makeAssaultGunship() {
  const out = new THREE.Group();
  const armor = mat('#2B313A', { metal: 0.55, rough: 0.45 });
  const dark = mat('#171B21', { metal: 0.5, rough: 0.55 });
  const edge = mat('#454E5B', { metal: 0.6, rough: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#2E5F8E', metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.85, emissive: '#0E2440', emissiveIntensity: 0.6 });
  // 옆에서 본 모양을 폭(z)만큼 밀어 만든다
  const prism = (pts, depth, material) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 1 });
    geo.translate(0, 0, -depth / 2);
    return new THREE.Mesh(geo, material);
  };
  // 조종석 몸통(아래로 좁아지고 앞이 비스듬히 깎인 육각)과 앞·옆 유리
  out.add(prism([[-78, 70], [-60, 34], [44, 18], [80, 50], [88, 92], [52, 122], [-56, 122]], 74, armor));
  const canopy = prism([[46, 26], [78, 54], [84, 90], [54, 114], [40, 112], [62, 86], [58, 56], [38, 34]], 60, glass);
  canopy.position.x = 3;
  out.add(canopy);
  for (const s of [-1, 1]) {
    const side = prism([[0, 40], [44, 32], [56, 60], [40, 100], [0, 104]], 2, glass);
    side.position.set(10, 0, s * 39);
    out.add(side);
  }
  out.add(at(box(70, 10, 80, dark), -20, 16, 0)); // 배 아래 판
  // 장갑 지붕: 넓은 가운데 판 + 양옆으로 비스듬히 내려가는 판 두 겹 + 앞 모서리 판
  const roofY = 136;
  out.add(at(box(170, 12, 120, armor), -10, roofY, 0));
  out.add(at(box(120, 8, 70, edge), 10, roofY + 10, 0));
  out.add(at(box(40, 14, 50, dark), 50, roofY + 16, 0)); // 앞 센서 덮개
  for (const s of [-1, 1]) {
    const wing = at(box(190, 10, 150, armor), -14, roofY - 22, s * 128);
    wing.rotation.x = s * 0.32;
    out.add(wing);
    const outer = at(box(150, 9, 110, edge), -30, roofY - 58, s * 238);
    outer.rotation.x = s * 0.52;
    out.add(outer);
    // 지붕 아래 그물 무늬 통풍판(어둡게)
    const vent = at(box(150, 3, 120, dark), -20, roofY - 36, s * 120);
    vent.rotation.x = s * 0.32;
    out.add(vent);
    // 앞쪽 각진 판(지붕 앞 모서리)
    const lip = at(box(30, 8, 140, edge), 74, roofY - 34, s * 118);
    lip.rotation.set(s * 0.32, 0, -0.35);
    out.add(lip);
    // 뒤 꼬리판: 계단처럼 아래로 내려가는 판 셋
    for (let i = 0; i < 3; i++) {
      const fin = at(box(70, 6, 46, armor), -112 - i * 26, roofY - 34 - i * 22, s * (34 + i * 18));
      fin.rotation.set(s * 0.2, 0, 0.5);
      out.add(fin);
    }
    // 엔진 포드를 거는 각진 팔(위 팔·아래 팔)
    const arm1 = at(box(26, 16, 100, dark), 0, 104, s * 86);
    arm1.rotation.x = s * -0.5;
    out.add(arm1);
    const arm2 = at(box(18, 12, 96, edge), -26, 70, s * 96);
    arm2.rotation.x = s * 0.35;
    out.add(arm2);
  }
  // 엔진 포드: 팔각 통(축이 앞뒤 X), 앞에 덕트 팬, 아래 쌍 캐논, 옆 표시등
  const fans = [], lights = [];
  const fanMat = mat('#59636F', { metal: 0.8, rough: 0.3 });
  const lamp = mat('#FFCB4A', { emissive: '#FFB020' });
  for (const s of [-1, 1]) {
    const pod = new THREE.Group();
    pod.position.set(6, 48, s * 150);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 96, 8, 1), armor);
    shell.rotation.z = Math.PI / 2;
    shell.rotation.x = Math.PI / 8;
    pod.add(shell);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 6, 24, 1, true), dark);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = 46;
    pod.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 8, 12), edge);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = 46;
    pod.add(hub);
    const fan = new THREE.Group();
    fan.position.x = 45;
    for (let i = 0; i < 9; i++) {
      const blade = box(2, 30, 7, fanMat);
      blade.position.y = 18;
      const arm = new THREE.Group();
      arm.rotation.x = (i / 9) * Math.PI * 2;
      blade.rotation.y = 0.4;
      arm.add(blade);
      fan.add(arm);
    }
    pod.add(fan);
    fans.push(fan);
    // 뒤 배기구
    const back = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 10, 8), dark);
    back.rotation.z = Math.PI / 2;
    back.position.x = -52;
    pod.add(back);
    // 쌍 캐논(포드 아래, 앞으로)
    for (const dz of [-14, 14]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 120, 10), dark);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(52, -44, dz);
      pod.add(barrel);
      pod.add(at(box(10, 10, 10, dark), 114, -44, dz));
    }
    pod.add(at(box(40, 18, 40, edge), 4, -40, 0)); // 캐논 받침
    const l = at(box(10, 10, 4, lamp), 20, 0, s * 44);
    pod.add(l);
    lights.push(l);
    out.add(pod);
  }
  // ── 무장·장비 ──
  const olive = mat('#4E5A3A', { metal: 0.3, rough: 0.6 });
  const red = mat('#C8352A', { metal: 0.3, rough: 0.5 });
  const steel = mat('#8E96A2', { metal: 0.85, rough: 0.3 });
  const glow = mat('#FFB050', { emissive: '#FF7A1A' });
  const tube = (r, len, material, seg = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), material); m.rotation.z = Math.PI / 2; return m; };
  const gatlings = [];
  for (const s of [-1, 1]) {
    // 날개 아래 미사일 발사기 4개: 받침 레일에 나란히 매단 발사관(앞에 붉은 탄두)
    out.add(at(box(110, 8, 120, dark), 6, 70, s * 250));
    for (let i = 0; i < 4; i++) {
      const z = s * (205 + i * 30);
      const launcher = tube(9, 90, dark);
      launcher.position.set(6, 54, z);
      out.add(launcher);
      const warhead = new THREE.Mesh(new THREE.ConeGeometry(7, 16, 10), red);
      warhead.rotation.z = -Math.PI / 2;
      warhead.position.set(58, 54, z);
      out.add(warhead);
      out.add(at(box(6, 10, 6, dark), 6, 63, z));
    }
    // 날개 끝 개틀링건: 몸통 + 6개 총열 묶음(돈다)
    const gun = new THREE.Group();
    gun.position.set(10, 44, s * 336);
    gun.add(at(box(46, 26, 26, dark), -6, 0, 0));
    gun.add(at(box(14, 34, 10, steel), -14, 18, 0)); // 날개에 거는 받침
    const barrels = new THREE.Group();
    barrels.position.x = 40;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const bar = tube(2.6, 70, steel, 8);
      bar.position.set(0, Math.cos(a) * 7, Math.sin(a) * 7);
      barrels.add(bar);
    }
    const front = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 4, 14), dark);
    front.rotation.z = Math.PI / 2;
    front.position.x = 28;
    barrels.add(front);
    gun.add(barrels);
    out.add(gun);
    gatlings.push(barrels);
  }
  // 바닥 랜딩기어: 앞 하나·뒤 둘(다리 + 충격흡수 통 + 바퀴)
  const tire = mat('#141518', { rough: 0.9 });
  for (const [x, z] of [[46, 0], [-50, -30], [-50, 30]]) {
    out.add(at(box(8, 54, 8, steel), x, -10, z));
    out.add(at(box(14, 18, 14, dark), x, 10, z));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 10, 14), tire);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, -40, z);
    out.add(wheel);
  }
  // 뒤 엔진부: 몸통 뒤 엔진 상자와 붉게 빛나는 배기구 둘
  out.add(at(box(50, 54, 70, armor), -96, 80, 0));
  for (const z of [-20, 20]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 24, 14), dark);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-128, 80, z);
    out.add(nozzle);
    const fire = new THREE.Mesh(new THREE.CircleGeometry(11, 14), glow);
    fire.rotation.y = -Math.PI / 2;
    fire.position.set(-141, 80, z);
    out.add(fire);
  }
  // 지붕 위 RPG 2개: 받침 위 올리브색 발사관 + 앞에 탄두
  for (const z of [-34, 34]) {
    out.add(at(box(20, 14, 12, dark), -10, roofY + 20, z));
    const rpg = tube(8, 110, olive);
    rpg.position.set(-4, roofY + 34, z);
    out.add(rpg);
    const head = new THREE.Mesh(new THREE.ConeGeometry(11, 24, 10), olive);
    head.rotation.z = -Math.PI / 2;
    head.position.set(62, roofY + 34, z);
    out.add(head);
    out.add(at(box(8, 12, 4, steel), 20, roofY + 46, z)); // 조준경
  }
  out.userData = { fans, lights, gatlings };
  return out;
}
