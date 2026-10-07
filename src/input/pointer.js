import { DEADZONE, TEAM_NAME, WEAPONS, SLOT_NAME } from '../game/config.js';

/** 이동 스틱: X 변위만 사용. 데드존 안은 0, 바깥은 ±1까지 선형 보간. */
export function moveAxisFromDrag(dx, radius) {
  const v = Math.min(1, Math.max(-1, dx / radius));
  const mag = Math.abs(v);
  return mag < DEADZONE ? 0 : Math.sign(v) * (mag - DEADZONE) / (1 - DEADZONE);
}

/**
 * 조준 스틱: 자기 레일에서 상대 레일을 향하는 반원으로 제한한다.
 * 반대쪽 Y 성분은 0으로 자르고, 남은 벡터가 데드존 밖일 때만 armed(조준 중 → 자동 발사).
 */
export function aimFromDrag(dx, dy, radius, team, previousAim) {
  const cy = team === 'isb' ? Math.max(0, dy) : Math.min(0, dy);
  const armed = Math.hypot(dx, cy) / radius >= DEADZONE;
  if (dx === 0 && cy === 0) return { aim: previousAim, armed, x: 0, y: 0 };
  const angle = Math.abs(Math.atan2(cy, dx)); // 상단 [0, π], 하단 [-π, 0]
  return { aim: team === 'isb' ? angle : -angle, armed, x: dx, y: cy };
}

function placeKnob(knob, x, y, radius) {
  const len = Math.hypot(x, y);
  const k = len > radius ? radius / len : 1;
  knob.style.transform = `translate(${x * k}px, ${y * k}px)`;
}

function bindStick(el, handlers) {
  const knob = el.querySelector('.knob');
  let pointerId = null, cx = 0, cy = 0, radius = 1;
  const drag = (e) => handlers.drag(e.clientX - cx, e.clientY - cy, radius, knob);
  const end = () => {
    if (pointerId === null) return;
    pointerId = null;
    knob.style.transform = '';
    handlers.end();
  };
  el.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    el.setPointerCapture(pointerId);
    const rect = el.getBoundingClientRect();
    cx = rect.left + rect.width / 2; cy = rect.top + rect.height / 2; radius = rect.width / 2;
    drag(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === pointerId) drag(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(type, (e) => { if (e.pointerId === pointerId) end(); });
  }
  return end;
}

