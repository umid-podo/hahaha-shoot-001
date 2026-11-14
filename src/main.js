import { TICK, COUNTDOWN, TEAM_NAME, KATA } from './game/config.js';
import { SLOTS, createMatch, createInputs, cancelInputs, defaultLoadout } from './game/state.js';
import { step } from './game/update.js';
import { createAI, updateAI, AI_CHARACTERS, DIFFICULTY } from './game/ai.js';
import { createStoryMatch, checkpoint, waveLabel, COOP_SLOT, STAGES, stageStart, nextStageOf, WAVES, ENDLESS } from './game/story.js';
import { createControls } from './input/pointer.js';
import { createKataKeys, KATA_CODES } from './input/kata.js';
import { glowingKey, createTrainingMatch } from './game/gunkata.js';
import { attachKeyboard, applyKeyboard, clearKeys } from './input/keyboard.js';
import { applyView, attachMouse } from './input/view.js';
import { pollGamepads, applyGamepads, clearGamepads } from './input/gamepad.js';
import { pollPadMenu } from './input/padmenu.js';
import { blockBrowserGestures } from './input/gestures.js';
import { loadAssets, createRenderer } from './render/canvas.js';
import { createWorld3D } from './render/world3d.js';
import { createScreens } from './ui/screens.js';
import { modStore } from './game/mods.js';
import { addWin, rankMessage } from './game/rank.js';
import { unlock, setMuted, playEvents, updateEngine, updateBattleMusic, restartMusic } from './audio/synth.js';
import {
  loadSettings, saveSettings, loadBalance, saveBalance, loadBalanceDefaults, saveBalanceDefaults, loadSingle, saveSingle, loadStory, saveStory,
  loadStorySave, saveStorySave, clearStorySave, useAccount, lastAccount, currentAccount, loadRank, saveRank,
} from './storage/settings.js';
import { applyOverrides, applyCustomDefaults, changedCount } from './game/balance.js';

const MAX_FRAME_MS = 100;
const MAX_STEPS_PER_FRAME = 6;
const RESULT_DELAY_MS = 900;
// 2인 대결에서 이긴 사람이 승리 포즈를 취하는 동안(결과 화면은 그 뒤에)
const VICTORY_MS = 3600;

const settings = loadSettings();
// 밸런스 메뉴에서 바꿔 저장해 둔 수치를 가장 먼저 적용한다.
applyCustomDefaults(loadBalanceDefaults()); // '내 기본값'(노란 표시·기본값으로의 기준)
applyOverrides(loadBalance());
const loadout = defaultLoadout();
// 스토리 모드 2인 협동의 P2(지구방위팀) 선택. 2인 대결의 P2(ISB팀) 선택과는 따로 둔다.
const coopLoadout = { P2: { characterId: COOP_SLOT.characterId, weapon: COOP_SLOT.weapon, secondary: loadout.P2.secondary } };
// 'versus'(2인 대결), 'single'(싱글 플레이, P2는 AI) 또는 'training'(건 카타 수련장)
let mode = 'versus';
const single = loadSingle();
// 스토리 모드 웨이브별 요원 밸런스
const story = loadStory();
// 스토리 모드 이번 판을 어디서부터 시작했는지(이어하기·저장하기). 재대결은 이 자리부터 다시 한다. null이면 처음부터.
let resumeFrom = null;
// 이번 스토리 판을 처음부터 스테이지 건너뛰기 없이 해 왔는지(끝까지 깨면 랭크 +1레벨)
let storyClean = false;
// 지금 계정의 랭크 { tier, level, wins }
let rank = null;
// 연속 플레이에서 방금 오른 랭크 안내(코인 알림에 함께 보인다)
let endlessRankMsg = '';
let match = null;
let inputs = null;
let controls = null;
let renderer = null;
/** 경기 화면 위에 잠깐 뜨는 코인 알림 */
function coinToast(text) {
  const el = document.querySelector('#coin-toast');
  el.textContent = `🪙 ${text}`;
  el.hidden = false;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(coinToast.timer);
  coinToast.timer = setTimeout(() => { el.hidden = true; }, 3200);
  screens.announce(text);
}
const worldCanvas = document.querySelector('#world');
// 1인칭 3D 화면(three.js). renderer(2D 캔버스)는 그 위에 HUD·자막·건 카타를 그린다.
let world = null;
let ai = null;
// 키보드·터치·컨트롤러로 조작하는 사람 플레이어(싱글 플레이에서는 AI 자리 제외)
let humans = [];
/**
 * 지금 틀 배경음악(music.js SONGS). 스토리 모드의 보스전(보스가 오는 장면부터 싸우는 동안·도발 장면·보스와의 건 카타까지)은
 * 보스전 곡(윌슨 요원·데스스타는 전용 곡), 공중전(3스테이지 하늘, 데스스타 전까지)은 공중전 곡, 그 밖(컷씬 포함)은 배틀 음악.
 */
