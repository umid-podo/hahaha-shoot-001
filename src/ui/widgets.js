/** 여러 화면에서 쓰는 작은 DOM 조각 */
import { modStore, legendFor } from '../game/mods.js';

export function weaponInfo(w) {
  if (w.battery) return `${w.interval}초마다 ${w.burst}점사 레이저 탄 · 한 발 ${w.damage} · 배터리 ${w.battery.shots}발, 쉬면 ${w.battery.recharge}초 뒤 완충`;
  if (w.heat) return `${w.interval}초마다 ${w.damage} · ${w.heat.max}초 연사하면 과열 ${w.heat.cooldown}초`;
  if (w.field) return `조준 후 떼면 전기충격기를 포물선으로 발사 · 떨어진 곳에 반경 ${w.field.radius} 전기가 퍼짐 · 닿으면 ${w.field.freeze}초 못 움직임 · 쿨타임 ${w.interval}초`;
  if (w.shock) return `조준 후 떼면 약하게 유도되는 에너지 로켓 · 직격 ${w.damage} · 폭발 반경 ${w.splash.radius}(피해 ${w.splash.damage}) · 맞으면 ${w.shock}초 감전(못 움직이고 못 쏨)`;
  if (w.scoped && w.burst > 1) return `스코프 달림 · 조준 후 떼면 유탄 ${w.burst}발 · 한 발 ${w.damage}(주변 폭발 ${w.splash.damage}) · 쿨타임 ${w.interval}초`;
  if (w.thrown) return `아이템 버튼으로 던짐 · 반경 ${w.splash.radius} 폭발 ${w.splash.damage} · 쿨타임 ${w.interval}초`;
  if (w.instakill) {
    const aim = w.homing >= 180 ? '반드시 맞아' : `최대 ${w.homing}도 휘어 맞으면`;
    const hurt = w.damage >= 9999 ? '즉사' : `${w.damage} 피해`;
    return `전투 시작 ${w.readyAfter}초 뒤부터 · 쏘면 거대한 레이저가 ${aim} ${hurt} · 쿨타임 ${w.interval}초`;
  }
  if (w.flame) return `가까이에 불꽃을 뿜음(사거리 짧음) · ${w.interval}초마다 ${w.damage} · 연료 ${w.mag}`;
  if (w.energy && w.alternate) return `푸른 에너지 볼트를 엄청난 연사로 · 한 발 ${w.damage} · ${w.mag > 0 ? `${w.mag}발` : '탄약 무한'} · 탄속 매우 빠름`;
  if (w.energy) return `푸른 에너지 볼트 · ${w.interval}초마다 ${w.damage} · 탄속 매우 빠름 · 엄폐물·벽에 ${w.bounces}번 튕김`;
  if (w.dash) return `조준 후 떼면 매우 빠르게 돌진 · 닿으면 ${w.damage} · 쿨타임 ${w.interval}초`;
  if (w.pellets) return `조준 후 떼면 부채꼴로 ${w.pellets}발 · 한 발 ${w.damage} · 쿨타임 ${w.interval}초`;
  if (w.trigger === 'release') {
    const splash = w.splash ? ` · 폭발 범위 ${w.splash.damage}` : '';
    const note = w.note ? ` · ${w.note}` : '';
    return `조준 후 떼면 발사 · 쿨타임 ${w.interval}초 · 한 발 ${w.damage}${splash}${note}`;
  }
  const shots = w.burst > 1 ? `${w.burst}점사 ` : '';
  const splash = w.splash ? ` · 폭발 범위 ${w.splash.damage}` : '';
  const arrows = w.arrows ? `화살 ${w.arrows}개 나란히 ` : '';
  return `${w.interval}초마다 ${shots}${arrows}· 한 발 ${w.damage}${splash}`;
}

/** 그림이 있는 무기 */
const WEAPON_ICON = {
  crossbow: 'assets/ui/akimbo-crossbow.svg',
  // 전설 무기: 사용자가 준 디자인 그림
  energyrifle: 'assets/weapons/energy-rifle.jpg',
  energydual: 'assets/weapons/energy-dual.jpg',
  energyrpg: 'assets/weapons/energy-rpg.svg',
  grenadelauncher: 'assets/weapons/grenade-launcher.svg',
  stunlauncher: 'assets/weapons/stun-launcher.svg',
};
export const weaponIcon = (id) => WEAPON_ICON[id] ?? null;

