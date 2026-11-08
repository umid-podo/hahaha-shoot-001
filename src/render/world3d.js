import * as THREE from '../vendor/three.module.min.js';
import {
  ARENA_WIDTH, ARENA_HEIGHT, RAIL_Y, SPRITE_SIZE, TEAM_COLOR, CHARACTERS, JET, TANK, SHIP, TURRETS, WEAPONS, MUZZLE_OFFSET,
} from '../game/config.js';
import {
  ELEVATOR, CEILING_X, ROOF_STAIRS, CORRIDOR_STAIRS, DRIVE_ROAD, DRIVE_Y, CARRIER_Y,
} from '../game/story.js';
import * as M from './models.js';
import { createViewmodel, makeBullet, makeArrow, sharedShotGeometries, getFlashTexture, getSmokeTexture, vmFov, makeHeldGun, poseHeldGun, hasHeldGun } from './guns.js';
import { segmentRectTime } from '../game/collision.js';
import { modStore } from '../game/mods.js';

/**
 * 1인칭 3D 화면(three.js). 게임 상태(경기장 위에서 본 2D 좌표)를 그대로 읽어 3D로 그린다.
 * 경기장의 (x, y)는 3D의 (X, Z), 높이는 Y. 1단위 = 경기장 1px(몸 반지름 30 ≈ 40cm, 눈높이 EYE).
 * 사람 플레이어마다 그 사람의 눈으로 본 화면(1인칭)을 그리고, 둘이면 화면을 좌우로 나눈다(P1 왼쪽, P2 오른쪽).
 * 컷씬·처치 컷씬(킬캠)·대교 가는 길(운전)은 장면에 맞춘 카메라 하나로 화면 전체에 그린다.
 * 캐릭터는 그림(PNG·SVG)을 늘 카메라를 보는 판(빌보드)으로, 탈것·장치는 models.js의 도형 모델로 그린다.
 * HUD(조준점·체력·이름표·피해 숫자)는 hud.js가 2D 캔버스에 그리고, 여기서는 그 위치(화면 좌표)를 계산해 넘긴다.
 */

export const EYE = 128;          // 눈높이
const GUN_Y = 84;                 // 탄이 날아가는 높이
const PLANE_Y = 70;               // 하늘(공중전): 비행기가 나는 높이(이 높이를 기준면으로 본다)
const CAR_ROOF = 58;              // 도로: 차 지붕 높이(그 위에 선다)
const HELI_ALT = 330;             // 헬리콥터·건쉽이 떠 있는 높이
const JET_ALT = 360;              // 전투기 높이
const COVER_H = 84;               // 엄폐물 높이(눈높이 아래라 넘어 보인다)
const CHAR_SCALE = 1.75;          // 캐릭터 그림 크기(2D 그림 크기 대비)
const FOV = 74;
const RECOIL_TIME = 0.12;
const DS_SCALE = 1.6;             // 데스스타 모델 크기(거대 비행선)

const toV = (x, h, y) => new THREE.Vector3(x, h, y);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const ease = (k) => { const q = clamp01(k); return q * q * (3 - 2 * q); };

/** 2D 캔버스에 그린 그림을 텍스처로 */
function canvasTexture(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  return t;
}

/** 위에서 아래로 바뀌는 하늘 배경 */
function skyTexture(stops) {
  return canvasTexture(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    stops.forEach(([at, color]) => grad.addColorStop(at, color));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** 불 켜진 창문이 있는 건물 벽 */
function windowTexture(seed, lit = 0.35, base = '#1A1F2E') {
  let a = seed >>> 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 20) {
      for (let x = 8; x < w - 8; x += 20) {
        g.fillStyle = rnd() < lit ? (rnd() < 0.85 ? '#FFD678' : '#A0DCFF') : '#0E121C';
        g.fillRect(x, y, 10, 12);
      }
    }
  }, { repeat: [1, 1] });
}

/** 그림의 아래쪽 투명한 여백 비율(발이 땅에 닿게 하려고) */
function footMargin(img) {
  const c = document.createElement('canvas');
  const n = 64;
  c.width = n; c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, n, n);
  const data = g.getImageData(0, 0, n, n).data;
  for (let y = n - 1; y >= 0; y--) {
    for (let x = 0; x < n; x++) if (data[(y * n + x) * 4 + 3] > 40) return (n - 1 - y) / n;
  }
  return 0;
}

