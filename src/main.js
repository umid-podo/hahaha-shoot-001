import { TICK, COUNTDOWN, TEAM_NAME } from './game/config.js';
import { SLOTS, createMatch, createInputs, cancelInputs, defaultLoadout } from './game/state.js';
import { step } from './game/update.js';
import { createAI, updateAI, AI_CHARACTERS, DIFFICULTY } from './game/ai.js';
import { createStoryMatch, WAVES } from './game/story.js';
import { createControls } from './input/pointer.js';
import { attachKeyboard, applyKeyboard, clearKeys } from './input/keyboard.js';
import { pollGamepads, applyGamepads, clearGamepads } from './input/gamepad.js';
import { pollPadMenu } from './input/padmenu.js';
import { blockBrowserGestures } from './input/gestures.js';
import { loadAssets, createRenderer } from './render/canvas.js';
import { createScreens } from './ui/screens.js';
import { unlock, setMuted, playEvents, updateEngine, updateBattleMusic, restartMusic } from './audio/synth.js';
import {
  loadSettings, saveSettings, loadBalance, saveBalance, loadSingle, saveSingle, loadStory, saveStory,
} from './storage/settings.js';
import { applyOverrides, overrides } from './game/balance.js';

const MAX_FRAME_MS = 100;
const MAX_STEPS_PER_FRAME = 6;
const RESULT_DELAY_MS = 900;

const settings = loadSettings();
// 밸런스 메뉴에서 바꿔 저장해 둔 수치를 가장 먼저 적용한다.
applyOverrides(loadBalance());
const loadout = defaultLoadout();
// 'versus'(2인 대결) 또는 'single'(싱글 플레이, P2는 AI)
let mode = 'versus';
const single = loadSingle();
// 스토리 모드 웨이브별 요원 밸런스
const story = loadStory();
let match = null;
let inputs = null;
let controls = null;
let renderer = null;
let ai = null;
// 키보드·터치·컨트롤러로 조작하는 사람 플레이어(싱글 플레이에서는 AI 자리 제외)
let humans = [];

// cutscene: 스토리 모드 엔딩 컷씬(입력은 받지 않지만 시간은 흐른다)
const active = () => match && ['playing', 'countdown', 'cutscene'].includes(match.phase);

function cancelAllInput() {
  controls.cancelAll();
  clearKeys();
  clearGamepads();
  cancelInputs(inputs);
}

/** 싱글 플레이 경기 선택: P1은 플레이어가 고른 대로, P2는 요원 중 무작위 + AI 설정 */
function singleLoadout() {
  const damage = Object.fromEntries(Object.entries(single.aiDamage).filter(([, v]) => Number.isFinite(v)));
  return {
    P1: loadout.P1,
    P2: {
      characterId: AI_CHARACTERS[Math.floor(Math.random() * AI_CHARACTERS.length)],
      weapon: single.aiWeapon, secondary: single.aiSecondary, ai: true, radius: single.aiRadius, maxHp: single.aiHp, bulletSpeedScale: single.aiBulletSpeed / 100, damage,
    },
  };
}

/** 싱글 플레이에서 AI 자리 조작 패널 대신 보여 줄 안내(제목, 설명). 스토리 모드는 웨이브가 바뀌면 설명을 고친다. */
function aiPanel(team, title, text) {
  const panel = document.createElement('div');
  panel.className = `panel ai-panel team-${team}`;
  const head = document.createElement('b');
  head.textContent = title;
  const info = document.createElement('small');
  info.className = 'ai-panel-info';
  info.textContent = text;
  panel.append(head, info);
  return panel;
}

const storyMode = () => mode === 'single' && single.mode === 'story';
/** 이번 틱에 움직일 AI들: 스토리 모드는 지금 경기장의 요원 전원, 자유 대전은 1명 */
const brains = () => (match?.story ? match.story.brains : ai ? [ai] : []);

function startMatch() {
  unlock();
  match = storyMode() ? createStoryMatch(loadout.P1, story) : createMatch(mode === 'single' ? singleLoadout() : loadout);
  inputs = createInputs(match.players);
  humans = match.players.filter((p) => !p.ai);
  const aiPlayer = match.players.find((p) => p.ai);
  ai = aiPlayer && !match.story ? createAI(aiPlayer.id, single.difficulty) : null;
  clearKeys();
  clearGamepads();
  const groups = { earth: document.querySelector('#controls-earth'), isb: document.querySelector('#controls-isb') };
  controls = createControls(groups, humans, inputs);
  if (match.story) groups.isb.replaceChildren(aiPanel('isb', '스토리 모드 · ISB팀', WAVES[0].title));
  else if (aiPlayer) groups[aiPlayer.team].replaceChildren(aiPanel(aiPlayer.team, `${aiPlayer.id} · ${aiPlayer.name}`, `난이도 ${DIFFICULTY[single.difficulty].name}`));
  renderer.reset();
  restartMusic();
  screens.show('game');
}

function pause() {
  if (!active()) return;
  cancelAllInput();
  match.phase = 'paused';
  screens.show('pause');
}

