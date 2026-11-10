import * as THREE from '../vendor/three.module.min.js';
import { WEAPONS } from '../game/config.js';
import { GRADE, GRADES, PART_SLOTS, SLOT, MOD_WEAPONS, DRAW_COST, SHOP, SHOP_BY_ID, SHOP_PRICE, canMount, modStore } from '../game/mods.js';
import { buildShowcase, environmentMap } from '../render/guns.js';
import { makePartPreview } from '../render/parts.js';

const $ = (selector) => document.querySelector(selector);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/**
 * 개조 모드(총기 개조 작업실). 메인 메뉴 → '총기 개조'.
 * 왼쪽: 작업실 책상(3D) 위에 고른 총이 장착한 파츠를 단 채 놓여 있고(끌어서 돌려 보기), 오른쪽 뽑기 상자에서 파츠가 튀어나온다.
 * 오른쪽 패널: 랜덤 뽑기(1회·10회), 지금 총에 장착한 파츠 칸, 배낭(뽑은 파츠 전부: 눌러서 책상 위에 띄워 보기·장착·분해).
 * 장착은 총마다 따로 저장되고, 경기 중 1인칭 손에 든 총에도 그대로 보인다.
 */
export function createWorkshop({ show, onClose }) {
  const store = modStore();
  const weapons = Object.keys(MOD_WEAPONS);
  let weapon = 'rifle';
  let filter = 'all';
  let selected = null; // 배낭에서 눌러 본 파츠 id
  let tab = 'gacha'; // 'gacha'(랜덤 뽑기) · 'shop'(상점)
  let shopFilter = 'all'; // 'all' · 'rare' · 'elite' · 'weapon'(지금 고른 총만)
  let previewShop = null; // 상점에서 눌러 본 총기 스킨 id(책상 위 총에 미리 붙여 보여 줌)
  let three = null; // 3D 장면(처음 열 때 만든다)
  let running = false;

  // ── 3D 작업실 ──
  function woodTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#6B4426'; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(${40 + (i % 5) * 8}, ${22 + (i % 3) * 6}, 10, ${0.25 + (i % 4) * 0.08})`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      const y = (i * 37) % 256;
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 4);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function matTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#1F4A3A'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(200,240,220,0.25)'; g.lineWidth = 1;
    for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    g.strokeStyle = 'rgba(255,220,120,0.5)';
    g.beginPath(); g.arc(128, 128, 60, 0, Math.PI * 2); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function pegboardTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#B08A5A'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#5A4126';
    for (let y = 8; y < 256; y += 16) for (let x = 8; x < 256; x += 16) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 2);
    return t;
  }
  function makeThree() {
    const canvas = $('#mod-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2A2420');
    scene.environment = environmentMap(renderer);
    scene.environmentIntensity = 0.7;
    const camera = new THREE.PerspectiveCamera(38, 1.5, 1, 2000);
    camera.position.set(0, 52, 112);
    camera.lookAt(0, 6, 0);
    scene.add(new THREE.HemisphereLight('#FFE9CC', '#3A2A20', 1.1));
    const key = new THREE.SpotLight('#FFE2B0', 2600, 260, 0.75, 0.5, 1.4);
    key.position.set(-30, 110, 40);
    key.target.position.set(0, 0, 0);
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight('#AFC6FF', 0.6);
    fill.position.set(60, 40, 80);
    scene.add(fill);
    // 책상·작업 매트·벽(구멍판)·공구
    const desk = new THREE.Mesh(new THREE.BoxGeometry(260, 6, 110), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }));
    desk.position.set(0, -3, 0);
    scene.add(desk);
    const mat = new THREE.Mesh(new THREE.BoxGeometry(120, 0.4, 56), new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.9 }));
    mat.position.set(-8, 0.2, 4);
    scene.add(mat);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(320, 140), new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.9 }));
    wall.position.set(0, 60, -52);
    scene.add(wall);
    const toolMat = new THREE.MeshStandardMaterial({ color: '#9AA2AE', metalness: 0.9, roughness: 0.35 });
    const red = new THREE.MeshStandardMaterial({ color: '#C0392B', roughness: 0.6 });
    const tools = new THREE.Group();
    const wrench = new THREE.Mesh(new THREE.BoxGeometry(3, 34, 1), toolMat); wrench.position.set(-90, 60, -50); wrench.rotation.z = 0.2;
    const hammerH = new THREE.Mesh(new THREE.BoxGeometry(2.4, 30, 2), red); hammerH.position.set(-70, 58, -50);
    const hammerT = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 3), toolMat); hammerT.position.set(-70, 74, -50);
    const driver = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 10), red); driver.position.set(85, 64, -50);
    const driverTip = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 8), toolMat); driverTip.position.set(85, 50, -50);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(70, 14), new THREE.MeshBasicMaterial({ map: signTexture() }));
    sign.position.set(0, 98, -51.5);
    tools.add(wrench, hammerH, hammerT, driver, driverTip, sign);
    scene.add(tools);
    // 탁상 조명(팔·갓)
    const lamp = new THREE.Group();
    const lampMat = new THREE.MeshStandardMaterial({ color: '#2B2E34', metalness: 0.6, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 2, 20), lampMat); base.position.set(-100, 1, -30);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 70, 10), lampMat); arm.position.set(-85, 34, -18); arm.rotation.z = -0.5; arm.rotation.x = 0.4;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(9, 12, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#D9A13A', metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }));
    shade.position.set(-62, 66, 0); shade.rotation.z = 0.7;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), new THREE.MeshBasicMaterial({ color: '#FFF4D6' }));
    bulb.position.set(-60, 62, 0);
    lamp.add(base, arm, shade, bulb);
    scene.add(lamp);
    // 뽑기 상자(뚜껑이 열리고 등급 빛이 솟는다)
    const crate = new THREE.Group();
    crate.position.set(84, 0, 14);
    const crateMat = new THREE.MeshStandardMaterial({ color: '#3A4A3A', metalness: 0.4, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: '#C9A24A', metalness: 1, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 22), crateMat); body.position.y = 8;
    crate.add(body);
    for (const x of [-15, 15]) { const t = new THREE.Mesh(new THREE.BoxGeometry(1, 16.4, 22.4), trim); t.position.set(x, 8, 0); crate.add(t); }
    const lidPivot = new THREE.Group(); lidPivot.position.set(0, 16, -11);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(30.6, 3, 22.6), crateMat); lid.position.set(0, 1.5, 11.3);
    const lidTrim = new THREE.Mesh(new THREE.BoxGeometry(31, 0.8, 23), trim); lidTrim.position.set(0, 3.1, 11.3);
    lidPivot.add(lid, lidTrim);
    crate.add(lidPivot);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: questionTexture(), transparent: true }));
    mark.position.set(0, 9, 11.05);
    crate.add(mark);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 13, 90, 24, 1, true), beamMat);
    beam.position.y = 60;
    crate.add(beam);
    const crateLight = new THREE.PointLight('#FFFFFF', 0, 160, 1.6);
    crateLight.position.set(0, 24, 0);
    crate.add(crateLight);
    scene.add(crate);
    // 고른 파츠를 띄워 보는 받침(등급 빛 고리)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const previewRing = new THREE.Mesh(new THREE.RingGeometry(9, 11, 40), ringMat);
    previewRing.rotation.x = -Math.PI / 2;
    previewRing.position.set(-82, 0.6, 24);
    previewRing.visible = false;
    scene.add(previewRing);

    const state = { renderer, scene, camera, gun: null, gunKey: null, crate, lidPivot, beam, beamMat, crateLight, preview: null, previewRing, ringMat, anim: null, yaw: 0, drag: null };
    // 끌어서 총 돌려 보기
    canvas.addEventListener('pointerdown', (e) => { state.drag = { x: e.clientX, yaw: state.yaw }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (state.drag) state.yaw = state.drag.yaw + (e.clientX - state.drag.x) * 0.01; });
    canvas.addEventListener('pointerup', () => { state.drag = null; });
    canvas.addEventListener('pointercancel', () => { state.drag = null; });
    new ResizeObserver(() => resize(state)).observe(canvas.parentElement);
    resize(state);
    return state;
  }
  function signTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 100;
    const g = c.getContext('2d');
    g.fillStyle = '#1E2228'; g.fillRect(0, 0, 512, 100);
    g.strokeStyle = '#FFB020'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 88);
    g.fillStyle = '#FFD45E'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('총기 개조 작업실', 256, 52);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function questionTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#FFD45E'; g.font = 'bold 110px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function resize(s) {
    const box = s.renderer.domElement.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
    s.renderer.setSize(w, h, false);
    s.camera.aspect = w / h;
    // 좁은 화면(세로 휴대폰)에서는 뒤로 물러나 책상 전체가 보이게
    s.camera.position.set(0, 52 + Math.max(0, 1.4 - s.camera.aspect) * 40, 112 + Math.max(0, 1.4 - s.camera.aspect) * 110);
    s.camera.lookAt(0, 6, 0);
    s.camera.updateProjectionMatrix();
  }
  function dispose(obj) {
    obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.userData?.shared && !Array.isArray(o.material)) o.material.dispose?.(); });
  }
  /** 책상 위 총: 무기·장착이 바뀌면 다시 만든다. 길이를 맞춰(권총은 크게) 받침 위에 옆모습이 보이게 */
  function syncGun() {
    const s = three;
    const shop = previewShop && SHOP_BY_ID[previewShop].weapon === weapon ? SHOP_BY_ID[previewShop] : null;
    const key = shop ? `${weapon}|shop:${shop.id}` : `${weapon}|${store.signature(weapon)}`;
    if (s.gunKey === key) return;
    if (s.gun) { s.scene.remove(s.gun); dispose(s.gun); }
    const model = buildShowcase(weapon, shop ? Object.fromEntries(shop.parts.map((p) => [p.slot, p])) : store.equipped(weapon));
    const holder = new THREE.Group();
    const bb = new THREE.Box3().setFromObject(model);
    const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const fit = (weapon === 'pistol' || weapon === 'dual' ? 44 : weapon === 'crossbow' ? 52 : 74) / Math.max(size.x, 1);
    holder.scale.setScalar(fit);
    holder.add(model);
    holder.position.set(-8, size.y * fit * 0.5 + 3, 4);
    s.scene.add(holder);
    s.gun = holder;
    s.gunKey = key;
  }
  /** 배낭에서 고른 파츠를 왼쪽 받침 위에 띄운다 */
  function syncPreview() {
    const s = three;
    if (s.preview) { s.scene.remove(s.preview); dispose(s.preview); s.preview = null; }
    const item = store.items.find((i) => i.id === selected);
    s.previewRing.visible = !!item;
    if (!item) return;
    s.preview = makePartPreview(item);
    s.preview.position.set(-82, 16, 24);
    s.scene.add(s.preview);
    s.ringMat.color.set(GRADE[item.grade].color);
  }
  /** 뽑기 연출: 상자 뚜껑이 열리고 가장 높은 등급 빛이 솟으며 파츠가 떠오른다 */
  function playDraw(items) {
    const s = three;
    const best = items.reduce((a, b) => (GRADE[b.grade].rank > GRADE[a.grade].rank ? b : a));
    if (s.anim?.part) { s.scene.remove(s.anim.part); dispose(s.anim.part); }
    const part = makePartPreview(best);
    part.position.set(84, 8, 14);
    part.scale.multiplyScalar(0.2);
    s.scene.add(part);
    s.anim = { t: 0, part, color: GRADE[best.grade].color, rank: GRADE[best.grade].rank, scale: part.scale.x * 5 };
    s.beamMat.color.set(s.anim.color);
    s.crateLight.color.set(s.anim.color);
  }
  function animate(s, dt, time) {
    if (s.gun) s.gun.rotation.y = s.yaw + (s.drag ? 0 : Math.sin(time * 0.5) * 0.25);
    if (s.preview) { s.preview.rotation.y = time * 0.9; s.preview.position.y = 16 + Math.sin(time * 2) * 1.5; }
    const a = s.anim;
    if (a) {
      a.t += dt;
      const open = Math.min(1, a.t / 0.35);
      s.lidPivot.rotation.x = -open * 1.9;
      const rise = Math.min(1, Math.max(0, (a.t - 0.25) / 0.7));
      const e = rise * rise * (3 - 2 * rise);
      a.part.position.set(84, 8 + e * 34, 14 + e * 10);
      a.part.scale.setScalar(a.scale * (0.2 + 0.8 * e));
      a.part.rotation.y = a.t * (3 + a.rank * 2);
      const fade = a.t > 2.6 ? Math.max(0, 1 - (a.t - 2.6) / 0.6) : 1;
      s.beamMat.opacity = Math.min(1, a.t / 0.4) * (0.25 + a.rank * 0.15) * fade;
      s.beam.scale.set(1 + Math.sin(a.t * 10) * 0.04 * a.rank, 1, 1 + Math.sin(a.t * 10) * 0.04 * a.rank);
      s.crateLight.intensity = (2000 + a.rank * 2500) * Math.min(1, a.t / 0.3) * fade;
      if (a.t > 3.2) {
        s.lidPivot.rotation.x = -1.9 * Math.max(0, 1 - (a.t - 3.2) / 0.4);
        if (a.t > 3.6) { s.scene.remove(a.part); dispose(a.part); s.anim = null; s.lidPivot.rotation.x = 0; }
      }
    }
  }
  let last = 0;
  function loop(now) {
    if (!running) return;
    const time = now / 1000, dt = Math.min(0.05, time - last || 0.016);
    last = time;
    syncGun();
    animate(three, dt, time);
    three.renderer.render(three.scene, three.camera);
    requestAnimationFrame(loop);
  }

  // ── 패널 ──
  const gradeChip = (grade) => { const c = el('span', `grade grade-${grade}`, GRADE[grade].name); return c; };
  function renderWeapons() {
    const box = $('#mod-weapons');
    box.replaceChildren(...weapons.map((id) => {
      const b = el('button', 'mod-weapon', WEAPONS[id].name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(id === weapon));
      b.addEventListener('click', () => { weapon = id; previewShop = null; renderAll(); });
      return b;
    }));
  }
  function renderSlots() {
    const ul = $('#mod-slots');
    const eq = store.equipped(weapon);
    ul.replaceChildren(...MOD_WEAPONS[weapon].map((slot) => {
      const li = el('li', 'mod-slot');
      const item = eq[slot];
      li.append(el('span', 'slot-icon', SLOT[slot].icon), el('b', '', SLOT[slot].name));
      if (item) {
        const name = el('span', `slot-item grade-text-${item.grade}`, item.name);
        const off = el('button', 'small', '해제');
        off.type = 'button';
        off.addEventListener('click', () => store.unequip(weapon, slot));
        li.append(gradeChip(item.grade), name, off);
      } else {
        li.append(el('span', 'slot-empty', '기본'));
      }
      return li;
    }));
    $('#mod-weapon-name').textContent = WEAPONS[weapon].name;
  }
  function renderFilter() {
    const box = $('#mod-filter');
    const opts = [{ id: 'all', name: '전체' }, ...PART_SLOTS];
    box.replaceChildren(...opts.map((o) => {
      const b = el('button', 'small', o.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(filter === o.id));
      b.addEventListener('click', () => { filter = o.id; renderBag(); renderFilter(); });
      return b;
    }));
  }
  function renderBag() {
    const box = $('#mod-bag');
    const list = store.items.filter((i) => filter === 'all' || i.slot === filter)
      .slice().sort((a, b) => GRADE[b.grade].rank - GRADE[a.grade].rank || b.id - a.id);
    $('#mod-count').textContent = `${store.items.length}개`;
    if (!list.length) {
      box.replaceChildren(el('p', 'hint', store.items.length ? '이 칸의 파츠가 없어요.' : '배낭이 비었어요. 랜덤 뽑기로 파츠를 뽑아 보세요!'));
      return;
    }
    box.replaceChildren(...list.map((item) => {
      const card = el('div', `mod-item grade-border-${item.grade}${item.id === selected ? ' selected' : ''}`);
      const view = el('button', 'mod-item-view');
      view.type = 'button';
      view.setAttribute('aria-label', `${GRADE[item.grade].name} ${SLOT[item.slot].name} ${item.name} 살펴보기`);
      view.append(el('span', 'slot-icon', SLOT[item.slot].icon), el('span', 'mod-item-name', item.name));
      const meta = el('span', 'mod-item-meta');
      meta.append(gradeChip(item.grade), el('span', '', SLOT[item.slot].name));
      view.append(meta);
      view.addEventListener('click', () => { selected = selected === item.id ? null : item.id; syncPreview(); renderBag(); });
      const actions = el('div', 'mod-item-actions');
      const on = store.isEquipped(weapon, item.id);
      const fits = canMount(weapon, item.slot);
      // 장착한 파츠는 '장착 해제'(누르면 기본 부품으로 돌아감)
      const equip = el('button', on ? 'small unequip' : 'small primary', on ? '장착 해제' : fits ? '장착' : '이 총엔 못 붙임');
      equip.type = 'button';
      equip.disabled = !on && !fits;
      equip.setAttribute('aria-label', `${item.name} ${on ? '장착 해제' : '장착'}`);
      equip.addEventListener('click', () => { if (on) store.unequip(weapon, item.slot); else store.equip(weapon, item.id); });
      if (item.shop) meta.append(el('span', 'shop-tag', '상점'));
      // 상점에서 산 파츠는 영구 보관(분해 불가)
      const scrap = el('button', 'small', item.shop ? '영구 보관' : '분해');
      scrap.type = 'button';
      scrap.disabled = !!item.shop;
      scrap.addEventListener('click', () => {
        if (scrap.dataset.confirm) { if (selected === item.id) selected = null; store.remove(item.id); syncPreview(); return; }
        scrap.dataset.confirm = '1';
        scrap.textContent = '정말 분해?';
        setTimeout(() => { if (scrap.isConnected) { delete scrap.dataset.confirm; scrap.textContent = '분해'; } }, 2500);
      });
      actions.append(equip, scrap);
      card.append(view, actions);
      return card;
    }));
  }
  /** 가진 코인과 뽑기 버튼(코인이 모자라면 못 누름) */
  function renderCoins() {
    $('#mod-coins').textContent = `🪙 코인 ${store.coins}개`;
    $('#mod-draw-btn').disabled = !store.canDraw(1);
    $('#mod-draw10-btn').disabled = !store.canDraw(10);
    $('#mod-coin-hint').textContent = store.coins < DRAW_COST
      ? '코인이 없어요. 스토리 모드에서 스테이지를 깰 때마다 코인 1개를 받아요(중간에 그만둬도 받은 코인은 남아요).'
      : `뽑기 1번에 ${DRAW_COST}코인. 코인은 스토리 모드 스테이지를 깰 때마다 1개씩 받아요.`;
  }
  // ── 상점 ──
  function renderTabs() {
    for (const b of document.querySelectorAll('#mod-tabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    $('#mod-gacha').hidden = tab !== 'gacha';
    $('#mod-shop').hidden = tab !== 'shop';
  }
  function renderShopFilter() {
    const opts = [['all', '전체'], ['rare', `레어 (${SHOP_PRICE.rare}코인)`], ['elite', `엘리트 (${SHOP_PRICE.elite}코인)`], ['weapon', `${WEAPONS[weapon].name}만`]];
    $('#mod-shop-filter').replaceChildren(...opts.map(([id, name]) => {
      const b = el('button', 'small', name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(shopFilter === id));
      b.addEventListener('click', () => { shopFilter = id; renderShop(); });
      return b;
    }));
  }
  function renderShop() {
    renderShopFilter();
    const list = SHOP.filter((g) => shopFilter === 'all' || g.grade === shopFilter || (shopFilter === 'weapon' && g.weapon === weapon));
    $('#mod-shop-list').replaceChildren(...list.map((g) => {
      const owned = store.owns(g.id);
      const card = el('div', `mod-item shop-item grade-border-${g.grade}${previewShop === g.id ? ' previewing' : ''}`);
      const view = el('button', 'mod-item-view');
      view.type = 'button';
      view.setAttribute('aria-label', `${GRADE[g.grade].name} ${g.name} 미리 보기`);
      view.append(el('span', 'slot-icon', '🔫'), el('span', 'mod-item-name', g.name));
      const meta = el('span', 'mod-item-meta');
      meta.append(gradeChip(g.grade), el('span', 'shop-weapon', `${WEAPONS[g.weapon].name} · 파츠 ${g.parts.length}개`));
      view.append(meta);
      view.addEventListener('click', () => {
        previewShop = previewShop === g.id ? null : g.id;
        if (previewShop) weapon = g.weapon;
        renderWeapons(); renderSlots(); renderShop();
      });
      const actions = el('div', 'mod-item-actions');
      let btn;
      if (!owned) {
        btn = el('button', 'small primary', `구매 🪙${g.price}`);
        btn.disabled = !store.canBuy(g.id);
        btn.addEventListener('click', () => {
          if (!store.buy(g.id).length) return;
          weapon = g.weapon; previewShop = null;
          renderAll();
        });
      } else if (store.shopEquipped(g.id)) {
        btn = el('button', 'small', '장착 중');
        btn.disabled = true;
      } else {
        btn = el('button', 'small primary', '보유 · 장착');
        btn.addEventListener('click', () => { store.equipShop(g.id); weapon = g.weapon; previewShop = null; renderAll(); });
      }
      btn.type = 'button';
      btn.setAttribute('aria-label', `${g.name} ${btn.textContent}`);
      actions.append(btn);
      card.append(view, actions);
      return card;
    }));
  }
  for (const b of document.querySelectorAll('#mod-tabs button')) {
    b.addEventListener('click', () => { tab = b.dataset.tab; previewShop = null; renderTabs(); renderShop(); });
  }

  function renderAll() { renderCoins(); renderTabs(); renderWeapons(); renderSlots(); renderFilter(); renderBag(); renderShop(); }
  store.onChange(() => { if (running) { renderCoins(); renderSlots(); renderBag(); renderShop(); } });

  /** 뽑은 결과 카드(가장 좋은 등급부터) */
  function reveal(items) {
    const box = $('#mod-reveal');
    const sorted = items.slice().sort((a, b) => GRADE[b.grade].rank - GRADE[a.grade].rank);
    const list = el('div', 'reveal-list');
    sorted.forEach((item, i) => {
      const c = el('div', `reveal-card grade-border-${item.grade}`);
      c.style.animationDelay = `${0.9 + i * 0.08}s`;
      c.append(gradeChip(item.grade), el('b', '', item.name), el('span', 'hint', `${SLOT[item.slot].name} · 배낭에 넣었어요`));
      list.append(c);
    });
    const ok = el('button', 'primary', '확인');
    ok.type = 'button';
    ok.addEventListener('click', () => { box.hidden = true; });
    box.replaceChildren(el('p', 'reveal-title', items.length > 1 ? `${items.length}연속 뽑기 결과` : '뽑기 결과'), list, ok);
    box.hidden = false;
    setTimeout(() => ok.focus(), 50);
  }
  function draw(count) {
    const items = store.draw(count);
    if (!items.length) { renderCoins(); return; }
    if (three) playDraw(items);
    reveal(items);
  }

  $('#mod-draw-btn').addEventListener('click', () => draw(1));
  $('#mod-draw10-btn').addEventListener('click', () => draw(10));
  for (const b of document.querySelectorAll('.mod-close-btn')) b.addEventListener('click', () => { close(); onClose(); });
  $('#mod-odds').textContent = `확률: ${GRADES.map((g) => `${g.name} ${g.weight}%`).join(' · ')}`;

  function open() {
    show('mod');
    $('#mod-reveal').hidden = true;
    previewShop = null;
    if (!three) {
      try { three = makeThree(); } catch (error) { console.warn('작업실 3D 화면을 만들 수 없습니다.', error); }
    }
    renderAll();
    if (three) { syncPreview(); running = true; requestAnimationFrame(loop); }
  }
  function close() { running = false; }
  return { open, close };
}