export function createWorld3D(canvas, wrap, assets) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  const cameras = [new THREE.PerspectiveCamera(FOV, 1.6, 4, 12000), new THREE.PerspectiveCamera(FOV, 0.8, 4, 12000)];
  const cine = new THREE.PerspectiveCamera(58, 1.6, 4, 12000);
  const camState = { pos: new THREE.Vector3(800, 400, 1300), look: new THREE.Vector3(800, 60, 500), ready: false };
  let cssW = 1600, cssH = 1000;

  function resize() {
    const scale = Math.min(wrap.clientWidth / ARENA_WIDTH, wrap.clientHeight / ARENA_HEIGHT);
    cssW = Math.max(1, Math.round(ARENA_WIDTH * scale));
    cssH = Math.max(1, Math.round(ARENA_HEIGHT * scale));
    renderer.setSize(cssW, cssH, false);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  // ── 텍스처: 캐릭터 그림(오른쪽을 보는 원본과 뒤집은 것), 효과 그림 ──
  const textures = new Map();
  const feet = new Map();
  function spriteTexture(id, flipped) {
    const key = `${id}|${flipped}`;
    if (!textures.has(key)) {
      const t = new THREE.Texture(assets[id].img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      if (flipped) {
        t.wrapS = THREE.RepeatWrapping;
        t.repeat.x = -1;
      }
      textures.set(key, t);
    }
    return textures.get(key);
  }
  function footOf(id) {
    if (!feet.has(id)) feet.set(id, footMargin(assets[id].img));
    return feet.get(id);
  }
  /** 캐릭터의 지금 그림(무기별 그림이 있으면 그것) */
  const imageOf = (characterId, weapon) => (assets[`${characterId}@${weapon}`] ? `${characterId}@${weapon}` : characterId);

  // ── 조명(무대마다 색·세기를 바꾼다) ──
  const hemi = new THREE.HemisphereLight('#AFC6FF', '#3A3A44', 1.4);
  const sun = new THREE.DirectionalLight('#FFFFFF', 1.6);
  sun.position.set(400, 900, 1200);
  sun.target.position.set(800, 0, 500);
  scene.add(hemi, sun, sun.target);

  // ── 무대(경기장 환경). key가 바뀔 때만 새로 만든다 ──
  let env = { key: null, group: null, update: () => {} };
  function setEnv(key, match) {
    if (env.key === key) return;
    if (env.group) scene.remove(env.group);
    const group = new THREE.Group();
    scene.add(group);
    const builders = { arena: buildRooftop, rooftop: buildRooftop, corridor: buildCorridor, sky: buildSky, road: buildRoad, bridge: buildBridge, drive: buildDrive };
    env = { key, group, update: () => {}, ...(builders[key] ?? buildRooftop)(group, match) };
  }

  function floorPlane(texture, w = ARENA_WIDTH, h = ARENA_HEIGHT, cx = ARENA_WIDTH / 2, cz = ARENA_HEIGHT / 2, y = 0, color = '#FFFFFF') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, color, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, y, cz);
    return m;
  }
  /** 경기장 둘레를 감싸는 큰 건물들(base 높이부터 위로) */
  function skyline(group, { base = -1600, minH = 900, maxH = 2400, ring = 900, count = 34, lit = 0.35, seed = 7 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = ring + ((i * 977) % 700);
      const w = 260 + ((i * 131) % 260), d = 260 + ((i * 71) % 220);
      const h = minH + ((i * 389) % (maxH - minH));
      const tex = windowTexture(seed + i, lit);
      tex.repeat.set(Math.max(1, Math.round(w / 128)), Math.max(1, Math.round(h / 256)));
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: '#FFFFFF', emissiveMap: tex, emissiveIntensity: 0.55 }));
      b.position.set(ARENA_WIDTH / 2 + Math.cos(a) * (ARENA_WIDTH / 2 + r), base + h / 2, ARENA_HEIGHT / 2 + Math.sin(a) * (ARENA_HEIGHT / 2 + r));
      group.add(b);
    }
  }

  /** 옥상(1스테이지·2인 대결): 타일 바닥(기존 경기장 그림), 난간, 계단실, 둘레의 밤 도시 */
  function buildRooftop(group) {
    scene.background = skyTexture([[0, '#0B1030'], [0.55, '#2A1E4A'], [0.8, '#7A3E5C'], [1, '#C9704A']]);
    scene.fog = new THREE.Fog('#2A1E4A', 2600, 7000);
    hemi.color.set('#C8D2FF'); hemi.groundColor.set('#4A3A44'); hemi.intensity = 1.5;
    sun.color.set('#FFD9B0'); sun.intensity = 1.4;
    const tex = new THREE.Texture(assets.arena.img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    group.add(floorPlane(tex));
    // 건물 옥상 바닥 가장자리(경기장 밖 조금)와 난간
    const slab = new THREE.Mesh(new THREE.BoxGeometry(ARENA_WIDTH + 400, 60, ARENA_HEIGHT + 400), M.mat('#6E6A62', { rough: 1 }));
    slab.position.set(ARENA_WIDTH / 2, -31, ARENA_HEIGHT / 2);
    group.add(slab);
    const rail = M.mat('#5E6672', { metal: 0.5 });
    for (const [x, z, w, d] of [[ARENA_WIDTH / 2, -190, ARENA_WIDTH + 400, 12], [ARENA_WIDTH / 2, ARENA_HEIGHT + 190, ARENA_WIDTH + 400, 12],
      [-190, ARENA_HEIGHT / 2, 12, ARENA_HEIGHT + 400], [ARENA_WIDTH + 190, ARENA_HEIGHT / 2, 12, ARENA_HEIGHT + 400]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 70, d), rail);
      wall.position.set(x, 35, z);
      group.add(wall);
    }
    // 계단실(계단 컷씬의 문)
    const stair = new THREE.Group();
    stair.add(new THREE.Mesh(new THREE.BoxGeometry(150, 190, 120), M.mat('#8F8A80')));
    stair.children[0].position.y = 95;
    const door = new THREE.Mesh(new THREE.BoxGeometry(70, 130, 4), M.mat('#8A5A2B'));
    door.position.set(0, 65, 62);
    stair.add(door);
    stair.position.set(ROOF_STAIRS.x, 0, ROOF_STAIRS.y - 60);
    group.add(stair);
    // 물탱크·환풍기
    for (const [x, z] of [[1450, 150], [120, 120]]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 160, 20), M.mat('#A9B0BC', { metal: 0.5 }));
      tank.position.set(x, 80, z - 220);
      group.add(tank);
    }
    skyline(group);
    return {
      update(match, time) {
        const cut = match.cutscene;
        door.rotation.y = cut?.kind === 'stairs' && !cut.switched ? -cut.door * 1.4 : 0;
        door.position.x = cut?.kind === 'stairs' && !cut.switched ? -cut.door * 30 : 0;
      },
    };
  }

  /** 복도(2스테이지): 본부 복도 그림 바닥, 사방 벽·천장 조명, 엘리베이터, 벽 포탑, 계단 문, 천장 구멍(R-10) */
  function buildCorridor(group) {
    scene.background = new THREE.Color('#1A1E26');
    scene.fog = new THREE.Fog('#1A1E26', 1800, 4200);
    hemi.color.set('#FFF4E0'); hemi.groundColor.set('#3A3E48'); hemi.intensity = 1.9;
    sun.color.set('#FFFFFF'); sun.intensity = 0.8;
    const tex = new THREE.Texture(assets.corridor.img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    group.add(floorPlane(tex));
    const H = 300;
    const wallTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#4A505C'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#5E6672'; g.fillRect(0, 0, w, h * 0.55);
      g.fillStyle = '#2A2E35'; g.fillRect(0, h * 0.55, w, 6);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(w - 1, 0); g.lineTo(w - 1, h); g.stroke();
    }, { repeat: [8, 1] });
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
    for (const [x, z, w, d] of [[ARENA_WIDTH / 2, -10, ARENA_WIDTH + 40, 20], [ARENA_WIDTH / 2, ARENA_HEIGHT + 10, ARENA_WIDTH + 40, 20],
      [-10, ARENA_HEIGHT / 2, 20, ARENA_HEIGHT], [ARENA_WIDTH + 10, ARENA_HEIGHT / 2, 20, ARENA_HEIGHT]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      wall.position.set(x, H / 2, z);
      group.add(wall);
    }
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_WIDTH + 40, ARENA_HEIGHT + 40), M.mat('#6A707C', { rough: 1, emissive: '#2A2E36' }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(ARENA_WIDTH / 2, H, ARENA_HEIGHT / 2);
    group.add(ceiling);
    const lamp = M.mat('#FFF4D6', { emissive: '#FFF0C8' });
    for (let x = 140; x < ARENA_WIDTH; x += 330) {
      for (const z of [250, 750]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(160, 6, 30), lamp);
        l.position.set(x, H - 4, z);
        group.add(l);
      }
    }
    const point = new THREE.PointLight('#FFF0D0', 1.2, 1600, 1.2);
    point.position.set(ARENA_WIDTH / 2, H - 30, ARENA_HEIGHT / 2);
    group.add(point);
    // ISB 간판(위쪽 벽)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(220, 90), new THREE.MeshBasicMaterial({
      map: canvasTexture(220, 90, (g, w, h) => {
        g.fillStyle = '#D56A26'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#FFFFFF'; g.font = 'bold 60px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('ISB', w / 2, h / 2 + 2);
      }),
    }));
    sign.position.set(ELEVATOR.x + 360, 210, 1);
    group.add(sign);
    // 엘리베이터: 문 두 짝이 옆으로 열린다
    const frame = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.w + 40, 220, 10), M.mat('#9AA3B1', { metal: 0.7, rough: 0.3 }));
    frame.position.set(ELEVATOR.x, 110, 2);
    group.add(frame);
    const inside = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.w, 190, 4), M.mat('#FFF4D6', { emissive: '#7A6A40' }));
    inside.position.set(ELEVATOR.x, 95, 4);
    group.add(inside);
    const doors = [-1, 1].map((s) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.w / 2, 190, 6), M.mat('#C9D0DA', { metal: 0.8, rough: 0.25 }));
      d.position.set(ELEVATOR.x + (s * ELEVATOR.w) / 4, 95, 8);
      group.add(d);
      return { mesh: d, s };
    });
    // 벽 포탑
    const turrets = TURRETS.map((t) => {
      const m = M.makeTurret();
      m.position.set(t.x - t.dir * 30, 150, t.y);
      group.add(m);
      return m;
    });
    // 계단 문(왼쪽 벽)
    const stairDoor = new THREE.Mesh(new THREE.BoxGeometry(6, 150, CORRIDOR_STAIRS.h), M.mat('#8A5A2B'));
    stairDoor.position.set(CORRIDOR_STAIRS.x - 20, 75, CORRIDOR_STAIRS.y);
    group.add(stairDoor);
    // 천장 구멍(R-10이 부수고 내려온 자리)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(110, 10), M.mat('#050608', { basic: true, side: THREE.DoubleSide }));
    hole.rotation.x = Math.PI / 2;
    hole.position.set(CEILING_X, H - 2, RAIL_Y.isb);
    hole.visible = false;
    group.add(hole);
    return {
      update(match, time, reducedMotion) {
        const story = match.story;
        const open = story?.elevator?.open ?? 0;
        for (const d of doors) d.mesh.position.x = ELEVATOR.x + d.s * (ELEVATOR.w / 4 + open * (ELEVATOR.w / 2 - 6));
        turrets.forEach((m, i) => {
          const t = story?.turrets?.[i];
          m.visible = !!t;
          if (t) m.userData.head.rotation.y = -(t.aim - (TURRETS[i].dir > 0 ? 0 : Math.PI));
          if (t) m.rotation.y = TURRETS[i].dir > 0 ? 0 : Math.PI;
        });
        // 천장이 흔들리다 부서지면 구멍
        if (story?.ceiling) ceiling.position.y = H + (reducedMotion ? 0 : Math.sin(time * 60) * 2);
        hole.visible = !story?.ceiling && !!story && (story.wave >= 7 || match.players.some((p) => p.characterId === 'r10'));
        const cut = match.cutscene;
        stairDoor.rotation.y = cut?.kind === 'stairs' && cut.switched ? cut.door * 1.3 : 0;
      },
    };
  }

  /** 하늘(3스테이지): 비 내리는 밤, 아래 멀리 도시가 뒤로 흘러가고 구름이 스쳐 간다(앞은 ISB 쪽 = -Z) */
  function buildSky(group) {
    scene.background = skyTexture([[0, '#03050F'], [0.6, '#0C1430'], [1, '#1B2850']]);
    scene.fog = new THREE.Fog('#0C1430', 1500, 6000);
    hemi.color.set('#9FB4E8'); hemi.groundColor.set('#1A2238'); hemi.intensity = 1.3;
    sun.color.set('#C8D8FF'); sun.intensity = 1.1;
    const city = canvasTexture(512, 512, (g, w, h) => {
      g.fillStyle = '#0B0F1A'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 64) {
        g.fillStyle = '#161B27'; g.fillRect(0, y, w, 10);
        for (let x = 0; x < w; x += 24) { g.fillStyle = 'rgba(255,214,110,0.6)'; g.fillRect(x, y + 4, 10, 2); }
        for (let x = 0; x < w; x += 40 + ((x * 7) % 30)) {
          g.fillStyle = `rgb(${30 + (x % 20)},${34 + (x % 20)},${50 + (x % 20)})`;
          g.fillRect(x + 4, y + 16, 30, 40);
          for (let k = 0; k < 6; k++) { if ((x + k * 13 + y) % 3) continue; g.fillStyle = '#FFD678'; g.fillRect(x + 8 + (k % 3) * 8, y + 20 + Math.floor(k / 3) * 14, 4, 5); }
        }
      }
    }, { repeat: [12, 12] });
    const ground = floorPlane(city, 30000, 30000, ARENA_WIDTH / 2, ARENA_HEIGHT / 2, -2600);
    ground.material.emissive = new THREE.Color('#FFFFFF');
    ground.material.emissiveMap = city;
    ground.material.emissiveIntensity = 0.7;
    group.add(ground);
    const clouds = [];
    const cloudMat = M.mat('#5A6482', { transparent: true, opacity: 0.55, rough: 1 });
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(160 + ((i * 37 + k * 53) % 120), 10, 8), cloudMat);
        s.position.set((k - 1.5) * 160, ((k * 31) % 40) - 20, ((k * 53) % 80) - 40);
        s.scale.y = 0.45;
        c.add(s);
      }
      c.position.set(((i * 613) % 4800) - 1600, i % 3 === 0 ? 420 + (i % 5) * 60 : -500 - (i % 4) * 200, ((i * 389) % 6000) - 3000);
      group.add(c);
      clouds.push(c);
    }
    const rain = makeRain(group, 900);
    return {
      update(match, time, reducedMotion, dt) {
        const t = reducedMotion ? 0 : time;
        city.offset.y = (t * 0.02) % 1;
        for (const c of clouds) {
          if (!reducedMotion) c.position.z += dt * 700;
          if (c.position.z > 3200) c.position.z -= 6400;
        }
        rain.update(time, reducedMotion, dt);
      },
    };
  }

  /** 비: 카메라 둘레 상자 안에서 떨어지는 선들 */
  function makeRain(group, count = 700, { color = '#AAC3FF', speed = 1400, len = 40, area = 2400, top = 900, snow = false } = {}) {
    const pos = new Float32Array(count * 6);
    const seeds = Array.from({ length: count }, (_, i) => [((i * 7919) % 1000) / 1000, ((i * 104729) % 1000) / 1000, ((i * 1299709) % 1000) / 1000]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = snow
      ? new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 3.5, transparent: true, opacity: 0.85 }))
      : new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
    lines.frustumCulled = false;
    group.add(lines);
    return {
      update(time, reducedMotion) {
        const t = reducedMotion ? 0 : time;
        const cx = camState.center?.x ?? ARENA_WIDTH / 2, cz = camState.center?.z ?? ARENA_HEIGHT / 2;
        for (let i = 0; i < count; i++) {
          const [a, b, c] = seeds[i];
          const y = top - (((c * top * 2) + t * speed * (0.8 + a * 0.4)) % (top * 1.6));
          const x = cx + (a - 0.5) * area + (snow ? Math.sin(t * 1.3 + i) * 30 : -y * 0.15);
          const z = cz + (b - 0.5) * area;
          const o = i * 6;
          pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
          pos[o + 3] = x + (snow ? 0 : 6); pos[o + 4] = y + (snow ? 0 : len); pos[o + 5] = z;
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
  }

  /** 도로(4스테이지): 비 내리는 밤, 넓은 도로가 뒤(-X)로 흐르고(모두 +X로 달림) 양쪽 갓길 너머 건물·가로등 */
  function buildRoad(group) {
    scene.background = skyTexture([[0, '#03050F'], [0.7, '#141A2E'], [1, '#2A2440']]);
    scene.fog = new THREE.Fog('#141A2E', 1400, 5200);
    hemi.color.set('#8FA0C8'); hemi.groundColor.set('#202430'); hemi.intensity = 1.25;
    sun.color.set('#C8D0FF'); sun.intensity = 0.9;
    const roadTex = canvasTexture(512, 512, (g, w, h) => {
      g.fillStyle = '#1C212D'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + (i % 5) * 0.01})`; g.fillRect((i * 97) % w, (i * 61) % h, 3, 3); }
      // 차선(경기장 Y 180·320·440·560·680·820 = 이 그림의 세로 위치)
      for (const [i, y] of [180, 320, 440, 560, 680, 820].entries()) {
        g.fillStyle = i === 2 || i === 3 ? 'rgba(255,214,110,0.8)' : 'rgba(235,240,250,0.75)';
        for (let x = 0; x < w; x += 160) g.fillRect(x, (y / 1000) * h - 3, 90, 6);
      }
    }, { repeat: [8, 1] });
    const road = floorPlane(roadTex, 8 * 512, 1000, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    road.material.roughness = 0.35;
    road.material.metalness = 0.2;
    group.add(road);
    const side = M.mat('#2A2E38', { rough: 1 });
    for (const z of [-260, ARENA_HEIGHT + 260]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(8 * 512, 20, 500), side);
      s.position.set(ARENA_WIDTH / 2, -10, z);
      group.add(s);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(8 * 512, 30, 8), M.mat('#8A93A3', { metal: 0.6 }));
      rail.position.set(ARENA_WIDTH / 2, 30, z < 0 ? -12 : ARENA_HEIGHT + 12);
      group.add(rail);
    }
    // 흐르는 가로등·건물
    const movers = [];
    const lampMat = M.mat('#FFD08A', { emissive: '#FFB050' });
    for (let i = 0; i < 12; i++) {
      for (const z of [-40, ARENA_HEIGHT + 40]) {
        const pole = new THREE.Group();
        const p = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 320, 8), M.mat('#3A3F4D'));
        p.position.y = 160;
        pole.add(p);
        const head = new THREE.Mesh(new THREE.BoxGeometry(60, 10, 26), lampMat);
        head.position.set(0, 320, z < 0 ? 30 : -30);
        pole.add(head);
        pole.position.set(i * 400 - 1400, 0, z);
        group.add(pole);
        movers.push({ obj: pole, speed: 1 });
      }
    }
    for (let i = 0; i < 18; i++) {
      for (const z of [-700, ARENA_HEIGHT + 700]) {
        const w = 300 + ((i * 131) % 200), h = 600 + ((i * 389) % 1400);
        const tex = windowTexture(100 + i + (z > 0 ? 50 : 0), 0.4);
        tex.repeat.set(2, Math.round(h / 256));
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 400), new THREE.MeshStandardMaterial({ map: tex, emissive: '#FFFFFF', emissiveMap: tex, emissiveIntensity: 0.28 }));
        b.position.set(i * 330 - 1600, h / 2 - 20, z < 0 ? z - 500 : z + 500);
        group.add(b);
        movers.push({ obj: b, speed: 0.97 });
      }
    }
    const rain = makeRain(group, 900);
    return {
      update(match, time, reducedMotion, dt) {
        const speed = reducedMotion ? 0 : 900;
        roadTex.offset.x = ((time * speed) / 512) % 1;
        for (const m of movers) {
          m.obj.position.x -= speed * m.speed * dt;
          if (m.obj.position.x < -1800) m.obj.position.x += 4800;
        }
        rain.update(time, reducedMotion, dt);
      },
    };
  }

  /** 대교(5스테이지): 눈 내리는 밤, 강을 가로지르는 넓은 다리(앞뒤 = Z). 가운데가 들어 올려지며 벌어지면 그 아래로 배가 지나간다 */
  function buildBridge(group) {
    scene.background = skyTexture([[0, '#070B18'], [0.7, '#1A2238'], [1, '#3A4660']]);
    scene.fog = new THREE.Fog('#2A3248', 1500, 5200);
    hemi.color.set('#C8D6F0'); hemi.groundColor.set('#3A4458'); hemi.intensity = 1.5;
    sun.color.set('#DDE6FF'); sun.intensity = 1.0;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), M.mat('#0E1A2B', { metal: 0.6, rough: 0.3 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(ARENA_WIDTH / 2, -260, ARENA_HEIGHT / 2);
    group.add(water);
    const deckTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#B4BFCC'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect((i * 37) % w, (i * 91) % h, 4, 4); }
      g.fillStyle = 'rgba(90,100,120,0.25)'; g.fillRect(60, 0, 14, h); g.fillRect(180, 0, 14, h);
    }, { repeat: [6, 4] });
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.95 });
    const left = 56, right = ARENA_WIDTH - 56, gap = 250, mid = SHIP.y;
    const deck = (z0, z1) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(right - left, 30, z1 - z0), deckMat);
      d.position.set((left + right) / 2, -15, (z0 + z1) / 2);
      group.add(d);
      return d;
    };
    deck(-1600, mid - gap / 2);
    deck(mid + gap / 2, ARENA_HEIGHT + 1600);
    // 들어 올리는 상판 두 쪽(경첩은 틈의 양 끝)
    const leaves = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set((left + right) / 2, 0, mid + s * (gap / 2));
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(right - left, 30, gap / 2), deckMat);
      leaf.position.set(0, -15, -s * (gap / 4));
      pivot.add(leaf);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(right - left, 32, 14), M.mat('#FFC93C', { emissive: '#4A3A00' }));
      stripe.position.set(0, -15, -s * (gap / 2 - 7));
      pivot.add(stripe);
      group.add(pivot);
      return { pivot, s };
    });
    // 난간(눈 덮임)과 탑·줄
    for (const x of [left, right]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(16, 60, 4000), M.mat('#5E6672', { metal: 0.4 }));
      r.position.set(x, 30, ARENA_HEIGHT / 2);
      group.add(r);
      const snowTop = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 4000), M.mat('#F4F7FB'));
      snowTop.position.set(x, 62, ARENA_HEIGHT / 2);
      group.add(snowTop);
      for (const z of [-900, ARENA_HEIGHT + 900]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(80, 900, 80), M.mat('#7A3A2A', { rough: 0.7 }));
        tower.position.set(x, 450, z);
        group.add(tower);
      }
    }
    const cable = new THREE.LineBasicMaterial({ color: '#46505F' });
    for (const x of [left, right]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const z = -900 + (i / 40) * (ARENA_HEIGHT + 1800);
        const k = (i / 40) * 2 - 1;
        pts.push(new THREE.Vector3(x, 120 + 780 * k * k, z));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cable));
    }
    const lampMat = M.mat('#FFE2A8', { emissive: '#FFC870' });
    for (let z = -600; z < ARENA_HEIGHT + 600; z += 300) {
      for (const x of [left + 20, right - 20]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 260, 8), M.mat('#3A3F4D'));
        p.position.set(x, 130, z);
        group.add(p);
        const h = new THREE.Mesh(new THREE.SphereGeometry(12, 8, 6), lampMat);
        h.position.set(x, 262, z);
        group.add(h);
      }
    }
    const snow = makeRain(group, 1200, { color: '#FFFFFF', speed: 140, snow: true, top: 800 });
    return {
      update(match, time, reducedMotion, dt) {
        const open = match.story?.bridge?.open ?? 0;
        for (const l of leaves) l.pivot.rotation.x = l.s * open * 1.35;
        snow.update(time, reducedMotion, dt);
      },
    };
  }

  /** 대교 가는 길(운전): 눈 내리는 길(앞 = -Z)이 차 쪽으로 다가오고, 구멍·눈더미·가로등, 끝에 대교 입구 */
  function buildDrive(group) {
    scene.background = skyTexture([[0, '#0A1022'], [0.7, '#2A3654'], [1, '#56627E']]);
    scene.fog = new THREE.Fog('#3A4660', 1200, 4200);
    hemi.color.set('#E0E8F8'); hemi.groundColor.set('#6A7488'); hemi.intensity = 1.6;
    sun.color.set('#FFFFFF'); sun.intensity = 0.9;
    const roadTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#8693A3'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,214,90,0.9)'; g.fillRect(w / 2 - 5, 0, 10, h / 2);
      for (let i = 0; i < 120; i++) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect((i * 37) % w, (i * 71) % h, 4, 4); }
    }, { repeat: [1, 30] });
    const { left, right } = DRIVE_ROAD;
    const road = floorPlane(roadTex, right - left, 30 * 256, (left + right) / 2, DRIVE_Y - 3000);
    group.add(road);
    const snowField = floorPlane(null, 12000, 12000, ARENA_WIDTH / 2, DRIVE_Y - 3000, -2, '#DCE4EE');
    group.add(snowField);
    const lamps = [];
    for (let i = 0; i < 10; i++) {
      for (const x of [left - 40, right + 40]) {
        const p = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 240, 8), M.mat('#3A3F4D'));
        pole.position.y = 120;
        p.add(pole);
        const h = new THREE.Mesh(new THREE.SphereGeometry(12, 8, 6), M.mat('#FFE2A8', { emissive: '#FFC870' }));
        h.position.y = 244;
        p.add(h);
        const pile = new THREE.Mesh(new THREE.SphereGeometry(60, 10, 6), M.mat('#F4F7FB'));
        pile.scale.set(1.2, 0.35, 0.8);
        pile.position.set(x < left ? -90 : 90, 0, 60);
        p.add(pile);
        p.position.set(x, 0, 0);
        p.userData.base = i * 400;
        group.add(p);
        lamps.push(p);
      }
    }
    const obstacles = new Map();
    const holeMat = M.mat('#1A1F28', { rough: 1 });
    const driftMat = M.mat('#F4F7FB', { rough: 1 });
    // 대교 입구: 탑 두 개와 늘어진 줄
    const gate = new THREE.Group();
    for (const x of [left - 40, right + 40]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(70, 520, 70), M.mat('#7A3A2A'));
      t.position.set(x, 260, 0);
      gate.add(t);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(right - left + 150, 40, 40), M.mat('#7A3A2A'));
    beam.position.set((left + right) / 2, 500, 0);
    gate.add(beam);
    group.add(gate);
    const snow = makeRain(group, 1000, { color: '#FFFFFF', speed: 160, snow: true, top: 700 });
    return {
      update(match, time, reducedMotion, dt) {
        const c = match.cutscene;
        if (!c || c.kind !== 'drive') return;
        const scroll = c.dist;
        roadTex.offset.y = (scroll / 256) % 1;
        for (const p of lamps) p.position.z = DRIVE_Y + 600 - ((p.userData.base + scroll) % 4000);
        for (const o of c.obstacles) {
          const z = DRIVE_Y - (o.d - scroll);
          let m = obstacles.get(o);
          if (z < -3500 || z > DRIVE_Y + 900) { if (m) m.visible = false; continue; }
          if (!m) {
            if (o.kind === 'hole') {
              m = new THREE.Mesh(new THREE.CircleGeometry(o.r, 16), holeMat);
              m.rotation.x = -Math.PI / 2;
              m.position.y = 2;
            } else {
              m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), driftMat);
              m.scale.set(o.rx, 34, o.ry);
            }
            group.add(m);
            obstacles.set(o, m);
          }
          m.visible = true;
          m.position.x = o.x;
          m.position.z = z;
        }
        gate.position.z = DRIVE_Y - (c.length - scroll);
        snow.update(time, reducedMotion, dt);
      },
    };
  }

  // ── 배우(플레이어): 캐릭터 판 또는 탈것 모델 ──
  const actors = new Map();
  function actorOf(p) {
    let a = actors.get(p.id);
    if (!a) {
      const material = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.3, depthWrite: true });
      const sprite = new THREE.Sprite(material);
      sprite.center.set(0.5, 0);
      scene.add(sprite);
      const ring = new THREE.Mesh(new THREE.RingGeometry(38, 50, 32), new THREE.MeshBasicMaterial({ color: '#D9443A', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      a = { sprite, material, ring, model: null, modelKind: null, car: null, chute: null, image: null, seen: 0 };
      actors.set(p.id, a);
    }
    return a;
  }
  function setModel(a, kind) {
    if (a.modelKind === kind) return a.model;
    if (a.model) scene.remove(a.model);
    a.model = kind === 'lightning' ? M.makeLightning() : kind === 'gunship' ? M.makeHelicopter('gunship', 0.8)
      : kind === 'deathstar' ? M.makeDeathstar() : null;
    if (kind === 'deathstar') a.model.scale.setScalar(DS_SCALE);
    a.modelKind = kind;
    if (a.model) scene.add(a.model);
    return a.model;
  }
  function setCar(a, on, team) {
    if (!on) { if (a.car) a.car.visible = false; return null; }
    if (!a.car || a.car.userData.team !== team) {
      if (a.car) scene.remove(a.car);
      a.car = M.makeCar(team);
      a.car.userData.team = team;
      scene.add(a.car);
    }
    a.car.visible = true;
    return a.car;
  }
  function setChute(a, on) {
    if (!on) { if (a.chute) a.chute.visible = false; return null; }
    if (!a.chute) { a.chute = M.makeChute(); scene.add(a.chute); }
    a.chute.visible = true;
    return a.chute;
  }

  /**
   * 캐릭터 판 하나 놓기. pose: { characterId, weapon, scale, x, y, h(발 높이), alpha, lying, hurt, aim, spin }
   * 판의 그림 방향(오른쪽·왼쪽)은 카메라마다 renderView에서 맞춘다(a.aim을 남겨 둔다).
   */
  function placeSprite(a, pose) {
    // 손에 3D 총을 쥐어 줄 때는 무기를 지운 그림(있으면)
    const id = pose.bare && assets[`${pose.characterId}-bare`] ? `${pose.characterId}-bare` : imageOf(pose.characterId, pose.weapon);
    if (!assets[id]) { a.sprite.visible = false; return; }
    a.image = id;
    const size = SPRITE_SIZE * (pose.scale ?? 1) * CHAR_SCALE;
    const foot = footOf(id);
    a.sprite.scale.set(size, size, 1);
    a.sprite.center.set(0.5, pose.lying ? 0.5 : foot);
    a.sprite.position.set(pose.x, (pose.h ?? 0) + (pose.lying ? size * 0.28 : 0), pose.y);
    a.material.rotation = pose.lying ? Math.PI / 2 : pose.spin ?? 0;
    a.material.opacity = pose.alpha ?? 1;
    a.material.transparent = true;
    a.material.color.set(pose.lying ? '#8A8E96' : pose.hurt ? '#FF7A70' : '#FFFFFF');
    a.aim = pose.aim ?? 0;
    a.sprite.visible = (pose.alpha ?? 1) > 0.02;
  }

  /** 지금 장면에서 그릴 플레이어들(경기 중·킬캠): 탈것·낙하산·밧줄 높이까지 */
  function placePlayers(match, time, reducedMotion, hidden = new Set()) {
    const stage = match.story?.stage;
    const seen = new Set();
    for (const p of match.players) {
      if (hidden.has(p.id)) continue;
      const e = p.entering;
      if (e && e.t < 0) continue;
      const a = actorOf(p);
      seen.add(p.id);
      const character = CHARACTERS.find((c) => c.id === p.characterId);
      const aircraft = p.plane ? 'lightning' : character?.aircraft ? p.characterId : null;
      let h = 0;
      if (e) {
        const k = clamp01(e.t / e.duration);
        if (e.kind === 'rope') h = HELI_ALT * 0.8 * (1 - k);
        if (e.kind === 'fall') h = 260 * (1 - k * k);
        if (e.kind === 'chute') h = 700 * (1 - (1 - (1 - k) ** 2) * 1);
      }
      const onCar = stage === 'road' && !aircraft;
      if (onCar) h += CAR_ROOF;
      if (p.drone) h += 30 + (reducedMotion ? 0 : Math.sin(time * 5 + p.x * 0.01) * 6);
      if (p.jetpack && p.alive) h += 14 + (reducedMotion ? 0 : Math.sin(time * 4 + p.x * 0.01) * 4);
      // 탈것 모델
      const model = setModel(a, aircraft);
      if (model) {
        a.sprite.visible = false;
        if (aircraft === 'gunship' && !p.alive) { model.visible = false; continue; }
        model.visible = true;
        const lift = aircraft === 'deathstar' ? 260 : PLANE_Y;
        const behind = aircraft === 'deathstar' ? -260 : 0; // 거대해서 화면 위쪽 뒤에 떠 있게
        model.position.set(p.x, lift + (p.alive ? 0 : -60) + (reducedMotion ? 0 : Math.sin(time * 2 + p.x) * 4), p.y + behind);
        // 데스스타는 옆모습(긴 선체가 가로)으로, 비행기·건쉽은 바라보는 쪽으로
        model.rotation.set(0, aircraft === 'deathstar' ? 0 : -p.aim, p.alive ? 0 : 0.6);
        if (model.userData.rotor) model.userData.rotor.rotation.y = time * 30;
        if (model.userData.props) for (const pr of model.userData.props) pr.rotation.x = time * 40;
        if (model.userData.boost) model.userData.boost.visible = p.boost > 0;
        a.ring.visible = false;
        setCar(a, false);
        continue;
      }
      // 도로의 차·대교의 세워 둔 차
      const car = setCar(a, onCar || (stage === 'bridge' && p.carX !== undefined && !e), p.team);
      if (car) {
        if (onCar) {
          car.position.set(p.x, 0, p.y);
          car.rotation.set(0, 0, 0);
          for (const w of car.userData.wheels) w.rotation.y = reducedMotion ? 0 : time * 20;
        } else {
          car.position.set(p.carX, 0, RAIL_Y[p.team] + (p.team === 'earth' ? 90 : -90));
          car.rotation.set(0, p.team === 'earth' ? -Math.PI / 2 : Math.PI / 2, 0);
        }
      }
      const chute = setChute(a, e?.kind === 'chute');
      if (chute) chute.position.set(p.x, h, p.y);
      placeSprite(a, {
        characterId: p.characterId, weapon: p.weapon, scale: p.scale, x: p.x, y: p.y, h,
        bare: p.alive && !p.drone && hasHeldGun(p.weapon),
        alpha: e?.kind === 'walk' ? Math.min(1, 0.3 + clamp01(e.t / e.duration) * 2) : 1,
        lying: !p.alive, hurt: p.hurt > 0, aim: p.aim,
      });
      placeHeld(a, p, h, time, reducedMotion);
      a.ring.visible = p.boss && p.alive;
      if (a.ring.visible) {
        a.ring.position.set(p.x, h + 2, p.y);
        const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 5) * 0.08;
        a.ring.scale.setScalar(pulse * (p.radius / 30));
      }
    }
    return seen;
  }

  /**
   * 다른 사람이 손에 든 총(3인칭): 장착한 무기 모양 그대로 그림 손 높이에서 조준 방향으로 겨누고, 장전하면 장전 동작을 한다.
   * 사람 플레이어의 총에는 작업실에서 붙인 개조 파츠도 보인다. 쓰러지면 숨긴다.
   */
  function placeHeld(a, p, h, time, reducedMotion) {
    const show = p.alive && !p.drone && hasHeldGun(p.weapon) && a.sprite.visible;
    const key = show ? `${p.weapon}|${p.ai ? '' : modStore().signature(p.weapon)}` : null;
    if (a.heldKey !== key) {
      if (a.held) { scene.remove(a.held); a.held = null; }
      if (key) { a.held = makeHeldGun(p.weapon, p.ai ? {} : modStore().equipped(p.weapon)); scene.add(a.held); }
      a.heldKey = key;
    }
    if (!a.held) return;
    a.held.visible = show;
    const s = p.scale ?? 1;
    // 무기 없는 그림이면 그림 속 손 자리에 총을 쥐어 준다(화면 칸마다 카메라 쪽 판의 방향이 달라서 그릴 때 맞춘다: fitHeldToHands)
    const hands = assets[a.image]?.hands;
    a.grip = hands ? { hands, size: SPRITE_SIZE * s * CHAR_SCALE, foot: footOf(a.image), h, x: p.x, y: p.y, aim: p.aim } : null;
    const dx = Math.cos(p.aim), dz = Math.sin(p.aim);
    const bob = reducedMotion ? 0 : Math.sin(time * 9 + p.x * 0.05) * (Math.hypot(p.x - p.previousX, p.y - (p.previousY ?? p.y)) > 0.5 ? 2 : 0);
    // 만화 그림 크기에 맞춰 크게(실제 비율의 약 2배), 몸 앞 오른손 쪽에서 살짝 비스듬히 겨눠 옆모습이 보이게
    const side = 0.32;
    const rx = Math.cos(p.aim + Math.PI / 2), rz = Math.sin(p.aim + Math.PI / 2);
    a.held.position.set(p.x + dx * 26 * s + rx * 10 * s, h + (GUN_Y - 6) * s + bob, p.y + dz * 26 * s + rz * 10 * s);
    a.held.rotation.set(0, -(p.aim - side), 0);
    a.held.scale.setScalar(2.0 * s);
    poseHeldGun(a.held, p);
  }

  /**
   * 화면 칸 하나를 그리기 직전: 무기 없는 그림의 손 자리(그림 비율 좌표)를 지금 카메라에 맞춰 3D 위치로 옮겨 총 손잡이를 거기에 둔다.
   * 판(Sprite)은 늘 카메라를 보므로 손의 3D 위치는 카메라 오른쪽 방향(right)으로 정해진다. 그림이 뒤집혔으면(왼쪽을 봄) 좌우를 바꾼다.
   * 쌍권총·석궁처럼 두 자루면 두 번째 총은 두 번째 손에.
   */
  const handV = new THREE.Vector3(), handV2 = new THREE.Vector3(), toCam = new THREE.Vector3();
  function fitHeldToHands(a, right, facesLeft, cam) {
    const g = a.grip;
    if (!g || !a.held?.visible) return;
    const where = (uv, out) => {
      const u = facesLeft ? 1 - uv[0] : uv[0];
      out.set(g.x, g.h + (1 - uv[1] - g.foot) * g.size, g.y).addScaledVector(right, (u - 0.5) * g.size);
      toCam.set(cam.position.x - out.x, 0, cam.position.z - out.z).normalize();
      return out.addScaledVector(toCam, 5); // 판보다 살짝 앞(손 위)에
    };
    where(g.hands[0], handV);
    a.held.position.copy(handV);
    const items = a.held.userData.items;
    if (items.length > 1) {
      where(g.hands[1] ?? g.hands[0], handV2);
      a.held.updateMatrixWorld(true);
      const local = a.held.worldToLocal(handV2.clone());
      items[1].position.set(local.x, (items[1].userData.poseY ?? 0) + local.y, local.z);
    }
  }

  // ── 조준선(빨간 레이저): 총구에서 조준 방향으로, 엄폐물·사람에 닿는 곳까지. 끝에 빨간 점 ──
  const laserGeo = new THREE.BoxGeometry(1, 1, 1);
  const laserMat = new THREE.MeshBasicMaterial({ color: '#FF2A2A', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const laserMatOther = new THREE.MeshBasicMaterial({ color: '#FF2A2A', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  const aimLines = new Map();
  function aimEnd(match, p, sx, sy) {
    const max = 1700;
    const ex = sx + Math.cos(p.aim) * max, ey = sy + Math.sin(p.aim) * max;
    let t = 1;
    for (const c of match.covers ?? []) {
      if (!(c.hp > 0)) continue;
      const k = segmentRectTime(sx - c.x, sy - c.y, ex - c.x, ey - c.y, c.w / 2, c.h / 2);
      if (k !== null && k < t) t = k;
    }
    let hit = t < 1;
    const vx = ex - sx, vy = ey - sy, vv = vx * vx + vy * vy;
    for (const q of match.players) {
      if (q === p || !q.alive || q.plane || q.entering) continue;
      // 선분과 원(몸 반지름)이 처음 만나는 곳
      const fx = sx - q.x, fy = sy - q.y;
      const b = 2 * (fx * vx + fy * vy), c = fx * fx + fy * fy - q.radius * q.radius;
      const disc = b * b - 4 * vv * c;
      if (disc < 0) continue;
      const k = (-b - Math.sqrt(disc)) / (2 * vv);
      if (k > 0 && k < t) { t = k; hit = true; }
    }
    return { x: sx + vx * t, y: sy + vy * t, hit };
  }
  function placeAimLines(match) {
    const live = new Set();
    const stage = match.story?.stage;
    if (stage !== 'sky' && !match.cutscene && !match.killcam && match.phase !== 'countdown') {
      for (const p of match.players) {
        const character = CHARACTERS.find((c) => c.id === p.characterId);
        if (!p.alive || p.entering || p.plane || character?.aircraft || p.scripted || p.dash) continue;
        const w = WEAPONS[p.weapon];
        if (!w || w.thrown || w.dash) continue;
        let l = aimLines.get(p.id);
        if (!l) {
          const line = new THREE.Mesh(laserGeo, p.ai ? laserMatOther : laserMat);
          const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: getFlashTexture(), color: '#FF3030', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          scene.add(line, dot);
          l = { line, dot, owner: p.id };
          aimLines.set(p.id, l);
        }
        live.add(p.id);
        const h = GUN_Y + (stage === 'road' ? CAR_ROOF : 0);
        const sx = p.x + Math.cos(p.aim) * MUZZLE_OFFSET, sy = p.y + Math.sin(p.aim) * MUZZLE_OFFSET;
        const end = aimEnd(match, p, sx, sy);
        const len = Math.max(1, Math.hypot(end.x - sx, end.y - sy));
        l.line.visible = true;
        l.line.position.set((sx + end.x) / 2, h, (sy + end.y) / 2);
        l.line.rotation.set(0, -p.aim, 0);
        l.line.scale.set(len, p.ai ? 0.8 : 1.1, p.ai ? 0.8 : 1.1);
        l.dot.visible = end.hit;
        l.dot.position.set(end.x - Math.cos(p.aim) * 3, h, end.y - Math.sin(p.aim) * 3);
        l.dot.scale.setScalar(p.ai ? 9 : 13);
      }
    }
    for (const [id, l] of aimLines) if (!live.has(id)) { l.line.visible = false; l.dot.visible = false; }
  }

  /** 이번 프레임에 쓰지 않은 배우는 숨긴다(쓰러져 치운 요원 등) */
  function hideUnused(seen) {
    for (const [id, a] of actors) {
      if (seen.has(id)) continue;
      a.sprite.visible = false;
      a.ring.visible = false;
      if (a.held) a.held.visible = false;
      if (a.model) a.model.visible = false;
      if (a.car) a.car.visible = false;
      if (a.chute) a.chute.visible = false;
    }
  }

  // ── 컷씬 배우: 플레이어 대신 장면이 정한 자리에 그린다(id는 'cut:…') ──
  function cutActor(key) {
    return actorOf({ id: `cut:${key}` });
  }
  function cutSprite(key, pose, seen) {
    const a = cutActor(key);
    seen.add(`cut:${key}`);
    setModel(a, null);
    setCar(a, false);
    setChute(a, false);
    a.ring.visible = false;
    placeSprite(a, pose);
    return a;
  }
  function cutModel(key, kind, seen) {
    const a = cutActor(key);
    seen.add(`cut:${key}`);
    a.sprite.visible = false;
    a.ring.visible = false;
    setCar(a, false);
    setChute(a, false);
    const m = setModel(a, kind);
    if (m) m.visible = true;
    return m;
  }

  // 컷씬 소품(로켓·총알·헬리콥터 등) 모델: 키별로 하나
  const props = new Map();
  function prop(key, make) {
    let m = props.get(key);
    if (!m) { m = make(); scene.add(m); props.set(key, m); }
    m.visible = true;
    m.userData.used = true;
    return m;
  }
  function hideUnusedProps() {
    for (const m of props.values()) {
      if (!m.userData.used) m.visible = false;
      m.userData.used = false;
    }
  }

  /** 스토리의 연출 탈것: 헬리콥터·건쉽(요원 수송), 격추하러 온 전투기와 미사일 */
  function placeStoryCraft(story, time) {
    const c = story?.carrier;
    if (c) {
      const m = prop(`carrier:${c.kind}`, () => M.makeHelicopter(c.kind));
      const fall = c.state === 'down' ? c.fall ?? 0 : 0;
      m.position.set(c.x, HELI_ALT - fall * 260, RAIL_Y.isb - 40);
      m.rotation.set(0, Math.PI + c.angle, fall * 0.5);
      m.userData.rotor.rotation.y = time * 32;
    }
    if (story?.jet) {
      const m = prop('strike-jet', () => M.makeJet());
      m.position.set(story.jet.x, HELI_ALT + 40, RAIL_Y.isb - 40);
      m.rotation.set(0, 0, 0);
    }
    if (story?.missile) {
      const m = prop('strike-missile', () => makeRocket('#D9443A'));
      m.position.set(story.missile.x, HELI_ALT + 30, RAIL_Y.isb - 40);
      m.rotation.set(0, 0, 0);
    }
  }

  /** 전투기·탱크·배(경기 중 가로지르는 것) */
  function placeJet(jet, time, reducedMotion) {
    if (!jet) return;
    if (jet.kind === 'tank') {
      const m = prop('tank', () => M.makeTank());
      m.position.set(jet.x, 0, jet.y);
      m.rotation.set(0, jet.dir > 0 ? 0 : Math.PI, 0);
      return;
    }
    if (jet.kind === 'ship') {
      const m = prop('ship', () => M.makeShip());
      m.position.set(jet.x, -200, jet.y);
      m.rotation.set(0, jet.dir > 0 ? 0 : Math.PI, reducedMotion ? 0 : Math.sin(time * 1.5) * 0.02);
      return;
    }
    const m = prop('jet', () => M.makeJet());
    m.position.set(jet.x, JET_ALT, jet.y);
    m.rotation.set(0, jet.dir > 0 ? 0 : Math.PI, 0);
  }

  // ── 탄 ──
  const shots = new Map();
  const bulletGeo = new THREE.BoxGeometry(30, 3, 3);
  const bulletColor = (b) => (b.weapon === 'laser' ? '#FF2A2A' : b.weapon === 'jsniper' ? '#FF3B30'
    : b.weapon === 'lightning' ? '#9FE0FF' : b.team === 'earth' ? '#6FB8FF' : '#FFA040');
  // 탄·효과 도형은 한 번만 만들어 함께 쓴다(탄마다 새로 만들면 GPU 메모리가 샌다)
  const GEO = {
    rocketBody: new THREE.CylinderGeometry(5, 5, 34, 10),
    rocketNose: new THREE.ConeGeometry(5, 14, 10),
    rocketFlame: new THREE.ConeGeometry(6, 26, 10),
    grenade: new THREE.SphereGeometry(9, 10, 8),
    unitSphere: new THREE.SphereGeometry(1, 12, 8),
    debris: new THREE.BoxGeometry(14, 14, 14),
    ring: new THREE.RingGeometry(0.8, 1, 32),
  };
  function makeRocket(color = '#4E6B3A') {
    const g = new THREE.Group();
    const body = new THREE.Mesh(GEO.rocketBody, M.mat(color, { metal: 0.3 }));
    body.rotation.z = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(GEO.rocketNose, M.mat('#2A2E35'));
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 24;
    g.add(nose);
    const flame = new THREE.Mesh(GEO.rocketFlame, M.mat('#FFB23F', { basic: true, transparent: true, opacity: 0.9 }));
    flame.rotation.z = Math.PI / 2;
    flame.position.x = -30;
    g.add(flame);
    return g;
  }
  function makeShot(b) {
    if (b.thrown) {
      return new THREE.Mesh(GEO.grenade, M.mat('#4E6B3A'));
    }
    const rockets = { rpg: '#4E6B3A', missile: '#C9CED6', dsmissile: '#3FAE4A', dualrpg: '#7A4A2A', jet: '#D9443A', tank: '#2A2E35', ship: '#2A2E35', turret: '#2A2E35' };
    if (rockets[b.weapon]) return makeRocket(rockets[b.weapon]);
    // 레이저는 빛 덩어리, 석궁은 화살, 나머지는 진짜 총알 모양(구리 탄두·놋쇠 몸통, 뒤로 옅은 빛줄기)
    if (b.weapon === 'laser') {
      const m = new THREE.Mesh(bulletGeo, M.mat(bulletColor(b), { basic: true }));
      m.scale.set(1.6, 2.4, 2.4);
      return m;
    }
    if (b.weapon === 'crossbow') return makeArrow();
    const trail = bulletColor(b);
    if (b.weapon === 'shotgun' || b.weapon === 'flak') return makeBullet({ kind: 'pellet', trail, trailLen: 40 });
    if (b.weapon === 'sniper' || b.weapon === 'jsniper') return makeBullet({ trail, scale: 1.25, trailLen: 120 });
    if (b.weapon === 'lightning' || b.weapon === 'gunship') return makeBullet({ trail, scale: 1.5, trailLen: 90 });
    return makeBullet({ trail });
  }
  /** 탄의 높이: 보통은 총 높이, 던진 수류탄은 포물선, 전투기·포탑 폭탄은 쏜 높이에서 목표 바닥으로 */
  function shotHeight(b, stage) {
    const base = stage === 'sky' ? PLANE_Y : GUN_Y;
    const sx = b.startX ?? b.x, sy = b.startY ?? b.y;
    const k = b.range ? clamp01(Math.hypot(b.x - sx, b.y - sy) / b.range) : 0;
    if (b.thrown) return base + Math.sin(Math.PI * k) * 170;
    const from = { jet: JET_ALT, tank: 80, ship: -120, turret: 150 }[b.weapon];
    if (from !== undefined) return from + (16 - from) * k;
    return base;
  }
  const smokeFrom = new Map();
  function placeShots(match, reducedMotion) {
    const stage = match.story?.stage;
    const live = new Set();
    for (const b of match.projectiles) {
      live.add(b.id);
      let m = shots.get(b.id);
      if (!m) { m = makeShot(b); scene.add(m); shots.set(b.id, m); }
      const h = shotHeight(b, stage);
      m.position.set(b.x, h, b.y);
      const yaw = Math.atan2(b.vy, b.vx);
      const prev = m.userData.h ?? h;
      m.rotation.set(0, -yaw, Math.atan2(h - prev, Math.hypot(b.vx, b.vy) / 60) * 0.5);
      m.userData.h = h;
      // 로켓 연기(윌슨 요원의 쌍 RPG는 진하게)
      if (!reducedMotion && (b.splash && !b.thrown)) {
        const last = smokeFrom.get(b.id);
        const step = b.weapon === 'dualrpg' ? 26 : 50;
        if (!last || Math.hypot(b.x - last.x, b.y - last.y) >= step) {
          smokeFrom.set(b.id, { x: b.x, y: b.y });
          addEffect('smoke', { x: b.x - Math.cos(yaw) * 20, y: b.y - Math.sin(yaw) * 20, h, dense: b.weapon === 'dualrpg' });
        }
      }
    }
    for (const [id, m] of shots) {
      if (live.has(id)) continue;
      scene.remove(m);
      shots.delete(id);
      smokeFrom.delete(id);
    }
  }

  // ── 엄폐물 ──
  const covers = new Map();
  function placeCovers(match, time) {
    const road = match.story?.stage === 'road';
    const live = new Set();
    for (const c of match.covers ?? []) {
      const key = `${c.id}|${road}`;
      live.add(key);
      let g = covers.get(key);
      if (!g) {
        g = M.makeCover(c, c.team ? TEAM_COLOR[c.team] : '#FFD45E', COVER_H);
        if (road) {
          const truck = M.makeTruck(c.w + 40, Math.max(c.h + 40, 88));
          truck.position.y = -46;
          g.add(truck);
          g.userData.lift = 46;
        }
        g.position.set(c.x, g.userData.lift ?? 0, c.y);
        scene.add(g);
        covers.set(key, g);
      }
      g.visible = c.hp > 0;
      // 깎일수록 어둡게
      if (!c.steel && Number.isFinite(c.hp)) {
        const k = 0.45 + 0.55 * (c.hp / 200);
        g.userData.block.material = M.mat(`rgb(${Math.round(143 * k)},${Math.round(138 * k)},${Math.round(128 * k)})`, { rough: 0.9 });
      }
    }
    for (const [key, g] of covers) {
      if (live.has(key)) continue;
      scene.remove(g);
      covers.delete(key);
    }
  }

  // ── 효과(폭발·불꽃·연기·파편·레이저) ──
  let effects = [];
  const sparkTex = (() => { const t = new THREE.Texture(assets['hit-spark'].img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; })();
  // 총구 불꽃용 점광원: 늘 장면에 두고 세기만 바꾼다(빛 개수가 바뀌면 재질을 다시 컴파일해 끊긴다)
  const muzzleLights = Array.from({ length: 3 }, () => { const l = new THREE.PointLight('#FFB050', 0, 320, 1.6); scene.add(l); return l; });
  let muzzleLightNext = 0;
  const viewmodel = createViewmodel();
  const labels = []; // 화면에 띄울 글자(피해 숫자·MISS·퍽!): { text, x, y, h, color, age, life, rise }
  function addEffect(kind, e) {
    const stageH = currentStage === 'sky' ? PLANE_Y : 0;
    if (kind === 'explode') {
      const r = e.radius ?? 120;
      const ball = new THREE.Mesh(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#FFB040', transparent: true, opacity: 0.9 }));
      const core = new THREE.Mesh(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#FFE070', transparent: true, opacity: 1 }));
      const light = new THREE.PointLight('#FF9A40', 4, r * 6, 1.5);
      const g = new THREE.Group();
      g.add(ball, core, light);
      g.position.set(e.x, (e.h ?? stageH) + 30, e.y);
      scene.add(g);
      effects.push({ obj: g, age: 0, life: 0.55, update(k) {
        const s = r * (0.35 + 0.65 * k);
        ball.scale.setScalar(s); core.scale.setScalar(s * 0.55);
        ball.material.opacity = 0.9 * (1 - k); core.material.opacity = 1 - k;
        light.intensity = 4 * (1 - k);
      } });
      for (let i = 0; i < 5; i++) addEffect('smoke', { x: e.x + (i - 2) * r * 0.2, y: e.y + ((i * 37) % 5 - 2) * r * 0.15, h: (e.h ?? stageH) + 30, big: true });
      return;
    }
    if (kind === 'smoke') {
      const m = new THREE.Mesh(GEO.unitSphere, new THREE.MeshStandardMaterial({ color: e.dense ? '#9A9EA8' : '#7A7E88', transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }));
      m.position.set(e.x, e.h ?? stageH + GUN_Y, e.y);
      scene.add(m);
      const size = e.big ? 50 : e.dense ? 16 : 12;
      effects.push({ obj: m, age: 0, life: e.big ? 1.4 : 1.1, update(k, dt) {
        m.scale.setScalar(size * (0.6 + k * 1.8));
        m.material.opacity = (e.dense ? 0.6 : 0.45) * (1 - k);
        m.position.y += dt * 20;
      } });
      return;
    }
    if (kind === 'muzzle') {
      // 다른 사람이 쏠 때 총구 불꽃: 잠깐 번쩍이는 빛과 주변을 밝히는 점광원(미리 만든 빛을 돌려 쓴다)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getFlashTexture(), color: e.color ?? '#FFFFFF', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.set(e.x, e.h, e.y);
      s.material.rotation = Math.random() * Math.PI * 2;
      scene.add(s);
      const light = muzzleLights[muzzleLightNext++ % muzzleLights.length];
      light.position.set(e.x, e.h + 10, e.y);
      light.color.set(e.color ?? '#FFB050');
      const size = e.size ?? 46;
      effects.push({ obj: s, owner: e.owner, age: 0, life: 0.07, update(k) {
        s.scale.setScalar(size * (1 - k * 0.4));
        s.material.opacity = 1 - k;
        light.intensity = 2600 * (1 - k);
      } });
      return;
    }
    if (kind === 'gunsmoke') {
      // 총구 연기: 옅은 연기가 피어올라 퍼지며 사라진다
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getSmokeTexture(), color: '#D8DADF', transparent: true, depthWrite: false, opacity: 0.6 }));
      s.position.set(e.x, e.h, e.y);
      s.material.rotation = Math.random() * Math.PI * 2;
      scene.add(s);
      const s0 = e.size ?? 8, vx = (e.vx ?? 0), vz = (e.vz ?? 0);
      effects.push({ obj: s, owner: null, age: 0, life: e.life ?? 1.1, update(k, dt) {
        s.scale.setScalar(s0 * (0.5 + k * 2.4));
        s.material.opacity = (e.opacity ?? 0.5) * (1 - k) * Math.min(1, k * 8 + 0.3);
        s.position.x += vx * dt * (1 - k);
        s.position.z += vz * dt * (1 - k);
        s.position.y += dt * (e.rise ?? 16);
      } });
      return;
    }
    if (kind === 'spark') {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false }));
      s.position.set(e.x, e.h ?? stageH + GUN_Y, e.y);
      const size = e.size ?? 60;
      scene.add(s);
      effects.push({ obj: s, age: 0, life: 0.18, update(k) { s.scale.setScalar(size * (0.6 + k)); s.material.opacity = 1 - k; } });
      return;
    }
    if (kind === 'debris') {
      const g = new THREE.Group();
      const parts = Array.from({ length: 10 }, (_, i) => {
        const m = new THREE.Mesh(GEO.debris, M.mat('#8F8A80'));
        const a = (i / 10) * Math.PI * 2;
        m.userData.v = new THREE.Vector3(Math.cos(a) * (120 + (i % 3) * 60), 260 + (i % 4) * 60, Math.sin(a) * (120 + (i % 2) * 80));
        g.add(m);
        return m;
      });
      g.position.set(e.x, (e.h ?? stageH) + 50, e.y);
      scene.add(g);
      effects.push({ obj: g, age: 0, life: 0.9, update(k, dt) {
        for (const m of parts) {
          m.userData.v.y -= 900 * dt;
          m.position.addScaledVector(m.userData.v, dt);
          m.rotation.x += dt * 8; m.rotation.y += dt * 6;
        }
      } });
      return;
    }
    if (kind === 'beam') {
      const a = toV(e.x1, e.h1 ?? stageH + GUN_Y, e.y1), b = toV(e.x2, e.h2 ?? stageH + GUN_Y, e.y2);
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(e.width ?? 5, e.width ?? 5, len, 8, 1, true), new THREE.MeshBasicMaterial({ color: e.color ?? '#FF2A2A', transparent: true, opacity: 0.9, depthWrite: false }));
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      scene.add(m);
      effects.push({ obj: m, age: 0, life: e.life ?? 0.12, update(k) { m.material.opacity = 0.9 * (1 - k); } });
      return;
    }
    if (kind === 'ring') {
      const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: e.color ?? '#E6EBF5', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(e.x, (e.h ?? stageH) + 4, e.y);
      scene.add(m);
      effects.push({ obj: m, age: 0, life: 0.5, update(k) { m.scale.setScalar(30 + 140 * k); m.material.opacity = 0.7 * (1 - k); } });
      return;
    }
    if (kind === 'splash') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(30, 70, 1, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#CFE6FF', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      m.position.set(e.x, -240, e.y);
      scene.add(m);
      effects.push({ obj: m, age: 0, life: 1, update(k) { m.scale.y = 260 * Math.sin(Math.PI * k); m.position.y = -240 + m.scale.y / 2; m.material.opacity = 0.8 * (1 - k); } });
    }
  }
  function label(text, x, y, h, color, life = 0.7, size = 30) {
    labels.push({ text, x, y, h, color, age: 0, life, size });
  }
  function updateEffects(dt) {
    effects = effects.filter((fx) => {
      fx.age += dt;
      const k = Math.min(1, fx.age / fx.life);
      fx.update(k, dt);
      if (fx.age < fx.life) return true;
      scene.remove(fx.obj);
      // 효과마다 따로 만든 것(공용 도형·재질이 아닌 것)만 버린다
      const shared = new Set([...Object.values(GEO), ...sharedShotGeometries()]);
      fx.obj.traverse?.((o) => {
        if (o.geometry && !o.isSprite && !shared.has(o.geometry) && o.geometry !== bulletGeo) o.geometry.dispose(); // 판(Sprite) 도형은 three.js가 함께 쓴다
        if (o.material && !o.material.userData.shared) o.material.dispose();
      });
      return false;
    });
    for (let i = labels.length - 1; i >= 0; i--) {
      labels[i].age += dt;
      if (labels[i].age >= labels[i].life) labels.splice(i, 1);
    }
  }

  // ── 카메라 ──
  const recoil = {};
  const viewKick = {};
  /** 1인칭 카메라: 플레이어 p의 눈. 쓰러졌으면 몸 위에서 내려다본다. */
  function firstPerson(cam, p, match, time, reducedMotion, dt) {
    const stage = match.story?.stage;
    let h = p.plane ? PLANE_Y + 26 : EYE;
    if (stage === 'road' && !p.plane) h += CAR_ROOF;
    if (p.drone || p.jetpack) h += 24;
    const moving = Math.hypot(p.x - p.previousX, p.y - (p.previousY ?? p.y)) > 0.5;
    const bob = reducedMotion || p.plane ? 0 : moving ? Math.sin(time * 11) * 3 : 0;
    const kick = viewKick[p.id] ?? 0;
    viewKick[p.id] = Math.max(0, kick - dt * 6);
    const dx = Math.cos(p.aim), dz = Math.sin(p.aim);
    if (!p.alive) {
      cam.position.set(p.x - dx * 160, h + 220, p.y - dz * 160);
      cam.lookAt(p.x, 20, p.y);
      return;
    }
    cam.position.set(p.x, h + bob, p.y);
    const pitch = (p.plane ? -0.02 : -0.04) + kick * 0.05;
    cam.lookAt(p.x + dx * 100, h + bob + pitch * 100, p.y + dz * 100);
    if (p.plane && !reducedMotion) cam.rotateZ(-(p.x - p.previousX) * 0.01);
  }

  /** 장면 카메라: 바라볼 곳(look)을 정하고, from 쪽에서 dist만큼 떨어진 높이 h에서 본다. 부드럽게 따라간다. */
  function cinematic(target, dt, reducedMotion, snap = false) {
    // 복도는 벽·천장 안쪽에서만 찍는다
    if (env.key === 'corridor') {
      target.pos.x = Math.max(40, Math.min(ARENA_WIDTH - 40, target.pos.x));
      target.pos.z = Math.max(30, Math.min(ARENA_HEIGHT - 30, target.pos.z));
      target.pos.y = Math.min(280, target.pos.y);
    }
    const k = snap || reducedMotion || !camState.ready ? 1 : 1 - Math.exp(-dt * 4);
    camState.pos.lerp(target.pos, k);
    camState.look.lerp(target.look, k);
    camState.ready = true;
    cine.position.copy(camState.pos);
    cine.lookAt(camState.look);
  }
  /** a에서 b를 보는 옆모습 장면: 두 점 가운데를 바라보고, 두 점을 잇는 선 옆(side)에서 본다 */
  function sideShot(a, b, { dist = 520, h = 210, lookH = 90 } = {}) {
    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
    let dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const spread = Math.max(dist, len * 0.9);
    // 두 옆 중 경기장 가운데에 가까운 쪽(벽 밖으로 나가지 않게)
    const at = (side) => [mx - dz * side * spread - dx * 120, mz + dx * side * spread - dz * 120];
    const [x1, z1] = at(1), [x2, z2] = at(-1);
    const far = (x, z) => Math.hypot(x - ARENA_WIDTH / 2, (z - ARENA_HEIGHT / 2) * 1.6);
    const [x, z] = far(x1, z1) <= far(x2, z2) ? [x1, z1] : [x2, z2];
    return { pos: toV(x, h, z), look: toV(mx, lookH, mz) };
  }
  /** 뒤에서 어깨 너머로 보는 장면: from 뒤 높이 h에서 to를 본다 */
  function overShoulder(from, to, { back = 300, h = 220, lookH = 80 } = {}) {
    let dx = to.x - from.x, dz = to.y - from.y;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    return { pos: toV(from.x - dx * back + dz * 60, h, from.y - dz * back - dx * 60), look: toV(to.x, lookH, to.y) };
  }

  /** 컷씬마다 배우·소품을 놓고 카메라 목표를 돌려준다 */
  function stageCutscene(match, cut, time, reducedMotion, seen) {
    const playerOf = (id) => match.players.find((p) => p.id === id);
    const heroPose = (hero, extra = {}) => {
      const p = playerOf(cut.heroId);
      return { characterId: p?.characterId ?? 'earth-arrow', weapon: hero.weapon ?? p?.weapon, scale: p?.scale, x: hero.x, y: hero.y, aim: hero.aim ?? -Math.PI / 2, ...extra };
    };
    switch (cut.kind) {
      case 'smith': {
        const s = cut.smith;
        cutSprite('hero', heroPose(cut.hero, { h: cut.hero.lunge * 30 }), seen);
        const fallH = s.scale < cut.bossScale - 1e-3 ? -(1 - s.scale / cut.bossScale) * 1100 : 0;
        const flyH = cut.kicked && fallH === 0 ? Math.min(160, Math.max(0, cut.kickFrom?.y - s.y) * 0.4) : 0;
        cutSprite('smith', { characterId: 'isb-agent-1', weapon: 'pistol', scale: cut.bossScale, x: s.x, y: s.y, h: flyH + fallH, alpha: s.alpha, spin: s.angle, aim: Math.PI / 2 }, seen);
        cut.bullets.forEach((b, i) => {
          const m = prop(`cut-bullet:${i}`, () => makeBullet({ trail: '#6FB8FF' }));
          m.position.set(b.x, GUN_Y, b.y);
          m.rotation.set(0, -Math.atan2(b.vy, b.vx), 0);
        });
        return sideShot(cut.hero, s.alpha > 0.5 ? s : cut.hero, { dist: 560 });
      }
      case 'stairs': {
        for (const h of cut.heroes) {
          const p = playerOf(h.id);
          if (!p) continue;
          cutSprite(`stairs:${h.id}`, { characterId: p.characterId, weapon: p.weapon, scale: p.scale, x: h.x, y: h.y, h: -(1 - h.scale) * 320, alpha: h.alpha, aim: h.walk < 0 ? Math.PI : 0 }, seen);
        }
        const lead = cut.heroes[0] ?? { x: 800, y: RAIL_Y.earth };
        if (!cut.switched) return overShoulder({ x: lead.x + 80, y: lead.y + 260 }, { x: ROOF_STAIRS.x, y: ROOF_STAIRS.y - 60 }, { back: 380, h: 300 });
        return { pos: toV(170, 220, ARENA_HEIGHT - 40), look: toV(Math.max(500, lead.x + 300), 70, lead.y - 200) };
      }
      case 'r10': {
        cutSprite('hero', heroPose(cut.hero, { weapon: cut.hero.weapon }), seen);
        const r = cut.r10;
        cutSprite('r10', { characterId: 'r10', weapon: 'laser', scale: r.scale, x: r.x, y: r.y, h: 40 + r.rise * 120, alpha: r.alpha, aim: Math.PI / 2 }, seen);
        if (cut.rocket && !cut.rocket.hit) {
          const m = prop('cut-rocket', () => makeRocket());
          m.position.set(cut.rocket.x, GUN_Y + 40, cut.rocket.y);
          m.rotation.set(0, -cut.rocket.angle, 0.3);
        }
        return sideShot(cut.hero, r, { dist: 600, h: 230 });
      }
      case 'lightning': {
        const hero = playerOf(cut.hero.id);
        if (cut.scene === 'corridor') {
          cutSprite('hero', { characterId: hero?.characterId ?? 'earth-arrow', weapon: hero?.weapon, scale: hero?.scale, x: cut.hero.x, y: cut.hero.y, alpha: 1 - cut.fade, aim: -Math.PI / 2 }, seen);
          return { pos: toV(cut.hero.x, 260, cut.hero.y + 420), look: toV(cut.hero.x, 90, cut.hero.y) };
        }
        cutSprite('hero', { characterId: hero?.characterId ?? 'earth-arrow', weapon: hero?.weapon, scale: hero?.scale, x: cut.hero.x, y: cut.hero.y, alpha: cut.hero.alpha, aim: 0 }, seen);
        if (cut.plane.visible) {
          const m = cutModel('plane', 'lightning', seen);
          const lift = (cut.plane.scale - 1.7) * 380;
          m.position.set(cut.plane.x, 160 + lift, cut.plane.y);
          m.rotation.set(0, Math.PI / 2 - cut.plane.angle, 0);
          m.scale.setScalar(1);
          for (const pr of m.userData.props) pr.rotation.x = time * 40;
        }
        return { pos: toV(cut.hero.x + 520, 240, cut.hero.y + 420), look: toV(cut.hero.x, 140 + (cut.plane.visible ? Math.max(0, (cut.plane.scale - 1.7) * 200) : 0), cut.hero.y - 60) };
      }
      case 'deathstar': {
        const m = cutModel('ds', 'deathstar', seen);
        m.position.set(cut.ds.x, 260 - (1 - cut.ds.scale) * 2400, cut.ds.y - 260);
        m.rotation.set(0, 0, cut.ds.angle);
        m.scale.setScalar(DS_SCALE);
        m.visible = cut.ds.alpha > 0.02;
        const plane = cutModel('hero-plane', 'lightning', seen);
        plane.position.set(cut.hero.x, PLANE_Y + (RAIL_Y.earth - cut.hero.y) * 0.8, cut.hero.y);
        plane.rotation.order = 'YXZ';
        plane.rotation.set(cut.hero.roll, Math.PI / 2, 0);
        for (const pr of plane.userData.props) pr.rotation.x = time * 40;
        return overShoulder({ x: cut.hero.x, y: cut.hero.y + 200 }, { x: cut.ds.x, y: cut.ds.y }, { back: 420, h: 260, lookH: 120 });
      }
      case 'parachute': {
        for (const h of cut.heroes) {
          const p = playerOf(h.id);
          if (!p) continue;
          if (!cut.switched) {
            if (h.planeAlpha > 0.02) {
              const m = cutModel(`pc-plane:${h.id}`, 'lightning', seen);
              m.position.set(h.planeX, PLANE_Y + (RAIL_Y.earth - h.planeY) * 0.5, h.planeY);
              m.rotation.set(0, Math.PI / 2, 0);
              for (const pr of m.userData.props) pr.rotation.x = time * 40;
            }
            if (!h.jumped) continue;
            const fall = -(1 - h.scale) * 1600;
            const a = cutSprite(`pc:${h.id}`, { characterId: p.characterId, weapon: p.ground?.primary ?? p.primary, scale: p.ground?.scale ?? p.scale, x: h.x, y: h.y, h: PLANE_Y + fall, aim: -Math.PI / 2 }, seen);
            const chute = setChute(a, h.chute > 0.05);
            if (chute) { chute.position.set(h.x, PLANE_Y + fall, h.y); chute.scale.setScalar(0.3 + 0.7 * h.chute); }
            continue;
          }
          const car = setCar(cutActor(`pc-car:${h.id}`), true, 'earth');
          seen.add(`cut:pc-car:${h.id}`);
          car.position.set(h.toX, 0, RAIL_Y.earth);
          for (const w of car.userData.wheels) w.rotation.y = time * 20;
          const k = clamp01((h.y + 140) / (RAIL_Y.earth + 140));
          const height = h.landed ? CAR_ROOF : CAR_ROOF + (1 - k) * 900;
          const a = cutSprite(`pc:${h.id}`, { characterId: p.characterId, weapon: p.weapon, scale: p.scale, x: h.x, y: RAIL_Y.earth, h: height, aim: -Math.PI / 2 }, seen);
          const chute = setChute(a, h.chute > 0.05);
          if (chute) {
            chute.position.set(h.x - (h.landed ? (1 - h.chute) * 260 : 0), height, RAIL_Y.earth);
            chute.scale.setScalar(h.landed ? Math.max(0.05, h.chute) : 1);
          }
        }
        const lead = cut.heroes[0];
        if (!cut.switched) {
          const fall = lead?.jumped ? -(1 - lead.scale) * 1600 : 0;
          return { pos: toV((lead?.x ?? 800) + 260, PLANE_Y + fall + 380, (lead?.y ?? 900) + 300), look: toV(lead?.x ?? 800, PLANE_Y + fall - 100, lead?.y ?? 900) };
        }
        return { pos: toV((lead?.toX ?? 800) - 700, 420, RAIL_Y.earth + 700), look: toV(lead?.toX ?? 800, 200, RAIL_Y.earth) };
      }
      case 'wilson': {
        cutSprite('hero', heroPose(cut.hero), seen);
        const boss = playerOf(cut.bossId);
        const carActor = cutActor('wilson-car');
        seen.add('cut:wilson-car');
        const car = setCar(carActor, cut.car.alpha > 0.02, 'isb');
        if (car) {
          car.position.set(cut.car.x, 0, cut.car.y);
          car.rotation.set(0, -cut.car.angle, 0);
        }
        cutSprite('wilson', { characterId: boss?.characterId ?? 'wilson', weapon: boss?.weapon, scale: cut.car.scale, x: cut.car.x, y: cut.car.y, h: CAR_ROOF, alpha: cut.car.alpha, spin: cut.car.angle * 0.3, aim: Math.PI / 2 }, seen);
        return sideShot(cut.hero, cut.car, { dist: 640, h: 300 });
      }
      case 'drive': {
        const humans = cut.cars.filter((c) => !c.ai);
        for (const car of cut.cars) {
          const p = playerOf(car.id);
          if (!p) continue;
          const a = cutActor(`drive:${car.id}`);
          seen.add(`cut:drive:${car.id}`);
          const m = setCar(a, true, 'earth');
          const wob = reducedMotion ? 0 : (car.bump > 0 ? Math.sin(time * 60) * 6 : 0);
          m.position.set(car.x, wob > 0 ? wob : 0, DRIVE_Y);
          m.rotation.set(0, Math.PI / 2 - car.steer * 0.12 + (car.skid > 0 && !reducedMotion ? Math.sin(time * 25) * 0.25 : 0), 0);
          for (const w of m.userData.wheels) w.rotation.y = time * 25;
          m.visible = !(car.safe > 0 && !reducedMotion && Math.floor(time * 12) % 2);
          a.sprite.visible = false;
        }
        return humans.map((car) => ({
          pos: toV(car.x, 210, DRIVE_Y + 330), look: toV(car.x, 60, DRIVE_Y - 500), id: car.id,
        }));
      }
      case 'johnson': {
        cutSprite('hero', heroPose(cut.hero), seen);
        const j = cut.johnson;
        const boss = playerOf(cut.bossId);
        const fall = j.scale < j.base - 1e-3 ? -(1 - j.scale / j.base) * 600 : 0;
        cutSprite('johnson', { characterId: boss?.characterId ?? 'johnson', weapon: boss?.weapon, scale: j.base, x: j.x, y: j.y, h: fall, alpha: j.alpha, spin: j.angle, aim: Math.PI / 2 }, seen);
        return sideShot(cut.hero, { x: j.x, y: j.y }, { dist: 640, h: 260 });
      }
      default:
        return { pos: toV(800, 500, 1500), look: toV(800, 0, 450) };
    }
  }

  /** 처치 컷씬(킬캠) 카메라: 쓰러진 요원(또는 주인공) 가까이, 확대할수록 가깝게 */
  function killcamShot(match, k) {
    const shot = k.shot;
    const focus = shot.focus ? k[shot.focus] : null;
    if (!focus) return { pos: toV(800, 700, 1500), look: toV(800, 40, 420) };
    const from = shot.focus === 'victim' ? k.hero : { x: focus.x, y: focus.y - 300 };
    let dx = focus.x - from.x, dz = focus.y - from.y;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const dist = 560 / (shot.zoom ?? 1);
    const stageH = match.story?.stage === 'road' ? CAR_ROOF : match.story?.stage === 'sky' ? PLANE_Y : 0;
    return { pos: toV(focus.x - dx * dist + dz * 110, stageH + 190, focus.y - dz * dist - dx * 110), look: toV(focus.x, stageH + 60, focus.y) };
  }

  // ── 이벤트 → 효과 ──
  let currentStage = null;
  function heightOf(match, x, y) {
    if (match.story?.stage === 'road') return CAR_ROOF + 40;
    if (match.story?.stage === 'sky') return PLANE_Y;
    return GUN_Y - 20;
  }
  let lastMatch = null;
  let lastScene = null;
  const NO_FLASH = new Set(['grenade', 'dagger', 'crossbow', 'overcool']);
  /** 쏜 사람의 총구(경기장 좌표)에 불꽃·연기. 1인칭으로 보는 내 화면에서는 불꽃을 숨기고(손에 든 총이 따로 번쩍인다) 연기는 보인다 */
  function muzzleFx(match, e) {
    if (!match || NO_FLASH.has(e.weapon) || match.gunkata || match.cutscene) return;
    const p = match.players.find((q) => q.id === e.playerId);
    if (!p || p.plane || p.aircraft || WEAPONS[e.weapon]?.thrown) return;
    const dx = Math.cos(p.aim), dz = Math.sin(p.aim);
    const x = p.x + dx * MUZZLE_OFFSET, y = p.y + dz * MUZZLE_OFFSET;
    const h = (currentStage === 'sky' ? PLANE_Y : GUN_Y) + (currentStage === 'road' ? CAR_ROOF : 0);
    const big = ['shotgun', 'rpg', 'sniper', 'dualrpg', 'jsniper'].includes(e.weapon);
    const color = e.weapon === 'laser' ? '#FF3030' : e.weapon === 'instakill' ? '#FF4FA0' : null;
    addEffect('muzzle', { x, y, h, owner: p.id, color, size: big ? 70 : 46 });
    if (p.ai) { // 사람 플레이어의 연기는 손에 든 총구 자리에서 띄운다(ownSmoke)
      addEffect('gunsmoke', { x: x + dx * 6, y: y + dz * 6, h: h + 4, size: big ? 16 : 10, vx: dx * 30, vz: dz * 30 });
    }
  }
  /** 내 화면의 총구 연기: 뷰모델 카메라 기준 자리(cm)를 1인칭 카메라 기준 경기장 좌표로 옮긴다 */
  function ownSmoke(cam, positions, p) {
    const vmScale = Math.tan((cam.fov / 2) * Math.PI / 180) / Math.tan((vmFov(cam.aspect) / 2) * Math.PI / 180);
    for (const v of positions) {
      const local = new THREE.Vector3(v.x * vmScale * 0.75, v.y * vmScale * 0.75, v.z * 0.75);
      const w = cam.localToWorld(local);
      const big = ['shotgun', 'rpg', 'sniper'].includes(p.weapon);
      for (let i = 0; i < (big ? 3 : 2); i++) {
        addEffect('gunsmoke', {
          x: w.x + Math.cos(p.aim) * i * 4, y: w.z + Math.sin(p.aim) * i * 4, h: w.y + 1, size: big ? 6 : 3.6,
          vx: Math.cos(p.aim) * 14, vz: Math.sin(p.aim) * 14, rise: 7, opacity: big ? 0.45 : 0.32, life: big ? 1.3 : 0.9,
        });
      }
    }
  }

  /** 화면 좌표: view의 카메라로 (x, h, y)를 투영해 HUD 좌표(1600×1000 중 그 화면 칸)로. 카메라 뒤면 null */
  const tmp = new THREE.Vector3();
  function project(cam, rect, x, h, y) {
    tmp.set(x, h, y).project(cam);
    if (tmp.z > 1 || tmp.z < -1) return null;
    return { x: rect.x + ((tmp.x + 1) / 2) * rect.w, y: rect.y + ((1 - tmp.y) / 2) * rect.h };
  }

  return {
    addEvents(events, match) {
      lastMatch = match ?? lastMatch;
      for (const e of events) {
        if (e.type === 'fire') {
          recoil[e.playerId] = RECOIL_TIME;
          viewKick[e.playerId] = Math.min(1, (viewKick[e.playerId] ?? 0) + 0.35);
          viewmodel.fire(e.playerId, e.weapon);
          muzzleFx(lastMatch, e);
        }
        const h = lastMatch ? heightOf(lastMatch, e.x, e.y) : GUN_Y;
        if (e.type === 'explode') addEffect('explode', { x: e.x, y: e.y, radius: e.radius, h: currentStage === 'sky' ? PLANE_Y : currentStage === 'road' ? CAR_ROOF : 0 });
        if (e.type === 'hit') { addEffect('spark', { x: e.x, y: e.y, h }); label(`-${e.damage}`, e.x, e.y, h + 80, '#FF5A4A'); }
        if (e.type === 'block') addEffect('spark', { x: e.x, y: e.y, h, size: 34 });
        if (e.type === 'cover-break' || e.type === 'ceiling-break') addEffect('debris', { x: e.x, y: e.y, h: e.type === 'ceiling-break' ? 240 : 0 });
        if (e.type === 'laser') addEffect('beam', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, h1: 180, h2: 0 });
        if (e.type === 'megalaser') addEffect('beam', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, width: 22, color: '#FF3B6B', life: 0.6 });
        if (e.type === 'dodge') label('MISS', e.x + 40, e.y, h + 90, '#C9CED6');
        if (e.type === 'kick') { addEffect('spark', { x: e.x, y: e.y, h: 100, size: 160 }); label('퍽!', e.x, e.y, 200, '#D9443A', 0.6, 60); }
        if (e.type === 'land') addEffect('ring', { x: e.x, y: e.y });
        if (e.type === 'splash') addEffect('splash', { x: e.x, y: e.y });
        if (e.type === 'bump') addEffect('ring', { x: e.x, y: DRIVE_Y, color: '#5E6672' });
        if (e.type === 'drift') addEffect('ring', { x: e.x, y: DRIVE_Y, color: '#FFFFFF' });
      }
    },
    reset() {
      viewmodel.reset();
      for (const l of muzzleLights) l.intensity = 0;
      for (const fx of effects) scene.remove(fx.obj);
      effects = [];
      labels.length = 0;
      for (const m of shots.values()) scene.remove(m);
      shots.clear();
      for (const g of covers.values()) scene.remove(g);
      covers.clear();
      camState.ready = false;
    },
    /**
     * 한 프레임 그리기. viewIds: 1인칭으로 볼 사람 플레이어 id(1~2명). 돌려주는 값: 화면 칸마다
     * { id, rect(1600×1000 HUD 좌표), cinematic, tags(이름표: 플레이어·화면 좌표), labels(떠오르는 글자) }.
     */
    draw(match, inputs, dt, time, reducedMotion, viewIds) {
      lastMatch = match;
      const cut = match.cutscene;
      currentStage = match.story?.stage ?? null;
      const key = !match.story ? 'arena'
        : cut?.kind === 'drive' && !cut.switched ? 'drive'
        : cut?.kind === 'lightning' && !cut.switched ? (cut.scene === 'roof' ? 'rooftop' : 'corridor')
        : match.story.stage;
      setEnv(key, match);
      env.update(match, time, reducedMotion, dt);
      if (match.phase !== 'paused') updateEffects(dt);

      const seen = new Set();
      let views;
      // 장면이 바뀌면(컷씬 종류·킬캠) 카메라를 새 자리로 바로 옮긴다
      const sceneKey = cut ? `${cut.kind}:${cut.switched ?? ''}` : match.killcam ? 'killcam' : 'fps';
      if (sceneKey !== lastScene) { camState.ready = false; lastScene = sceneKey; }
      if (cut) {
        // 컷씬: 플레이어는 숨기고 장면 배우만(대교 가는 길·킬캠은 아래)
        const target = stageCutscene(match, cut, time, reducedMotion, seen);
        if (Array.isArray(target)) {
          views = target.map((t, i) => ({ id: t.id, target: t, rect: target.length > 1 ? { x: i * 800, y: 0, w: 800, h: 1000 } : { x: 0, y: 0, w: 1600, h: 1000 } }));
        } else {
          views = [{ id: null, target, rect: { x: 0, y: 0, w: 1600, h: 1000 } }];
        }
        if (cut.kind === 'stairs' && cut.switched === false) placeStoryCraft(match.story, time);
      } else {
        for (const id of placePlayers(match, time, reducedMotion)) seen.add(id);
        placeStoryCraft(match.story, time);
        placeJet(match.jet, time, reducedMotion);
        if (match.killcam) {
          views = [{ id: null, target: killcamShot(match, match.killcam), rect: { x: 0, y: 0, w: 1600, h: 1000 } }];
        } else {
          const ids = viewIds.length ? viewIds : [match.players[0]?.id];
          views = ids.map((id, i) => ({ id, rect: ids.length > 1 ? { x: i * 800, y: 0, w: 800, h: 1000 } : { x: 0, y: 0, w: 1600, h: 1000 } }));
        }
        // 존슨 요원의 빨간 조준선
        const lines = match.story?.sniper?.lines;
        if (lines) {
          lines.angles.forEach((a, i) => {
            const m = prop(`sniper-line:${i}`, () => new THREE.Mesh(new THREE.BoxGeometry(1, 2, 2), M.mat('#FF2A2A', { basic: true, transparent: true, opacity: 0.8 })));
            m.scale.x = 2400;
            m.position.set(lines.x + Math.cos(a) * 1200, GUN_Y, lines.y + Math.sin(a) * 1200);
            m.rotation.set(0, -a, 0);
            m.material.opacity = reducedMotion ? 0.8 : 0.5 + 0.4 * Math.abs(Math.sin(time * 18));
          });
        }
      }
      if (!cut) placeShots(match, reducedMotion);
      else for (const [id, m] of shots) { scene.remove(m); shots.delete(id); }
      placeAimLines(match);
      placeCovers(cut?.kind === 'drive' && !cut.switched ? { covers: [] } : match, time);
      hideUnused(seen);
      hideUnusedProps();

      const out = [];
      for (const [i, v] of views.entries()) {
        const cam = v.target ? cine : cameras[i] ?? cameras[0];
        const viewer = !v.target ? match.players.find((p) => p.id === v.id) : null;
        if (v.target) {
          if (views.length > 1) {
            cam.position.copy(v.target.pos);
            cam.lookAt(v.target.look);
          } else {
            cinematic(v.target, dt, reducedMotion);
          }
        } else if (viewer) {
          firstPerson(cam, viewer, match, time, reducedMotion, dt);
          camState.ready = false;
        }
        camState.center = { x: cam.position.x, z: cam.position.z };
        const px = (v.rect.x / 1600) * cssW, pw = (v.rect.w / 1600) * cssW, ph = (v.rect.h / 1000) * cssH;
        cam.aspect = pw / ph;
        cam.fov = v.target ? 58 : FOV;
        cam.updateProjectionMatrix();
        // 내 몸(판·비행기)은 내 화면에서 숨긴다(쓰러지면 내려다보는 내 몸은 보인다)
        const own = viewer?.alive && actors.get(viewer.id);
        const ownVisible = own ? [own.sprite.visible, own.model?.visible, own.car?.visible, own.held?.visible] : null;
        if (own) { own.sprite.visible = false; if (own.model) own.model.visible = false; if (own.held) own.held.visible = false; }
        // 판 그림의 방향: 카메라 오른쪽 기준으로 캐릭터가 왼쪽을 보면 뒤집는다
        // 카메라 바로 앞의 판(옆에 붙어 선 동료 등)은 화면을 가리지 않게 흐리게
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const faded = [];
        for (const a of actors.values()) {
          if (!a.sprite.visible || !a.image) continue;
          const facesLeft = Math.cos(a.aim) * right.x + Math.sin(a.aim) * right.z < 0;
          a.material.map = spriteTexture(a.image, facesLeft);
          fitHeldToHands(a, right, facesLeft, cam);
          if (v.target) continue;
          const d = Math.hypot(a.sprite.position.x - cam.position.x, a.sprite.position.z - cam.position.z);
          if (d < 170) { faded.push([a, a.material.opacity]); a.material.opacity *= Math.max(0.12, (d - 50) / 120); }
        }
        // 내가 쏜 총구 불꽃은 내 화면에서 숨긴다(손에 든 3D 총이 번쩍인다)
        const ownFx = viewer ? effects.filter((fx) => fx.owner === viewer.id && fx.obj.visible) : [];
        for (const fx of ownFx) fx.obj.visible = false;
        renderer.setViewport(px, 0, pw, ph);
        renderer.setScissor(px, 0, pw, ph);
        renderer.render(scene, cam);
        for (const fx of ownFx) fx.obj.visible = true;
        // 손에 든 총(3D): 장착한 무기 모양 그대로, 쌍권총·석궁은 양손에 하나씩
        if (viewer?.alive && !viewer.plane && !v.target) {
          const smoke = viewmodel.render(renderer, viewer, pw / ph, {
            time, dt, reducedMotion, paused: match.phase === 'paused',
            moving: Math.hypot(viewer.x - viewer.previousX, viewer.y - (viewer.previousY ?? viewer.y)) > 0.5,
            lights: { hemi, sun },
          });
          if (smoke.length && !reducedMotion) ownSmoke(cam, smoke, viewer);
        }
        if (own) { own.sprite.visible = ownVisible[0]; if (own.model) own.model.visible = !!ownVisible[1]; if (own.held) own.held.visible = !!ownVisible[3]; }
        for (const [a, opacity] of faded) a.material.opacity = opacity;
        // HUD용 이름표·떠오르는 글자 위치
        const tags = [];
        if (!cut) {
          for (const p of match.players) {
            if (viewer && p.id === viewer.id) continue;
            if (p.entering && p.entering.t < 0) continue;
            const a = actors.get(p.id);
            if (!a || !(a.sprite.visible || a.model?.visible)) continue;
            const top = a.model?.visible ? (p.characterId === 'deathstar' ? 360 : PLANE_Y + 70) : a.sprite.position.y + a.sprite.scale.y * (1 - footOf(a.image ?? p.characterId)) * 0.92;
            const s = project(cam, v.rect, p.x, top + 16, p.y);
            if (!s) continue;
            const dist = cam.position.distanceTo(tmp.set(p.x, top, p.y));
            tags.push({ player: p, x: s.x, y: s.y, dist });
          }
        }
        const words = [];
        for (const l of labels) {
          const s = project(cam, v.rect, l.x, l.h + (reducedMotion ? 0 : l.age * 60), l.y);
          if (s) words.push({ ...l, sx: s.x, sy: s.y });
        }
        // 처치 컷씬의 말풍선(무전·도발): 쓰러진 요원 머리 위
        let bubble = null;
        const k = match.killcam;
        if (k?.shot.bubble && v.target) {
          const stageH = match.story?.stage === 'road' ? CAR_ROOF : 0;
          const s = project(cam, v.rect, k.victim.x, stageH + 70, k.victim.y);
          if (s) bubble = { text: k.shot.bubble, x: s.x, y: s.y };
        }
        out.push({ id: v.id, rect: v.rect, cinematic: !!v.target, viewer, tags, labels: words, bubble, cameraYaw: viewer?.aim ?? 0 });
      }
      return out;
    },
  };
}
