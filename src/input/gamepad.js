import { DEADZONE, KEY_AIM_SPEED } from '../game/config.js';
import { aimFromDrag, moveAxisFromDrag } from './pointer.js';
import { KATA_PAD } from './kata.js';

/**
 * 게임 컨트롤러(브라우저 Gamepad API, 표준 배치 기준. Xbox·PlayStation·Switch Pro 등).
 * 연결된 순서대로 첫 번째 컨트롤러는 첫 번째 사람 플레이어(P1), 두 번째는 P2를 조작한다(싱글 플레이에서는 P1만).
 * 키보드·터치와 함께 받는다. 브라우저는 컨트롤러 버튼을 한 번 누른 뒤에야 컨트롤러를 알려 준다.
 */
// 표준 배치 버튼 번호: 0 A(×) · 1 B(○) · 2 X(□) · 4 LB · 5 RB · 6 LT · 7 RT · 9 Start · 12~15 십자키 위·아래·왼쪽·오른쪽
export const PAD_BUTTONS = { fire: [7, 0], swap: [5, 2], item: [4, 1], pause: [9], up: [12], down: [13], left: [14], right: [15] };
export const PAD_LABEL = '컨트롤러: 왼쪽 스틱·십자키 ←/→ 이동 · 오른쪽 스틱(또는 십자키 ↑/↓) 조준 · RT/A 발사 · RB/X 무기 전환 · LB/B 수류탄 · Start 일시정지';

const pressed = (pad, list) => list.some((i) => pad.buttons[i]?.pressed);

/** 컨트롤러 한 대의 지금 상태. 순수 함수(테스트용). */
export function readPad(pad) {
  const [lx = 0, , rx = 0, ry = 0] = pad.axes;
  const dpad = (pressed(pad, PAD_BUTTONS.right) ? 1 : 0) - (pressed(pad, PAD_BUTTONS.left) ? 1 : 0);
  const stick = moveAxisFromDrag(lx, 1);
  return {
    move: Math.min(1, Math.max(-1, stick + dpad)),
    rx, ry,
    // 십자키 ↑/↓는 키보드 W/S처럼 조준선을 돌린다(↑ 화면 왼쪽, ↓ 화면 오른쪽)
    turn: (pressed(pad, PAD_BUTTONS.down) ? 1 : 0) - (pressed(pad, PAD_BUTTONS.up) ? 1 : 0),
    fire: pressed(pad, PAD_BUTTONS.fire),
    swap: pressed(pad, PAD_BUTTONS.swap),
    item: pressed(pad, PAD_BUTTONS.item),
    pause: pressed(pad, PAD_BUTTONS.pause),
    // 건 카타 버튼: A·B·X·Y → 1·2·3·4 (누르지 않았으면 0)
    kata: KATA_PAD[Object.keys(KATA_PAD).find((i) => pad.buttons[i]?.pressed)] ?? 0,
  };
}

/** 오른쪽 스틱을 조준 각도로. 데드존 안이거나 자기 진영 쪽으로만 기울이면 null(조준 유지). */
export function aimFromStick(rx, ry, team) {
  if (Math.hypot(rx, ry) < DEADZONE) return null;
  const r = aimFromDrag(rx, ry, 1, team, 0);
  return r.armed ? r.aim : null;
}

const connectedPads = () => [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected);

let states = [];
let previous = [];

/** 일시정지·경기 시작 때 호출. 지금 눌린 버튼은 한 번 뗐다가 다시 눌러야 반응한다(키보드 clearKeys와 같다). */
export function clearGamepads() {
  previous = states.map((s) => ({ ...s }));
  for (const s of states) s.move = 0;
}

/**
 * 매 화면 프레임에 한 번 호출. 버튼을 새로 누르거나 뗀 순간을 입력 프레임에 넣는다.
 * inputs가 null이면(경기 입력을 받지 않는 중) Start만 본다.
 */
export function pollGamepads(players, inputs, onPause) {
  const pads = connectedPads();
  states = pads.map(readPad);
  states.forEach((s, i) => {
    const before = previous[i] ?? {};
    if (s.pause && !before.pause) onPause();
    const p = players[i];
    const frame = p && inputs?.[p.id];
    if (!frame) return;
    if (s.swap && !before.swap) frame.swap = true;
    if (s.item && !before.item) frame.item = true;
    if (s.fire !== !!before.fire) frame.aiming = s.fire;
    if (s.kata && s.kata !== before.kata) frame.kata = s.kata; // 건 카타 1~4(A·B·X·Y)
  });
  previous = states;
}

/** 매 틱 호출(applyKeyboard 다음). 이동축을 더하고 오른쪽 스틱·십자키로 조준한다. */
export function applyGamepads(inputs, players, dt) {
  players.forEach((p, i) => {
    const s = states[i];
    const frame = inputs[p.id];
    if (!s || !frame) return;
    frame.moveAxis = Math.min(1, Math.max(-1, frame.moveAxis + s.move));
    const aim = aimFromStick(s.rx, s.ry, p.team);
    if (aim !== null) { frame.aim = aim; return; }
    if (s.turn === 0) return;
    const dir = p.team === 'isb' ? -1 : 1;
    const next = frame.aim + dir * s.turn * KEY_AIM_SPEED * dt;
    frame.aim = p.team === 'isb' ? Math.min(Math.PI, Math.max(0, next)) : Math.min(0, Math.max(-Math.PI, next));
  });
}
