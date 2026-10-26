// 스토리 모드 장면 음악: 보스전·공중전마다 정해 둔 유튜브 영상을 화면 구석의 작은 유튜브 플레이어로 튼다.
// 음원 파일은 저장소에 넣지 않는다(저작권). 영상을 불러오지 못하면(오프라인·차단·영상 삭제) 그냥 원래 배틀 음악이 나온다.

/** 장면별 유튜브 영상 id. 바꾸려면 여기만 고친다. */
export const MUSIC = {
  boss: '0wq6AJy2i0I',      // 보스전 기본: 스플래툰2 '진간장 시오카라부시'
  wilson: 'OsOWi_3RFu4',    // 윌슨 요원 보스전: The Four Horsemen
  sky: 'h-6Yy_6bLv4',       // 공중전(3스테이지 하늘): Sonic Superstars - Speed Jungle Zone Act
  deathstar: 'Y5oxGRh0cIY', // 데스스타 보스전: Sonic Superstars - late game Boss
};
const API_URL = 'https://www.youtube.com/iframe_api';
const VOLUME = 70;
const PLAYING = 1, ENDED = 0;

let host = null;       // 플레이어를 담는 화면 구석의 상자
let player = null;     // YT.Player
let ready = false;
let failed = false;    // 불러오기 실패: 다시 시도하지 않고 배틀 음악을 쓴다
let loading = null;
let owner = null;      // 지금 음악을 튼 장면(같은 장면이면 같은 값)
let video = null;      // 플레이어에 올려 둔 영상 id
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

/** 스토리 모드를 시작할 때 플레이어를 미리 만들어 둔다. */
export function prepareStoryMusic() {
  if (host || failed || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.id = 'story-music';
  host.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('div');
  host.append(frame);
  document.body.append(host);
  loadApi().then(() => {
    player = new window.YT.Player(frame, {
      videoId: video ?? MUSIC.boss, width: 200, height: 200,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0 },
      events: {
        onReady() { ready = true; video ??= MUSIC.boss; player.setVolume(VOLUME); sync(true); },
        onStateChange(e) {
          state = e.data;
          if (state === ENDED && want) { player.seekTo(0); player.playVideo(); } // 그 장면 동안 반복
        },
        onError(e) { console.warn(`장면 음악을 불러오지 못했습니다(유튜브 오류 ${e.data}). 배틀 음악을 씁니다.`); fail(); },
      },
    });
  }).catch(fail);
}

function fail() {
  failed = true;
  want = false;
  host?.classList.remove('on');
}

/** 플레이어를 지금 상태에 맞춘다. fresh면 지금 장면의 영상을 처음부터. */
function sync(fresh = false) {
  if (!ready || failed) return;
  host.classList.toggle('on', want);
  const id = owner?.video;
  if (want && id && (fresh || id !== player.getVideoData?.().video_id)) {
    player.loadVideoById(id); // 새 장면: 그 영상을 처음부터 튼다
    return;
  }
  if (want) player.playVideo();
  else player.pauseVideo();
}

/**
 * 매 프레임 호출. scene: 지금 음악을 틀 장면 { key, video }(key는 같은 장면이면 같은 문자열), 없으면 null.
 * paused·muted면 멈춘다. 새 장면이 시작되면 그 영상을 처음부터 튼다.
 */
export function updateStoryMusic(scene, { paused = false, muted = false } = {}) {
  if (failed) return;
  let fresh = false;
  if (scene && scene.key !== owner?.key) {
    owner = scene;
    video = scene.video;
    fresh = true;
  }
  if (!scene) owner = null;
  const next = !!scene && !paused && !muted;
  if (next === want && !fresh) return;
  want = next;
  if (want) prepareStoryMusic();
  if (fresh && !want) { if (ready) player.cueVideoById(video); return; }
  sync(fresh);
}

/** 장면 음악이 실제로 나오는 중인지(그동안 배틀 음악은 끈다) */
export function storyMusicPlaying() {
  return want && ready && !failed && state === PLAYING;
}
