/** 여러 화면에서 쓰는 작은 DOM 조각 */

export function weaponInfo(w) {
  if (w.beam) return `${w.interval}초마다 ${w.damage} · 배터리 ${w.battery.shots}발, 쉬면 ${w.battery.recharge}초 뒤 완충`;
  if (w.heat) return `${w.interval}초마다 ${w.damage} · ${w.heat.max}초 연사하면 과열 ${w.heat.cooldown}초`;
  if (w.thrown) return `아이템 버튼으로 던짐 · 반경 ${w.splash.radius} 폭발 ${w.splash.damage} · 쿨타임 ${w.interval}초`;
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

/** 무기를 그린 그림이 있는 무기(아킴보 석궁) */
const WEAPON_ICON = { crossbow: 'assets/ui/akimbo-crossbow.svg' };

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
  name.textContent = w.name;
  const info = document.createElement('small');
  info.textContent = weaponInfo(w);
  nodes.push(name, info);
  return nodes;
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
