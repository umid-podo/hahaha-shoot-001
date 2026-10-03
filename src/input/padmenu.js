/**
 * 메뉴·준비·일시정지·결과·밸런스 화면을 게임 컨트롤러로 조작한다(Xbox 컨트롤러 기준, 어느 컨트롤러로든).
 * 십자키·왼쪽 스틱으로 버튼 사이를 화면 배치대로 옮겨 다니고, A는 선택(누르기), B는 취소(화면의 data-pad-cancel 버튼),
 * 오른쪽 스틱은 화면 스크롤. 숫자 칸은 A로 고치기를 시작해 십자키로 값을 올리고 내린 뒤 A·B로 끝낸다.
 */
const A = 0, B = 1;
const DPAD = { up: 12, down: 13, left: 14, right: 15 };
const STICK = 0.5;
const REPEAT_DELAY = 0.35, REPEAT_EVERY = 0.11;
const SCROLL_SPEED = 900; // 오른쪽 스틱 끝까지 기울였을 때 초당 스크롤(px)

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]';

/** 패드 하나에서 누른 방향. 십자키가 먼저, 없으면 왼쪽 스틱의 더 크게 기운 축. */
export function padDirection(pad) {
  for (const [dir, i] of Object.entries(DPAD)) if (pad.buttons[i]?.pressed) return dir;
  const [x = 0, y = 0] = pad.axes;
  if (Math.max(Math.abs(x), Math.abs(y)) < STICK) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

/**
 * 지금 칸(from)에서 dir 쪽으로 가장 가까운 칸의 번호. 없으면 -1. 칸은 { left, top, width, height }.
 * 진행 방향 거리에 옆으로 벗어난 거리를 2배로 더해, 같은 줄·같은 열에 있는 칸을 먼저 고른다.
 */
export function nextIndex(from, rects, dir) {
  const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];
  const [fx, fy] = center(from);
  let best = -1, bestScore = Infinity;
  rects.forEach((r, i) => {
    const [x, y] = center(r);
    const dx = x - fx, dy = y - fy;
    const along = { up: -dy, down: dy, left: -dx, right: dx }[dir];
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1) return;
    const score = along + across * 2;
    if (score < bestScore) { best = i; bestScore = score; }
  });
  return best;
}

const visibleScreen = () => document.querySelector('.screen:not([hidden])');
const candidates = (screen) => [...screen.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

let previous = { a: false, b: false, dir: null };
let held = 0, repeatAt = 0;
let editing = null;

function focus(el) {
  document.body.classList.add('pad-nav');
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** 화면의 첫 칸: 강조 버튼(.primary)이 있으면 그것 */
const firstOf = (list) => list.find((el) => el.classList.contains('primary')) ?? list[0];

function stepNumber(input, dir) {
  // stepUp()은 min 기준 눈금에 맞춰(500 → 511) 버리므로 지금 값에서 step만큼 더하고 뺀다
  const step = Number(input.step) || 1;
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  const sign = dir === 'up' || dir === 'right' ? 1 : -1;
  const next = Math.min(max, Math.max(min, (Number(input.value) || 0) + sign * step));
  if (String(next) === input.value) return;
  input.value = String(Math.round(next * 1e6) / 1e6);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setEditing(input) {
  editing?.classList.remove('pad-editing');
  editing = input;
  editing?.classList.add('pad-editing');
}

function move(screen, dir) {
  if (editing) { stepNumber(editing, dir); return; }
  const list = candidates(screen);
  if (list.length === 0) return;
  const current = list.indexOf(document.activeElement);
  if (current < 0) { focus(firstOf(list)); return; }
  const rects = list.map((el) => el.getBoundingClientRect());
  const next = nextIndex(rects[current], rects, dir);
  if (next >= 0) focus(list[next]);
}

function select(screen) {
  const el = document.activeElement;
  if (editing) { setEditing(null); return; }
  const list = candidates(screen);
  if (!list.includes(el)) {
    if (list.length) focus(firstOf(list));
    return;
  }
  if (el.tagName === 'INPUT' && el.type === 'number') { setEditing(el); return; }
  el.click();
}

function cancel(screen) {
  if (editing) { setEditing(null); return; }
  const btn = screen.querySelector('[data-pad-cancel]');
  if (btn && !btn.disabled && btn.getClientRects().length > 0) btn.click();
}

/**
 * 매 화면 프레임 호출. enabled가 거짓(경기 중)이어도 버튼 상태는 따라가서,
 * 경기 중 누르던 A가 결과 화면에서 '새로 누름'으로 잡히지 않게 한다.
 */
export function pollPadMenu(enabled, dt) {
  const pads = [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected);
  const now = {
    a: pads.some((p) => p.buttons[A]?.pressed),
    b: pads.some((p) => p.buttons[B]?.pressed),
    dir: pads.map(padDirection).find(Boolean) ?? null,
  };
  const scroll = pads.map((p) => p.axes[3] ?? 0).find((v) => Math.abs(v) >= 0.2) ?? 0;
  const before = previous;
  previous = now;
  if (editing && document.activeElement !== editing) setEditing(null);
  const screen = enabled ? visibleScreen() : null;
  if (!screen) { held = 0; return; }

  if (now.dir && now.dir === before.dir) {
    held += dt;
    if (held >= repeatAt) { repeatAt += REPEAT_EVERY; move(screen, now.dir); }
  } else if (now.dir) {
    held = 0; repeatAt = REPEAT_DELAY;
    move(screen, now.dir);
  }
  if (now.a && !before.a) select(screen);
  if (now.b && !before.b) cancel(screen);
  if (scroll) screen.scrollBy(0, scroll * SCROLL_SPEED * dt);
}

// 마우스·터치를 쓰면 컨트롤러 포커스 표시를 끈다
globalThis.window?.addEventListener('pointerdown', () => document.body.classList.remove('pad-nav'), true);