function stickElement(kind, label) {
  const el = document.createElement('div');
  el.className = `stick stick-${kind}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.innerHTML = '<div class="knob"></div>';
  return el;
}

/** 누르는 즉시 반응하는 버튼(터치 지연 없음). 키보드로 누른 경우(click detail 0)도 받는다. */
function actionButton(className, onPress) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!btn.disabled) onPress(); });
  btn.addEventListener('click', (e) => { if (e.detail === 0) onPress(); });
  return btn;
}

/**
 * 플레이어별 조작 패널: 이동키 | 가운데 무기·아이템 버튼 | 발사키. 패널이 화면 절반을 채우고 두 스틱을 양 끝에 둬
 * 이동키와 발사키 사이를 최대한 벌린다. 가운데 빈 곳에는 고른 주무기·보조무기 바로 선택과 수류탄(아이템) 던지기 버튼.
 * cancelAll()은 모든 스틱을 놓아 사격을 멈추고, sync(players)는 매 프레임 버튼 상태(든 무기·수류탄 쿨타임)를 맞춘다.
 * sideOf(p)는 패널을 놓을 쪽('earth' 왼쪽·'isb' 오른쪽). 기본은 팀 쪽이고, 스토리 모드 2인 협동의 P2는 지구방위팀이어도 오른쪽.
 * wide(스토리 모드 1인): 패널 하나가 화면 너비를 다 쓰고, 이동키는 왼쪽 끝·발사키는 오른쪽 끝, 무기·아이템 버튼은 발사키 바로 옆.
 */
export function createControls(groups, players, inputs, sideOf = (p) => p.team, { wide = false } = {}) {
  const cancels = [];
  const buttons = {};
  for (const side of ['earth', 'isb']) {
    groups[side].replaceChildren();
    for (const p of players.filter((pl) => sideOf(pl) === side)) {
      const { team } = p;
      const frame = inputs[p.id];
      const panel = document.createElement('div');
      panel.className = `panel team-${team}${wide ? ' wide' : ''}`;
      const header = document.createElement('div');
      header.className = 'panel-head';
      header.textContent = `${p.id} · ${p.name}`;
      header.title = TEAM_NAME[team];
      const move = stickElement('move', `${p.id} 이동키`);
      const aim = stickElement('aim', `${p.id} 발사키`);

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', `${p.id} 무기·아이템`);
      const slotBtn = (slot, weaponId) => {
        const btn = actionButton('weapon-btn', () => { frame.select = slot; });
        btn.innerHTML = `<small>${SLOT_NAME[slot]}</small><span></span>`;
        btn.lastChild.textContent = WEAPONS[weaponId].name;
        btn.setAttribute('aria-label', `${p.id} ${SLOT_NAME[slot]} ${WEAPONS[weaponId].name}`);
        return btn;
      };
      const primary = slotBtn('primary', p.primary);
      const secondary = slotBtn('secondary', p.secondary);
      const item = actionButton('item-btn', () => { frame.item = true; });
      item.innerHTML = '<small>아이템</small><span></span>';
      item.setAttribute('aria-label', `${p.id} 수류탄 던지기`);
      // 전용 무기 캐릭터는 주무기 하나뿐이고 아이템도 없다
      secondary.disabled = p.primaryOnly;
      item.disabled = p.primaryOnly;
      actions.append(primary, secondary, item);
      buttons[p.id] = { primary, secondary, item, slot: null, itemText: null };

      const middle = document.createElement('div');
      middle.className = 'panel-mid';
      if (wide) {
        // 넓은 패널: 이동키 | 이름(가운데 빈 곳) | 무기·아이템 버튼 | 발사키
        middle.append(header);
        panel.append(move, middle, actions, aim);
      } else {
        middle.append(header, actions);
        panel.append(move, middle, aim);
      }
      groups[side].append(panel);

      cancels.push(bindStick(move, {
        drag(dx, _dy, radius, knob) {
          frame.touchAxis = moveAxisFromDrag(dx, radius);
          placeKnob(knob, dx, 0, radius);
        },
        end() { frame.touchAxis = 0; },
      }));
      cancels.push(bindStick(aim, {
        drag(dx, dy, radius, knob) {
          const r = aimFromDrag(dx, dy, radius, p.team, frame.aim);
          frame.aim = r.aim;
          frame.aiming = r.armed;
          placeKnob(knob, r.x, r.y, radius);
        },
        end() { frame.aiming = false; },
      }));
    }
  }
  return {
    cancelAll() { for (const cancel of cancels) cancel(); },
    /** elapsed: 경기 시작 뒤 흐른 시간(즉사기 남은 시간 표시용) */
    sync(list, elapsed = 0) {
      for (const p of list) {
        const b = buttons[p.id];
        if (!b) continue;
        if (b.slot !== p.slot) {
          b.slot = p.slot;
          b.primary.setAttribute('aria-pressed', String(p.slot === 'primary'));
          b.secondary.setAttribute('aria-pressed', String(p.slot === 'secondary'));
        }
        // 즉사기: 다시 쓸 수 있을 때까지(전투 시작 대기·쏜 뒤 쿨타임) 주무기 버튼에 남은 초
        const primaryWeapon = WEAPONS[p.primary];
        const wait = primaryWeapon.instakill ? Math.max(primaryWeapon.readyAfter - elapsed, p.cooldown) : 0;
        const primaryText = !primaryWeapon.instakill ? primaryWeapon.name
          : wait > 0 ? `${primaryWeapon.name} ${Math.ceil(wait)}초`
          : `${primaryWeapon.name} 준비!`;
        if (b.primaryText !== primaryText) {
          b.primaryText = primaryText;
          b.primary.lastChild.textContent = primaryText;
        }
        // 단검·샷건: 쿨타임 동안 보조무기 버튼에 남은 초
        const left = WEAPONS[p.secondary]?.ownCooldown ? p.cooldowns[p.secondary] ?? 0 : 0;
        const secondaryText = p.primaryOnly ? '없음' : left > 0 ? `${Math.ceil(left)}초` : WEAPONS[p.secondary].name;
        if (b.secondaryText !== secondaryText) {
          b.secondaryText = secondaryText;
          b.secondary.lastChild.textContent = secondaryText;
          b.secondary.classList.toggle('cooling', left > 0);
        }
        const ready = p.alive && p.grenadeCooldown <= 0;
        const text = p.primaryOnly ? '없음' : ready ? '수류탄' : `${Math.ceil(p.grenadeCooldown)}초`;
        if (b.itemText !== text) {
          b.itemText = text;
          b.item.lastChild.textContent = text;
          b.item.classList.toggle('cooling', !ready);
        }
      }
    },
  };
}
