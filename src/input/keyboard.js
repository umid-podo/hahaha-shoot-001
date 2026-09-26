import { KEY_AIM_SPEED } from '../game/config.js';

// aimLeft/aimRight는 조준선을 화면 왼쪽/오른쪽으로 돌린다. swap은 주무기 → 보조무기 → 수류탄 순으로 전환.
export const KEYMAP = {
  P1: { left: 'KeyA', right: 'KeyD', aimLeft: 'KeyW', aimRight: 'KeyS', fire: 'KeyF', swap: 'KeyE' },
  P2: { left: 'ArrowLeft', right: 'ArrowRight', aimLeft: 'ArrowUp', aimRight: 'ArrowDown', fire: 'Enter', swap: 'ShiftRight' },
  P3: { left: 'KeyJ', right: 'KeyL', aimLeft: 'KeyI', aimRight: 'KeyK', fire: 'KeyH', swap: 'KeyU' },
  P4: { left: 'Numpad4', right: 'Numpad6', aimLeft: 'Numpad8', aimRight: 'Numpad5', fire: 'Numpad0', swap: 'NumpadAdd' },
};
const FIRE_HINT = '누르고 있으면 연사(RPG·저격총·수류탄은 떼면 발사)';
export const KEY_LABELS = {
  P1: `A/D 이동 · W/S 조준 · F ${FIRE_HINT} · E 무기 전환`,
  P2: `←/→ 이동 · ↑/↓ 조준 · Enter ${FIRE_HINT} · 오른쪽 Shift 무기 전환`,
  P3: `J/L 이동 · I/K 조준 · H ${FIRE_HINT} · U 무기 전환`,
  P4: `Num4/6 이동 · Num8/5 조준 · Num0 ${FIRE_HINT} · Num+ 무기 전환`,
};

const held = new Set();
const fireOwner = {};
const swapOwner = {};
const gameCodes = new Set();
for (const [id, map] of Object.entries(KEYMAP)) {
  fireOwner[map.fire] = id;
  swapOwner[map.swap] = id;
  for (const code of Object.values(map)) gameCodes.add(code);
}

export function clearKeys() { held.clear(); }

/** getInputs()는 경기 입력을 받는 동안에만 입력 프레임을, 그 외에는 null을 돌려준다. */
export function attachKeyboard(getInputs, onEscape) {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { onEscape(); return; }
    const inputs = getInputs();
    if (!inputs || !gameCodes.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    const swapper = inputs[swapOwner[e.code]];
    if (swapper) swapper.swap = true;
    const frame = inputs[fireOwner[e.code]];
    if (frame) frame.aiming = true;
  });
  window.addEventListener('keyup', (e) => {
    const inputs = getInputs();
    if (!inputs || !held.delete(e.code)) return;
    const frame = inputs[fireOwner[e.code]];
    if (frame) frame.aiming = false;
  });
}

/** 매 틱 호출. 키 이동축을 터치 이동축과 합치고 조준 각도를 회전한다. */
export function applyKeyboard(inputs, players, dt) {
  for (const p of players) {
    const map = KEYMAP[p.id], frame = inputs[p.id];
    const keyAxis = (held.has(map.right) ? 1 : 0) - (held.has(map.left) ? 1 : 0);
    frame.moveAxis = Math.min(1, Math.max(-1, frame.touchAxis + keyAxis));
    const turn = (held.has(map.aimRight) ? 1 : 0) - (held.has(map.aimLeft) ? 1 : 0);
    if (turn === 0) continue;
    // 화면 오른쪽으로 돌리기: 상단(아래를 조준)은 각도 감소, 하단(위를 조준)은 각도 증가
    const dir = p.team === 'isb' ? -1 : 1;
    const aim = frame.aim + dir * turn * KEY_AIM_SPEED * dt;
    frame.aim = p.team === 'isb' ? Math.min(Math.PI, Math.max(0, aim)) : Math.min(0, Math.max(-Math.PI, aim));
  }
}
