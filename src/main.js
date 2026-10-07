import { TICK, COUNTDOWN, TEAM_NAME } from './game/config.js';
import { SLOTS, createMatch, createInputs, cancelInputs, defaultLoadout } from './game/state.js';
import { step } from './game/update.js';
import { createAI, updateAI, AI_CHARACTERS, DIFFICULTY } from './game/ai.js';
import { createStoryMatch, checkpoint, waveLabel, COOP_SLOT } from './game/story.js';
import { createControls } from './input/pointer.js';
import { createKataKeys, KATA_CODES } from './input/kata.js';
import { glowingKey } from './game/gunkata.js';
import { attachKeyboard, applyKeyboard, clearKeys } from './input/keyboard.js';
import { pollGamepads, applyGamepads, clearGamepads } from './input/gamepad.js';
import { pollPadMenu } from './input/padmenu.js';
import { blockBrowserGestures } from './input/gestures.js';
import { loadAssets, createRenderer } from './render/canvas.js';
import { createScreens } from './ui/screens.js';
import { unlock, setMuted, playEvents, updateEngine, updateBattleMusic, restartMusic } from './audio/synth.js';
import {
  loadSettings, saveSettings, loadBalance, saveBalance, loadSingle, saveSingle, loadStory, saveStory,
  loadStorySave, saveStorySave, clearStorySave,
} from './storage/settings.js';
import { applyOverrides, overrides } from './game/balance.js';

const MAX_FRAME_MS = 100;
const MAX_STEPS_PER_FRAME = 6;
const RESULT_DELAY_MS = 900;

const settings = loadSettings();
// 밸런스 메뉴에서 바꿔 저장해 둔 수치를 가장 먼저 적용한다.
applyOverrides(loadBalance());
const loadout = defaultLoadout();
// 스토리 모드 2인 협동의 P2(지구방위팀) 선택. 2인 대결의 P2(ISB팀) 선택과는 따로 둔다.
const coopLoadout = { P2: { characterId: COOP_SLOT.characterId, weapon: COOP_SLOT.weapon, secondary: loadout.P2.secondary } };
// 'versus'(2인 대결) 또는 'single'(싱글 플레이, P2는 AI)
let mode = 'versus';
const single = loadSingle();
// 스토리 모드 웨이브별 요원 밸런스
const story = loadStory();
// 스토리 모드 이번 판을 어디서부터 시작했는지(이어하기·저장하기). 재대결은 이 자리부터 다시 한다. null이면 처음부터.
let resumeFrom = null;
let match = null;
let inputs = null;
let controls = null;
let renderer = null;
let ai = null;
// 키보드·터치·컨트롤러로 조작하는 사람 플레이어(싱글 플레이에서는 AI 자리 제외)
let humans = [];

// cutscene: 스토리 모드 엔딩 컷씬(입력은 받지 않지만 시간은 흐른다)
// killcam: 스토리 모드에서 요원을 쓰러뜨릴 때의 짧은 처치 컷씬, gunkata: 쓰러뜨린 요원·보스와의 건 카타(1·2·3·4 버튼만)
const active = () => match && ['playing', 'countdown', 'cutscene', 'killcam', 'gunkata'].includes(match.phase);

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

/** 자유 대전(싱글 플레이)에서 AI 자리 조작 패널 대신 보여 줄 안내(제목, 설명). */
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
/** 스토리 모드 2인 협동 P2 선택. 이어하기·저장한 판은 저장할 때의 인원을 따르고, 1인이면 null. */
function storyPartner() {
  if (resumeFrom) return resumeFrom.coop ? resumeFrom.pick2 : null;
  return single.storyPlayers === 2 ? coopLoadout.P2 : null;
}
/** 스토리 모드에 데려갈 AI 동료(직접 고른 캐릭터·주무기). 이어하기·저장한 판은 저장할 때의 동료. */
const storyAllies = () => (resumeFrom ? resumeFrom.allyPicks ?? [] : single.storyAllyPicks.slice(0, single.storyAllies));
/** 이번 틱에 움직일 AI들: 스토리 모드는 지금 경기장의 요원 전원, 자유 대전은 1명 */
const brains = () => (match?.story ? [...match.story.brains, ...match.story.allyBrains] : ai ? [ai] : []);

function startMatch() {
  unlock();
  if (!storyMode()) resumeFrom = null;
  match = storyMode() ? createStoryMatch(resumeFrom?.pick ?? loadout.P1, story, Date.now(), resumeFrom, storyPartner(), storyAllies())
    : createMatch(mode === 'single' ? singleLoadout() : loadout);
  inputs = createInputs(match.players);
  humans = match.players.filter((p) => !p.ai);
  const aiPlayer = match.players.find((p) => p.ai);
  ai = aiPlayer && !match.story ? createAI(aiPlayer.id, single.difficulty) : null;
  clearKeys();
  clearGamepads();
  const groups = { earth: document.querySelector('#controls-earth'), isb: document.querySelector('#controls-isb') };
  // 일시정지 버튼은 스토리 1인에서 패널 안으로 옮기므로, 패널을 새로 만들기 전에 제자리(두 패널 사이)로 돌려놓는다
  controlsEl.insertBefore(pauseBtn, groups.isb);
  // 스토리 모드 1인: 패널 하나가 화면 너비를 다 쓴다(이동키 왼쪽 끝, 발사키 오른쪽 끝, 무기 버튼은 발사키 옆)
  const solo = !!match.story && !match.story.coop;
  controlsEl.classList.toggle('solo', solo);
  // 스토리 모드 2인 협동의 P2는 지구방위팀이지만 조작 패널은 오른쪽(평소 P2 자리)에 둔다
  controls = createControls(groups, humans, inputs, (p) => (p.team === 'earth' && p.id === 'P2' ? 'isb' : p.team), { wide: solo });
  if (solo) groups.earth.querySelector('.panel-mid').append(pauseBtn);
  if (!match.story && aiPlayer) groups[aiPlayer.team].replaceChildren(aiPanel(aiPlayer.team, `${aiPlayer.id} · ${aiPlayer.name}`, `난이도 ${DIFFICULTY[single.difficulty].name}`));
  renderer.reset();
  restartMusic();
  screens.show('game');
}

