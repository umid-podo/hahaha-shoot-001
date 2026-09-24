import { TICK, COUNTDOWN, TEAM_NAME } from './game/config.js';
import { SLOTS, createMatch, createInputs, cancelInputs, defaultLoadout } from './game/state.js';
import { step } from './game/update.js';
import { createControls } from './input/pointer.js';
import { attachKeyboard, applyKeyboard, clearKeys } from './input/keyboard.js';
import { loadAssets, createRenderer } from './render/canvas.js';
import { createScreens } from './ui/screens.js';
import { unlock, setMuted, playEvents, updateEngine } from './audio/synth.js';
import { loadSettings, saveSettings } from './storage/settings.js';

const MAX_FRAME_MS = 100;
const MAX_STEPS_PER_FRAME = 6;

const settings = loadSettings();
let playerCount = 2;
let loadout = defaultLoadout(4);
let match = null;
let inputs = null;
let controls = null;
let renderer = null;

const active = () => match && (match.phase === 'playing' || match.phase === 'countdown');

function cancelAllInput() {
  controls.cancelAll();
  clearKeys();
  cancelInputs(inputs);
}

function startMatch() {
  unlock();
  match = createMatch(playerCount, loadout);
  inputs = createInputs(match.players);
  clearKeys();
  controls = createControls(
    { earth: document.querySelector('#controls-earth'), isb: document.querySelector('#controls-isb') },
    match.players, inputs);
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

const screens = createScreens({
  onSelectCount(count) {
    unlock();
    playerCount = count;
    screens.showReady(SLOTS.slice(0, count), loadout);
  },
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
});
setMuted(settings.muted);
screens.syncSettings(settings);

attachKeyboard(() => (active() ? inputs : null), () => (match?.phase === 'paused' ? resume() : pause()));
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
      applyKeyboard(inputs, match.players, TICK);
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
  if (match) renderer.draw(match, inputs, frameMs / 1000, now / 1000, settings.reducedMotion);
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
