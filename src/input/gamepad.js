// 컨트롤러 스틱 데드존은 pointer.js의 moveAxisFromDrag가 처리한다
import { moveAxisFromDrag } from './pointer.js';
import { KATA_PAD } from './kata.js';

/**
 * 게임 컨트롤러(브라우저 Gamepad API, 표준 배치 기준. Xbox·PlayStation·Switch Pro 등).
 * 연결된 순서대로 첫 번째 컨트롤러는 첫 번째 사람 플레이어(P1), 두 번째는 P2를 조작한다(싱글 플레이에서는 P1만).
 * 키보드·터치와 함께 받는다. 브라우저는 컨트롤러 버튼을 한 번 누른 뒤에야 컨트롤러를 알려 준다.
 * 1인칭: 왼쪽 스틱 앞뒤·옆걸음, 오른쪽 스틱 좌우로 고개 돌리기, 십자키 ↑/↓ 앞뒤·←/→ 고개 돌리기.
 */
// 표준 배치 버튼 번호: 0 A(×) · 1 B(○) · 2 X(□) · 4 LB · 5 RB · 6 LT · 7 RT · 9 Start · 12~15 십자키 위·아래·왼쪽·오른쪽
export const PAD_BUTTONS = { fire: [7, 0], swap: [5, 2], item: [4, 1], pause: [9], up: [12], down: [13], left: [14], right: [15] };
export const PAD_LABEL = '컨트롤러: 왼쪽 스틱 앞뒤·옆걸음 · 오른쪽 스틱 고개 돌리기 · 십자키 ↑/↓ 앞뒤·←/→ 고개 돌리기 · RT/A 발사 · RB/X 무기 전환 · LB/B 수류탄 · Start 일시정지';

const pressed = (pad, list) => list.some((i) => pad.buttons[i]?.pressed);
const clamp1 = (v) => Math.min(1, Math.max(-1, v));

/** 컨트롤러 한 대의 지금 상태. 순수 함수(테스트용). fwd +앞, side +오른쪽, turn +오른쪽으로 돌기. */
export function readPad(pad) {
  const [lx = 0, ly = 0, rx = 0] = pad.axes;
  const dpadX = (pressed(pad, PAD_BUTTONS.right) ? 1 : 0) - (pressed(pad, PAD_BUTTONS.left) ? 1 : 0);
  const dpadY = (pressed(pad, PAD_BUTTONS.up) ? 1 : 0) - (pressed(pad, PAD_BUTTONS.down) ? 1 : 0);
  return {
    side: moveAxisFromDrag(lx, 1),
    fwd: clamp1(-moveAxisFromDrag(ly, 1) + dpadY),
    turn: clamp1(turnFromStick(rx) + dpadX),
    fire: pressed(pad, PAD_BUTTONS.fire),
    swap: pressed(pad, PAD_BUTTONS.swap),
    item: pressed(pad, PAD_BUTTONS.item),
    pause: pressed(pad, PAD_BUTTONS.pause),
    // 건 카타 버튼: A·B·X·Y → 1·2·3·4 (누르지 않았으면 0)
    kata: KATA_PAD[Object.keys(KATA_PAD).find((i) => pad.buttons[i]?.pressed)] ?? 0,
  };
}

/** 오른쪽 스틱 가로를 고개 돌리는 속도로: 데드존 안은 0, 바깥은 조금씩 돌리기 쉽게 제곱 곡선 */
export function turnFromStick(rx) {
  const v = moveAxisFromDrag(rx, 1);
  return Math.sign(v) * v * v;
}

const connectedPads = () => [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected);

let states = [];
let previous = [];

/** 일시정지·경기 시작 때 호출. 지금 눌린 버튼은 한 번 뗐다가 다시 눌러야 반응한다(키보드 clearKeys와 같다). */
export function clearGamepads() {
  previous = states.map((s) => ({ ...s }));
  for (const s of states) { s.fwd = 0; s.side = 0; s.turn = 0; }
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

/** 매 틱 호출(applyKeyboard 다음). 앞뒤·옆걸음·고개 돌리기를 더한다(입력 프레임의 fwd·side·turn). */
export function applyGamepads(inputs, players) {
  players.forEach((p, i) => {
    const s = states[i];
    const frame = inputs[p.id];
    if (!s || !frame) return;
    frame.fwd = clamp1(frame.fwd + s.fwd);
    frame.side = clamp1(frame.side + s.side);
    frame.turn = clamp1(frame.turn + s.turn);
  });
}
