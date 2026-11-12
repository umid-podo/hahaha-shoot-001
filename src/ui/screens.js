import { createWorkshop } from './workshop.js';
import { modStore } from '../game/mods.js';
import {
  TEAM_NAME, TEAM_COLOR, CHARACTERS, WEAPONS, PRIMARY_IDS, SECONDARY_IDS, DEFAULT_SECONDARY, MAX_SECONDARIES, normalizeSecondaries, TICK, MAPS,
} from '../game/config.js';
import { TIERS, ACCOUNTS, MAX_LEVEL, accountName, rankLabel, rankProgress } from '../game/rank.js';
import { loadRank } from '../storage/settings.js';
import { accountKey } from '../game/mods.js';
import { KEY_LABELS } from '../input/keyboard.js';
import { PAD_LABEL } from '../input/gamepad.js';
import { createBalanceScreens } from './balance.js';
import { createSingleSetup } from './single.js';
import { createStorySetup } from './story.js';
import { DEATHSTAR_NAME, COOP_SLOT, waveLabel, ENDLESS } from '../game/story.js';
import { weaponInfo, secretChoiceButton, weaponButtons, weaponLabel } from './widgets.js';

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
const OTHER_SOURCES = { jet: '전투기', turret: '포탑', tank: '탱크', ship: '배' };
const sourceName = (players, id) => OTHER_SOURCES[id] ?? players.find((p) => p.id === id)?.name ?? id;
/** 쓰러뜨린 무기 이름. 전투기·포탑은 무기표에 없다. */
const killWeaponName = (killedBy) => WEAPONS[killedBy.weapon]?.name ?? (killedBy.weapon === 'turret' || killedBy.weapon === 'tank' ? '포탄' : killedBy.weapon === 'ship' ? '대포' : '미사일');

/** 한 플레이어의 무기별 통계 합계 */
function totals(stats) {
  const t = { shots: 0, hits: 0, damage: 0, coverDamage: 0 };
  for (const w of Object.values(stats.weapons)) for (const k of Object.keys(t)) t[k] += w[k];
  return t;
}

/**
 * 자리 하나의 캐릭터·주무기 선택 목록(li). 고를 때마다 onPick(slotId, key, value).
 * heading을 주면 자리 이름 대신 쓴다.
 */
