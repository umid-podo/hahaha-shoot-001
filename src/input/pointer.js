import { DEADZONE, TEAM_NAME, WEAPONS, SLOT_NAME, SLOT_WEAPON } from '../game/config.js';

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
 * 이동키와 발사키 사이를 최대한 벌린다. 가운데 빈 곳에는 주무기·보조무기 바로 선택과 수류탄(아이템) 던지기 버튼.
 * cancelAll()은 모든 스틱을 놓아 사격을 멈추고, sync(players)는 매 프레임 버튼 상태(든 무기·수류탄 쿨타임)를 맞춘다.
 */
export function createControls(groups, players, inputs) {
  const cancels = [];
  const buttons = {};
  for (const team of ['earth', 'isb']) {
    groups[team].replaceChildren();
    for (const p of players.filter((pl) => pl.team === team)) {
      const frame = inputs[p.id];
      const panel = document.createElement('div');
      panel.className = `panel team-${team}`;
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
      const secondary = slotBtn('secondary', SLOT_WEAPON.secondary);
      const item = actionButton('item-btn', () => { frame.item = true; });
      item.innerHTML = '<small>아이템</small><span></span>';
      item.setAttribute('aria-label', `${p.id} 수류탄 던지기`);
      // 드론은 레이저 캐논 하나뿐이고 아이템도 없다
      secondary.disabled = p.drone;
      item.disabled = p.drone;
      actions.append(primary, secondary, item);
      buttons[p.id] = { primary, secondary, item, slot: null, itemText: null };

      const middle = document.createElement('div');
      middle.className = 'panel-mid';
      middle.append(header, actions);
      panel.append(move, middle, aim);
      groups[team].append(panel);

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
    sync(list) {
      for (const p of list) {
        const b = buttons[p.id];
        if (!b) continue;
        if (b.slot !== p.slot) {
          b.slot = p.slot;
          b.primary.setAttribute('aria-pressed', String(p.slot === 'primary'));
          b.secondary.setAttribute('aria-pressed', String(p.slot === 'secondary'));
        }
        const ready = p.alive && p.grenadeCooldown <= 0;
        const text = p.drone ? '없음' : ready ? '수류탄' : `${Math.ceil(p.grenadeCooldown)}초`;
        if (b.itemText !== text) {
          b.itemText = text;
          b.item.lastChild.textContent = text;
          b.item.classList.toggle('cooling', !ready);
        }
      }
    },
  };
}
