import { TEAM_NAME, CHARACTERS, WEAPONS, PRIMARY_IDS } from '../game/config.js';
import { KEY_LABELS } from '../input/keyboard.js';

const $ = (selector) => document.querySelector(selector);
const MIN_PANEL_WIDTH = 220;

export function weaponInfo(w) {
  if (w.beam) return `${w.interval}초마다 ${w.damage} · 배터리 ${w.battery.shots}발, 쉬면 ${w.battery.recharge}초 뒤 완충`;
  if (w.heat) return `${w.interval}초마다 ${w.damage} · ${w.heat.max}초 연사하면 과열 ${w.heat.cooldown}초`;
  if (w.thrown) return `떼면 던짐 · 반경 ${w.splash.radius} 폭발 ${w.splash.damage} · 쿨타임 ${w.interval}초`;
  if (w.trigger === 'release') {
    const splash = w.splash ? ` · 폭발 범위 ${w.splash.damage}` : '';
    const note = w.note ? ` · ${w.note}` : '';
    return `조준 후 떼면 발사 · 쿨타임 ${w.interval}초 · 한 발 ${w.damage}${splash}${note}`;
  }
  const shots = w.burst > 1 ? `${w.burst}점사 ` : '';
  const splash = w.splash ? ` · 폭발 범위 ${w.splash.damage}` : '';
  return `${w.interval}초마다 ${shots}· 한 발 ${w.damage}${splash}`;
}

function choiceButton(label, pressed, onClick) {
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

/** 메뉴·준비·일시정지·결과 DOM 화면. 'pause'와 'result'는 경기 화면 위에 겹친다. */
export function createScreens(handlers) {
  const game = $('#game');
  const screens = { menu: $('#screen-menu'), ready: $('#screen-ready'), pause: $('#screen-pause'), result: $('#screen-result') };

  function show(name) {
    game.hidden = name === 'menu' || name === 'ready';
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
    // 버튼 대신 제목에 포커스: 눌린 채 넘어온 Enter(P2 발사키) 반복이 버튼을 누르지 않게 한다.
    screens[name]?.querySelector('[tabindex="-1"]').focus();
  }

  for (const btn of document.querySelectorAll('.count-btn')) {
    btn.addEventListener('click', () => handlers.onSelectCount(Number(btn.dataset.count)));
  }
  $('#retry-btn').addEventListener('click', handlers.onRetryLoad);
  $('#start-btn').addEventListener('click', handlers.onStart);
  $('#back-btn').addEventListener('click', handlers.onMenu);
  $('#pause-btn').addEventListener('click', handlers.onPause);
  $('#resume-btn').addEventListener('click', handlers.onResume);
  for (const btn of document.querySelectorAll('.restart-btn')) btn.addEventListener('click', handlers.onStart);
  for (const btn of document.querySelectorAll('.menu-btn')) btn.addEventListener('click', handlers.onMenu);
  for (const btn of document.querySelectorAll('.mute-toggle')) btn.addEventListener('click', handlers.onToggleMute);
  $('#motion-toggle').addEventListener('click', handlers.onToggleMotion);

  return {
    show,
    setLoading() {
      $('#load-status').hidden = false;
      $('#load-status').textContent = '에셋을 불러오는 중…';
      $('#retry-btn').hidden = true;
    },
    setLoadError(path) {
      $('#load-status').textContent = `불러오지 못했습니다: ${path}`;
      $('#retry-btn').hidden = false;
    },
    setLoaded() {
      $('#load-status').hidden = true;
      for (const btn of document.querySelectorAll('.count-btn')) btn.disabled = false;
    },
    /** 자리마다 캐릭터(4명 중 자유)와 총기를 고른다. 고를 때마다 handlers.onPick(slotId, key, value) */
    showReady(slots, loadout) {
      $('#slot-list').replaceChildren(...slots.map((s) => {
        const pick = loadout[s.id];
        const li = document.createElement('li');
        li.className = `team-${s.team}`;
        const title = document.createElement('b');
        title.textContent = `${s.id} · ${TEAM_NAME[s.team]}`;

        const chars = document.createElement('div');
        chars.className = 'choices characters';
        chars.setAttribute('role', 'group');
        chars.setAttribute('aria-label', `${s.id} 캐릭터`);
        for (const c of CHARACTERS) {
          const img = document.createElement('img');
          img.src = c.image ?? `assets/characters/${c.id}.png`;
          img.alt = '';
          const name = document.createElement('span');
          name.textContent = c.name;
          chars.append(choiceButton([img, name], pick.characterId === c.id, () => {
            handlers.onPick(s.id, 'characterId', c.id);
            syncWeapons();
          }));
        }

        const weapons = document.createElement('div');
        weapons.className = 'choices weapons';
        weapons.setAttribute('role', 'group');
        weapons.setAttribute('aria-label', `${s.id} 총기`);
        for (const id of PRIMARY_IDS) {
          const name = document.createElement('span');
          name.textContent = WEAPONS[id].name;
          const info = document.createElement('small');
          info.textContent = weaponInfo(WEAPONS[id]);
          weapons.append(choiceButton([name, info], pick.weapon === id,
            () => handlers.onPick(s.id, 'weapon', id)));
        }

        // 드론을 고르면 주무기 선택 대신 전용 무기 안내
        const droneNote = document.createElement('small');
        droneNote.className = 'drone-note';
        function syncWeapons() {
          const character = CHARACTERS.find((c) => c.id === loadout[s.id].characterId);
          weapons.hidden = !!character?.drone;
          droneNote.hidden = !character?.drone;
          if (character?.drone) {
            const w = WEAPONS[character.weapon];
            droneNote.textContent = `${character.name} 전용: ${w.name} (${weaponInfo(w)}) · 보조무기·수류탄 없음`;
          }
        }
        syncWeapons();

        const keys = document.createElement('small');
        keys.textContent = `키보드: ${KEY_LABELS[s.id]}`;
        li.append(title, chars, weapons, droneNote, keys);
        return li;
      }));
      $('#narrow-warning').hidden = window.innerWidth / slots.length >= MIN_PANEL_WIDTH;
      show('ready');
    },
    showResult(match) {
      const { winner, players } = match;
      $('#result-title').textContent = winner === 'draw' ? '무승부' : `${TEAM_NAME[winner]} 우승!`;
      const alive = (team) => players.filter((p) => p.team === team && p.alive).length;
      const total = (team) => players.filter((p) => p.team === team).length;
      $('#result-score').textContent =
        `생존 ${TEAM_NAME.earth} ${alive('earth')}/${total('earth')} : ${alive('isb')}/${total('isb')} ${TEAM_NAME.isb}`;
      show('result');
    },
    announce(text) { $('#live').textContent = text; },
    syncSettings(settings) {
      for (const btn of document.querySelectorAll('.mute-toggle')) btn.setAttribute('aria-pressed', settings.muted);
      $('#motion-toggle').setAttribute('aria-pressed', settings.reducedMotion);
    },
  };
}