function slotItem(s, loadout, onPick, heading = `${s.id} · ${TEAM_NAME[s.team]}`) {
  const pick = loadout[s.id];
  const li = document.createElement('li');
  li.className = `team-${s.team}`;
  const title = document.createElement('b');
  title.textContent = heading;

  const chars = document.createElement('div');
  chars.className = 'choices characters';
  chars.setAttribute('role', 'group');
  chars.setAttribute('aria-label', `${s.id} 캐릭터`);
  for (const c of CHARACTERS.filter((ch) => !ch.hidden)) {
    // 숨겨진 캐릭터: 이 버튼을 빠르게 unlockTaps번(기본 3번) 누르면 버튼이 그 숨겨진 캐릭터로 바뀐다.
    // 온이름은 2번 아크 트루퍼, 3번 제작자.
    // 숨겨진 캐릭터가 된 버튼을 (연타가 아니게) 한 번 누르면 원래 캐릭터로 돌아온다.
    const secrets = CHARACTERS.filter((h) => h.hidden && h.unlockFrom === c.id);
    const label = (ch) => {
      const img = document.createElement('img');
      img.alt = '';
      img.src = ch.image ?? `assets/characters/${ch.id}.png`;
      const name = document.createElement('span');
      name.textContent = ch.name;
      return [img, name];
    };
    chars.append(secretChoiceButton(c, secrets, pick.characterId, label, (ch) => {
      onPick(s.id, 'characterId', ch.id);
      // 그림에서 무기를 든 캐릭터(코드네임 X 등)는 주무기도 그 무기로(그 뒤에 다시 바꿀 수 있다)
      if (ch.pictured && loadout[s.id].weapon !== ch.pictured) {
        onPick(s.id, 'weapon', ch.pictured);
        buildWeapons();
      }
      syncWeapons();
    }));
  }

  // 무기 선택: 주무기 줄과 보조무기 줄
  const weaponRow = (label, ids, key, current) => {
    const row = document.createElement('div');
    row.className = 'choices weapons';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${s.id} ${label}`);
    // 숨겨진 무기(아킴보 석궁)는 쌍권총 버튼을 빠르게 2번 눌러 부른다
    row.append(...weaponButtons(WEAPONS, ids, current, (id) => onPick(s.id, key, id)));
    const heading = document.createElement('div');
    heading.className = 'field-label';
    heading.textContent = label;
    return [heading, row];
  };
  /**
   * 보조무기 줄: 최대 MAX_SECONDARIES개까지 골라 들고 간다(누를 때마다 넣고 빼기, 고른 순서가 보조무기 1·2·3 칸).
   * 이미 가득이면 가장 먼저 고른 것을 빼고 새로 넣는다. 하나는 꼭 남는다.
   */
  const secondaryRow = () => {
    const now = loadout[s.id];
    let picked = normalizeSecondaries(now.secondaries ?? [now.secondary ?? DEFAULT_SECONDARY]);
    const row = document.createElement('div');
    row.className = 'choices weapons multi';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${s.id} 보조무기(최대 ${MAX_SECONDARIES}개)`);
    const items = SECONDARY_IDS.filter((id) => !WEAPONS[id].hidden).map((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice';
      const order = document.createElement('b');
      order.className = 'pick-order';
      btn.append(order, ...weaponLabel(WEAPONS[id]));
      btn.addEventListener('click', () => {
        if (picked.includes(id)) { if (picked.length > 1) picked = picked.filter((x) => x !== id); }
        else picked = [...picked, id].slice(-MAX_SECONDARIES);
        onPick(s.id, 'secondaries', picked);
        onPick(s.id, 'secondary', picked[0]);
        sync();
      });
      return { id, btn, order };
    });
    function sync() {
      for (const { id, btn, order } of items) {
        const i = picked.indexOf(id);
        btn.setAttribute('aria-pressed', String(i >= 0));
        order.textContent = i >= 0 ? String(i + 1) : '';
      }
    }
    sync();
    row.append(...items.map((it) => it.btn));
    const heading = document.createElement('div');
    heading.className = 'field-label';
    heading.textContent = `보조무기 (최대 ${MAX_SECONDARIES}개 · 고른 순서대로 보조무기 1·2·3 칸)`;
    return [heading, row];
  };
  const weapons = document.createElement('div');
  weapons.className = 'weapon-picks';
  function buildWeapons() {
    const now = loadout[s.id];
    weapons.replaceChildren(
      ...weaponRow('주무기', PRIMARY_IDS, 'weapon', now.weapon),
      ...secondaryRow(),
    );
  }
  buildWeapons();

  // 전용 무기 캐릭터(R-10·숨겨진 캐릭터)를 고르면 무기 선택 대신 전용 무기 안내
  const droneNote = document.createElement('small');
  droneNote.className = 'drone-note';
  function syncWeapons() {
    const character = CHARACTERS.find((c) => c.id === loadout[s.id].characterId);
    weapons.hidden = !!character?.weapon;
    droneNote.hidden = !character?.weapon;
    if (character?.weapon) {
      const w = WEAPONS[character.weapon];
      droneNote.textContent = `${character.name} 전용: ${w.name} (${weaponInfo(w)}) · 보조무기·수류탄 없음`;
    }
  }
  syncWeapons();

  const keys = document.createElement('small');
  keys.textContent = `키보드: ${KEY_LABELS[s.id]}`;
  const pad = document.createElement('small');
  pad.textContent = `${s.id === 'P1' ? '첫 번째' : '두 번째'} ${PAD_LABEL}`;
  li.append(title, chars, weapons, droneNote, keys, pad);
  return li;
}

