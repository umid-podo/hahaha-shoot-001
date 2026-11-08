import { DEADZONE, TEAM_NAME, WEAPONS, SLOT_NAME } from '../game/config.js';

/** 축 하나(스틱 한 방향 변위): 데드존 안은 0, 바깥은 ±1까지 선형 보간. */
export function moveAxisFromDrag(dx, radius) {
  const v = Math.min(1, Math.max(-1, dx / radius));
  const mag = Math.abs(v);
  return mag < DEADZONE ? 0 : Math.sign(v) * (mag - DEADZONE) / (1 - DEADZONE);
}

/** 이동 스틱(1인칭): 위로 밀면 앞, 아래로 밀면 뒤, 옆으로 밀면 옆걸음. 데드존은 원으로 본다. { fwd, side } */
export function moveFromDrag(dx, dy, radius) {
  const len = Math.hypot(dx, dy) / radius;
  if (len < DEADZONE) return { fwd: 0, side: 0 };
  const k = Math.min(1, (Math.min(1, len) - DEADZONE) / (1 - DEADZONE)) / len;
  return { fwd: (-dy / radius) * k, side: (dx / radius) * k };
}

/**
 * 시선 스틱(1인칭): 옆으로 민 만큼 고개를 돌리고(turn -1~1, 조금씩 돌리기 쉽게 제곱 곡선), 데드존 밖으로 밀고 있는 동안
 * armed(발사). 위로 밀면 돌지 않고 정면으로 쏜다. 떼면 쏘는 무기(RPG·저격총)는 밀었다가 놓을 때 한 발.
 */
export function lookFromDrag(dx, dy, radius) {
  const armed = Math.hypot(dx, dy) / radius >= DEADZONE;
  const v = moveAxisFromDrag(dx, radius);
  return { turn: Math.sign(v) * v * v, armed };
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
      const move = stickElement('move', `${p.id} 이동키(앞뒤·옆걸음)`);
      const aim = stickElement('aim', `${p.id} 시선·발사키(옆으로 밀면 돌기, 밀고 있으면 발사)`);

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
      const jump = actionButton('jump-btn', () => { frame.jump = true; });
      jump.innerHTML = '<small>점프</small><span>▲</span>';
      jump.setAttribute('aria-label', `${p.id} 점프`);
      actions.append(primary, secondary, item, jump);
      buttons[p.id] = { primary, secondary, item, jump, slot: null, itemText: null };

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
        drag(dx, dy, radius, knob) {
          const m = moveFromDrag(dx, dy, radius);
          frame.touchFwd = m.fwd;
          frame.touchSide = m.side;
          placeKnob(knob, dx, dy, radius);
        },
        end() { frame.touchFwd = 0; frame.touchSide = 0; },
      }));
      cancels.push(bindStick(aim, {
        drag(dx, dy, radius, knob) {
          const r = lookFromDrag(dx, dy, radius);
          frame.touchTurn = r.turn;
          frame.aiming = r.armed;
          placeKnob(knob, dx, dy, radius);
        },
        end() { frame.touchTurn = 0; frame.aiming = false; },
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
        // 과냉각(공중전): 켜져 있는 동안은 '과냉각 ON'
        const secondaryText = p.primaryOnly ? '없음' : p.boost > 0 ? `${WEAPONS[p.secondary].name} ON`
          : left > 0 ? `${Math.ceil(left)}초` : WEAPONS[p.secondary].name;
        if (b.secondaryText !== secondaryText) {
          b.secondaryText = secondaryText;
          b.secondary.lastChild.textContent = secondaryText;
          b.secondary.classList.toggle('cooling', left > 0);
        }
        const ready = p.alive && p.grenadeCooldown <= 0;
        const text = p.primaryOnly ? '없음' : ready ? WEAPONS[p.item ?? 'grenade'].name : `${Math.ceil(p.grenadeCooldown)}초`;
        if (b.itemText !== text) {
          b.itemText = text;
          b.item.lastChild.textContent = text;
          b.item.classList.toggle('cooling', !ready);
        }
      }
    },
  };
}
