// 메뉴 화면 컨트롤러 조작: 방향 읽기, 화면 배치대로 다음 칸 고르기
import test from 'node:test';
import assert from 'node:assert/strict';
import { padDirection, nextIndex } from '../src/input/padmenu.js';

function pad(axes = [0, 0, 0, 0], down = []) {
  return { axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })) };
}

test('방향: 십자키가 먼저, 없으면 왼쪽 스틱의 더 크게 기운 축(작게 기울이면 없음)', () => {
  assert.equal(padDirection(pad(undefined, [12])), 'up');
  assert.equal(padDirection(pad(undefined, [15])), 'right');
  assert.equal(padDirection(pad([0.9, 0.3])), 'right');
  assert.equal(padDirection(pad([-0.2, 0.8])), 'down');
  assert.equal(padDirection(pad([0.3, -0.3])), null);
  assert.equal(padDirection(pad([0.9, 0], [12])), 'up');
});

test('다음 칸: 같은 줄·같은 열을 먼저, 그 방향에 칸이 없으면 -1', () => {
  const r = (left, top) => ({ left, top, width: 100, height: 40 });
  // 첫 줄 버튼 셋, 둘째 줄 왼쪽에 하나
  const rects = [r(0, 0), r(120, 0), r(240, 0), r(0, 60)];
  assert.equal(nextIndex(rects[0], rects, 'right'), 1);
  assert.equal(nextIndex(rects[1], rects, 'right'), 2);
  assert.equal(nextIndex(rects[2], rects, 'right'), -1);
  assert.equal(nextIndex(rects[0], rects, 'down'), 3);
  assert.equal(nextIndex(rects[2], rects, 'down'), 3);
  assert.equal(nextIndex(rects[3], rects, 'up'), 0);
  assert.equal(nextIndex(rects[0], rects, 'up'), -1);
});
