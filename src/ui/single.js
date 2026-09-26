import { WEAPONS, PRIMARY_IDS, MAX_HP } from '../game/config.js';
import { DIFFICULTY, DIFFICULTY_IDS } from '../game/ai.js';
import { defaultSingle } from '../storage/settings.js';
import { weaponInfo, choiceButton } from './widgets.js';

const $ = (selector) => document.querySelector(selector);

/** 칸별 무기 기본 피해(밸런스 조정 값 반영). 수류탄은 폭발 피해. */
function defaultDamage(single) {
  return {
    primary: WEAPONS[single.aiWeapon].damage,
    secondary: WEAPONS.smg.damage,
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
    hp: $('#ai-hp'), speed: $('#ai-speed'),
    primary: $('#ai-dmg-primary'), secondary: $('#ai-dmg-secondary'), grenade: $('#ai-dmg-grenade'),
  };

  const clamp = (input, value) => Math.min(Number(input.max), Math.max(Number(input.min), Math.round(value)));

  function syncNumbers() {
    const defaults = defaultDamage(single);
    number.hp.value = String(single.aiHp);
    number.speed.value = String(single.aiBulletSpeed);
    for (const slot of ['primary', 'secondary', 'grenade']) {
      number[slot].value = String(single.aiDamage[slot] ?? defaults[slot]);
      number[slot].closest('.param').classList.toggle('changed', single.aiDamage[slot] !== null);
    }
    number.hp.closest('.param').classList.toggle('changed', single.aiHp !== defaultSingle().aiHp);
    number.speed.closest('.param').classList.toggle('changed', single.aiBulletSpeed !== 100);
    $('#ai-defaults').textContent = `기본 피해: ${WEAPONS[single.aiWeapon].name} ${defaults.primary}` +
      ` · 기관단총 ${defaults.secondary} · 수류탄 ${defaults.grenade}. 탄속 100%는 무기 기본 탄속입니다.`;
  }

  function buildChoices() {
    $('#ai-difficulty').replaceChildren(...DIFFICULTY_IDS.map((id) => {
      const name = document.createElement('span');
      name.textContent = DIFFICULTY[id].name;
      const info = document.createElement('small');
      info.textContent = DIFFICULTY_HINT[id];
      return choiceButton([name, info], single.difficulty === id, () => { single.difficulty = id; changed(); });
    }));
    $('#ai-weapon').replaceChildren(...PRIMARY_IDS.map((id) => {
      const name = document.createElement('span');
      name.textContent = WEAPONS[id].name;
      const info = document.createElement('small');
      info.textContent = weaponInfo(WEAPONS[id]);
      return choiceButton([name, info], single.aiWeapon === id, () => {
        single.aiWeapon = id;
        single.aiDamage.primary = null; // 무기를 바꾸면 주무기 피해는 새 무기 기본값부터
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
    Object.assign(single, defaultSingle());
    buildChoices();
    changed();
  });

  return {
    open(state) {
      single = state;
      buildChoices();
      syncNumbers();
    },
  };
}
