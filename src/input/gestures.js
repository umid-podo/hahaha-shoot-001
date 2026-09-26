/**
 * 브라우저 기본 확대/축소·스크롤 제스처 막기 (특히 iOS Safari).
 * iOS Safari는 viewport의 user-scalable=no를 무시하고, touch-action만으로는 여러 손가락 핀치를 다 막지 못한다.
 * 그래서 CSS(touch-action: none, styles.css)에 더해 아래 이벤트의 기본 동작을 취소한다.
 * - gesturestart/change/end: WebKit 전용 핀치 제스처. 항상 막는다(메뉴에서 확대된 채 경기에 들어가지 않게).
 * - touchmove: 두 손가락 이상이면 어디서든, 경기 화면(#game) 안이면 한 손가락도 막는다(페이지 밀림 방지).
 *   메뉴·밸런스 화면의 한 손가락 스크롤은 그대로 둔다.
 * - touchend: 경기 화면 안에서 빠른 연타(더블탭 확대)를 막는다.
 * 게임 조작은 Pointer Events로 받으므로 터치 이벤트의 기본 동작을 취소해도 멀티터치 입력은 그대로 들어온다.
 */
const DOUBLE_TAP_MS = 350;

export function blockBrowserGestures(gameRoot) {
  const inGame = (target) => !gameRoot.hidden && target instanceof Node && gameRoot.contains(target);
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  const opts = { passive: false };

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, opts);

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || inGame(e.target)) stop(e);
  }, opts);

  // 여러 손가락이 동시에 닿을 때(두 번째 손가락) Safari가 확대를 시작하지 못하게 한다.
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1 && inGame(e.target)) stop(e);
  }, opts);

  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    if (!inGame(e.target)) return;
    const now = e.timeStamp;
    if (now - lastEnd < DOUBLE_TAP_MS) stop(e);
    lastEnd = now;
  }, opts);
}