function resume() {
  // 컷씬 중에 멈췄으면 카운트다운 없이 컷씬으로 돌아간다
  if (match.cutscene) {
    match.phase = 'cutscene';
    screens.show('game');
    return;
  }
  match.phase = 'countdown';
  match.countdown = COUNTDOWN;
  screens.show('game');
}

function toggle(key) {
  settings[key] = !settings[key];
  saveSettings(settings);
  setMuted(settings.muted);
  screens.syncSettings(settings);
}

function showSetup() {
  unlock();
  match = null;
  if (mode === 'single') screens.showSingle(SLOTS[0], loadout, single, story);
  else screens.showReady(SLOTS, loadout);
}

const screens = createScreens({
  /** 캐릭터 선택: 지금 모드의 준비 화면으로 */
  onSetup: showSetup,
  onVersus() { mode = 'versus'; showSetup(); },
  onSingle() { mode = 'single'; showSetup(); },
  onSingleChange(value) { saveSingle(value); },
  onStoryChange(value) { saveStory(value); },
  onPick(slotId, key, value) {
    loadout[slotId] = { ...loadout[slotId], [key]: value };
  },
  onStart: startMatch,
  onMenu() { match = null; screens.show('menu'); },
  onPause: pause,
  onResume: resume,
  onRetryLoad: boot,
  onToggleMute: () => toggle('muted'),
  onToggleMotion: () => toggle('reducedMotion'),
  onBalanceChange(values) {
    saveBalance(values);
    screens.setBalanceStatus(Object.keys(values).length);
  },
});
screens.setBalanceStatus(Object.keys(overrides()).length);
setMuted(settings.muted);
screens.syncSettings(settings);

blockBrowserGestures(document.querySelector('#game'));
// 키보드는 사람 플레이어 자리에만 입력한다(싱글 플레이의 AI 자리 키는 무시).
const humanInputs = () => Object.fromEntries(humans.map((p) => [p.id, inputs[p.id]]));
const togglePause = () => (match?.phase === 'paused' ? resume() : pause());
attachKeyboard(() => (active() ? humanInputs() : null), togglePause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);

let last = performance.now();
let accumulator = 0;
function frame(now) {
  const frameMs = Math.min(now - last, MAX_FRAME_MS);
  last = now;
  // 컨트롤러는 이벤트가 없어 매 프레임 읽는다(Start는 경기 밖에서도 일시정지 풀기에 쓴다).
  pollGamepads(humans, active() ? inputs : null, togglePause);
  // 경기 밖(메뉴·준비·일시정지·결과·밸런스 화면)에서는 컨트롤러로 버튼을 고른다(A 선택, B 취소).
  pollPadMenu(!active(), frameMs / 1000);
  if (active()) {
    accumulator += frameMs / 1000;
    let steps = 0;
    while (accumulator >= TICK && steps < MAX_STEPS_PER_FRAME && active()) {
      applyKeyboard(inputs, humans, TICK);
      applyGamepads(inputs, humans, TICK);
      for (const brain of brains()) updateAI(brain, match, inputs, TICK);
      const events = step(match, inputs, TICK);
      accumulator -= TICK;
      steps++;
      renderer.addEvents(events);
      playEvents(events);
      for (const e of events) {
        if (e.type === 'wave') {
          screens.announce(`${e.title} 시작`);
          const info = document.querySelector('#controls-isb .ai-panel-info');
          if (info) info.textContent = e.title;
        }
        if (e.type === 'wave-clear') screens.announce(`${WAVES[e.wave].title} 클리어`);
        if (e.type !== 'down') continue;
        const p = match.players.find((pl) => pl.id === e.playerId);
        screens.announce(`${TEAM_NAME[p.team]} ${p.id} ${p.name} 쓰러짐`);
      }
      if (match.phase === 'result') {
        cancelAllInput();
        // 마지막 한 방(즉사기 레이저 등)이 보이도록 결과 화면은 조금 뒤에 띄운다
        const ended = match;
        setTimeout(() => { if (match === ended) screens.showResult(ended); }, RESULT_DELAY_MS);
      }
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  } else {
    accumulator = 0;
  }
  if (match) {
    renderer.draw(match, inputs, frameMs / 1000, now / 1000, settings.reducedMotion);
    controls.sync(match.players, match.tick * TICK);
  }
  updateEngine(match?.phase === 'playing' ? match.jet : null);
  // 신나는 전투 음악: 카운트다운부터 경기·컷씬 동안. 일시정지·결과·메뉴에서는 작아지며 멈춘다.
  updateBattleMusic(active());
  requestAnimationFrame(frame);
}

async function boot() {
  screens.setLoading();
  try {
    const assets = await loadAssets();
    renderer = createRenderer(document.querySelector('#arena'), document.querySelector('#arena-wrap'), assets);
    screens.setLoaded();
    requestAnimationFrame(frame);
  } catch (error) {
    screens.setLoadError(error.message);
  }
}
boot();
