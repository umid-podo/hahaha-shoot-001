import { WEAPONS, SECONDARY_IDS } from '../game/config.js';
import { DIFFICULTY, DIFFICULTY_IDS } from '../game/ai.js';
import {
  WAVES, STAGES, STORY_FIELDS, STORY_WEAPONS, BOSS_NAME, AGENT_WEAPON_CHOICES, defaultStory, waveWho,
} from '../game/story.js';
import { choiceButton } from './widgets.js';
import { loadStoryDefaults, saveStoryDefaults, clearStoryDefaults } from '../storage/settings.js';

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const FROM = {
  start: '처음부터 옥상에', heli: '헬리콥터에서 내려옴', gunship: '전투기가 헬리콥터를 격추한 뒤 건쉽에서 내려옴',
  elevator: '엘리베이터에서 나옴', ceiling: '천장을 부수고 나타남', sky: '하늘 위에서 날아옴',
  car: '차를 타고 뒤에서 따라붙음', chute: '낙하산을 메고 다리 위 차에 내려앉음',
};
const DIFFICULTY_NAME = Object.fromEntries(DIFFICULTY_IDS.map((id) => [id, DIFFICULTY[id].name]));

/** 웨이브 설명: 어디서 오는지와 보조무기·수류탄(주무기는 아래 요원별 칸에서 고른다) */
function waveNote(wave) {
  const from = FROM[wave.from];
  if (wave.boss === 'r10') return `${from} · 레이저 캐논(피해 20 레이저 탄 3점사, 약 3초 쏘고 2초 재장전) · 보조무기·수류탄 없음`;
  if (wave.boss === 'wilson') {
    const w = WEAPONS.dualrpg;
    return `${from} · ${w.name}(쌍권총처럼 ${w.burst}점사, 터지는 로켓·폭발 ${w.splash.damage}, 유도 없음) · 보조무기·수류탄 없음`;
  }
  if (wave.boss === 'johnson') {
    const w = WEAPONS.jsniper;
    return `${from} · ${w.name}(${w.interval}초마다 빨간 조준선을 따라 ${w.volley.count}발, 체력 절반 아래면 ${w.volley.rage}발) · 보조무기·수류탄 없음`;
  }
  if (wave.boss === 'deathstar') return `${from} · 거대 비행선 · ${WEAPONS.flak.name}(부채꼴 ${WEAPONS.flak.pellets}발)`;
  if (wave.stage === 'sky') return `${from} · ${WEAPONS.gunship.name}(${WEAPONS.gunship.burst}점사)`;
  const levels = wave.agents?.some((a) => a.difficulty)
    ? ` · 기획 난이도 ${wave.agents.map((a) => DIFFICULTY_NAME[a.difficulty ?? 'normal']).join('·')}` : '';
  const kata = wave.normalKata ? ` · 보통 요원은 건 카타 ${wave.normalKata}번` : '';
  return wave.boss ? `${from} · 주무기 + 보조무기 + 수류탄` : `${from} · 주무기만(보조무기·수류탄 없음)${levels}${kata}`;
}

const RANDOM_NAME = `무작위(${STORY_WEAPONS.map((w) => WEAPONS[w].name).join('·')})`;
const weaponName = (id) => (id === 'random' ? RANDOM_NAME : WEAPONS[id].name);

/** '기획대로' 난이도 설명: 요원마다 정해진 난이도 */
const mixedName = (wave) => `기획대로(${wave.agents.map((a) => DIFFICULTY_NAME[a.difficulty ?? 'normal']).join('·')})`;

/**
 * 싱글 플레이 화면의 스토리 모드 설정 칸: 웨이브마다 요원 난이도·체력·피해·탄속·이동 속도·히트박스, 보스는 보조무기도.
 * 값이 바뀔 때마다 onChange(story)를 부른다. 기본값과 다른 칸은 노랗게 표시한다.
 */