function musicSong() {
  const story = match?.story;
  if (!story || match.cutscene || match.phase === 'result') return 'battle';
  const boss = WAVES[story.wave].boss;
  if (boss && ['drop', 'fight'].includes(story.phase)) return boss === 'wilson' || boss === 'deathstar' ? boss : 'boss';
  return story.stage === 'sky' ? 'sky' : 'battle';
}

// cutscene: 스토리 모드 엔딩 컷씬(입력은 받지 않지만 시간은 흐른다. 대교 가는 길만 좌우 이동으로 차를 몬다)
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
  // 스토리 설정에서 고른 시작 스테이지(이어하기·건너뛰기가 아니면): 그 스테이지 처음부터 체력 가득
  const startAt = !resumeFrom && single.storyStart !== 'rooftop' && STAGES[single.storyStart]
    ? { wave: stageStart(single.storyStart), hp: FULL_HP, hp2: FULL_HP, skip: true } : null;
  // 건 카타 수련장: P1이 고른 캐릭터로 훈련용 전투 로봇과 끝없이 건 카타
  // 랭크: 처음 스테이지(옥상)부터 건너뛰기 없이 시작한 판만(저장한 판은 그 판이 그랬을 때만)
  // 연속 플레이 모드(스토리 시작 칸에서 고름): 옥상에서 요원이 3명씩 끝없이(이어하기·건너뛰기로 이어 온 판은 아님)
  const endless = storyMode() && !resumeFrom && single.storyStart === 'endless';
  storyClean = storyMode() && !startAt && !endless && (resumeFrom ? resumeFrom.clean === true : true);
  match = mode === 'training' ? createTrainingMatch(loadout.P1)
    : storyMode() ? createStoryMatch(resumeFrom?.pick ?? loadout.P1, story, Date.now(), resumeFrom ?? startAt, storyPartner(), storyAllies(), { endless, endlessMap: single.endlessMap })
    // 2인 대결은 준비 화면에서 고른 경기장(넓은 옥상·고공 요새)
    : createMatch(mode === 'single' ? singleLoadout() : loadout, Date.now(), { wide: true, map: mode === 'versus' ? settings.versusMap ?? 'wide' : 'wide' });
  inputs = createInputs(match.players);
  humans = match.players.filter((p) => !p.ai);
  const aiPlayer = match.players.find((p) => p.ai);
  ai = aiPlayer && !match.story && !match.training ? createAI(aiPlayer.id, single.difficulty) : null;
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
  controlsEl.classList.toggle('training', !!match.training);
  if (!match.story && !match.training && aiPlayer) groups[aiPlayer.team].replaceChildren(aiPanel(aiPlayer.team, `${aiPlayer.id} · ${aiPlayer.name}`, `난이도 ${DIFFICULTY[single.difficulty].name}`));
  renderer.reset();
  world?.reset();
  restartMusic();
  screens.show('game');
}

function pause() {
  if (!active()) return;
  mouse?.release();
  cancelAllInput();
  match.phase = 'paused';
  const next = match.story && !match.story.endless && nextStageOf(match.story.stage);
  screens.showPause(!!match.story && !match.story.endless, next ? `${STAGES[next].num}스테이지 ${STAGES[next].name}로 건너뛰기` : null);
}

/** 체력을 가득 채워 시작하라는 값(최대 체력으로 잘린다) */
const FULL_HP = 99999;

