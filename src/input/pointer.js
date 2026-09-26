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

/** 무기 전환 버튼 글자: 지금 든 무기 이름. 읽기용 이름에는 칸(주무기·보조무기·수류탄)도 넣는다. */
function setSwapLabel(btn, playerId, weaponId, slot) {
  btn.textContent = WEAPONS[weaponId].name;
  btn.setAttribute('aria-label', `${playerId} 무기 전환, 현재 ${SLOT_NAME[slot]} ${WEAPONS[weaponId].name}`);
}

/**
 * 플레이어별 조작 패널을 만들고 입력 프레임에 연결한다. cancelAll()은 모든 스틱을 놓아 사격을 멈추고,
 * setWeapon(playerId, weaponId, slot)은 무기 전환 버튼의 표시를 바꾼다.
 */
export function createControls(groups, players, inputs) {
  const cancels = [];
  const swapButtons = {};
  const label = (id, weapon, slot) => setSwapLabel(swapButtons[id], id, weapon, slot);
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
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.className = 'swap-btn';
      swap.disabled = p.drone; // 드론은 전환할 무기가 없다
      swapButtons[p.id] = swap;
      label(p.id, p.weapon, p.slot);
      swap.addEventListener('pointerdown', (e) => { e.preventDefault(); frame.swap = true; });
      swap.addEventListener('click', (e) => { if (e.detail === 0) frame.swap = true; }); // 키보드로 누른 경우
      panel.append(header, swap, move, aim);
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
    setWeapon(playerId, weaponId, slot) {
      if (swapButtons[playerId]) label(playerId, weaponId, slot);
    },
  };
}
