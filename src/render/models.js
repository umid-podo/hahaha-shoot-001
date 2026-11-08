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