/**
 * 일시정지 화면 '스테이지 건너뛰기': 지금 스테이지를 건너뛰고 다음 스테이지 처음부터(체력 가득) 시작한다.
 * 같은 캐릭터·무기·2인 협동·AI 동료로 시작하고, 다시 시작하면 그 스테이지 처음부터다.
 */
function skipStage() {
  const next = match?.story && nextStageOf(match.story.stage);
  if (!next) return;
  const coop = match.story.coop;
  resumeFrom = {
    wave: stageStart(next), hp: FULL_HP, skip: true,
    pick: resumeFrom?.pick ?? loadout.P1,
    ...(coop ? { coop: true, hp2: FULL_HP, pick2: resumeFrom?.pick2 ?? coopLoadout.P2 } : {}),
    ...(match.story.allies ? { allies: match.story.allies, allyPicks: match.story.allyPicks.map((p) => ({ ...p })) } : {}),
  };
  startMatch();
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
  const pickOf = (p) => ({ characterId: p.characterId, weapon: p.primary, secondary: p.ground?.secondary ?? p.secondary, secondaries: p.ground?.secondaries ?? p.secondaries, skyCraft: p.skyCraft });
  const save = { ...point, pick: pickOf(hero), savedAt: Date.now(), ...(storyClean ? { clean: true } : {}) };
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
  else screens.showReady(SLOTS, loadout, settings.versusMap ?? 'wide');
}

/** 계정 고르기: 그 계정의 랭크·코인·배낭·산 무기·스토리 저장으로 바꾼다(다른 계정에는 영향 없음) */
function selectAccount(n) {
  useAccount(n);
  modStore().useAccount(n);
  rank = loadRank(n);
  resumeFrom = null;
  // 다른 계정이 산 전설 무기를 고른 채로 남지 않게
  for (const pick of [loadout.P1, loadout.P2, coopLoadout.P2]) {
    if (!modStore().ownsWeapon(pick.weapon)) pick.weapon = 'rifle';
  }
  screens.setContinue(loadStorySave());
  screens.setAccount(n, rank);
  screens.show('menu');
}

/**
 * 경기가 끝났을 때 랭크: 2인 대결에서 누가 이기거나(무승부 제외), 스토리 모드를 건너뛰기 없이 끝까지 깨면 지금 계정이 1레벨 오른다.
 * 30레벨이면 20코인과 함께 다음 등급으로 승급. 결과 화면에 보일 { message, result }를 돌려준다(오르지 않으면 null).
 */
function awardRank(ended) {
  const won = ended.story ? ended.winner === 'earth' && storyClean : mode === 'versus' && ['earth', 'isb'].includes(ended.winner);
  if (!won || ended.training) return null;
  const result = addWin(rank);
  rank = result.rank;
  saveRank(rank);
  if (result.coins) modStore().addCoins(result.coins);
  screens.setAccount(currentAccount(), rank);
  const message = rankMessage(result);
  coinToast(message);
  return { message, result };
}

