import { TICK, COUNTDOWN, TEAM_NAME } from './game/config.js';
import { SLOTS, createMatch, createInputs, cancelInputs, defaultLoadout } from './game/state.js';
import { step } from './game/update.js';
import { createAI, updateAI, AI_CHARACTERS, DIFFICULTY } from './game/ai.js';
import { createControls } from './input/pointer.js';
import { attachKeyboard, applyKeyboard, clearKeys } from './input/keyboard.js';
import { blockBrowserGestures } from './input/gestures.js';
import { loadAssets, createRenderer } from './render/canvas.js';
import { createScreens } from './ui/screens.js';
import { unlock, setMuted, playEvents, updateEngine } from './audio/synth.js';
import {
  loadSettings, saveSettings, loadBalance, saveBalance, loadSingle, saveSingle,
} from './storage/settings.js';
import { applyOverrides, overrides } from './game/balance.js';

const MAX_FRAME_MS = 100;
const MAX_STEPS_PER_FRAME = 6;

const settings = loadSettings();
// 밸런스 메뉴에서 바꿔 저장해 둔 수치를 가장 먼저 적용한다.
applyOverrides(loadBalance());
const loadout = defaultLoadout();
// 'versus'(2인 대결) 또는 'single'(싱글 플레이, P2는 AI)
let mode = 'versus';
const single = loadSingle();
let match = null;
let inputs = null;
let controls = null;
let renderer = null;
let ai = null;
// 키보드·터치로 조작하는 사람 플레이어(싱글 플레이에서는 AI 자리 제외)
let humans = [];

const active = () => match && (match.phase === 'playing' || match.phase === 'countdown');

function cancelAllInput() {
  controls.cancelAll();
  clearKeys();
  cancelInputs(inputs);
}

/** 싱글 플레이 경기 선택: P1은 플레이어가 고른 대로, P2는 요원 중 무작위 + AI 설정 */
function singleLoadout() {
  const damage = Object.fromEntries(Object.entries(single.aiDamage).filter(([, v]) => Number.isFinite(v)));
  return {
    P1: loadout.P1,
    P2: {
      characterId: AI_CHARACTERS[Math.floor(Math.random() * AI_CHARACTERS.length)],
      weapon: single.aiWeapon, ai: true, maxHp: single.aiHp, bulletSpeedScale: single.aiBulletSpeed / 100, damage,
    },
  };
}

/** 싱글 플레이에서 AI 자리 조작 패널 대신 보여 줄 안내 */
function aiPanel(player) {
  const panel = document.createElement('div');
  panel.className = `panel ai-panel team-${player.team}`;
  const head = document.createElement('b');
  head.textContent = `${player.id} · ${player.name}`;
  const info = document.createElement('small');
  info.textContent = `난이도 ${DIFFICULTY[single.difficulty].name}`;
  panel.append(head, info);
  return panel;
}

function startMatch() {
  unlock();
  match = createMatch(mode === 'single' ? singleLoadout() : loadout);
  inputs = createInputs(match.players);
  humans = match.players.filter((p) => !p.ai);
  const aiPlayer = match.players.find((p) => p.ai);
  ai = aiPlayer ? createAI(aiPlayer.id, single.difficulty) : null;
  clearKeys();
  const groups = { earth: document.querySelector('#controls-earth'), isb: document.querySelector('#controls-isb') };
  controls = createControls(groups, humans, inputs);
  if (aiPlayer) groups[aiPlayer.team].replaceChildren(aiPanel(aiPlayer));
  renderer.reset();
  screens.show('game');
}

function pause() {
  if (!active()) return;
  cancelAllInput();
  match.phase = 'paused';
  screens.show('pause');
}

function resume() {
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
  if (mode === 'single') screens.showSingle(SLOTS[0], loadout, single);
  else screens.showReady(SLOTS, loadout);
}

const screens = createScreens({
  /** 캐릭터 선택: 지금 모드의 준비 화면으로 */
  onSetup: showSetup,
  onVersus() { mode = 'versus'; showSetup(); },
  onSingle() { mode = 'single'; showSetup(); },
  onSingleChange(value) { saveSingle(value); },
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
attachKeyboard(() => (active() ? humanInputs() : null), () => (match?.phase === 'paused' ? resume() : pause()));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);

let last = performance.now();
let accumulator = 0;
function frame(now) {
  const frameMs = Math.min(now - last, MAX_FRAME_MS);
  last = now;
  if (active()) {
    accumulator += frameMs / 1000;
    let steps = 0;
    while (accumulator >= TICK && steps < MAX_STEPS_PER_FRAME && active()) {
      applyKeyboard(inputs, humans, TICK);
      if (ai) updateAI(ai, match, inputs, TICK);
      const events = step(match, inputs, TICK);
      accumulator -= TICK;
      steps++;
      renderer.addEvents(events);
      playEvents(events);
      for (const e of events) {
        if (e.type !== 'down') continue;
        const p = match.players.find((pl) => pl.id === e.playerId);
        screens.announce(`${TEAM_NAME[p.team]} ${p.id} ${p.name} 쓰러짐`);
      }
      if (match.phase === 'result') {
        cancelAllInput();
        screens.showResult(match);
      }
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  } else {
    accumulator = 0;
  }
  if (match) {
    renderer.draw(match, inputs, frameMs / 1000, now / 1000, settings.reducedMotion);
    controls.sync(match.players);
  }
  updateEngine(match?.phase === 'playing' ? match.jet : null);
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