function pause() {
  if (!active()) return;
  cancelAllInput();
  match.phase = 'paused';
  screens.showPause(!!match.story);
}

function resume() {
  // 컷씬·킬캠·건 카타 중에 멈췄으면 카운트다운 없이 그 장면으로 돌아간다
  if (match.cutscene || match.killcam || match.gunkata) {
    match.phase = match.cutscene ? 'cutscene' : match.killcam ? 'killcam' : 'gunkata';
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

/** 일시정지 화면 '저장하기': 지금 웨이브(웨이브 사이라면 다음 웨이브)와 체력, 캐릭터 선택을 저장한다. */
function saveStoryProgress() {
  const point = match?.story && checkpoint(match);
  if (!point) {
    screens.setSaveStatus('지금은 저장할 수 없습니다.');
    return;
  }
  const [hero, partner] = match.players.filter((p) => !p.ai);
  const pickOf = (p) => ({ characterId: p.characterId, weapon: p.primary, secondary: p.secondary });
  const save = { ...point, pick: pickOf(hero), savedAt: Date.now() };
  if (partner) save.pick2 = pickOf(partner);
  saveStorySave(save);
  resumeFrom = save;
  screens.setContinue(save);
  const hp = partner ? `체력 P1 ${point.hp} · P2 ${point.hp2}` : `체력 ${point.hp}`;
  screens.setSaveStatus(`저장했습니다: ${point.label} · ${hp}. 메인 메뉴의 '스토리 이어하기'로 이어서 할 수 있어요.`);
}

/** 저장한 곳부터 스토리 모드 이어하기 */
function continueStory() {
  const save = loadStorySave();
  if (!save) { screens.setContinue(null); return; }
  mode = 'single';
  single.mode = 'story';
  single.storyPlayers = save.coop ? 2 : 1;
  single.storyAllies = save.allies ?? 0;
  if (save.allyPicks) save.allyPicks.forEach((p, i) => { single.storyAllyPicks[i] = { ...p }; });
  saveSingle(single);
  loadout.P1 = { ...loadout.P1, ...save.pick };
  if (save.coop) coopLoadout.P2 = { ...coopLoadout.P2, ...save.pick2 };
  resumeFrom = save;
  startMatch();
}

function showSetup() {
  unlock();
  match = null;
  resumeFrom = null;
  if (mode === 'single') screens.showSingle(SLOTS[0], loadout, single, story, coopLoadout);
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
  onCoopPick(slotId, key, value) {
    coopLoadout[slotId] = { ...coopLoadout[slotId], [key]: value };
  },
  onStart: startMatch,
  onSave: saveStoryProgress,
  onContinue: continueStory,
  onClearSave() { clearStorySave(); resumeFrom = null; screens.setContinue(null); },
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
screens.setContinue(loadStorySave());
setMuted(settings.muted);
screens.syncSettings(settings);

blockBrowserGestures(document.querySelector('#game'));
const controlsEl = document.querySelector('#controls');
const pauseBtn = document.querySelector('#pause-btn');
/** 건 카타 버튼(터치·키보드 숫자 1~4): 사람 플레이어 입력 칸에 넣으면 step()이 읽는다 */
function pressKata(key) {
  if (match?.phase !== 'gunkata' || !humans.length) return;
  inputs[humans[0].id].kata = key;
}
const kataKeys = createKataKeys(document.querySelector('#kata-keys'), pressKata);
window.addEventListener('keydown', (e) => {
  if (!KATA_CODES[e.code] || match?.phase !== 'gunkata') return;
  e.preventDefault();
  if (!e.repeat) pressKata(KATA_CODES[e.code]);
});
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
          screens.announce(`${waveLabel(e.wave)} 시작`);
        }
        if (e.type === 'wave-clear') screens.announce(`${waveLabel(e.wave)} 클리어`);
        if (e.type === 'stage') screens.announce('2스테이지 복도. 체력이 모두 회복되었습니다.');
        if (e.type === 'gunkata') screens.announce('건 카타 모드! 빛나는 버튼 1, 2, 3, 4를 0.5초 안에 누르세요.');
        if (e.type === 'kata-warn') screens.announce(`${e.key}번`);
        if (e.type !== 'down') continue;
        const p = match.players.find((pl) => pl.id === e.playerId);
        screens.announce(`${TEAM_NAME[p.team]} ${p.id} ${p.name} 쓰러짐`);
      }
      if (match.phase === 'result') {
        cancelAllInput();
        // 스토리를 끝까지 깨면 저장은 지운다(지면 남겨 두어 이어할 수 있다)
        if (match.story && match.winner === 'earth') {
          clearStorySave();
          resumeFrom = null;
          screens.setContinue(null);
        }
        // 마지막 한 방(즉사기 레이저 등)이 보이도록 결과 화면은 조금 뒤에 띄운다
        const ended = match;
        setTimeout(() => { if (match === ended) screens.showResult(ended); }, RESULT_DELAY_MS);
      }
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  } else {
    accumulator = 0;
  }
  // 건 카타 동안에는 조작 패널 대신 1·2·3·4 버튼, 눌러야 할 버튼은 빛난다
  controlsEl.classList.toggle('kata', !!match?.gunkata);
  kataKeys.sync(match?.phase === 'gunkata' ? glowingKey(match.gunkata) : null);
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
