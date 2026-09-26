import { TEAM_NAME, TEAM_COLOR, CHARACTERS, WEAPONS, PRIMARY_IDS, TICK } from '../game/config.js';
import { KEY_LABELS } from '../input/keyboard.js';
import { createBalanceScreens } from './balance.js';

const $ = (selector) => document.querySelector(selector);
// 2인 조작 패널 한 개(이동키 + 버튼 + 발사키)가 들어가려면 필요한 대략의 화면 폭
const MIN_PANEL_WIDTH = 380;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const percent = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-');
function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const sourceName = (players, id) => (id === 'jet' ? '전투기' : players.find((p) => p.id === id)?.name ?? id);

/** 한 플레이어의 무기별 통계 합계 */
function totals(stats) {
  const t = { shots: 0, hits: 0, damage: 0, coverDamage: 0 };
  for (const w of Object.values(stats.weapons)) for (const k of Object.keys(t)) t[k] += w[k];
  return t;
}

export function weaponInfo(w) {
  if (w.beam) return `${w.interval}초마다 ${w.damage} · 배터리 ${w.battery.shots}발, 쉬면 ${w.battery.recharge}초 뒤 완충`;
  if (w.heat) return `${w.interval}초마다 ${w.damage} · ${w.heat.max}초 연사하면 과열 ${w.heat.cooldown}초`;
  if (w.thrown) return `아이템 버튼으로 던짐 · 반경 ${w.splash.radius} 폭발 ${w.splash.damage} · 쿨타임 ${w.interval}초`;
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
  const screens = {
    menu: $('#screen-menu'), ready: $('#screen-ready'), pause: $('#screen-pause'), result: $('#screen-result'),
    balance: $('#screen-balance'), summary: $('#screen-summary'),
  };

  function show(name) {
    game.hidden = !['game', 'pause', 'result'].includes(name);
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
    // 버튼 대신 제목에 포커스: 눌린 채 넘어온 Enter(P2 발사키) 반복이 버튼을 누르지 않게 한다.
    screens[name]?.querySelector('[tabindex="-1"]').focus();
  }

  $('#setup-btn').addEventListener('click', handlers.onSetup);
  for (const btn of document.querySelectorAll('.setup-again-btn')) btn.addEventListener('click', handlers.onSetup);
  const balance = createBalanceScreens({
    show,
    onChange: handlers.onBalanceChange,
    onClose() { handlers.onMenu(); },
  });
  $('#balance-btn').addEventListener('click', balance.open);
  $('#retry-btn').addEventListener('click', handlers.onRetryLoad);
  $('#start-btn').addEventListener('click', handlers.onStart);
  $('#back-btn').addEventListener('click', handlers.onMenu);
  // 경기 중 버튼은 누르는 즉시 반응: 더블탭 확대 방지로 빠른 두 번째 탭의 click이 사라질 수 있다(src/input/gestures.js).
  const pauseBtn = $('#pause-btn');
  pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); handlers.onPause(); });
  pauseBtn.addEventListener('click', (e) => { if (e.detail === 0) handlers.onPause(); }); // 키보드로 누른 경우
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
      $('#setup-btn').disabled = false;
    },
    /** 메인 메뉴에 밸런스 변경 여부를 알린다. */
    setBalanceStatus(changedCount) {
      $('#balance-status').hidden = changedCount === 0;
      $('#balance-status').textContent = `밸런스 수치 ${changedCount}개가 기본값과 다릅니다.`;
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
      const { winner, players, stats } = match;
      const time = match.tick * TICK;
      $('#result-time').textContent = `경기 시간 ${formatTime(time)}`;
      const winnerPlayer = players.find((p) => p.team === winner);
      $('#result-title').textContent = winner === 'draw' ? '무승부'
        : `${winnerPlayer.id} ${winnerPlayer.name} (${TEAM_NAME[winner]}) 승리!`;

      // 플레이어 카드: 승패, 남은 체력, 핵심 수치
      $('#result-players').replaceChildren(...players.map((p) => {
        const s = stats[p.id];
        const t = totals(s);
        const card = el('article', `result-player team-${p.team}`);
        const outcome = winner === 'draw' ? '무승부' : winner === p.team ? '승리' : '패배';
        const head = el('div', 'result-head');
        const img = el('img');
        img.src = CHARACTERS.find((c) => c.id === p.characterId)?.image ?? `assets/characters/${p.characterId}.png`;
        img.alt = '';
        const who = el('div');
        who.append(el('b', '', `${p.id} ${p.name}`), el('small', '', `${TEAM_NAME[p.team]} · ${WEAPONS[p.primary].name}`));
        head.append(img, who, el('span', `outcome ${outcome === '승리' ? 'win' : ''}`, outcome));

        const hp = el('div', 'hp-line');
        const meter = el('div', 'hp-meter');
        const fill = el('i');
        fill.style.width = `${(p.hp / p.maxHp) * 100}%`;
        meter.append(fill);
        hp.append(el('span', '', '남은 체력'), meter, el('b', '', `${p.hp} / ${p.maxHp}`));

        const facts = el('dl', 'facts');
        const fact = (label, value) => { facts.append(el('dt', '', label), el('dd', '', value)); };
        fact('준 피해', String(t.damage));
        fact('받은 피해', String(s.taken));
        fact('초당 피해', time > 0 ? (t.damage / time).toFixed(1) : '0');
        fact('명중률', `${percent(t.hits, t.shots)} (${t.hits}/${t.shots})`);
        fact('엄폐물 피해', String(t.coverDamage));
        fact('전투기에게 받은 피해', String(s.takenFrom.jet ?? 0));
        if (s.killedBy) {
          fact('쓰러짐', `${formatTime(s.downAt ?? time)} · ${sourceName(players, s.killedBy.ownerId)}의 ${WEAPONS[s.killedBy.weapon]?.name ?? '미사일'}`);
        }
        card.append(head, hp, facts);
        return card;
      }));

      // 준 피해 비교 막대
      const dealt = players.map((p) => totals(stats[p.id]).damage);
      const sum = dealt.reduce((a, b) => a + b, 0);
      const compare = $('#result-damage');
      compare.replaceChildren(...players.map((p, i) => {
        const seg = el('div', 'seg', `${p.id} ${dealt[i]}`);
        seg.style.flexGrow = String(sum > 0 ? dealt[i] : 1);
        seg.style.background = TEAM_COLOR[p.team];
        return seg;
      }));
      compare.setAttribute('aria-label', `준 피해 비교: ${players.map((p, i) => `${p.id} ${dealt[i]}`).join(', ')}`);

      // 무기별 표: 쏜 무기만, 주무기 → 보조무기 → 아이템 순
      const order = [...PRIMARY_IDS, 'laser', 'smg', 'grenade'];
      const rows = [];
      for (const p of players) {
        const used = order.filter((id) => stats[p.id].weapons[id]);
        if (used.length === 0) {
          const tr = el('tr', `team-${p.team}`);
          tr.append(el('th', '', `${p.id} ${p.name}`), el('td', 'empty', '쏘지 않음'));
          tr.lastChild.colSpan = 7;
          tr.firstChild.scope = 'row';
          rows.push(tr);
          continue;
        }
        for (const id of used) {
          const w = stats[p.id].weapons[id];
          const tr = el('tr', `team-${p.team}`);
          const th = el('th', '', `${p.id} ${p.name}`);
          th.scope = 'row';
          tr.append(th, el('td', '', WEAPONS[id].name), el('td', '', String(w.shots)), el('td', '', String(w.hits)),
            el('td', '', percent(w.hits, w.shots)), el('td', 'num-strong', String(w.damage)),
            el('td', '', w.shots ? (w.damage / w.shots).toFixed(1) : '-'), el('td', '', String(w.coverDamage)));
          rows.push(tr);
        }
      }
      $('#result-weapons tbody').replaceChildren(...rows);
      show('result');
    },
    announce(text) { $('#live').textContent = text; },
    syncSettings(settings) {
      for (const btn of document.querySelectorAll('.mute-toggle')) btn.setAttribute('aria-pressed', settings.muted);
      $('#motion-toggle').setAttribute('aria-pressed', settings.reducedMotion);
    },
  };
}
