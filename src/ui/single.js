import { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, MAX_HP } from '../game/config.js';
import { DIFFICULTY, DIFFICULTY_IDS } from '../game/ai.js';
import { defaultSingle } from '../storage/settings.js';
import { MAX_ALLIES } from '../game/story.js';
import { weaponLabel, choiceButton, weaponButtons } from './widgets.js';

const $ = (selector) => document.querySelector(selector);

/** 칸별 무기 기본 피해(밸런스 조정 값 반영). 수류탄은 폭발 피해. */
function defaultDamage(single) {
  return {
    primary: WEAPONS[single.aiWeapon].damage,
    secondary: WEAPONS[single.aiSecondary].damage,
    grenade: WEAPONS.grenade.splash.damage,
  };
}

const DIFFICULTY_HINT = {
  easy: '늦게 반응하고 잘 못 피하며, 지금 위치를 겨눔',
  normal: '적당히 피하고, 움직임을 조금 예측',
  hard: '빠르게 피하고, 움직임을 끝까지 예측',
};

/**
 * 싱글 플레이 화면의 AI 설정 칸(난이도·AI 주무기·체력·탄속·칸별 피해).
 * 값이 바뀔 때마다 onChange(single)을 부른다. 피해 칸을 비우면 무기 기본 피해를 쓴다.
 */
