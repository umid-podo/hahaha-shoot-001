// 게임 컨트롤러: 표준 배치 버튼·스틱을 이동·조준·발사로 바꾸기
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPad, turnFromStick, PAD_BUTTONS } from '../src/input/gamepad.js';

function pad(axes = [0, 0, 0, 0], down = []) {
  return { axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })) };
}

test('왼쪽 스틱은 데드존을 빼고 앞뒤·옆걸음으로, 십자키 ↑/↓도 앞뒤', () => {
  assert.equal(readPad(pad([0.1, 0, 0, 0])).side, 0);
  assert.equal(readPad(pad([1, 0, 0, 0])).side, 1);
  assert.equal(readPad(pad([0, -1, 0, 0])).fwd, 1, '스틱 위 = 앞');
  assert.ok(readPad(pad([0, 0.5, 0, 0])).fwd < 0);
  assert.equal(readPad(pad(undefined, PAD_BUTTONS.up)).fwd, 1);
  assert.equal(readPad(pad(undefined, PAD_BUTTONS.down)).fwd, -1);
});

test('버튼: RT·A 발사, RB·X 무기 전환, LB·B 수류탄, Start 일시정지, 십자키 ←/→ 고개 돌리기', () => {
  for (const b of [7, 0]) assert.equal(readPad(pad(undefined, [b])).fire, true);
  for (const b of [5, 2]) assert.equal(readPad(pad(undefined, [b])).swap, true);
  for (const b of [4, 1]) assert.equal(readPad(pad(undefined, [b])).item, true);
  assert.equal(readPad(pad(undefined, [9])).pause, true);
  assert.equal(readPad(pad(undefined, [14])).turn, -1);
  assert.equal(readPad(pad(undefined, [15])).turn, 1);
  const idle = readPad(pad());
  assert.deepEqual([idle.fire, idle.swap, idle.item, idle.pause, idle.turn], [false, false, false, false, 0]);
});

test('오른쪽 스틱 가로로 고개 돌리기: 데드존 안은 0, 조금 밀면 천천히(제곱 곡선)', () => {
  assert.equal(turnFromStick(0.1), 0);
  assert.equal(turnFromStick(1), 1);
  assert.equal(turnFromStick(-1), -1);
  assert.ok(turnFromStick(0.5) > 0 && turnFromStick(0.5) < 0.5);
  assert.equal(readPad(pad([0, 0, 1, 0])).turn, 1);
});

test('건 카타: A·B·X·Y는 1·2·3·4', () => {
  assert.deepEqual([0, 1, 2, 3].map((b) => readPad(pad(undefined, [b])).kata), [1, 2, 3, 4]);
  assert.equal(readPad(pad()).kata, 0);
});
