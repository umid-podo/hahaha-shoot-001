import { WEAPONS, SECONDARY_IDS } from '../game/config.js';
import { DIFFICULTY, DIFFICULTY_IDS } from '../game/ai.js';
import {
  WAVES, STAGES, STORY_FIELDS, STORY_WEAPONS, BOSS_NAME, R10_NAME, AGENT_WEAPON_CHOICES, defaultStory,
} from '../game/story.js';
import { choiceButton } from './widgets.js';

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const FROM = {
  start: '처음부터 옥상에', heli: '헬리콥터에서 내려옴', gunship: '전투기가 헬리콥터를 격추한 뒤 건쉽에서 내려옴',
  elevator: '엘리베이터에서 나옴', ceiling: '천장을 부수고 나타남',
};
const DIFFICULTY_NAME = Object.fromEntries(DIFFICULTY_IDS.map((id) => [id, DIFFICULTY[id].name]));

/** 웨이브 설명: 어디서 오는지와 보조무기·수류탄(주무기는 아래 요원별 칸에서 고른다) */
function waveNote(wave) {
  const from = FROM[wave.from];
  if (wave.boss === 'r10') return `${from} · 레이저 캐논(피해 20 레이저 탄 3점사, 약 3초 쏘고 2초 재장전) · 보조무기·수류탄 없음`;
  const levels = wave.agents?.some((a) => a.difficulty)
    ? ` · 기획 난이도 ${wave.agents.map((a) => DIFFICULTY_NAME[a.difficulty ?? 'normal']).join('·')}` : '';
  return wave.boss ? `${from} · 주무기 + 보조무기 + 수류탄` : `${from} · 주무기만(보조무기·수류탄 없음)${levels}`;
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

  function waveBox(wave, i) {
    const cfg = story.waves[i];
    const def = defaultStory().waves[i];
    const box = el('fieldset', `story-wave${wave.boss ? ' boss' : ''}`);
    const who = wave.boss === 'smith' ? BOSS_NAME : wave.boss === 'r10' ? R10_NAME : `요원 ${wave.count}명`;
    box.append(el('legend', '', `${wave.title} · ${who}`), el('small', '', waveNote(wave)));

    box.append(el('div', 'field-label', '난이도'));
    const difficulty = el('div', `choices difficulty${def.difficulty === 'mixed' ? ' mixed' : ''}`);
    difficulty.setAttribute('role', 'group');
    difficulty.setAttribute('aria-label', `${wave.title} 난이도`);
    const choices = def.difficulty === 'mixed' ? ['mixed', ...DIFFICULTY_IDS] : DIFFICULTY_IDS;
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
    const nodes = [];
    WAVES.forEach((wave, i) => {
      if (i === 0 || WAVES[i - 1].stage !== wave.stage) {
        const stage = STAGES[wave.stage];
        nodes.push(el('h3', 'story-stage', `${stage.num}스테이지 · ${stage.name}`));
      }
      nodes.push(waveBox(wave, i));
    });
    $('#story-waves').replaceChildren(...nodes);
  }

  $('#story-reset-btn').addEventListener('click', () => {
    story.waves = defaultStory().waves;
    build();
    changed();
  });

  return {
    open(state) {
      story = state;
      build();
    },
  };
}