const screens = createScreens({
  /** 캐릭터 선택: 지금 모드의 준비 화면으로 */
  onSetup: showSetup,
  onVersus() { mode = 'versus'; showSetup(); },
  onSingle() { mode = 'single'; showSetup(); },
  onTraining() { mode = 'training'; resumeFrom = null; startMatch(); },
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
  onSkipStage: skipStage,
  onContinue: continueStory,
  onClearSave() { clearStorySave(); resumeFrom = null; screens.setContinue(null); },
  onAccount: selectAccount,
  onAccounts() { match = null; screens.showAccounts(currentAccount()); },
  onMap(id) { settings.versusMap = id; saveSettings(settings); },
  onMenu() { match = null; screens.show('menu'); },
  onPause: pause,
  onResume: resume,
  onRetryLoad: boot,
  onToggleMute: () => toggle('muted'),
  onToggleMotion: () => toggle('reducedMotion'),
  onBalanceChange(values) {
    saveBalance(values);
    screens.setBalanceStatus(changedCount());
  },
  onBalanceDefaultsChange(values) { saveBalanceDefaults(values); },
});
screens.setBalanceStatus(changedCount());
// 마지막에 플레이한 계정을 미리 골라 둔다(처음 화면에서 계정 1~4 중 다시 고른다)
useAccount(lastAccount());
modStore().useAccount(currentAccount());
rank = loadRank();
screens.setAccount(currentAccount(), rank);
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
// 포인터 잠금을 Esc로 풀어 일시정지된 직후의 같은 Esc는 다시 풀지 않는다
const togglePause = () => {
  if (match?.phase === 'paused' && performance.now() - lockPausedAt < 400) return;
  return match?.phase === 'paused' ? resume() : pause();
};
attachKeyboard(() => (active() ? humanInputs() : null), togglePause);
// 마우스: 게임 화면을 누르면 포인터를 잠그고 P1의 고개를 돌린다(Esc로 풀면 일시정지)
const mouse = attachMouse(document.querySelector('#arena'), () => (active() && humans[0] ? inputs[humans[0].id] : null));
let lockPausedAt = -Infinity;
// 터치로 조작하는 기기면 마우스 안내를 띄우지 않는다
let isTouch = false;
window.addEventListener('pointerdown', (e) => { isTouch = e.pointerType === 'touch'; }, { capture: true });
document.addEventListener('pointerlockchange', () => {
  if (mouse.locked() || match?.phase !== 'playing') return;
  lockPausedAt = performance.now();
  pause();
});
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
      applyKeyboard(inputs, humans);
      applyGamepads(inputs, humans);
      // 1인칭: 고개 돌리기·앞뒤·옆걸음을 경기장 이동축으로(대교 가는 길은 좌우 핸들만)
      applyView(inputs, humans, TICK, { drive: match.cutscene?.kind === 'drive' });
      for (const brain of brains()) updateAI(brain, match, inputs, TICK);
      const events = step(match, inputs, TICK);
      accumulator -= TICK;
      steps++;
      renderer.addEvents(events, match);
      world?.addEvents(events, match);
      playEvents(events);
      for (const e of events) {
        if (e.type === 'wave') {
          screens.announce(e.endless ? `연속 플레이 ${e.endless}웨이브 시작` : `${waveLabel(e.wave)} 시작`);
        }
        // 연속 플레이: 웨이브를 깰 때마다 랭크 1레벨·1코인. 바로 저장되므로 중간에 그만둬도 남는다
        if (e.type === 'wave-clear' && e.endless) {
          const result = addWin(rank);
          rank = result.rank;
          saveRank(rank);
          if (result.coins) modStore().addCoins(result.coins);
          screens.setAccount(currentAccount(), rank);
          coinToast(`${e.endless}웨이브 돌파! ${rankMessage(result)}`);
          endlessRankMsg = rankMessage(result);
        }
        if (e.type === 'endless-reward') {
          const coins = modStore().addCoins(1);
          coinToast(`${e.cleared}웨이브 돌파! 코인 +1 (가진 코인 ${coins}) · ${endlessRankMsg}`);
        }
        // 스토리 스테이지를 깰 때마다 1코인(바로 저장되므로 중간에 그만둬도 남는다). 마지막 대교는 승리할 때
        if (match.story && (e.type === 'stage' || (e.type === 'result' && e.winner === 'earth'))) {
          const coins = modStore().addCoins(1);
          coinToast(`스테이지 클리어! 코인 +1 (가진 코인 ${coins})`);
        }
        if (e.type === 'wave-clear') screens.announce(e.endless ? `연속 플레이 ${e.endless}웨이브 클리어` : `${waveLabel(e.wave)} 클리어`);
        if (e.type === 'stage') {
          screens.announce({
            sky: '3스테이지 하늘. 라이트닝을 타고 공중전! 체력이 모두 회복되었습니다.',
            road: '4스테이지 도로. 달리는 차 위에서 싸웁니다. 탱크를 조심하세요! 체력이 모두 회복되었습니다.',
            bridge: '5스테이지 눈 내리는 대교. 다리가 벌어지면 배가 대포를 쏩니다. 체력은 대교 가는 길에서 남은 만큼입니다.',
          }[e.stage] ?? '2스테이지 복도. 체력이 모두 회복되었습니다.');
        }
        if (e.type === 'gunkata') screens.announce(`건 카타 모드! 빛나는 버튼 1, 2, 3, 4를 ${KATA.warn}초 안에 누르세요.`);
        if (e.type === 'kata-warn') screens.announce(`${e.key}번`);
        if (e.type !== 'down') continue;
        const p = match.players.find((pl) => pl.id === e.playerId);
        screens.announce(`${TEAM_NAME[p.team]} ${p.id} ${p.name} 쓰러짐`);
      }
      if (match.phase === 'result') {
        mouse.release();
        cancelAllInput();
        // 스토리를 끝까지 깨면 저장은 지운다(지면 남겨 두어 이어할 수 있다)
        if (match.story && match.winner === 'earth') {
          clearStorySave();
          resumeFrom = null;
          screens.setContinue(null);
        }
        // 마지막 한 방(즉사기 레이저 등)이 보이도록 결과 화면은 조금 뒤에 띄운다
        const ended = match;
        const ranked = awardRank(ended);
        // 2인 대결: 이긴 사람이 승리 포즈(3D 화면이 그 사람을 비춘다)를 취한 뒤 결과 화면
        const winnerPlayer = mode === 'versus' && !ended.story && ended.players.find((p) => p.team === ended.winner);
        if (winnerPlayer) {
          ended.victory = { id: winnerPlayer.id, t: 0 };
          screens.announce(`${winnerPlayer.id} ${winnerPlayer.name} 승리! 승리 포즈!`);
        }
        setTimeout(() => { if (match === ended) screens.showResult(ended, ranked); }, winnerPlayer ? VICTORY_MS : RESULT_DELAY_MS);
      }
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  } else {
    accumulator = 0;
  }
  // 건 카타 동안에는 조작 패널 대신 1·2·3·4 버튼, 눌러야 할 버튼은 빛난다
  controlsEl.classList.toggle('kata', !!match?.gunkata);
  kataKeys.sync(match?.phase === 'gunkata' ? glowingKey(match.gunkata) : null);
  if (match?.victory) match.victory.t += frameMs / 1000;
  if (match) {
    if (world) {
      // 건 카타(옆에서 본 2D 화면) 동안은 3D를 그리지 않고 3D 화면도 숨긴다(2D 화면만 보인다)
      worldCanvas.style.visibility = match.gunkata ? 'hidden' : '';
      const views = match.gunkata ? [] : world.draw(match, inputs, frameMs / 1000, now / 1000, settings.reducedMotion, humans.map((p) => p.id));
      renderer.drawOverlay(match, inputs, frameMs / 1000, now / 1000, settings.reducedMotion, views, { mouseHint: !mouse.locked() && match.phase === 'playing' && !isTouch });
    } else {
      renderer.draw(match, inputs, frameMs / 1000, now / 1000, settings.reducedMotion);
    }
    controls.sync(match.players, match.tick * TICK);
  }
  updateEngine(match?.phase === 'playing' ? match.jet : null);
  // 신나는 전투 음악: 카운트다운부터 경기·컷씬 동안. 일시정지·결과·메뉴에서는 작아지며 멈춘다.
  // 보스전·공중전에는 그 장면의 곡(곡이 바뀌면 처음부터)
  updateBattleMusic(active(), musicSong());
  requestAnimationFrame(frame);
}

async function boot() {
  screens.setLoading();
  try {
    const assets = await loadAssets();
    renderer = createRenderer(document.querySelector('#arena'), document.querySelector('#arena-wrap'), assets);
    // WebGL을 쓸 수 없는 기기는 예전처럼 위에서 내려다본 2D 화면으로 그린다
    try {
      world = createWorld3D(worldCanvas, document.querySelector('#arena-wrap'), assets);
    } catch (error) {
      console.warn('3D 화면을 만들 수 없어 2D 화면으로 그립니다.', error);
      world = null;
      document.querySelector('#world').hidden = true;
    }
    screens.setLoaded();
    // 처음 시작할 때 계정 1~4 중 하나를 고른다
    screens.showAccounts(currentAccount());
    requestAnimationFrame(frame);
  } catch (error) {
    screens.setLoadError(error.message);
  }
}
boot();