/** 무기 선택 버튼 안의 내용: [그림], 이름, 설명 */
export function weaponLabel(w) {
  const nodes = [];
  if (WEAPON_ICON[w.id]) {
    const img = document.createElement('img');
    img.className = 'weapon-icon';
    img.src = WEAPON_ICON[w.id];
    img.alt = '';
    nodes.push(img);
  }
  const name = document.createElement('span');
  name.textContent = w.legendary ? `★ ${w.name}` : w.name;
  const info = document.createElement('small');
  info.textContent = weaponInfo(w);
  nodes.push(name, info);
  return nodes;
}

// 숨겨진 캐릭터·무기를 부르는 연타: 앞 누름과 이 시간(ms) 안에 다시 누르면 '빠른 연타'로 센다
const FAST_TAP_MS = 400;

/**
 * 숨겨진 항목이 딸린 선택 버튼. 빠르게 unlockTaps번(기본 3번) 누르면 버튼이 그 숨겨진 항목으로 바뀌고,
 * 숨겨진 항목이 된 버튼을 (연타가 아니게) 한 번 누르면 원래 항목으로 돌아온다.
 * label(item)은 버튼 내용, onPick(item)은 누를 때마다 지금 보이는 항목으로 부른다.
 */
export function secretChoiceButton(base, secrets, currentId, label, onPick) {
  let shown = secrets.find((h) => h.id === currentId) ?? base;
  let count = 0, lastTap = -Infinity;
  const btn = choiceButton(label(shown), currentId === shown.id, () => {
    if (secrets.length) {
      const now = performance.now();
      count = now - lastTap < FAST_TAP_MS ? count + 1 : 1;
      lastTap = now;
      const unlocked = secrets.find((h) => (h.unlockTaps ?? 3) === count);
      if (unlocked) shown = unlocked;
      else if (count === 1 && shown !== base) shown = base;
      btn.replaceChildren(...label(shown));
      btn.classList.toggle('secret', shown !== base);
    }
    onPick(shown);
  });
  btn.classList.toggle('secret', shown !== base);
  return btn;
}

/**
 * ids 중 보이는 무기마다 숨겨진 무기가 딸린 선택 버튼. 전설 무기(상점 구매)는 산 뒤에만 고를 수 있고,
 * 아직 안 샀으면 자물쇠 버튼(누를 수 없음, 상점 가격 안내)으로 보인다.
 */
export function weaponButtons(WEAPONS, ids, currentId, onPick) {
  const store = modStore();
  return ids.filter((id) => !WEAPONS[id].hidden).map((id) => {
    const w = WEAPONS[id];
    if (w.legendary && !store.ownsWeapon(id)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice legendary locked';
      btn.disabled = true;
      const name = document.createElement('span');
      name.textContent = `🔒 ${w.name}`;
      const info = document.createElement('small');
      info.textContent = `전설 무기 · 총기 개조 → 상점에서 ${legendFor(id)?.price ?? 50}코인`;
      if (WEAPON_ICON[id]) {
        const img = document.createElement('img');
        img.className = 'weapon-icon';
        img.src = WEAPON_ICON[id];
        img.alt = '';
        btn.append(img);
      }
      btn.append(name, info);
      return btn;
    }
    const secrets = ids.map((h) => WEAPONS[h]).filter((s) => s.hidden && s.unlockFrom === id);
    const btn = secretChoiceButton(w, secrets, currentId, weaponLabel, (picked) => onPick(picked.id));
    if (w.legendary) btn.classList.add('legendary');
    return btn;
  });
}

export function choiceButton(label, pressed, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'choice';
  btn.setAttribute('aria-pressed', String(pressed));
  btn.addEventListener('click', () => {
    for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(b === btn));
    onClick();
  });
  if (typeof label === 'string') btn.textContent = label; else btn.append(...label);
  return btn;
}
