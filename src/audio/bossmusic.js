// 스토리 모드 보스전 음악: 유튜브 영상(스플래툰2 '진간장 시오카라부시')을 화면 구석의 작은 유튜브 플레이어로 튼다.
// 음원 파일은 저장소에 넣지 않는다(저작권). 영상을 불러오지 못하면(오프라인·차단·영상 삭제) 그냥 원래 배틀 음악이 나온다.

export const BOSS_VIDEO_ID = '0wq6AJy2i0I';
const API_URL = 'https://www.youtube.com/iframe_api';
const VOLUME = 70;
const PLAYING = 1, ENDED = 0;

let host = null;       // 플레이어를 담는 화면 구석의 상자
let player = null;     // YT.Player
let ready = false;
let failed = false;    // 불러오기 실패: 다시 시도하지 않고 배틀 음악을 쓴다
let loading = null;
let owner = null;      // 지금 음악을 튼 보스전(경기·웨이브)
let want = false;      // 지금 틀어야 하는지
let state = -1;

/** 유튜브 iframe API를 한 번만 불러온다. */
function loadApi() {
  loading ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = reject;
    document.head.append(script);
  });
  return loading;
}

/** 첫 사용자 입력 때(소리를 켤 수 있을 때) 플레이어를 미리 만들어 둔다. */
export function prepareBossMusic() {
  if (player || failed || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.id = 'boss-music';
  host.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('div');
  host.append(frame);
  document.body.append(host);
  loadApi().then(() => {
    player = new window.YT.Player(frame, {
      videoId: BOSS_VIDEO_ID, width: 200, height: 200,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0 },
      events: {
        onReady() { ready = true; player.setVolume(VOLUME); sync(); },
        onStateChange(e) {
          state = e.data;
          if (state === ENDED && want) { player.seekTo(0); player.playVideo(); } // 보스전 동안 반복
        },
        onError(e) { console.warn(`보스전 음악을 불러오지 못했습니다(유튜브 오류 ${e.data}). 배틀 음악을 씁니다.`); fail(); },
      },
    });
  }).catch(fail);
}

function fail() {
  failed = true;
  want = false;
  host?.classList.remove('on');
}

function sync() {
  if (!ready || failed) return;
  host.classList.toggle('on', want);
  if (want) player.playVideo();
  else player.pauseVideo();
}

/**
 * 매 프레임 호출. boss: 지금 보스전이면 그 보스전을 가리키는 값(같은 보스전이면 같은 값), 아니면 null.
 * paused·muted면 멈춘다. 새 보스전이 시작되면 처음부터 튼다.
 */
export function updateBossMusic(boss, { paused = false, muted = false } = {}) {
  if (failed) return;
  if (boss && boss !== owner) {
    owner = boss;
    if (ready) player.seekTo(0);
  }
  if (!boss) owner = null;
  const next = !!boss && !paused && !muted;
  if (next === want) return;
  want = next;
  if (want) prepareBossMusic();
  sync();
}

/** 보스전 음악이 실제로 나오는 중인지(그동안 배틀 음악은 끈다) */
export function bossMusicPlaying() {
  return want && ready && !failed && state === PLAYING;
}
