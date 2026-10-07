// 게임 컨트롤러: 표준 배치 버튼·스틱을 이동·조준·발사로 바꾸기
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPad, aimFromStick, PAD_BUTTONS } from '../src/input/gamepad.js';

function pad(axes = [0, 0, 0, 0], down = []) {
  return { axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })) };
}

test('왼쪽 스틱은 데드존을 빼고 이동축으로, 십자키 ←/→도 이동', () => {
  assert.equal(readPad(pad([0.1, 0, 0, 0])).move, 0);
  assert.equal(readPad(pad([1, 0, 0, 0])).move, 1);
  assert.ok(readPad(pad([-0.5, 0, 0, 0])).move < 0);
  assert.equal(readPad(pad(undefined, PAD_BUTTONS.left)).move, -1);
  assert.equal(readPad(pad([1, 0, 0, 0], PAD_BUTTONS.right)).move, 1);
});

test('버튼: RT·A 발사, RB·X 무기 전환, LB·B 수류탄, Start 일시정지, 십자키 ↑/↓ 조준 회전', () => {
  for (const b of [7, 0]) assert.equal(readPad(pad(undefined, [b])).fire, true);
  for (const b of [5, 2]) assert.equal(readPad(pad(undefined, [b])).swap, true);
  for (const b of [4, 1]) assert.equal(readPad(pad(undefined, [b])).item, true);
  assert.equal(readPad(pad(undefined, [9])).pause, true);
  assert.equal(readPad(pad(undefined, [12])).turn, -1);
  assert.equal(readPad(pad(undefined, [13])).turn, 1);
  const idle = readPad(pad());
  assert.deepEqual([idle.fire, idle.swap, idle.item, idle.pause, idle.turn], [false, false, false, false, 0]);
});

test('오른쪽 스틱 조준: 상대 쪽 반원만, 데드존·자기 진영 쪽은 null(조준 유지)', () => {
  // 하단 지구방위팀은 위(-y)를, 상단 ISB팀은 아래(+y)를 조준한다
  assert.ok(Math.abs(aimFromStick(0, -1, 'earth') - -Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(aimFromStick(0, 1, 'isb') - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(aimFromStick(1, 0, 'earth')) < 1e-9);
  assert.equal(aimFromStick(0.05, -0.05, 'earth'), null);
  assert.equal(aimFromStick(0, 1, 'earth'), null);
  assert.equal(aimFromStick(0, -1, 'isb'), null);
});

test('건 카타: A·B·X·Y는 1·2·3·4', () => {
  assert.deepEqual([0, 1, 2, 3].map((b) => readPad(pad(undefined, [b])).kata), [1, 2, 3, 4]);
  assert.equal(readPad(pad()).kata, 0);
});
