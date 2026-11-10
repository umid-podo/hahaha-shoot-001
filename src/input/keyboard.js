// 1인칭 3D 키보드 조작. forward/back은 앞뒤, left/right는 옆걸음, turnLeft/turnRight는 고개 돌리기(마우스로도 돌린다),
// fire는 발사(누르고 있으면 연사), swap은 주무기 ↔ 보조무기 전환, item은 수류탄 던지기, evade는 회피(빠른 돌진).
export const KEYMAP = {
  P1: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', turnLeft: 'KeyZ', turnRight: 'KeyC',
    fire: 'KeyF', swap: 'KeyE', item: 'KeyQ', jump: 'Space', evade: 'ShiftLeft',
  },
  P2: {
    forward: 'ArrowUp', back: 'ArrowDown', left: 'Comma', right: 'Period', turnLeft: 'ArrowLeft', turnRight: 'ArrowRight',
    fire: 'Enter', swap: 'ShiftRight', item: 'Slash', jump: 'ControlRight', evade: 'KeyM',
  },
};
const FIRE_HINT = '누르고 있으면 연사(RPG·저격총은 떼면 발사)';
export const KEY_LABELS = {
  P1: `W/S 앞뒤 · A/D 옆걸음 · 마우스(화면을 눌러 잠금) 또는 Z/C 고개 돌리기 · F·왼쪽 클릭 ${FIRE_HINT} · E·휠 무기 전환 · Q·오른쪽 클릭 수류탄 · Space 점프 · 왼쪽 Shift·휠 클릭 회피(2번 연속 돌진)`,
  P2: `↑/↓ 앞뒤 · ←/→ 고개 돌리기 · ,/. 옆걸음 · Enter ${FIRE_HINT} · 오른쪽 Shift 무기 전환 · / 수류탄 · 오른쪽 Ctrl 점프 · M 회피(2번 연속 돌진)`,
};
/** 혼자 하면(사람 플레이어 1명) P1은 P2 키(방향키 등)로도 조작한다. */
export const SOLO_LABEL = '혼자 할 때는 방향키·Enter 등 P2 키로도 조작할 수 있습니다.';

const held = new Set();
const gameCodes = new Set(Object.values(KEYMAP).flatMap((map) => Object.values(map)));
/** 이 키를 누른 사람: 그 키의 자리(P1·P2)가 경기에 없으면(혼자 하면) 사람 플레이어 하나에게 */
function ownerOf(code, inputs, action) {
  const id = Object.keys(KEYMAP).find((pid) => KEYMAP[pid][action] === code);
  if (!id) return null;
  if (inputs[id]) return inputs[id];
  const ids = Object.keys(inputs);
  return ids.length === 1 ? inputs[ids[0]] : null;
}

export function clearKeys() { held.clear(); }

/** getInputs()는 경기 입력을 받는 동안에만 사람 플레이어의 입력 프레임을, 그 외에는 null을 돌려준다. */
export function attachKeyboard(getInputs, onEscape) {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { onEscape(); return; }
    const inputs = getInputs();
    if (!inputs || !gameCodes.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    const swapper = ownerOf(e.code, inputs, 'swap');
    if (swapper) swapper.swap = true;
    const jumper = ownerOf(e.code, inputs, 'jump');
    if (jumper) jumper.jump = true;
    const evader = ownerOf(e.code, inputs, 'evade');
    if (evader) evader.evade = true;
    const thrower = ownerOf(e.code, inputs, 'item');
    if (thrower) thrower.item = true;
    const shooter = ownerOf(e.code, inputs, 'fire');
    if (shooter) shooter.aiming = true;
  });
  window.addEventListener('keyup', (e) => {
    const inputs = getInputs();
    if (!inputs || !held.delete(e.code)) return;
    const shooter = ownerOf(e.code, inputs, 'fire');
    if (shooter) shooter.aiming = false;
  });
}

const axis = (plus, minus) => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);

/**
 * 매 틱 호출. 키로 누른 앞뒤·옆걸음·고개 돌리기를 입력 프레임(fwd·side·turn)에 넣는다(터치 스틱 몫은 input/view.js에서 더한다).
 * 혼자 하면 P1은 P2 키로도 움직인다.
 */
export function applyKeyboard(inputs, players) {
  const solo = players.length === 1;
  for (const p of players) {
    const frame = inputs[p.id];
    const maps = solo ? [KEYMAP.P1, KEYMAP.P2] : [KEYMAP[p.id]].filter(Boolean);
    frame.fwd = 0; frame.side = 0; frame.turn = 0;
    for (const map of maps) {
      frame.fwd += axis(map.forward, map.back);
      frame.side += axis(map.right, map.left);
      frame.turn += axis(map.turnRight, map.turnLeft);
    }
  }
}