export function createSingleSetup(onChange) {
  let single = null;
  const number = {
    hp: $('#ai-hp'), speed: $('#ai-speed'), radius: $('#ai-radius'),
    primary: $('#ai-dmg-primary'), secondary: $('#ai-dmg-secondary'), grenade: $('#ai-dmg-grenade'),
  };

  const clamp = (input, value) => Math.min(Number(input.max), Math.max(Number(input.min), Math.round(value)));

  function syncNumbers() {
    const defaults = defaultDamage(single);
    number.hp.value = String(single.aiHp);
    number.speed.value = String(single.aiBulletSpeed);
    number.radius.value = String(single.aiRadius);
    number.radius.closest('.param').classList.toggle('changed', single.aiRadius !== defaultSingle().aiRadius);
    for (const slot of ['primary', 'secondary', 'grenade']) {
      number[slot].value = String(single.aiDamage[slot] ?? defaults[slot]);
      number[slot].closest('.param').classList.toggle('changed', single.aiDamage[slot] !== null);
    }
    number.hp.closest('.param').classList.toggle('changed', single.aiHp !== defaultSingle().aiHp);
    number.speed.closest('.param').classList.toggle('changed', single.aiBulletSpeed !== 100);
    $('#ai-defaults').textContent = `기본 피해: ${WEAPONS[single.aiWeapon].name} ${defaults.primary}` +
      ` · ${WEAPONS[single.aiSecondary].name} ${defaults.secondary} · 수류탄 ${defaults.grenade}. 탄속 100%는 무기 기본 탄속, 히트박스 기본 반지름은 30(사람 캐릭터)입니다.`;
  }

  function buildChoices() {
    $('#ai-difficulty').replaceChildren(...DIFFICULTY_IDS.map((id) => {
      const name = document.createElement('span');
      name.textContent = DIFFICULTY[id].name;
      const info = document.createElement('small');
      info.textContent = DIFFICULTY_HINT[id];
      return choiceButton([name, info], single.difficulty === id, () => { single.difficulty = id; changed(); });
    }));
    // 숨겨진 무기(아킴보 석궁)는 쌍권총 버튼을 빠르게 2번 눌러 부른다
    $('#ai-weapon').replaceChildren(...weaponButtons(WEAPONS, PRIMARY_IDS, single.aiWeapon, (id) => {
      if (single.aiWeapon !== id) single.aiDamage.primary = null; // 무기를 바꾸면 주무기 피해는 새 무기 기본값부터
      single.aiWeapon = id;
      changed();
    }));
  }

  function syncSecondary() {
    $('#ai-secondary').replaceChildren(...SECONDARY_IDS.map((id) => {
      return choiceButton(weaponLabel(WEAPONS[id]), single.aiSecondary === id, () => {
        single.aiSecondary = id;
        single.aiDamage.secondary = null; // 보조무기를 바꾸면 피해도 새 무기 기본값부터
        changed();
      });
    }));
  }

  function changed() {
    syncNumbers();
    onChange(single);
  }

  number.hp.addEventListener('change', () => {
    const v = Number(number.hp.value);
    single.aiHp = Number.isFinite(v) && number.hp.value !== '' ? clamp(number.hp, v) : MAX_HP;
    changed();
  });
  number.speed.addEventListener('change', () => {
    const v = Number(number.speed.value);
    single.aiBulletSpeed = Number.isFinite(v) && number.speed.value !== '' ? clamp(number.speed, v) : 100;
    changed();
  });
  number.radius.addEventListener('change', () => {
    const v = Number(number.radius.value);
    single.aiRadius = Number.isFinite(v) && number.radius.value !== '' ? clamp(number.radius, v) : defaultSingle().aiRadius;
    changed();
  });
  for (const slot of ['primary', 'secondary', 'grenade']) {
    number[slot].addEventListener('change', () => {
      const raw = number[slot].value;
      const v = Number(raw);
      const value = raw === '' || !Number.isFinite(v) ? null : clamp(number[slot], v);
      single.aiDamage[slot] = value === defaultDamage(single)[slot] ? null : value;
      changed();
    });
  }
  $('#ai-reset-btn').addEventListener('click', () => {
    Object.assign(single, defaultSingle(), { mode: single.mode, storyPlayers: single.storyPlayers, storyAllies: single.storyAllies });
    buildChoices();
    syncSecondary();
    changed();
  });

  /** 자유 대전 · 스토리 모드 고르기. 고른 모드의 설정 칸만 보인다. */
  function buildMode() {
    const modes = [
      ['free', '자유 대전', 'AI 1명과 1:1. 무기·체력·난이도를 직접 정함'],
      ['story', '스토리 모드', '옥상(스미스 요원) → 복도(R-10)'],
    ];
    $('#single-mode').replaceChildren(...modes.map(([id, name, hint]) => {
      const label = document.createElement('span');
      label.textContent = name;
      const info = document.createElement('small');
      info.textContent = hint;
      return choiceButton([label, info], single.mode === id, () => {
        single.mode = id;
        syncMode();
        onChange(single);
      });
    }));
    syncMode();
  }

  /** 스토리 모드 인원: 혼자 · 2인 협동(P2도 지구방위팀) */
  function buildPlayers() {
    const options = [
      [1, '1인', '혼자서 P1 조작'],
      [2, '2인 협동', 'P2도 지구방위팀으로 함께. 둘 다 쓰러지면 패배'],
    ];
    $('#story-players').replaceChildren(...options.map(([n, name, hint]) => {
      const label = document.createElement('span');
      label.textContent = name;
      const info = document.createElement('small');
      info.textContent = hint;
      return choiceButton([label, info], single.storyPlayers === n, () => {
        single.storyPlayers = n;
        syncMode();
        onChange(single);
      });
    }));
  }

  /** 스토리 모드 AI 동료 수: 없음·1·2·3명. 1명마다 적에 쉬움 돌격소총 요원이 1명씩 더 나온다. */
  function buildAllies() {
    $('#story-allies').replaceChildren(...Array.from({ length: MAX_ALLIES + 1 }, (_, n) => {
      const label = document.createElement('span');
      label.textContent = n ? `AI 동료 ${n}명` : 'AI 동료 없음';
      const info = document.createElement('small');
      info.textContent = n ? `적 웨이브마다 쉬움 돌격소총 요원 +${n}` : '혼자(또는 2인 협동만)';
      return choiceButton([label, info], single.storyAllies === n, () => {
        single.storyAllies = n;
        onChange(single);
      });
    }));
  }

  function syncMode() {
    const story = single.mode === 'story';
    $('#story-allies').hidden = !story;
    $('#free-setup').hidden = story;
    $('#story-setup').hidden = !story;
    $('#story-players').hidden = !story;
    // 2인 협동이면 P2 캐릭터·무기 고르기 칸을 보인다
    const p2 = $('#single-p2');
    if (p2) p2.hidden = !(story && single.storyPlayers === 2);
  }

  return {
    open(state) {
      single = state;
      if (single.mode !== 'story') single.mode = 'free';
      if (single.storyPlayers !== 2) single.storyPlayers = 1;
      if (!(single.storyAllies >= 0 && single.storyAllies <= MAX_ALLIES)) single.storyAllies = 0;
      buildPlayers();
      buildAllies();
      buildMode();
      // 목록에서 빠진 무기(예: 전용 무기가 된 아킴보 석궁)가 저장돼 있으면 기본값으로
      if (!PRIMARY_IDS.includes(single.aiWeapon)) single.aiWeapon = defaultSingle().aiWeapon;
      if (!SECONDARY_IDS.includes(single.aiSecondary)) single.aiSecondary = SECONDARY_IDS[0];
      buildChoices();
      syncSecondary();
      syncNumbers();
    },
  };
}
