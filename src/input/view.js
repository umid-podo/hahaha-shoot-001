/**
 * 1인칭 시점 조작을 경기 입력으로 바꾼다. 사람 플레이어의 입력 프레임에는 키보드·컨트롤러·터치가 넣은
 * 앞뒤(fwd, +앞)·옆걸음(side, +오른쪽)·고개 돌리기(turn, +오른쪽) 값과 마우스로 돌린 각도(mouseTurn, 라디안)가 있다.
 * 매 틱 바라보는 방향(aim)을 돌리고, 앞뒤·옆걸음을 그 방향 기준으로 경기장 가로(moveAxis)·세로(moveY) 이동축으로 바꾼다.
 * 경기장은 위에서 보면 X 오른쪽, Y 아래쪽이고 aim은 그 평면의 각도라 앞은 (cos aim, sin aim), 오른쪽은 (-sin aim, cos aim)이다.
 */
export const TURN_SPEED = (150 * Math.PI) / 180; // 키·스틱을 끝까지 밀었을 때 초당 도는 각도
export const MOUSE_SENSITIVITY = 0.0026;         // 마우스 1px당 도는 각도(라디안)

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/** 각도를 (-π, π]로 */
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** 앞뒤·옆걸음(바라보는 방향 기준)을 경기장 가로·세로 이동축으로 */
export function toWorld(fwd, side, aim) {
  const c = Math.cos(aim), s = Math.sin(aim);
  return [fwd * c - side * s, fwd * s + side * c];
}

/**
 * 매 틱 호출(applyKeyboard·applyGamepads 다음). drive: 대교 가는 길(운전)처럼 좌우 핸들만 받는 장면이면 옆걸음이 곧 가로 이동축.
 */
export function applyView(inputs, players, dt, { drive = false } = {}) {
  for (const p of players) {
    const frame = inputs[p.id];
    if (!frame) continue;
    const turn = clamp1(frame.turn + (frame.touchTurn ?? 0));
    frame.aim = wrapAngle(frame.aim + turn * TURN_SPEED * dt + (frame.mouseTurn ?? 0));
    frame.mouseTurn = 0;
    const fwd = clamp1(frame.fwd + (frame.touchFwd ?? 0));
    const side = clamp1(frame.side + (frame.touchSide ?? 0));
    if (drive) {
      frame.moveAxis = side;
      frame.moveY = 0;
      continue;
    }
    [frame.moveAxis, frame.moveY] = toWorld(fwd, side, frame.aim);
  }
}

/**
 * 마우스로 P1(사람 플레이어 첫째)의 고개를 돌리고 쏜다. 게임 화면을 누르면 마우스 포인터를 잠그고(Esc로 풀림),
 * 잠긴 동안 좌우로 움직이면 고개를 돌리고 왼쪽 버튼 발사, 오른쪽 버튼 수류탄, 휠 무기 전환.
 * getFrame()은 경기 중이면 P1 입력 프레임, 아니면 null. 터치로 누른 것은 포인터를 잠그지 않는다.
 */
export function attachMouse(element, getFrame) {
  const locked = () => document.pointerLockElement === element;
  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || !getFrame()) return;
    if (!locked()) {
      element.requestPointerLock?.();
      return;
    }
    const frame = getFrame();
    if (e.button === 0) frame.aiming = true;
    if (e.button === 2) frame.item = true;
  });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const frame = getFrame();
    if (frame && locked()) frame.aiming = false;
  });
  element.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    const frame = locked() && getFrame();
    if (frame) frame.mouseTurn = (frame.mouseTurn ?? 0) + e.movementX * MOUSE_SENSITIVITY;
  });
  element.addEventListener('wheel', (e) => {
    const frame = locked() && getFrame();
    if (!frame) return;
    e.preventDefault();
    frame.swap = true;
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    const frame = getFrame();
    if (!locked() && frame) frame.aiming = false;
  });
  return {
    /** 경기가 멈추면(일시정지·결과) 포인터 잠금을 푼다 */
    release() { if (locked()) document.exitPointerLock?.(); },
    locked,
  };
}
