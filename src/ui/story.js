import { WEAPONS, SECONDARY_IDS } from '../game/config.js';
import { DIFFICULTY, DIFFICULTY_IDS } from '../game/ai.js';
import { WAVES, STORY_FIELDS, STORY_WEAPONS, BOSS_NAME, defaultStory } from '../game/story.js';
import { choiceButton } from './widgets.js';

const $ = (selector) => document.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 웨이브 설명: 어디서 오는지와 무기 */
function waveNote(wave) {
  const from = { start: '처음부터 옥상에', heli: '헬리콥터에서 내려옴', gunship: '전투기가 헬리콥터를 격추한 뒤 건쉽에서 내려옴' }[wave.from];
  const weapon = wave.weapon === 'random'
    ? `${STORY_WEAPONS.map((id) => WEAPONS[id].name).join('·')} 중 무작위`
    : WEAPONS[wave.weapon].name;
  return wave.boss ? `${from} · ${weapon} + 보조무기 + 수류탄` : `${from} · ${weapon} · 보조무기·수류탄 없음`;
}

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
    box.append(el('legend', '', `${wave.title} · ${wave.boss ? BOSS_NAME : `요원 ${wave.count}명`}`), el('small', '', waveNote(wave)));

    box.append(el('div', 'field-label', '난이도'));
    const difficulty = el('div', 'choices difficulty');
    difficulty.setAttribute('role', 'group');
    difficulty.setAttribute('aria-label', `${wave.title} 난이도`);
    difficulty.append(...DIFFICULTY_IDS.map((id) => choiceButton(DIFFICULTY[id].name, cfg.difficulty === id, () => {
      cfg.difficulty = id;
      changed();
    })));
    box.append(difficulty);

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

  function build() {
    $('#story-waves').replaceChildren(...WAVES.map(waveBox));
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
