// 스토리 모드 장면 음악: 보스전·공중전마다 정해 둔 유튜브 영상을 화면 구석의 작은 유튜브 플레이어로 튼다.
// 음원 파일은 저장소에 넣지 않는다(저작권). 영상을 불러오지 못하면(오프라인·차단·영상 삭제) 그냥 원래 배틀 음악이 나온다.
// 브라우저가 소리 나는 자동 재생을 막으면(특히 아이폰·아이패드) 플레이어를 크게 보여 주고 "눌러서 음악 켜기"를 띄운다.
// 플레이어를 한 번 직접 누르면 그 뒤로는 장면마다 자동으로 나온다.

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
const BLOCKED_AFTER = 2500; // 틀라고 한 뒤 이만큼(ms) 지나도 안 나오면 자동 재생이 막힌 것으로 본다
const NOTE_TIME = 6000;     // 불러오기 실패 안내를 보여 주는 시간(ms)

let host = null;       // 플레이어를 담는 화면 구석의 상자
let note = null;       // 상자 아래 안내 글
let player = null;     // YT.Player
let ready = false;
let failed = null;     // 불러오기 실패 이유(안내 글). 실패하면 다시 시도하지 않고 배틀 음악을 쓴다
let loading = null;
let owner = null;      // 지금 음악을 튼 장면(같은 장면이면 같은 값)
let video = null;      // 플레이어에 올려 둔 영상 id
let want = false;      // 지금 틀어야 하는지
let wantSince = 0;     // 틀라고 한 때
let state = -1;
let noteUntil = 0;

/** 유튜브 iframe API를 한 번만 불러온다. */
function loadApi() {
  loading ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => reject(new Error('유튜브에 연결할 수 없어요'));
    document.head.append(script);
    // 응답이 없으면(차단·오프라인) 10초 뒤 포기
    setTimeout(() => reject(new Error('유튜브에 연결할 수 없어요')), 10000);
  });
  return loading;
}

/** 스토리 모드를 시작할 때 플레이어를 미리 만들어 둔다. */
export function prepareStoryMusic() {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.id = 'story-music';
  const box = document.createElement('div');
  box.className = 'story-music-player';
  const frame = document.createElement('div');
  box.append(frame);
  note = document.createElement('p');
  note.className = 'story-music-note';
  note.setAttribute('role', 'status');
  host.append(box, note);
  document.body.append(host);
  loadApi().then(() => {
    player = new window.YT.Player(frame, {
      videoId: video ?? MUSIC.boss, width: 200, height: 200,
      playerVars: { autoplay: 0, controls: 1, disablekb: 1, fs: 0, playsinline: 1, rel: 0 },
      events: {
        onReady() { ready = true; video ??= MUSIC.boss; player.setVolume(VOLUME); player.unMute(); sync(true); },
        onStateChange(e) {
          state = e.data;
          if (state === ENDED && want) { player.seekTo(0); player.playVideo(); } // 그 장면 동안 반복
          // 장면이 끝났는데 (직접 눌러서) 재생되면 다시 멈춘다
          if (state === PLAYING && !want) player.pauseVideo();
          show();
        },
        onError(e) {
          const reason = { 2: '영상 주소가 잘못됐어요', 5: '이 브라우저에서 재생할 수 없어요', 100: '영상이 지워졌어요',
            101: '유튜브가 이 사이트에서의 재생을 막았어요', 150: '유튜브가 이 사이트에서의 재생을 막았어요' }[e.data];
          fail(`${reason ?? '영상을 불러올 수 없어요'} (유튜브 오류 ${e.data})`);
        },
      },
    });
  }).catch((err) => fail(err.message));
}

function fail(reason) {
  failed = reason;
  console.warn(`장면 음악: ${reason}. 배틀 음악을 씁니다.`);
  noteUntil = want ? performance.now() + NOTE_TIME : 0;
  show();
}

/**
 * 상자 모양: 음악이 나오는 중이면 작게(눌리지 않음), 자동 재생이 막혔으면 크게 보이며 "눌러서 음악 켜기",
 * 실패했으면 잠깐 이유를 보여 준다.
 */
function show() {
  if (!host) return;
  const now = performance.now();
  const blocked = want && ready && !failed && state !== PLAYING && now - wantSince > BLOCKED_AFTER;
  const error = !!failed && now < noteUntil;
  host.classList.toggle('on', (want && !failed) || error);
  host.classList.toggle('tap', blocked);
  host.classList.toggle('error', error);
  note.textContent = error ? `♪ 장면 음악을 틀 수 없어요: ${failed}` : blocked ? '♪ 눌러서 음악 켜기' : '';
}

/** 플레이어를 지금 상태에 맞춘다. fresh면 지금 장면의 영상을 처음부터. */
function sync(fresh = false) {
  if (!ready || failed) return;
  const id = owner?.video;
  if (want && id && (fresh || id !== player.getVideoData?.().video_id)) player.loadVideoById(id); // 새 장면: 처음부터
  else if (want) player.playVideo();
  else player.pauseVideo();
}

/**
 * 매 프레임 호출. scene: 지금 음악을 틀 장면 { key, video }(key는 같은 장면이면 같은 문자열), 없으면 null.
 * paused·muted면 멈춘다. 새 장면이 시작되면 그 영상을 처음부터 튼다.
 */
export function updateStoryMusic(scene, { paused = false, muted = false } = {}) {
  let fresh = false;
  if (scene && scene.key !== owner?.key) {
    owner = scene;
    video = scene.video;
    fresh = true;
    if (failed) noteUntil = performance.now() + NOTE_TIME; // 새 장면마다 왜 안 나오는지 잠깐 알려 준다
  }
  if (!scene) owner = null;
  const next = !!scene && !paused && !muted;
  if (next !== want || fresh) {
    if ((next && !want) || (next && fresh)) wantSince = performance.now();
    want = next;
    if (want) prepareStoryMusic();
    if (fresh && !want) { if (ready && !failed) player.cueVideoById(video); }
    else sync(fresh);
  }
  show();
}

/** 장면 음악이 실제로 나오는 중인지(그동안 배틀 음악은 끈다) */
export function storyMusicPlaying() {
  return want && ready && !failed && state === PLAYING;
}
