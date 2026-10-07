import { KATA_KEYS, KATA_MOVES } from '../game/gunkata.js';

/**
 * 건 카타 버튼 1·2·3·4. 건 카타 동안 조작 패널 대신 화면 아래 가운데에 나온다.
 * 터치(누르는 즉시), 키보드 숫자 1~4(숫자패드 포함), 컨트롤러 A·B·X·Y(1·2·3·4)로 누른다.
 * onPress(key)는 누른 번호를 받는다. sync(glow)는 빛나야 할 버튼 번호(없으면 null)를 매 프레임 맞춘다.
 */
export const KATA_CODES = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4,
};
// 컨트롤러 표준 배치: 0 A · 1 B · 2 X · 3 Y
export const KATA_PAD = { 0: 1, 1: 2, 2: 3, 3: 4 };
const PAD_NAME = { 1: 'A', 2: 'B', 3: 'X', 4: 'Y' };

export function createKataKeys(container, onPress) {
  const buttons = KATA_KEYS.map((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kata-key';
    btn.dataset.key = String(key);
    btn.innerHTML = '<b></b><small></small>';
    btn.firstChild.textContent = String(key);
    btn.lastChild.textContent = `${KATA_MOVES[key].hint} · ${PAD_NAME[key]}`;
    btn.setAttribute('aria-label', `${key}번 ${KATA_MOVES[key].hint}`);
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); onPress(key); });
    btn.addEventListener('click', (e) => { if (e.detail === 0) onPress(key); }); // 키보드로 누른 경우
    return btn;
  });
  container.replaceChildren(...buttons);
  let lit = null;
  return {
    sync(glow) {
      if (glow === lit) return;
      lit = glow;
      for (const b of buttons) b.classList.toggle('glow', Number(b.dataset.key) === glow);
    },
  };
}
