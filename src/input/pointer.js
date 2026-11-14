import { DEADZONE, TEAM_NAME, WEAPONS, SLOT_NAME, EVADE } from '../game/config.js';

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
 * armed(발사). 위로 살짝 밀면 돌지 않고 정면으로 쏘고, 위아래로 크게 밀면 고개를 들고 숙인다(look). 떼면 쏘는 무기(RPG·저격총)는 밀었다가 놓을 때 한 발.
 */
export function lookFromDrag(dx, dy, radius) {
  const armed = Math.hypot(dx, dy) / radius >= DEADZONE;
  const v = moveAxisFromDrag(dx, radius);
  // 위아래: 절반 넘게 크게 밀어야 고개를 든다(살짝 위로 밀면 그대로 정면 사격)
  const k = Math.min(1, Math.abs(dy) / radius);
  const look = k < 0.5 ? 0 : -Math.sign(dy) * ((k - 0.5) / 0.5) ** 2;
  return { turn: Math.sign(v) * v * v, armed, look };
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
      // 보조무기 칸마다 버튼(최대 3개)
      const seconds = (p.secondaries ?? [p.secondary]).map((id, i) => slotBtn(i === 0 ? 'secondary' : `secondary${i + 1}`, id));
      const secondary = seconds[0];
      const item = actionButton('item-btn', () => { frame.item = true; frame.touchItem = true; });
      // 강습 건쉽 게틀링: 누르고 있는 동안 연사(손을 떼면 멈춤)
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) item.addEventListener(type, () => { frame.touchItem = false; });
      item.innerHTML = '<small>아이템</small><span></span>';
      item.setAttribute('aria-label', `${p.id} 수류탄 던지기`);
      // 전용 무기 캐릭터는 주무기 하나뿐이고 아이템도 없다
      for (const b of seconds) b.disabled = p.primaryOnly;
      item.disabled = p.primaryOnly || p.noItem;
      const jump = actionButton('jump-btn', () => { frame.jump = true; frame.touchJump = true; });
      // 꾹 누르고 있는 동안 더 높이 뛴다(손을 떼면 그만 모은다)
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) jump.addEventListener(type, () => { frame.touchJump = false; });
      // 강습 건쉽: 점프 버튼은 고도 올리기, 회피 버튼은 고도 내리기(누르고 있는 동안)
      jump.innerHTML = p.flier ? '<small>올라가기</small><span>▲</span>' : '<small>점프</small><span>▲</span>';
      jump.setAttribute('aria-label', `${p.id} 점프`);
      const evade = actionButton('evade-btn', () => { frame.evade = true; frame.touchDescend = true; });
      // 강습 건쉽: 회피 버튼을 누르고 있는 동안 고도를 내린다(점프 버튼은 올림)
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) evade.addEventListener(type, () => { frame.touchDescend = false; });
      evade.innerHTML = p.flier ? '<small>내려가기</small><span>▼</span>' : '<small>회피</small><span></span>';
      evade.setAttribute('aria-label', `${p.id} 회피(빠른 돌진, 2번 연속)`);
      evade.disabled = false;
      actions.append(primary, ...seconds, item, jump, evade);
      buttons[p.id] = { primary, secondary, seconds, item, jump, evade, slot: null, itemText: null, evadeText: null, secondTexts: [] };

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
          frame.touchLook = r.look;
          frame.aiming = r.armed;
          placeKnob(knob, dx, dy, radius);
        },
        end() { frame.touchTurn = 0; frame.touchLook = 0; frame.aiming = false; },
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
          b.seconds.forEach((btn, i) => btn.setAttribute('aria-pressed', String(p.slot === (i === 0 ? 'secondary' : `secondary${i + 1}`))));
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
        // 보조무기 칸마다: 쿨타임 동안 남은 초, 과냉각(공중전)이 켜져 있으면 'ON', 방패를 세웠으면 남은 막을 피해
        (p.secondaries ?? [p.secondary]).forEach((id, i) => {
          const btn = b.seconds[i];
          if (!btn) return;
          const w = WEAPONS[id];
          const left = w?.ownCooldown ? p.cooldowns[id] ?? 0 : 0;
          const text = p.primaryOnly ? '없음' : w?.boost && p.boost > 0 ? `${w.name} ON`
            : w?.shield && p.shield ? `방패 ${Math.ceil(p.shield.hp)}` : left > 0 ? `${Math.ceil(left)}초` : w?.name ?? '';
          if (b.secondTexts[i] !== text) {
            b.secondTexts[i] = text;
            btn.lastChild.textContent = text;
            btn.classList.toggle('cooling', left > 0);
          }
        });
        // 회피: 남은 횟수를 점으로(●●), 다 쓰면 다시 채워질 때까지 회색
        const charges = p.evadeCharges ?? EVADE.charges;
        const evadeText = p.flier || p.plane ? '▼' : '●'.repeat(charges) + '○'.repeat(Math.max(0, EVADE.charges - charges));
        if (b.evadeText !== evadeText) {
          b.evadeText = evadeText;
          b.evade.lastChild.textContent = evadeText;
          // 공중전에서 강습 건쉽으로 바뀌거나 내리면 점프·회피 버튼 이름도 바꾼다
          b.evade.firstChild.textContent = p.flier || p.plane ? '내려가기' : '회피';
          b.jump.firstChild.textContent = p.flier || p.plane ? '올라가기' : '점프';
          b.evade.classList.toggle('cooling', !p.flier && !p.plane && charges <= 0);
        }
        b.evade.disabled = false; // 공중전 라이트닝은 회피 버튼으로 고도를 내린다
        b.item.disabled = !!(p.primaryOnly || p.noItem);
        const ready = p.alive && (p.grenadeCooldown <= 0 || !!WEAPONS[p.item]?.hold); // 연사 아이템(게틀링)은 늘 이름으로
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