/** 메뉴·준비·일시정지·결과 DOM 화면. 'pause'와 'result'는 경기 화면 위에 겹친다. */
export function createScreens(handlers) {
  const game = $('#game');
  const screens = {
    menu: $('#screen-menu'), ready: $('#screen-ready'), pause: $('#screen-pause'), result: $('#screen-result'),
    balance: $('#screen-balance'), summary: $('#screen-summary'), single: $('#screen-single'), mod: $('#screen-mod'),
    account: $('#screen-account'),
  };

  /** 메인 메뉴 '총기 개조' 버튼의 가진 코인 표시 */
  const syncMenuCoins = () => { $('#menu-coins').textContent = `🪙 ${modStore().coins}`; };
  modStore().onChange(syncMenuCoins);
  syncMenuCoins();
  function show(name) {
    if (name === 'menu') syncMenuCoins();
    game.hidden = !['game', 'pause', 'result'].includes(name);
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
    // 버튼 대신 제목에 포커스: 눌린 채 넘어온 Enter(P2 발사키) 반복이 버튼을 누르지 않게 한다.
    screens[name]?.querySelector('[tabindex="-1"]').focus();
  }

  $('#setup-btn').addEventListener('click', handlers.onVersus);
  $('#single-btn').addEventListener('click', handlers.onSingle);
  $('#training-btn').addEventListener('click', handlers.onTraining);
  $('#single-start-btn').addEventListener('click', handlers.onStart);
  const singleSetup = createSingleSetup(handlers.onSingleChange);
  const storySetup = createStorySetup(handlers.onStoryChange);
  for (const btn of document.querySelectorAll('.setup-again-btn')) btn.addEventListener('click', handlers.onSetup);
  const balance = createBalanceScreens({
    show,
    onChange: handlers.onBalanceChange,
    onDefaultsChange: handlers.onBalanceDefaultsChange,
    onClose() { handlers.onMenu(); },
  });
  $('#balance-btn').addEventListener('click', balance.open);
  $('#account-btn').addEventListener('click', handlers.onAccounts);
  // 총기 개조 작업실(랜덤 뽑기·배낭·장착)
  const workshop = createWorkshop({ show, onClose() { handlers.onMenu(); } });
  $('#mod-btn').addEventListener('click', workshop.open);
  $('#retry-btn').addEventListener('click', handlers.onRetryLoad);
  $('#start-btn').addEventListener('click', handlers.onStart);
  $('#back-btn').addEventListener('click', handlers.onMenu);
  // 경기 중 버튼은 누르는 즉시 반응: 더블탭 확대 방지로 빠른 두 번째 탭의 click이 사라질 수 있다(src/input/gestures.js).
  const pauseBtn = $('#pause-btn');
  pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); handlers.onPause(); });
  pauseBtn.addEventListener('click', (e) => { if (e.detail === 0) handlers.onPause(); }); // 키보드로 누른 경우
  $('#resume-btn').addEventListener('click', handlers.onResume);
  $('#save-btn').addEventListener('click', handlers.onSave);
  $('#skip-stage-btn').addEventListener('click', handlers.onSkipStage);
  for (const btn of document.querySelectorAll('.continue-btn')) btn.addEventListener('click', handlers.onContinue);
  $('#clear-save-btn').addEventListener('click', handlers.onClearSave);
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
      $('#single-btn').disabled = false;
      $('#training-btn').disabled = false;
    },
    /** 일시정지 화면. 스토리 모드면 '저장하기'를, 다음 스테이지가 있으면 skipLabel로 '건너뛰기' 버튼을 보인다. */
    showPause(story, skipLabel = null) {
      $('#save-btn').hidden = !story;
      $('#skip-stage-btn').hidden = !skipLabel;
      if (skipLabel) $('#skip-stage-btn').textContent = skipLabel;
      $('#save-status').textContent = '';
      show('pause');
    },
    setSaveStatus(text) { $('#save-status').textContent = text; },
    /** 스토리 저장이 있으면 메인 메뉴·싱글 플레이 화면에 '스토리 이어하기'와 저장 위치를 보인다. */
    setContinue(save) {
      const allies = save?.allies ? ` · AI 동료 ${save.allies}명` : '';
      const text = !save ? '' : save.coop ? `저장(2인 협동): ${save.label} · 체력 P1 ${save.hp} · P2 ${save.hp2}${allies}`
        : `저장: ${save.label} · 체력 ${save.hp}${allies}`;
      for (const btn of document.querySelectorAll('.continue-btn')) btn.hidden = !save;
      for (const info of document.querySelectorAll('.continue-info')) {
        info.hidden = !save;
        info.textContent = text;
      }
      $('#clear-save-btn').hidden = !save;
    },
    /** 메인 메뉴에 밸런스 변경 여부를 알린다. */
    setBalanceStatus(changedCount) {
      $('#balance-status').hidden = changedCount === 0;
      $('#balance-status').textContent = `밸런스 수치 ${changedCount}개가 기본값과 다릅니다.`;
    },
    /**
     * 계정 선택 화면: 계정 1~4 버튼(계정마다 랭크·코인). 고르면 handlers.onAccount(n). current는 지금(마지막) 계정.
     */
    showAccounts(current) {
      const list = $('#account-list');
      list.replaceChildren(...ACCOUNTS.map((n) => {
        const r = loadRank(n);
        // 그 계정의 코인(읽기만, 기본 코인은 그 계정을 처음 고를 때 받는다)
        const coins = (() => {
          try {
            const saved = JSON.parse(localStorage.getItem(accountKey('haha2.mods.v1', n)));
            return Number.isFinite(saved?.coins) ? saved.coins : null;
          } catch { return null; }
        })();
        const btn = el('button', `account-card${n === current ? ' current' : ''}`);
        btn.type = 'button';
        btn.style.setProperty('--tier', TIERS[r.tier].color);
        btn.append(
          el('b', 'account-title', accountName(n)),
          el('span', 'rank-badge', `${TIERS[r.tier].icon} ${rankLabel(r)}`),
          el('small', '', `승리 ${r.wins}번 · ${coins === null ? '새 계정' : `🪙 ${coins}`}`),
        );
        btn.addEventListener('click', () => handlers.onAccount(n));
        return btn;
      }));
      show('account');
    },
    /** 메인 메뉴 위 계정·랭크 표시 */
    setAccount(n, rank) {
      $('#account-name').textContent = accountName(n);
      const tier = TIERS[rank.tier];
      $('#rank-badge').textContent = `${tier.icon} ${rankLabel(rank)}`;
      $('#rank-badge').style.setProperty('--tier', tier.color);
      $('#rank-fill').style.width = `${Math.round(rankProgress(rank) * 100)}%`;
      $('#rank-fill').style.background = tier.color;
      $('#account-bar').title = rank.tier === TIERS.length - 1 ? `최고 등급 · ${MAX_LEVEL}레벨까지` : `${MAX_LEVEL}레벨이 되면 20코인과 함께 ${TIERS[rank.tier + 1].name}으로 승급`;
      syncMenuCoins();
    },
    /** 2인 대결: 경기장과 자리마다 캐릭터(5명 중 자유)·주무기를 고른다. 고를 때마다 handlers.onPick(slotId, key, value) */
    showReady(slots, loadout, map = 'wide') {
      $('#map-choices').replaceChildren(...Object.values(MAPS).map((m) => {
        const btn = el('button', 'choice');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(m.id === map));
        btn.append(el('span', '', m.name), el('small', '', m.info));
        btn.addEventListener('click', () => {
          for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(b === btn));
          handlers.onMap(m.id);
        });
        return btn;
      }));
      $('#slot-list').replaceChildren(...slots.map((s) => slotItem(s, loadout, handlers.onPick)));
      $('#narrow-warning').hidden = window.innerWidth / slots.length >= MIN_PANEL_WIDTH;
      show('ready');
    },
    /**
     * 싱글 플레이 설정: 플레이어(P1) 캐릭터·주무기와 AI 설정(자유 대전) 또는 웨이브별 요원 밸런스(스토리 모드).
     * coopLoadout은 스토리 모드 2인 협동 P2의 선택({ P2 }). 2인 협동을 고르면 P2 칸이 보인다.
     */
    showSingle(slot, loadout, single, story, coopLoadout) {
      const partner = slotItem(COOP_SLOT, coopLoadout, handlers.onCoopPick, `P2 · 2인 협동 · ${TEAM_NAME[COOP_SLOT.team]}`);
      partner.id = 'single-p2';
      $('#single-player').replaceChildren(slotItem(slot, loadout, handlers.onPick, `플레이어 · ${TEAM_NAME[slot.team]}`), partner);
      singleSetup.open(single);
      storySetup.open(story);
      show('single');
    },
    showResult(match, ranked = null) {
      const { winner, stats, story } = match;
      // 랭크: 오른 레벨·승급 안내
      $('#result-rank').hidden = !ranked;
      if (ranked) {
        $('#result-rank').textContent = `${TIERS[ranked.result.rank.tier].icon} ${ranked.message}`;
        $('#result-rank').classList.toggle('promoted', !!ranked.result.promoted);
      }
      // 2인 대결 승리 포즈: 이긴 캐릭터가 뛰어오르며 총을 치켜든다
      const champ = match.victory && match.players.find((p) => p.id === match.victory.id);
      $('#result-victory').hidden = !champ;
      if (champ) {
        const img = el('img', 'victory-pose');
        img.src = CHARACTERS.find((c) => c.id === champ.characterId)?.image ?? `assets/characters/${champ.characterId}.png`;
        img.alt = `${champ.name} 승리 포즈`;
        const card = el('div', `victory-card team-${champ.team}`);
        card.append(el('span', 'victory-confetti', '🎉'), img, el('b', '', `WINNER · ${champ.id} ${champ.name}`), el('span', 'victory-confetti right', '🏆'));
        $('#result-victory').replaceChildren(card);
      }
      // 스토리 모드는 경기장에서 치운 요원까지 나온 요원 전원을 보여 준다
      const players = story ? [...match.players.filter((p) => p.team === 'earth'), ...story.roster] : match.players;
      const time = match.tick * TICK;
      $('#result-time').textContent = `경기 시간 ${formatTime(time)}` + (story?.endless ? ' · 스토리 연속 플레이 모드' : story ? ` · 스토리 모드 ${waveLabel(story.wave)}` : '');
      const winnerPlayer = players.find((p) => p.team === winner);
      $('#result-title').textContent = winner === 'draw' ? '무승부'
        : story?.endless ? `연속 플레이 끝! ${story.endless.cleared}웨이브 돌파 · 레벨 +${story.endless.cleared} · 코인 +${story.endless.rewards}`
        : story ? (winner === 'earth' ? `스토리 클리어! ${DEATHSTAR_NAME}을 격추했다!` : `${waveLabel(story.wave)}에서 패배…`)
        : winnerPlayer.ai ? `${winnerPlayer.name} 승리…`
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
        if (story && p.team === 'earth') fact('포탑에게 받은 피해', String(s.takenFrom.turret ?? 0));
        if (s.killedBy) {
          fact('쓰러짐', `${formatTime(s.downAt ?? time)} · ${sourceName(players, s.killedBy.ownerId)}의 ${killWeaponName(s.killedBy)}`);
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
      const order = [...PRIMARY_IDS, 'laser', 'instakill', ...SECONDARY_IDS, 'grenade',
        'lightning', 'missile', 'gunship', 'flak', 'dsmissile', 'dualrpg']; // 공중전 무기
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