export function createStorySetup(onChange) {
  let story = null;

  // 선택 버튼은 눌린 표시를 스스로 바꾸고, 숫자 칸은 그 칸만 고친다(다시 그리면 컨트롤러로 숫자를 고치던 칸이 풀린다).
  const changed = () => onChange(story);
  // 기본값: '내 기본값'을 저장해 두었으면 그것, 없으면 원래 기본값. 노란 표시·'기본 ○○' 안내·'기본값으로' 버튼의 기준이다.
  let custom = loadStoryDefaults();
  const base = () => custom ?? defaultStory();
  const status = (text) => { $('#story-defaults-status').textContent = text; };
  const baseNote = () => (custom ? "기준은 '내 기본값'입니다." : '기준은 원래 기본값입니다.');

  /** 건 카타 모드 켜기·끄기(끄면 쓰러뜨린 요원은 바로 처치 컷씬, 보스는 바로 엔딩 컷씬) */
  function kataBox() {
    const box = el('fieldset', 'story-wave story-kata');
    box.append(el('legend', '', '건 카타 모드'), el('small', '', '요원·보스를 쓰러뜨릴 때 1·2·3·4 버튼으로 맞서는 건 카타. 끄면 바로 처치 컷씬(보스는 엔딩 컷씬)으로 넘어갑니다.'));
    const row = el('div', 'choices story-kata-choices');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '건 카타 모드');
    const mark = () => row.classList.toggle('changed', story.gunkata !== base().gunkata);
    row.append(...[[true, '켜기'], [false, '끄기']].map(([on, label]) => choiceButton(label, story.gunkata === on, () => {
      story.gunkata = on;
      mark();
      changed();
    })));
    mark();
    box.append(row);
    return box;
  }

  function waveBox(wave, i) {
    const cfg = story.waves[i];
    const def = base().waves[i];
    const box = el('fieldset', `story-wave${wave.boss ? ' boss' : ''}`);
    const who = waveWho(wave);
    box.append(el('legend', '', `${wave.title} · ${who}`), el('small', '', waveNote(wave)));

    box.append(el('div', 'field-label', '난이도'));
    const mixable = defaultStory().waves[i].difficulty === 'mixed'; // '기획대로'는 요원마다 난이도가 정해진 웨이브만
    const difficulty = el('div', `choices difficulty${mixable ? ' mixed' : ''}`);
    difficulty.setAttribute('role', 'group');
    difficulty.setAttribute('aria-label', `${wave.title} 난이도`);
    const choices = mixable ? ['mixed', ...DIFFICULTY_IDS] : DIFFICULTY_IDS;
    difficulty.append(...choices.map((id) => choiceButton(id === 'mixed' ? mixedName(wave) : DIFFICULTY[id].name, cfg.difficulty === id, () => {
      cfg.difficulty = id;
      changed();
    })));
    box.append(difficulty);

    // 요원마다 주무기: 무작위 또는 주무기 6종 중 하나. 기본값과 다르면 노랗게.
    cfg.weapons.forEach((weapon, k) => {
      const who = wave.boss === 'smith' ? BOSS_NAME : `요원 ${k + 1}`;
      const label = el('div', 'field-label', `${who} 주무기 `);
      const note = el('small', 'weapon-default', `기본 ${weaponName(def.weapons[k])}`);
      label.append(note);
      const row = el('div', 'choices agent-weapon');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `${wave.title} ${who} 주무기`);
      const mark = () => row.classList.toggle('changed', cfg.weapons[k] !== def.weapons[k]);
      row.append(...AGENT_WEAPON_CHOICES.map((id) => choiceButton(id === 'random' ? '무작위' : WEAPONS[id].name, weapon === id, () => {
        cfg.weapons[k] = id;
        mark();
        changed();
      })));
      mark();
      box.append(label, row);
    });

    if ('secondary' in cfg) {
      box.append(el('div', 'field-label', '보조무기'));
      const secondary = el('div', 'choices secondary');
      secondary.setAttribute('role', 'group');
      secondary.setAttribute('aria-label', `${BOSS_NAME} 보조무기`);
      secondary.append(...['random', ...SECONDARY_IDS].map((id) => choiceButton(
        id === 'random' ? '무작위' : WEAPONS[id].name, cfg.secondary === id, () => { cfg.secondary = id; changed(); })));
      box.append(secondary);
    }

    const numbers = el('div', 'ai-numbers');
    for (const [key, f] of Object.entries(STORY_FIELDS)) {
      const row = el('label', 'param');
      if (cfg[key] !== def[key]) row.classList.add('changed');
      const input = el('input');
      input.type = 'number';
      input.inputMode = 'numeric';
      Object.assign(input, { min: String(f.min), max: String(f.max), step: String(f.step), value: String(cfg[key]) });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        cfg[key] = input.value === '' || !Number.isFinite(v) ? def[key] : Math.min(f.max, Math.max(f.min, Math.round(v)));
        input.value = String(cfg[key]);
        row.classList.toggle('changed', cfg[key] !== def[key]);
        changed();
      });
      row.append(`${f.label} `, input, el('em', '', f.unit), el('small', '', `기본 ${def[key]}${f.unit}`));
      numbers.append(row);
    }
    box.append(numbers);
    return box;
  }

  /** 스테이지마다 제목 + 웨이브 칸 */
  function build() {
    const nodes = [kataBox()];
    WAVES.forEach((wave, i) => {
      if (i === 0 || WAVES[i - 1].stage !== wave.stage) {
        const stage = STAGES[wave.stage];
        nodes.push(el('h3', 'story-stage', `${stage.num}스테이지 · ${stage.name}`));
      }
      nodes.push(waveBox(wave, i));
    });
    $('#story-waves').replaceChildren(...nodes);
  }

  /** 설정 전체를 s로 바꾼다(건 카타·웨이브) */
  function replaceWith(s) {
    story.gunkata = s.gunkata;
    story.waves = s.waves;
    build();
    changed();
  }

  $('#story-reset-btn').addEventListener('click', () => {
    replaceWith(base());
    status(`기본값으로 되돌렸습니다. ${baseNote()}`);
  });
  // 지금 설정을 '내 기본값'으로 저장: 앞으로 노란 표시와 '기본값으로' 버튼이 이 값을 기준으로 한다
  $('#story-save-defaults-btn').addEventListener('click', () => {
    saveStoryDefaults(story);
    custom = loadStoryDefaults();
    build();
    status("지금 설정을 '내 기본값'으로 저장했습니다.");
  });
  // 원래 기본값으로: '내 기본값'을 지우고 처음 값으로 되돌린다
  $('#story-factory-btn').addEventListener('click', () => {
    clearStoryDefaults();
    custom = null;
    replaceWith(defaultStory());
    status("'내 기본값'을 지우고 원래 기본값으로 되돌렸습니다.");
  });

  return {
    open(state) {
      story = state;
      status(custom ? "'내 기본값'을 저장해 두었습니다. 노란 칸은 그 값과 다른 칸입니다." : '');
      build();
    },
  };
}
