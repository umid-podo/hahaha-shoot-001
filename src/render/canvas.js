import {
  ARENA_WIDTH, ARENA_HEIGHT, RAIL_Y, MIN_X, MAX_X, SPRITE_SIZE, TEAM_COLOR, TEAM_NAME,
  MAX_HP, WEAPONS, COVER, TICK, CHARACTERS, TANK,
} from '../game/config.js';
import {
  WAVES, ELEVATOR, CRACK_TIME, ROOF_STAIRS, CORRIDOR_STAIRS, currentWave, stageProgress, waveLabel,
} from '../game/story.js';
import {
  movesOf, foeName, DAMAGE as KATA_DAMAGE, WARN_TIME as KATA_WARN, RESOLVE_TIME as KATA_RESOLVE,
} from '../game/gunkata.js';

const INK = '#30353E';
// 데스스타 그림 위치·크기(판정 중심 기준)
const DS_DRAW_DY = 40, DS_DRAW_SCALE = 0.85;
// 도로 탱크 그림 크기(위에서 본 길이·폭)
const TANK_DRAW = { l: 230, w: 124 };
const MAX_DPR = 2;
const RECOIL_TIME = 0.08;
const SPARK_TIME = 0.15;
const EFFECT_TIME = 0.6;
const EXPLODE_TIME = 0.4;
const LASER_TIME = 0.1;
const MEGA_TIME = 0.6;
const GAUGE_H = 6;
// 오른쪽 팀 체력판. 상단은 윗변, 하단은 아랫변 기준으로 캐릭터·체력바와 겹치지 않게 둔다.
const TEAM_BOX = { isbTop: RAIL_Y.isb + 98, earthBottom: RAIL_Y.earth - 102, w: 190, right: 20 };
const HP_BAR = { w: 88, h: 10 };

function hpColor(ratio) {
  return ratio > 0.5 ? '#3FAE4A' : ratio > 0.25 ? '#F2B233' : '#D9443A';
}

function drawHpBar(ctx, x, y, w, h, hp, max = MAX_HP) {
  const ratio = hp / max;
  ctx.fillStyle = 'rgba(48,53,62,0.35)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  if (ratio > 0) {
    ctx.fillStyle = hpColor(ratio);
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(h, w * ratio), h, h / 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.stroke();
}

// 엄폐물 금: 크기에 대한 비율 좌표 폴리라인. 내구도가 75%·50%·25% 아래로 내려갈 때마다 한 줄씩 늘어난다.
const CRACKS = [
  [[0.18, 0], [0.24, 0.35], [0.16, 0.6], [0.22, 1]],
  [[0.62, 0], [0.55, 0.4], [0.66, 0.7], [0.6, 1]],
  [[0.4, 1], [0.44, 0.55], [0.36, 0.3], [0.42, 0], [0.84, 0.25], [0.9, 0.7]],
];
// 부서질 때 흩어지는 파편: [방향 각도, 속도, 크기]
const DEBRIS = [[-2.6, 160, 14], [-1.9, 220, 10], [-1.2, 190, 16], [-0.4, 150, 12], [0.5, 200, 10],
  [1.3, 170, 14], [2.1, 210, 12], [2.9, 140, 16]];
const DEBRIS_TIME = 0.6;

/** manifest와 필수 이미지를 불러온다. 실패하면 파일 경로를 담은 Error를 던진다. */
export async function loadAssets() {
  const manifestPath = 'assets/manifest.json';
  const res = await fetch(manifestPath).catch(() => null);
  if (!res || !res.ok) throw new Error(manifestPath);
  const manifest = await res.json();
  const assets = {};
  await Promise.all(manifest.assets.map(async (entry) => {
    const img = new Image();
    img.src = manifest.pathBase + entry.path;
    try { await img.decode(); } catch { throw new Error(img.src); }
    assets[entry.id] = { img, anchor: entry.bodyAnchor };
  }));
  return assets;
}

export function createRenderer(canvas, wrap, assets) {
  const ctx = canvas.getContext('2d');
  let elapsedTime = 0; // 경기 시작 뒤 흐른 시간(즉사기 충전 표시용)
  let effects = [];
  // 킬캠 카메라: 지금 보는 중심(x, y)과 확대 배율(z). 매 프레임 목표로 부드럽게 따라간다.
  const cam = { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, z: 1 };
  const recoil = {};

  function resize() {
    const scale = Math.min(wrap.clientWidth / ARENA_WIDTH, wrap.clientHeight / ARENA_HEIGHT);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.style.width = `${ARENA_WIDTH * scale}px`;
    canvas.style.height = `${ARENA_HEIGHT * scale}px`;
    canvas.width = Math.max(1, Math.round(ARENA_WIDTH * scale * dpr));
    canvas.height = Math.max(1, Math.round(ARENA_HEIGHT * scale * dpr));
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  function drawPlayer(p, input, time, reducedMotion) {
    // 하늘(공중전)의 비행체(라이트닝·건쉽·데스스타)는 그림 파일 대신 직접 그린다
    const aircraft = p.plane || CHARACTERS.find((c) => c.id === p.characterId)?.aircraft;
    if (aircraft && !p.alive && !p.plane) return; // 격추된 건쉽은 이미 터져 사라졌다
    // 무기별 그림(manifest id '<캐릭터>@<무기>')이 있으면 그것을, 없으면 기본 그림을 쓴다.
    const { img, anchor } = aircraft ? { img: null, anchor: [0.5, 0.5] } : assets[`${p.characterId}@${p.weapon}`] ?? assets[p.characterId];
    const size = SPRITE_SIZE * p.scale; // 드론처럼 크게 그리는 캐릭터도 판정 원은 같다
    const color = TEAM_COLOR[p.team];
    const hurt = p.hurt > 0;

    if (!p.alive) {
      // 쓰러진 캐릭터: 옆으로 눕히고 흐리게, KO 표시(격추된 라이트닝은 회색으로 기울어 연기)
      ctx.save();
      ctx.translate(p.x, p.y + 10);
      ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = 0.45;
      ctx.filter = 'grayscale(1)';
      if (aircraft) { ctx.rotate(-Math.PI / 2 + 0.6); drawLightning(0, 0, 0, 0.9, time, true); }
      else ctx.drawImage(img, -anchor[0] * size, -anchor[1] * size, size, size);
      ctx.restore();
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = '#D9443A';
      ctx.strokeText('KO', p.x, p.y);
      ctx.fillText('KO', p.x, p.y);
      return;
    }

    // 단검 돌진: 지나온 길에 팀 색 잔상
    if (p.dash && !reducedMotion) {
      const len = Math.hypot(p.dash.vx, p.dash.vy);
      const ux = (p.dash.returning ? -p.dash.vx : p.dash.vx) / len, uy = (p.dash.returning ? -p.dash.vy : p.dash.vy) / len;
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = 0.12 * (4 - i);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x - ux * i * 26, p.y - uy * i * 26, p.radius * (1 - i * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 단검 돌진 중에는 무적: 흰 빛 테두리
    if (p.dash) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#FFD45E';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 보스(스토리 모드 스미스 요원): 몸 둘레에 맥동하는 붉은 기운
    if (p.boss) {
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 5);
      ctx.fillStyle = `rgba(217,68,58,${0.12 + 0.12 * pulse})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 26 + pulse * 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 판정 위치를 알려주는 몸 중심 팀 링. 피격 직후에는 빨갛게 번쩍인다.
    ctx.lineWidth = hurt ? 5 : 3;
    ctx.strokeStyle = hurt ? '#D9443A' : color;
    ctx.globalAlpha = hurt ? 1 : 0.45;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + (hurt ? 6 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 드론은 늘 둥실 떠 있고, 제트팩 캐릭터는 떠서 움직이며, 사람은 걸을 때만 통통 튄다.
    const moving = input.moveAxis !== 0 && !p.dash;
    const bounce = p.jetpack ? -12 + (reducedMotion ? 0 : Math.sin(time * 4 + p.x * 0.01) * 3)
      : reducedMotion ? 0
      : p.drone ? Math.sin(time * 5 + p.x * 0.01) * 5
      : moving ? Math.sin(time * 20) * 2 : 0;
    const squash = !reducedMotion && recoil[p.id] > 0 ? 0.92 : 1;
    const shake = !reducedMotion && hurt ? Math.sin(time * 90) * 3 : 0;
    const facing = Math.cos(p.aim) < 0 ? -1 : 1; // 원본은 오른쪽을 본다. 반전 시 앵커도 함께 반전된다.
    if (aircraft) {
      // 비행체는 조준 방향으로 기수를 돌린다(옆으로 움직이면 살짝 기운다)
      ctx.save();
      ctx.globalAlpha = hurt ? 0.7 : 1;
      const tilt = reducedMotion ? 0 : input.moveAxis * 0.18;
      if (p.plane) drawLightning(p.x + shake, p.y, p.aim + Math.PI / 2 + tilt, 0.95, time, reducedMotion, p.boost > 0);
      // 데스스타는 화면 위 끝에 잘리지 않게 판정 중심보다 조금 아래, 0.85배로 그린다
      else if (p.characterId === 'deathstar') drawDeathstar(p.x + shake, p.y + DS_DRAW_DY, DS_DRAW_SCALE, time, reducedMotion);
      else drawCarrier({ kind: 'gunship', x: p.x + shake, y: p.y, angle: p.aim + Math.PI + tilt, state: 'hover', scale: 0.5, enemy: true }, time, reducedMotion);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(p.x + shake, p.y + bounce);
      ctx.scale(facing * squash, squash);
      ctx.globalAlpha = hurt ? 0.7 : 1;
      ctx.drawImage(img, -anchor[0] * size, -anchor[1] * size, size, size);
      ctx.restore();
    }
    // 제트팩 불꽃은 그림 위에 그려 치마에 가리지 않게 한다
    if (p.jetpack) drawJetFlame(p, anchor, size, facing, bounce, moving, time, reducedMotion);

    if (p.weapon === 'instakill') drawMegaCannon(p, time, reducedMotion);
    // 아킴보 석궁: 권총형 석궁 두 자루를 조준 방향으로 겨눈 모습으로 덧그린다
    if (p.weapon === 'crossbow') {
      const { img: bow } = assets['akimbo-crossbow'];
      ctx.save();
      ctx.translate(p.x + Math.cos(p.aim) * 30, p.y - 4 + Math.sin(p.aim) * 30);
      ctx.rotate(p.aim);
      if (Math.cos(p.aim) < 0) ctx.scale(1, -1); // 왼쪽을 겨눠도 뒤집혀 보이지 않게
      ctx.drawImage(bow, -30, -30, 80, 60);
      ctx.restore();
    }

    // 현재 조준 방향 눈금(항상) + 발사 준비 중에만 조준선
    const cos = Math.cos(p.aim), sin = Math.sin(p.aim);
    // 떼면 쏘는 무기(RPG·저격총)의 쿨타임, 방전, 과열 동안은 눈금을 회색으로 표시
    const weapon = WEAPONS[p.weapon];
    const reloading = (weapon.trigger === 'release' && p.cooldown > 0) ||
      (weapon.ownCooldown && (p.cooldowns[weapon.id] ?? 0) > 0) ||
      (weapon.battery && p.battery <= 0) || (weapon.heat && p.overheat > 0);
    ctx.fillStyle = reloading ? '#9A9EA5' : color;
    ctx.beginPath();
    ctx.arc(p.x + cos * p.radius, p.y + sin * p.radius, 5, 0, Math.PI * 2);
    ctx.fill();
    if (input.aiming) {
      const reach = p.weapon === 'sniper' ? 420 : 190; // 저격총은 긴 조준선
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(p.x + cos * 38, p.y + sin * 38);
      ctx.lineTo(p.x + cos * reach, p.y + sin * reach);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(p.x + cos * (reach + 10), p.y + sin * (reach + 10));
      ctx.rotate(p.aim);
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-10, -10); ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = p.boss ? `BOSS ${p.name}` : `${p.id} ${p.name}`;
    const w = ctx.measureText(label).width + 16;
    ctx.fillStyle = p.boss ? '#B3261E' : color;
    ctx.beginPath();
    ctx.roundRect(p.x - w / 2, p.y + 47, w, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p.x, p.y + 60);
    drawHpBar(ctx, p.x - HP_BAR.w / 2, p.y + 76, HP_BAR.w, HP_BAR.h, p.hp, p.maxHp);
    const gaugeY = p.y + 76 + HP_BAR.h + 3;
    const drawn = drawGauge(p, p.x - HP_BAR.w / 2, gaugeY, HP_BAR.w);
    let row = drawn ? 1 : 0;
    // 단검·샷건 쿨타임: 보라 막대(무기를 바꿔 들고 있어도 표시)
    const secondary = WEAPONS[p.secondary];
    const secondaryLeft = p.cooldowns[p.secondary] ?? 0;
    if (!p.primaryOnly && secondary?.ownCooldown && secondaryLeft > 0) {
      bar(p.x - HP_BAR.w / 2, gaugeY + row * (GAUGE_H + 2), HP_BAR.w, 1 - secondaryLeft / secondary.interval, '#8E6BD6');
      row++;
    }
    // 수류탄(아이템) 쿨타임: 던진 뒤 다시 쓸 수 있을 때까지 회색 막대
    if (!p.primaryOnly && p.grenadeCooldown > 0) {
      bar(p.x - HP_BAR.w / 2, gaugeY + row * (GAUGE_H + 2), HP_BAR.w,
        1 - p.grenadeCooldown / WEAPONS[p.item ?? 'grenade'].interval, '#9A9EA5');
    }
  }

  function bar(x, y, w, ratio, color) {
    ctx.fillStyle = 'rgba(48,53,62,0.35)';
    ctx.fillRect(x, y, w, GAUGE_H);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), GAUGE_H);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, GAUGE_H);
  }

  /**
   * 체력바 아래 무기 상태 막대. 레이저는 배터리(빨강), 기관단총은 열(주황, 과열 중엔 빨강).
   * 해당 없으면 그리지 않고 false를 돌려준다.
   */
  function drawGauge(p, x, y, w) {
    const weapon = WEAPONS[p.weapon];
    let ratio, color;
    if (weapon.instakill) {
      // 즉사기: 전투 시작부터 readyAfter초까지, 쏜 뒤에는 쿨타임 동안 차오르는 빨간 막대, 다 차면 금색
      ratio = elapsedTime < weapon.readyAfter ? elapsedTime / weapon.readyAfter
        : weapon.interval > 0 ? 1 - p.cooldown / weapon.interval : 1;
      color = ratio >= 1 ? '#FFC53D' : '#D9443A';
    } else if (weapon.battery) {
      ratio = p.battery / weapon.battery.shots; color = '#E0312B';
    } else if (weapon.heat && (p.heat > 0 || p.overheat > 0)) {
      ratio = p.overheat > 0 ? 1 : p.heat / weapon.heat.max;
      color = p.overheat > 0 ? '#D9443A' : '#F2A33A';
    } else {
      return false;
    }
    bar(x, y, w, ratio, color);
    return true;
  }

  /** 제트팩 불꽃: 그림 속 분사구에서 아래로. 움직일 때 길고 크게, 멈춰 있을 때는 작게 일렁인다. */
  function drawJetFlame(p, anchor, size, facing, bounce, moving, time, reducedMotion) {
    const [nx, ny] = p.jetpack;
    const x = p.x + (nx - anchor[0]) * size * facing;
    const y = p.y + bounce + (ny - anchor[1]) * size;
    const flicker = reducedMotion ? 1 : 0.8 + Math.random() * 0.4;
    const len = (moving ? 58 : 24) * flicker, wide = moving ? 14 : 9;
    // 움직이는 반대쪽으로 살짝 기운 불꽃
    const tilt = moving ? -Math.sign(p.x - p.previousX || 0) * 0.35 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    for (const [l, w, c] of [[len, wide, 'rgba(255,120,40,0.85)'], [len * 0.65, wide * 0.6, '#FFD45E'], [len * 0.3, wide * 0.3, '#FFFFFF']]) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(0, l * 1.1, w, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** 즉사기: 몸보다 큰 레이저포. 쓸 수 있으면 포구가 빨갛게 맥동하고, 쓰기 전·쓴 뒤에는 어둡다. */
  function drawMegaCannon(p, time, reducedMotion) {
    const weapon = WEAPONS.instakill;
    const ready = elapsedTime >= weapon.readyAfter && p.cooldown <= 0;
    ctx.save();
    ctx.translate(p.x + Math.cos(p.aim) * 10, p.y - 6 + Math.sin(p.aim) * 10);
    ctx.rotate(p.aim);
    if (Math.cos(p.aim) < 0) ctx.scale(1, -1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.fillStyle = '#4A505A';
    ctx.beginPath(); ctx.roundRect(-30, -16, 104, 32, 8); ctx.fill(); ctx.stroke();       // 포신 몸통
    ctx.fillStyle = '#2A2E35';
    ctx.beginPath(); ctx.roundRect(-44, -22, 30, 44, 6); ctx.fill(); ctx.stroke();        // 뒤쪽 동력부
    ctx.fillStyle = '#6B7380';
    ctx.beginPath(); ctx.roundRect(70, -22, 22, 44, 6); ctx.fill(); ctx.stroke();         // 포구
    ctx.strokeStyle = '#D9443A'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-24, -8); ctx.lineTo(62, -8); ctx.moveTo(-24, 8); ctx.lineTo(62, 8); ctx.stroke(); // 빨간 줄
    const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(time * 10);
    ctx.globalAlpha = ready ? pulse : 0.35;
    ctx.fillStyle = ready ? '#FF3355' : '#7A2A33';
    ctx.beginPath(); ctx.arc(92, 0, ready ? 16 : 10, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** 즉사기 레이저: 조준 방향으로 나가 상대에게 휘어 꽂히는 거대한 빛줄기 */
  function drawMegaLaser(fx) {
    const k = fx.age / MEGA_TIME;
    const dist = Math.hypot(fx.x2 - fx.x1, fx.y2 - fx.y1);
    const cx = fx.x1 + Math.cos(fx.aim) * dist * 0.5, cy = fx.y1 + Math.sin(fx.aim) * dist * 0.5;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 1 - k * 0.7;
    for (const [w, c] of [[90, 'rgba(255,40,90,0.25)'], [54, 'rgba(255,40,90,0.55)'], [30, '#FF2A55'], [12, '#FFFFFF']]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w * (1 - k * 0.5);
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.quadraticCurveTo(cx, cy, fx.x2, fx.y2);
      ctx.stroke();
    }
    if (fx.hit) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(fx.x2, fx.y2, 70 * (1 - k * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** 팀별 체력 요약: 팀 이름과 멤버마다 이름·총기·체력바 */
  function drawTeam(team, players) {
    const members = players.filter((p) => p.team === team);
    const w = TEAM_BOX.w, h = 40 + members.length * 30, x = ARENA_WIDTH - TEAM_BOX.right - w;
    const y = team === 'isb' ? TEAM_BOX.isbTop : TEAM_BOX.earthBottom - h;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.strokeStyle = TEAM_COLOR[team];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.drawImage(assets[`${team}-badge`].img, x + 10, y + 6, 26, 26);
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(TEAM_NAME[team], x + 44, y + 20);
    members.forEach((p, i) => {
      const my = y + 40 + i * 30;
      ctx.fillStyle = p.alive ? INK : '#9A9EA5';
      // 이름·무기 이름이 길면 판 안에 들어가도록 글자를 줄인다
      const text = `${p.id} ${p.name} · ${WEAPONS[p.weapon].name}`;
      let size = 13;
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      while (size > 8 && ctx.measureText(text).width > w - 24) ctx.font = `bold ${--size}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 12, my + 2);
      ctx.textAlign = 'right';
      ctx.fillText(p.alive ? `${p.hp}` : 'KO', x + w - 12, my + 17);
      drawHpBar(ctx, x + 12, my + 12, w - 60, 10, p.hp, p.maxHp);
    });
  }

  /** 엄폐물: 콘크리트 방호벽. 팀 진영 엄폐물은 윗면에 팀 색 띠를 두른다. 깎일수록 금이 늘고 위에 내구도 바를 띄운다. */
  /** 엄폐물. roadTime이 있으면(4스테이지 도로) 엄폐물을 짐칸에 실은 트럭이 함께 달린다. */
  function drawCovers(covers, roadTime = null, reducedMotion = false) {
    for (const c of covers) {
      if (c.hp <= 0) continue;
      if (roadTime !== null) drawTruck(c, roadTime, reducedMotion);
      if (c.steel) { drawSteel(c); continue; }
      const x = c.x - c.w / 2, y = c.y - c.h / 2;
      ctx.fillStyle = 'rgba(48,53,62,0.25)';
      ctx.beginPath();
      ctx.roundRect(x + 6, y + 8, c.w, c.h, 8);
      ctx.fill();
      ctx.fillStyle = '#8F8A80';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(x, y, c.w, c.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.team ? TEAM_COLOR[c.team] : '#FFD45E';
      ctx.fillRect(x + 4, y + 4, c.w - 8, 8);
      ctx.strokeStyle = 'rgba(48,53,62,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let bx = x + c.w / 4; bx < x + c.w - 1; bx += c.w / 4) {
        ctx.moveTo(bx, y + 14); ctx.lineTo(bx, y + c.h - 4);
      }
      ctx.stroke();

      const ratio = c.hp / COVER.hp;
      const stage = ratio < 0.25 ? 3 : ratio < 0.5 ? 2 : ratio < 0.75 ? 1 : 0;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      for (const crack of CRACKS.slice(0, stage)) {
        ctx.beginPath();
        crack.forEach(([u, v], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + u * c.w, y + v * c.h));
        ctx.stroke();
      }
      if (c.hp < COVER.hp) drawHpBar(ctx, x + 10, y - 14, c.w - 20, 8, c.hp, COVER.hp);
    }
  }

  /** 도로의 엄폐물을 실은 평판 트럭(위에서 봄, 오른쪽으로 달림): 짐칸이 엄폐물보다 조금 크고 오른쪽에 운전석 */
  function drawTruck(c, time, reducedMotion) {
    const bed = { w: c.w + 40, h: Math.max(c.h + 40, 88) };
    const x = c.x - bed.w / 2, y = c.y - bed.h / 2 + (reducedMotion ? 0 : Math.sin(time * 9 + c.x) * 1.2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.roundRect(x + 6, y + 10, bed.w + 70, bed.h, 10); ctx.fill();
    ctx.fillStyle = '#0D0F14';
    for (const wx of [x + 26, x + bed.w - 30, x + bed.w + 40]) for (const side of [0, 1]) ctx.fillRect(wx - 16, y - 6 + side * (bed.h), 32, 12);
    ctx.fillStyle = '#4A4F5A';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x, y, bed.w, bed.h, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#B8862E';
    ctx.beginPath(); ctx.roundRect(x + bed.w + 4, y + 4, 62, bed.h - 8, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(120,170,230,0.6)';
    ctx.fillRect(x + bed.w + 46, y + 12, 12, bed.h - 24);
    ctx.fillStyle = '#FFF7D6';
    ctx.fillRect(x + bed.w + 62, y + 12, 4, 10);
    ctx.fillRect(x + bed.w + 62, y + bed.h - 22, 4, 10);
    ctx.fillStyle = '#FF3B30';
    ctx.fillRect(x - 3, y + 8, 4, 12);
    ctx.fillRect(x - 3, y + bed.h - 20, 4, 12);
  }

  /** 강철 엄폐물: 파란빛 도는 금속판 + 리벳 + 팀 색 띠. 금·내구도 바 없음. */
  function drawSteel(c) {
    const x = c.x - c.w / 2, y = c.y - c.h / 2;
    ctx.fillStyle = 'rgba(48,53,62,0.3)';
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 8, c.w, c.h, 6);
    ctx.fill();
    const grad = ctx.createLinearGradient(0, y, 0, y + c.h);
    grad.addColorStop(0, '#C7D0DB');
    grad.addColorStop(0.5, '#7D8A99');
    grad.addColorStop(1, '#56626F');
    ctx.fillStyle = grad;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, c.w, c.h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = TEAM_COLOR[c.team];
    ctx.fillRect(x + 4, y + 4, c.w - 8, 6);
    ctx.fillStyle = '#E6EBF1';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    for (const rx of [x + 12, x + c.w - 12]) {
      for (const ry of [y + 18, y + c.h - 9]) {
        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillStyle = INK;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STEEL', c.x, c.y + 5);
  }

  function drawDebris(fx, reducedMotion) {
    const k = fx.age / DEBRIS_TIME;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#8F8A80';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    for (const [angle, speed, size] of DEBRIS) {
      const d = reducedMotion ? 20 : speed * fx.age;
      const px = fx.x + Math.cos(angle) * d, py = fx.y + Math.sin(angle) * d + (reducedMotion ? 0 : 200 * fx.age * fx.age);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(reducedMotion ? angle : angle + fx.age * 8);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawJet(jet) {
    const { img } = assets['fighter-jet'];
    const w = 260, h = 200;
    // 그림자: 옥상 위 하늘 높이 날고 있다는 느낌(탄환은 그 밑으로 지나가므로 전투기는 탄환 위에 그린다)
    ctx.save();
    ctx.translate(jet.x + 30, jet.y + 40);
    ctx.scale(jet.dir, 1);
    ctx.globalAlpha = 0.18;
    ctx.filter = 'brightness(0)';
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.save();
    ctx.translate(jet.x, jet.y);
    ctx.scale(jet.dir, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /**
   * 스토리 모드에서 들어오는 중인 요원. 아직 차례가 오지 않은 요원(t < 0)은 그리지 않는다.
   * rope: 헬리콥터(건쉽)에서 줄을 타고 내려온다. 하늘에서 내려오므로 작게 시작해 레일에 닿으면 제 크기.
   * walk: 엘리베이터에서 걸어 나온다(처음엔 흐리게). fall: 천장에서 떨어진다(크게 시작해 바닥에 내려앉으며 제 크기, 그림자가 진해짐).
   */
  function drawEntering(p, input, time, reducedMotion) {
    const e = p.entering;
    if (e.t < 0) return;
    const k = Math.min(1, e.t / e.duration);
    if (e.kind === 'drive') {
      // 도로: 요원을 태운 차가 뒤에서 달려온다
      drawCar(p.x, p.y, p.team, time, reducedMotion);
      drawPlayer(p, { moveAxis: 0, aiming: false }, time, reducedMotion);
      return;
    }
    if (e.kind === 'walk') {
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.3 + k * 2);
      drawPlayer(p, { moveAxis: 1, aiming: false }, time, reducedMotion);
      ctx.restore();
      return;
    }
    if (e.kind === 'fall') {
      const s = 1 + (1 - k * k) * 1.4;
      ctx.fillStyle = `rgba(48,53,62,${0.15 + 0.3 * k})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 30, 60 * (0.6 + 0.4 * k), 22 * (0.6 + 0.4 * k), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      ctx.rotate(reducedMotion ? 0 : (1 - k) * 0.6);
      ctx.translate(-p.x, -p.y);
      drawPlayer(p, input, time, reducedMotion);
      ctx.restore();
      return;
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, e.fromY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    const s = 0.55 + 0.45 * k;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);
    ctx.translate(-p.x, -p.y);
    drawPlayer(p, input, time, reducedMotion);
    ctx.restore();
  }

  /**
   * 위에서 본 라이트닝(쌍동 전투기, 주인공 전용기). 기수는 angle 방향(0이면 위쪽).
   * 가운데 짧은 동체(조종석)와 엔진이 달린 꼬리 붐 두 개, 긴 주날개, 두 붐을 잇는 꼬리 날개. 은색 몸체에 파란 무늬.
   * boost(과냉각 중)이면 엔진 뒤로 파란 불꽃.
   */
  function drawLightning(x, y, angle, scale, time, reducedMotion, boost = false) {
    const silver = '#C9CED6', blue = '#2F6FD6', dark = '#6B7380';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5 / scale;
    ctx.lineJoin = 'round';
    // 그림자
    ctx.fillStyle = 'rgba(20,30,60,0.18)';
    ctx.beginPath(); ctx.ellipse(18, 26, 92, 30, 0, 0, Math.PI * 2); ctx.fill();
    // 엔진 불꽃(과냉각이면 파랗게 길게)
    for (const bx of [-30, 30]) {
      const len = boost ? 34 + (reducedMotion ? 0 : Math.random() * 10) : 12;
      ctx.fillStyle = boost ? 'rgba(90,170,255,0.85)' : 'rgba(255,170,60,0.75)';
      ctx.beginPath(); ctx.moveTo(bx - 5, 52); ctx.lineTo(bx, 52 + len); ctx.lineTo(bx + 5, 52); ctx.fill();
    }
    // 꼬리 날개(두 붐을 잇는 수평 꼬리) + 수직 꼬리 두 장
    ctx.fillStyle = silver;
    ctx.beginPath(); ctx.roundRect(-40, 40, 80, 10, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = blue;
    for (const bx of [-30, 30]) { ctx.beginPath(); ctx.roundRect(bx - 4, 36, 8, 18, 3); ctx.fill(); ctx.stroke(); }
    // 주날개: 끝은 둥글고 파란 날개 끝
    ctx.fillStyle = silver;
    ctx.beginPath();
    ctx.moveTo(-86, -6); ctx.lineTo(86, -6); ctx.quadraticCurveTo(96, 0, 86, 8); ctx.lineTo(-86, 8); ctx.quadraticCurveTo(-96, 0, -86, -6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = blue;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * 88, 1, 6, 7, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(48,53,62,0.35)';
    ctx.lineWidth = 1.2 / scale;
    for (const lx of [-64, -48, 48, 64]) { ctx.beginPath(); ctx.moveTo(lx, -5); ctx.lineTo(lx, 7); ctx.stroke(); }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5 / scale;
    // 꼬리 붐(엔진 나셀) 두 개: 앞쪽 엔진은 파란 덮개
    for (const bx of [-30, 30]) {
      ctx.fillStyle = silver;
      ctx.beginPath(); ctx.roundRect(bx - 7, -34, 14, 86, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = blue;
      ctx.beginPath(); ctx.ellipse(bx, -30, 8, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // 프로펠러: 빠르게 도는 원판 + 날 두 장
      ctx.fillStyle = 'rgba(200,210,225,0.35)';
      ctx.beginPath(); ctx.ellipse(bx, -44, 20, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(bx, -44);
      ctx.scale(Math.cos(reducedMotion ? 0.7 : time * 40 + bx), 1);
      ctx.fillStyle = '#4A3A20';
      ctx.fillRect(-20, -2, 40, 4);
      ctx.restore();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(bx, -44, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // 가운데 동체(조종석) — 파란 기수
    ctx.fillStyle = silver;
    ctx.beginPath(); ctx.ellipse(0, -10, 11, 34, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = blue;
    ctx.beginPath(); ctx.ellipse(0, -36, 7, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9FD3F2';
    ctx.beginPath(); ctx.ellipse(0, -10, 6, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /**
   * 위에서 본 거대 비행선 데스스타(ISB 공중 요새). 길쭉한 강철 선체, 가운데 함교, 양옆 엔진과 프로펠러,
   * 아래(지구방위팀 쪽)를 향한 포탑 여러 개, 붉은 경고등. angle·alpha·scale은 엔딩 컷씬의 추락용.
   */
  function drawDeathstar(x, y, scale, time, reducedMotion, alpha = 1, angle = 0) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    // 그림자
    ctx.fillStyle = 'rgba(20,30,60,0.2)';
    ctx.beginPath(); ctx.ellipse(40, 60, 330, 92, 0, 0, Math.PI * 2); ctx.fill();
    // 양옆 엔진 날개와 프로펠러
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#3B4250';
      ctx.beginPath(); ctx.roundRect(sx > 0 ? 180 : -300, -26, 120, 52, 14); ctx.fill(); ctx.stroke();
      for (const ex of [sx * 230, sx * 280]) {
        ctx.fillStyle = 'rgba(180,190,205,0.4)';
        ctx.beginPath(); ctx.arc(ex, -40, 26, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(ex, -40);
        ctx.rotate(reducedMotion ? 0.4 : time * 18 * sx);
        ctx.fillStyle = '#2A2E35';
        ctx.fillRect(-26, -3, 52, 6);
        ctx.fillRect(-3, -26, 6, 52);
        ctx.restore();
      }
    }
    // 선체
    const hull = ctx.createLinearGradient(0, -110, 0, 110);
    hull.addColorStop(0, '#7A8290');
    hull.addColorStop(0.5, '#4E5562');
    hull.addColorStop(1, '#2F343D');
    ctx.fillStyle = hull;
    ctx.beginPath(); ctx.ellipse(0, 0, 300, 105, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 늑골(가로 줄)과 판
    ctx.strokeStyle = 'rgba(20,24,30,0.45)';
    ctx.lineWidth = 3;
    for (let i = -4; i <= 4; i++) {
      const rx = i * 60;
      const ry = 105 * Math.sqrt(Math.max(0, 1 - (rx / 300) ** 2));
      ctx.beginPath(); ctx.moveTo(rx, -ry); ctx.lineTo(rx, ry); ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(0, 0, 300, 52, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    // 함교(가운데 위)와 ISB 표식
    ctx.fillStyle = '#2A2E35';
    ctx.beginPath(); ctx.roundRect(-70, -50, 140, 70, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FF4B3A';
    for (let i = 0; i < 5; i++) { ctx.fillRect(-56 + i * 26, -36, 14, 8); }
    ctx.fillStyle = '#D56A26';
    ctx.beginPath(); ctx.roundRect(-48, -2, 96, 34, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ISB', 0, 16);
    // 아래를 향한 포탑들
    for (const tx of [-220, -140, 140, 220, -60, 60]) {
      const ty = 105 * Math.sqrt(Math.max(0, 1 - (tx / 300) ** 2)) - 18;
      ctx.fillStyle = '#2A2E35';
      ctx.beginPath(); ctx.arc(tx, ty, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillRect(tx - 4, ty, 8, 30);
    }
    // 깜빡이는 경고등
    const blink = reducedMotion ? 1 : (Math.sin(time * 6) > 0 ? 1 : 0.3);
    ctx.fillStyle = `rgba(255,60,50,${blink})`;
    for (const lx of [-290, 290]) { ctx.beginPath(); ctx.arc(lx, 0, 8, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  /*
   * 하늘(공중전) 배경: 비 내리는 밤, 도시 상공. 라이트닝이 앞으로(위로) 날아가니 땅(도시)·구름·비가 계속 아래로 흘러간다.
   * 도시는 가로 한 줄(블록·건물 지붕·불 켜진 창문·가로등 길)을 미리 몇 장 그려 두고 줄마다 골라 이어 붙인다.
   * 가까운 구름은 더 빨리 흐르고(원근), 빗줄기가 비스듬히 떨어지며, 가끔 번개가 쳐 화면이 번쩍인다.
   */
  const CITY_ROW_H = 260;
  const CITY_SPEED = 170;     // 도시가 흘러가는 속도(초당)
  const CLOUD_SPEED = 420;    // 가까운 비구름
  const RAIN_SPEED = 1500;
  let cityRows = null;

  /** 시드 고정 난수(도시 줄 그림을 늘 같게) */
  function cityRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 도시 한 줄(가로 1600 × 세로 260): 위쪽 가로 도로 + 세로 골목으로 나뉜 블록, 블록마다 건물 지붕과 창문 불빛 */
  function makeCityRow(seed) {
    const c = document.createElement('canvas');
    c.width = ARENA_WIDTH;
    c.height = CITY_ROW_H;
    const g = c.getContext('2d');
    const rnd = cityRng(seed);
    g.fillStyle = '#0B0F1A';
    g.fillRect(0, 0, c.width, c.height);
    // 가로 큰길: 젖은 아스팔트 + 차선 + 가로등 불빛 웅덩이
    g.fillStyle = '#161B27';
    g.fillRect(0, 0, c.width, 44);
    g.fillStyle = 'rgba(255,214,110,0.55)';
    for (let x = 20; x < c.width; x += 80) g.fillRect(x, 20, 34, 3);
    for (let x = 40; x < c.width; x += 160) {
      const glow = g.createRadialGradient(x, 6, 0, x, 6, 46);
      glow.addColorStop(0, 'rgba(255,200,110,0.35)');
      glow.addColorStop(1, 'rgba(255,200,110,0)');
      g.fillStyle = glow;
      g.fillRect(x - 46, -40, 92, 92);
    }
    // 블록(세로 골목으로 나뉨)
    let x = 0;
    while (x < c.width) {
      const w = 150 + Math.floor(rnd() * 120);
      const bx = x + 14, bw = Math.min(w - 28, c.width - bx);
      // 블록 바닥
      g.fillStyle = '#121725';
      g.fillRect(bx, 56, bw, CITY_ROW_H - 64);
      // 건물 지붕 2~4개
      let by = 62;
      while (by < CITY_ROW_H - 30) {
        const bh = 50 + Math.floor(rnd() * 80);
        const h = Math.min(bh, CITY_ROW_H - 12 - by);
        let cx = bx + 6;
        while (cx < bx + bw - 30) {
          const cw = Math.min(40 + Math.floor(rnd() * 70), bx + bw - 6 - cx);
          const shade = 28 + Math.floor(rnd() * 26);
          g.fillStyle = `rgb(${shade},${shade + 4},${shade + 18})`;
          g.fillRect(cx, by, cw, h - 6);
          g.strokeStyle = 'rgba(0,0,0,0.6)';
          g.lineWidth = 2;
          g.strokeRect(cx, by, cw, h - 6);
          // 창문 불빛(지붕 가장자리에 비치는 빛)
          for (let wy = by + 8; wy < by + h - 14; wy += 12) {
            for (let wx = cx + 6; wx < cx + cw - 8; wx += 10) {
              if (rnd() < 0.32) {
                g.fillStyle = rnd() < 0.85 ? 'rgba(255,214,120,0.85)' : 'rgba(160,220,255,0.8)';
                g.fillRect(wx, wy, 5, 6);
              }
            }
          }
          // 옥상 장치·네온
          if (rnd() < 0.3) {
            g.fillStyle = rnd() < 0.5 ? 'rgba(255,70,170,0.9)' : 'rgba(70,230,255,0.9)';
            g.fillRect(cx + 4, by + 4, Math.min(26, cw - 8), 5);
          }
          if (rnd() < 0.25) {
            g.fillStyle = '#FF3B30';
            g.beginPath(); g.arc(cx + cw - 6, by + 6, 2.5, 0, Math.PI * 2); g.fill();
          }
          cx += cw + 6;
        }
        by += h;
      }
      x += w;
    }
    return c;
  }

  function drawSkyBackground(time, reducedMotion) {
    if (!cityRows) cityRows = Array.from({ length: 6 }, (_, i) => makeCityRow(1000 + i * 7919));
    const t = reducedMotion ? 0 : time;
    // 도시: 위에서부터 줄을 이어 붙이고 아래로 흘려보낸다(줄 번호마다 같은 그림)
    const scroll = t * CITY_SPEED;
    const first = Math.floor(scroll / CITY_ROW_H);
    const offset = scroll - first * CITY_ROW_H;
    for (let j = -1; j * CITY_ROW_H < ARENA_HEIGHT + CITY_ROW_H; j++) {
      const id = j - first;
      const row = cityRows[((id * 2654435761) >>> 0) % cityRows.length];
      ctx.drawImage(row, 0, j * CITY_ROW_H + offset);
    }
    // 도로 위를 달리는 차 불빛(앞 흰빛·뒤 붉은빛)
    for (let i = 0; i < 14; i++) {
      const lane = i % 2;
      const rowY = ((i % 5) - 1) * CITY_ROW_H + offset; // 그 줄 위쪽 큰길
      const dir = lane ? 1 : -1;
      const x = ((i * 233 + t * (90 + (i % 4) * 25) * dir) % ARENA_WIDTH + ARENA_WIDTH) % ARENA_WIDTH;
      ctx.fillStyle = dir > 0 ? 'rgba(255,250,220,0.9)' : 'rgba(255,60,50,0.9)';
      ctx.fillRect(x, rowY + 12 + lane * 14, 8, 3);
    }
    // 밤 하늘 높이에서 내려다보는 느낌: 짙은 남색으로 덮고(아래쪽은 조금 밝게)
    const night = ctx.createLinearGradient(0, 0, 0, ARENA_HEIGHT);
    night.addColorStop(0, 'rgba(6,10,26,0.62)');
    night.addColorStop(1, 'rgba(12,20,44,0.38)');
    ctx.fillStyle = night;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    // 가까운 비구름: 도시보다 빨리 흐른다
    for (let i = 0; i < 7; i++) {
      const span = ARENA_HEIGHT + 500;
      const y = ((i * 263 + t * CLOUD_SPEED * (0.8 + (i % 3) * 0.2)) % span) - 250;
      const x = (i * 431 + 120) % ARENA_WIDTH;
      const k = 0.8 + (i % 3) * 0.3;
      ctx.fillStyle = `rgba(60,68,92,${0.28 + (i % 2) * 0.12})`;
      for (const [dx, dy, r] of [[0, 0, 90], [80, 16, 70], [-80, 20, 64], [24, -30, 60]]) {
        ctx.beginPath(); ctx.ellipse(x + dx * k, y + dy * k, r * k * 1.5, r * k, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    drawRain(time, reducedMotion);
  }

  /*
   * 4스테이지 도로 배경: 비 내리는 밤, 도시의 넓은 도로를 위에서 내려다본다. 모두 오른쪽으로 달리고 있으니
   * 차선 점선·가로등 불빛·젖은 노면의 반사가 계속 왼쪽으로 흘러간다. 위아래 끝은 갓길 난간과 건물 지붕.
   * 차선 경계(LANES)는 요원(위)·엄폐물 트럭·탱크·주인공(아래)이 각자 차선 하나씩 쓰게 나눴다.
   */
  const ROAD_SPEED = 900;     // 노면이 흘러가는 속도(초당)
  const ROAD_EDGE = 26;       // 위아래 갓길 두께
  const LANES = [180, 320, 440, 560, 680, 820];
  const CAR = { l: 150, w: 84 };

  function drawRoadBackground(time, reducedMotion) {
    const t = reducedMotion ? 0 : time;
    const asphalt = ctx.createLinearGradient(0, 0, 0, ARENA_HEIGHT);
    asphalt.addColorStop(0, '#161A24');
    asphalt.addColorStop(0.5, '#1E2330');
    asphalt.addColorStop(1, '#161A24');
    ctx.fillStyle = asphalt;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    const scroll = (t * ROAD_SPEED) % 2000;
    // 젖은 노면에 비친 가로등 불빛(길게 번진 주황 빛)
    for (let i = 0; i < 6; i++) {
      for (const top of [true, false]) {
        const x = ((i * 400 + (top ? 0 : 200) - scroll) % 2400 + 2400) % 2400 - 400;
        const y = top ? ROAD_EDGE + 40 : ARENA_HEIGHT - ROAD_EDGE - 40;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 170);
        glow.addColorStop(0, 'rgba(255,190,100,0.22)');
        glow.addColorStop(1, 'rgba(255,190,100,0)');
        ctx.fillStyle = glow;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1.8, 1);
        ctx.translate(-x, -y);
        ctx.fillRect(x - 170, y - 170, 340, 340);
        ctx.restore();
      }
    }
    // 네온 간판 반사(분홍·하늘색 번짐)
    for (let i = 0; i < 4; i++) {
      const x = ((i * 530 + 260 - scroll * 0.9) % 2120 + 2120) % 2120 - 260;
      const y = i % 2 ? 150 : ARENA_HEIGHT - 150;
      ctx.fillStyle = i % 2 ? 'rgba(255,70,170,0.07)' : 'rgba(70,230,255,0.07)';
      ctx.beginPath(); ctx.ellipse(x, y, 160, 46, 0, 0, Math.PI * 2); ctx.fill();
    }
    // 차선: 흰 점선이 왼쪽으로 흐른다(가운데 두 줄은 노란 중앙선 대신 굵은 흰 선)
    for (const [i, y] of LANES.entries()) {
      ctx.fillStyle = i === 2 || i === 3 ? 'rgba(255,214,110,0.55)' : 'rgba(235,240,250,0.55)';
      const dash = 90, gap = 70, period = dash + gap;
      const off = scroll % period;
      for (let x = -off; x < ARENA_WIDTH; x += period) ctx.fillRect(x, y - 3, dash, 6);
    }
    // 갓길: 위아래 난간과 그 너머 건물 지붕(어둡게), 난간 기둥이 흐른다
    for (const top of [true, false]) {
      const y0 = top ? 0 : ARENA_HEIGHT - ROAD_EDGE;
      ctx.fillStyle = '#0B0F1A';
      ctx.fillRect(0, y0, ARENA_WIDTH, ROAD_EDGE);
      const railY = top ? ROAD_EDGE - 4 : ARENA_HEIGHT - ROAD_EDGE + 2;
      ctx.fillStyle = '#8A93A3';
      ctx.fillRect(0, railY, ARENA_WIDTH, 3);
      ctx.fillStyle = '#5E6672';
      const off = (t * ROAD_SPEED) % 60;
      for (let x = -off; x < ARENA_WIDTH; x += 60) ctx.fillRect(x, top ? railY - 6 : railY, 4, 9);
      // 지붕 창문 불빛
      for (let i = 0; i < 30; i++) {
        const x = ((i * 97 - t * ROAD_SPEED * 0.97) % ARENA_WIDTH + ARENA_WIDTH) % ARENA_WIDTH;
        if ((i * 7) % 3 === 0) continue;
        ctx.fillStyle = i % 4 ? 'rgba(255,214,120,0.7)' : 'rgba(160,220,255,0.7)';
        ctx.fillRect(x, y0 + (top ? 5 : 10), 6, 6);
      }
    }
    // 바람에 날리는 물보라·속도선
    if (!reducedMotion) {
      ctx.strokeStyle = 'rgba(200,215,240,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const y = 40 + ((i * 211) % (ARENA_HEIGHT - 80));
        const x = ((i * 389 - time * ROAD_SPEED * 1.6) % (ARENA_WIDTH + 300) + ARENA_WIDTH + 300) % (ARENA_WIDTH + 300) - 150;
        ctx.moveTo(x, y); ctx.lineTo(x + 120, y);
      }
      ctx.stroke();
    }
    drawRain(time, reducedMotion, true);
  }

  /** 비: 비스듬히 빠르게 떨어지는 빗줄기(도로에서는 바닥에 튀는 물방울도). 번개가 가끔 번쩍인다. */
  function drawRain(time, reducedMotion, splash = false) {
    const t = reducedMotion ? 0 : time;
    ctx.strokeStyle = 'rgba(170,195,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 150; i++) {
      const sx = (i * 113) % ARENA_WIDTH;
      const y = ((i * 337 + t * RAIN_SPEED * (0.85 + (i % 5) * 0.06)) % (ARENA_HEIGHT + 80)) - 40;
      const x = (sx - y * 0.18 + ARENA_WIDTH * 2) % ARENA_WIDTH;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 7, y + 34);
    }
    ctx.stroke();
    if (splash && !reducedMotion) {
      ctx.strokeStyle = 'rgba(190,210,255,0.4)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) {
        const k = (time * 2.3 + i * 0.37) % 1;
        const x = (i * 271 + Math.floor(time * 2.3 + i * 0.37) * 577) % ARENA_WIDTH;
        const y = (i * 523 + Math.floor(time * 2.3 + i * 0.37) * 311) % ARENA_HEIGHT;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.ellipse(x, y, 4 + k * 12, 2 + k * 5, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (!reducedMotion) {
      const p = time % 7.3;
      const flash = p < 0.08 ? 0.45 : p > 0.18 && p < 0.26 ? 0.3 : 0;
      if (flash) {
        ctx.fillStyle = `rgba(220,230,255,${flash})`;
        ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
      }
    }
  }

  /**
   * 위에서 본 달리는 자동차(오른쪽으로 달림). 지구방위팀은 파란 스포츠카, ISB는 검은 세단에 주황 줄.
   * 앞(오른쪽)으로 전조등 빛, 뒤(왼쪽)로 붉은 미등과 물보라. (x, y)는 지붕 가운데(그 위에 캐릭터가 선다).
   */
  function drawCar(x, y, team, time, reducedMotion, alpha = 1) {
    const { l, w } = CAR;
    const bob = reducedMotion ? 0 : Math.sin(time * 11 + x * 0.05) * 1.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y + 10 + bob);
    // 전조등 빛
    const beam = ctx.createLinearGradient(l / 2, 0, l / 2 + 260, 0);
    beam.addColorStop(0, 'rgba(255,248,210,0.35)');
    beam.addColorStop(1, 'rgba(255,248,210,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(l / 2, -w / 2 + 10); ctx.lineTo(l / 2 + 260, -w / 2 - 40); ctx.lineTo(l / 2 + 260, w / 2 + 40); ctx.lineTo(l / 2, w / 2 - 10);
    ctx.closePath(); ctx.fill();
    // 뒤로 튀는 물보라
    if (!reducedMotion) {
      ctx.fillStyle = 'rgba(200,215,240,0.18)';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(-l / 2 - 26 - Math.random() * 10, side * (w / 2 - 6), 36, 10, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // 그림자·바퀴
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.roundRect(-l / 2 + 6, -w / 2 + 10, l, w, 22); ctx.fill();
    ctx.fillStyle = '#0D0F14';
    for (const wx of [-l / 2 + 34, l / 2 - 40]) for (const side of [-1, 1]) ctx.fillRect(wx - 18, side * w / 2 - 7, 36, 14);
    // 차체
    const body = team === 'earth' ? ['#2E7BE0', '#1B4F99'] : ['#2A2D35', '#15171C'];
    const grad = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
    grad.addColorStop(0, body[0]);
    grad.addColorStop(0.5, body[1]);
    grad.addColorStop(1, body[0]);
    ctx.fillStyle = grad;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-l / 2, -w / 2, l, w, 26); ctx.fill(); ctx.stroke();
    // 줄무늬(팀 색)
    ctx.fillStyle = team === 'earth' ? 'rgba(255,255,255,0.75)' : TEAM_COLOR.isb;
    ctx.fillRect(-l / 2 + 8, -6, l - 16, 5);
    ctx.fillRect(-l / 2 + 8, 3, l - 16, 5);
    // 앞뒤 유리(지붕은 가운데)
    ctx.fillStyle = 'rgba(120,170,230,0.55)';
    ctx.beginPath(); ctx.roundRect(l / 2 - 62, -w / 2 + 12, 26, w - 24, 8); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-l / 2 + 26, -w / 2 + 14, 20, w - 28, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-l / 2 + 50, -w / 2 + 10, l - 116, w - 20, 10); ctx.stroke();
    // 전조등·미등
    ctx.fillStyle = '#FFF7D6';
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(l / 2 - 6, side * (w / 2 - 14), 5, 9, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#FF3B30';
    for (const side of [-1, 1]) ctx.fillRect(-l / 2 + 1, side * (w / 2 - 14) - 8, 5, 16);
    // 경찰 경광등처럼 ISB 차 지붕엔 주황 경광등
    if (team === 'isb') {
      const on = reducedMotion ? 1 : (Math.floor(time * 6) % 2);
      ctx.fillStyle = on ? '#FF9D3F' : '#7A3A12';
      ctx.fillRect(-14, -w / 2 + 4, 28, 8);
    }
    ctx.restore();
  }

  /**
   * 위에서 본 탱크(도로에서 전투기 대신). 무한궤도 두 줄, 몸체, 가운데 포탑에 위·아래로 뻗은 포신 두 개
   * (위아래 양쪽으로 포탄을 쏜다). 막 쐈을 때는 포구에 불꽃.
   */
  function drawTank(jet, time, reducedMotion) {
    const len = TANK_DRAW.l, w = TANK_DRAW.w;
    const flash = jet.fireTimer > TANK.missile.interval - 0.12;
    ctx.save();
    ctx.translate(jet.x, jet.y);
    ctx.scale(jet.dir, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.roundRect(-len / 2 + 8, -w / 2 + 12, len, w, 14); ctx.fill();
    // 무한궤도(움직이는 마디)
    const tread = reducedMotion ? 0 : (time * 140) % 16;
    for (const side of [-1, 1]) {
      const ty = side > 0 ? w / 2 - 22 : -w / 2;
      ctx.fillStyle = '#1C1F18';
      ctx.fillRect(-len / 2, ty, len, 22);
      ctx.fillStyle = '#3A3F33';
      for (let x = -len / 2 + tread; x < len / 2; x += 16) ctx.fillRect(x, ty + 2, 6, 18);
    }
    // 몸체
    ctx.fillStyle = '#56663F';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-len / 2 + 14, -w / 2 + 16, len - 28, w - 32, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6E7F50';
    ctx.fillRect(len / 2 - 60, -w / 2 + 22, 34, w - 44);
    ctx.fillStyle = '#FFF7D6';
    for (const side of [-1, 1]) ctx.fillRect(len / 2 - 18, side * (w / 2 - 30) - 4, 6, 8);
    ctx.fillStyle = '#C0392B';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ISB', -len / 2 + 50, 0);
    // 포신 두 개(위·아래)와 포탑
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#3F4A2D';
      ctx.fillRect(-7, side > 0 ? 20 : -20 - 70, 14, 70);
      ctx.fillStyle = '#2A3120';
      ctx.fillRect(-9, side > 0 ? 82 : -92, 18, 10);
      if (flash) {
        ctx.fillStyle = '#FFD45E';
        ctx.beginPath(); ctx.arc(0, side * 104, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FF9D3F';
        ctx.beginPath(); ctx.arc(0, side * 104, 9, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = '#4B5A36';
    ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3A4529';
    ctx.beginPath(); ctx.arc(10, -6, 12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /**
   * 낙하산: 캐릭터(x, y) 위로 펼쳐진 붉은·흰 줄무늬 덮개와 줄. open(0~1)만큼 펼쳐지고, s는 크기 배율.
   */
  function drawChute(x, y, s, open, alpha = 1) {
    if (open <= 0.01) return;
    const cw = 150 * s * (0.3 + 0.7 * open), ch = 70 * s * open, cy = y - 120 * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(230,235,245,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const k of [-1, -0.5, 0.5, 1]) { ctx.moveTo(x + k * cw / 2, cy); ctx.lineTo(x + k * 10 * s, y - 20 * s); }
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, cy, cw / 2, ch, 0, Math.PI, 0);
    ctx.closePath();
    ctx.clip();
    const n = 6;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? '#F4F1E8' : '#D9443A';
      ctx.fillRect(x - cw / 2 + (cw / n) * i, cy - ch, cw / n + 1, ch + 2);
    }
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, cy, cw / 2, ch, 0, Math.PI, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 낙하산 컷씬: 하늘에서는 라이트닝에서 뛰어내린 주인공이 작아지며(떨어지며) 낙하산을 펴고, 라이트닝은 위로 날아간다.
   * 도로로 바뀐 뒤에는 각자의 차가 달리고, 주인공이 낙하산을 타고 내려와 지붕에 내려앉으면 낙하산이 접히며 뒤로 날아간다.
   */
  function drawParachuteCutscene(match, cut, time, reducedMotion) {
    for (const h of cut.heroes) {
      const p = match.players.find((q) => q.id === h.id);
      if (!p) continue;
      const pose = (x, y, scale) => ({
        ...p, plane: false, alive: true, hurt: 0, x, y, scale, aim: -Math.PI / 2,
        weapon: p.ground?.primary ?? p.primary, primaryOnly: true,
      });
      if (!cut.switched) {
        if (h.planeAlpha > 0.01) {
          ctx.save();
          ctx.globalAlpha = h.planeAlpha;
          drawLightning(h.planeX, h.planeY, 0, 0.95, time, reducedMotion);
          ctx.restore();
        }
        if (!h.jumped) continue;
        drawChute(h.x, h.y, h.scale, h.chute);
        drawPlayer(pose(h.x, h.y, (p.ground?.scale ?? 1) * h.scale), { moveAxis: 0, aiming: false }, time, reducedMotion);
        continue;
      }
      drawCar(h.toX, RAIL_Y.earth, 'earth', time, reducedMotion);
      if (h.landed) {
        // 접히며 뒤로 날아가는 낙하산
        drawChute(h.x - (1 - h.chute) * 260, h.y - (1 - h.chute) * 40, 1, h.chute, h.chute);
      } else {
        drawChute(h.x, h.y, 1, h.chute);
      }
      drawPlayer(pose(h.x, h.y, p.scale), { moveAxis: 0, aiming: false }, time, reducedMotion);
    }
  }

  /** 위에서 본 헬리콥터·건쉽. 기수는 dir 쪽(-1이면 왼쪽). 그림자 → 동체 → 회전 날개 순. */
  function drawCarrier(c, time, reducedMotion) {
    const gunship = c.kind === 'gunship';
    const k = (gunship ? 1.35 : 1) * (c.scale ?? 1); // scale: 공중전 적 건쉽은 작게
    const body = gunship ? '#4B5A44' : '#5E7FA3';
    const dark = gunship ? '#323C2E' : '#3E5876';
    const down = c.state === 'down';
    const fade = down ? Math.max(0, 1 - c.fall / 1.4) : 1;
    const rotor = reducedMotion ? 0.6 : time * (down ? 9 : 22);
    ctx.save();
    ctx.globalAlpha = fade;
    // 그림자(하늘 높이 떠 있음)
    ctx.fillStyle = 'rgba(48,53,62,0.18)';
    ctx.beginPath();
    ctx.ellipse(c.x + 34, c.y + 64, 96 * k, 34 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.scale(k, k); // 기수는 왼쪽(-x)
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4 / k;
    ctx.lineJoin = 'round';
    // 꼬리(오른쪽으로 길게) + 꼬리 날개
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.roundRect(30, -8, 112, 16, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(128, -26, 14, 52, 5); ctx.fill(); ctx.stroke();
    // 꼬리 회전 날개
    ctx.save();
    ctx.translate(135, 30);
    ctx.rotate(rotor * 1.6);
    ctx.lineWidth = 3 / k;
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke();
    ctx.restore();
    if (gunship) {
      // 건쉽: 짧은 날개 + 로켓 포드 + 기수 기관포
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.roundRect(-12, -62, 26, 124, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2A2E35';
      for (const y of [-58, 40]) { ctx.beginPath(); ctx.roundRect(-30, y, 46, 18, 8); ctx.fill(); ctx.stroke(); }
      ctx.beginPath(); ctx.roundRect(-98, -5, 30, 10, 3); ctx.fill(); ctx.stroke();
    }
    // 동체
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-6, 0, 72, 36, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // 조종석 유리(기수 쪽)
    ctx.fillStyle = '#9FD3F2';
    ctx.beginPath();
    ctx.ellipse(-44, 0, 24, 22, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // 문(요원이 내리는 곳)과 표식
    ctx.fillStyle = dark;
    ctx.fillRect(-4, -34, 34, 8);
    ctx.fillRect(-4, 26, 34, 8);
    ctx.fillStyle = '#D56A26';
    ctx.font = `bold ${gunship ? 14 : 16}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ISB', 18, 1);
    // 주 회전 날개: 흐릿한 원판 + 날개 2(건쉽 4)장
    ctx.fillStyle = 'rgba(48,53,62,0.12)';
    ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.rotate(rotor);
    ctx.fillStyle = '#30353E';
    const blades = gunship ? 4 : 2;
    for (let i = 0; i < blades; i++) {
      ctx.rotate(Math.PI * 2 / blades);
      ctx.fillRect(-4, -112, 8, 112);
    }
    ctx.restore();
    ctx.fillStyle = '#C9CDD2';
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
    // 격추: 불길과 연기
    if (down) {
      ctx.save();
      ctx.globalAlpha = fade;
      for (let i = 0; i < 4; i++) {
        const r = 26 + i * 10 + (reducedMotion ? 0 : Math.sin(time * 20 + i) * 4);
        ctx.fillStyle = i % 2 ? 'rgba(255,157,63,0.7)' : 'rgba(80,80,80,0.45)';
        ctx.beginPath(); ctx.arc(c.x - 20 + i * 18, c.y - 10 - i * 8, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * 복도 엘리베이터(기획서 그림처럼 정면에서 본 모습): 위쪽 벽 가운데 두 짝 문(◁ ▷)과 오른쪽 호출 버튼.
   * open(0~1)만큼 문이 양옆으로 열리고 안쪽 불빛이 보인다. 열려 있는 동안 버튼이 켜진다.
   */
  function drawElevator(e) {
    const { x, w } = ELEVATOR;
    const left = x - w / 2, top = 2, h = 62;
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    // 안쪽(문이 열리면 보임)
    ctx.fillStyle = '#FFE9A8';
    ctx.fillRect(left, top, w, h);
    ctx.fillStyle = 'rgba(255,212,94,0.5)';
    ctx.fillRect(left + 10, top + 8, w - 20, 12);
    // 문 두 짝
    const half = w / 2, slide = half * 0.92 * e.open;
    ctx.fillStyle = '#AEB6BF';
    ctx.lineWidth = 3;
    for (const [dx, sign] of [[0, -1], [half, 1]]) {
      const dxs = left + dx + sign * slide;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, w, h);
      ctx.clip();
      ctx.fillRect(dxs, top, half, h);
      ctx.strokeRect(dxs, top, half, h);
      // ◁ ▷ 표시
      ctx.fillStyle = INK;
      const cx = dxs + half / 2, cy = top + h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - sign * 9, cy - 10); ctx.lineTo(cx + sign * 9, cy); ctx.lineTo(cx - sign * 9, cy + 10);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#AEB6BF';
    }
    // 문틀
    ctx.lineWidth = 5;
    ctx.strokeRect(left, top, w, h);
    // 호출 버튼 판
    ctx.fillStyle = '#DADDE1';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(left + w + 14, top + 12, 18, 38, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = e.open > 0 || e.target > 0 ? '#FFB23F' : '#F5F5F5';
    for (const by of [top + 22, top + 38]) {
      ctx.beginPath(); ctx.arc(left + w + 23, by, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  /**
   * 복도 벽 포탑(기획서 그림처럼 삼각대 위 상자 + 포신). 포신은 플레이어를 따라 돈다.
   * 쏘는 동안 빨간 불이 깜빡이고, 다시 쏘기 1.5초 전부터 노란 경고 원이 깜빡인다.
   */
  function drawTurret(t, story, time, reducedMotion) {
    const firing = story.turretFiring && story.phase === 'fight';
    const warning = !story.turretFiring && story.phase === 'fight' && story.turretTimer < 1.5;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    // 삼각대
    for (const a of [-0.5, 0, 0.5]) {
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(Math.sin(a) * 30 - t.dir * 8, 44); ctx.stroke();
    }
    if (warning && (reducedMotion || Math.sin(time * 18) > 0)) {
      ctx.strokeStyle = '#FFB23F';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
    }
    // 포신(조준 방향)
    ctx.save();
    ctx.rotate(t.aim);
    ctx.fillStyle = '#4A505A';
    ctx.beginPath(); ctx.roundRect(8, -6, 40, 12, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2A2E35';
    ctx.beginPath(); ctx.arc(50, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
    // 몸통 상자
    ctx.fillStyle = '#7D8A99';
    ctx.beginPath(); ctx.roundRect(-22, -16, 40, 30, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = firing && (reducedMotion || Math.sin(time * 20) > 0) ? '#FF3B30' : '#7A2A33';
    ctx.beginPath(); ctx.arc(-t.dir * 10, -24, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /** 천장이 무너지기 직전: 떨어질 자리에 커지는 그림자와 떨어지는 먼지 */
  function drawCeiling(c, time, reducedMotion) {
    const k = Math.min(1, c.t / CRACK_TIME);
    ctx.fillStyle = `rgba(48,53,62,${0.1 + 0.3 * k})`;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + 30, 40 + 90 * k, 16 + 30 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9C978E';
    for (let i = 0; i < 10; i++) {
      const fall = reducedMotion ? 0.5 : (time * 1.6 + i * 0.37) % 1;
      const x = c.x + Math.sin(i * 2.3) * (40 + 70 * k), y = c.y - 60 + fall * 120;
      ctx.globalAlpha = (1 - fall) * k;
      ctx.fillRect(x - 3, y - 3, 6 + (i % 3) * 2, 6);
    }
    ctx.globalAlpha = 1;
  }

  /** 스토리 모드 하늘: 헬리콥터·건쉽, 헬리콥터를 격추하는 전투기와 미사일 */
  function drawStoryCraft(story, time, reducedMotion) {
    if (story.carrier) drawCarrier(story.carrier, time, reducedMotion);
    if (story.missile) {
      const m = story.missile;
      ctx.fillStyle = '#FFB23F';
      ctx.beginPath(); ctx.moveTo(m.x - 16, m.y - 5); ctx.lineTo(m.x - 34, m.y); ctx.lineTo(m.x - 16, m.y + 5); ctx.fill();
      ctx.fillStyle = '#D9443A';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x + 20, m.y); ctx.lineTo(m.x + 10, m.y - 7); ctx.lineTo(m.x - 16, m.y - 7); ctx.lineTo(m.x - 16, m.y + 7); ctx.lineTo(m.x + 10, m.y + 7);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (story.jet) drawJet(story.jet);
  }

  /** 스토리 모드 안내: 왼쪽 가운데 웨이브 표시 + 웨이브 시작·클리어 때 가운데 큰 글씨 */
  function drawStoryHud(story) {
    const index = currentWave(story);
    const wave = WAVES[index];
    const { n, total } = stageProgress(index);
    const text = `${waveLabel(index)} (${n}/${total})`;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 24;
    ctx.fillStyle = wave.boss ? '#B3261E' : TEAM_COLOR.isb;
    ctx.beginPath();
    ctx.roundRect(36, ARENA_HEIGHT / 2 - 18, w, 36, 18);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 48, ARENA_HEIGHT / 2 + 1);

    const b = story.banner;
    if (!b) return;
    // 들어올 때 커지고 나갈 때 흐려진다
    const fadeIn = Math.min(1, b.t / 0.25), fadeOut = Math.min(1, (b.duration - b.t) / 0.4);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
    ctx.translate(ARENA_WIDTH / 2, 330);
    const s = 0.8 + 0.2 * fadeIn;
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = b.text.includes('보스') || b.text.includes('경고') ? '#B3261E' : INK;
    ctx.strokeText(b.text, 0, 0);
    ctx.fillText(b.text, 0, 0);
    if (b.sub) {
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.lineWidth = 7;
      ctx.fillStyle = INK;
      ctx.strokeText(b.sub, 0, 70);
      ctx.fillText(b.sub, 0, 70);
    }
    ctx.restore();
  }

  /**
   * 엔딩 컷씬의 스미스 요원과 총알. 스미스 요원은 달릴 때 잔상이 남고, 차인 뒤에는 빙글빙글 돌며
   * 건물 밖으로 날아가 작아지며(아래로 떨어지며) 사라진다.
   */
  function drawCutsceneActors(match, cut, time, reducedMotion) {
    const boss = match.players.find((p) => p.id === cut.bossId);
    const { smith } = cut;
    const { img, anchor } = assets[boss.characterId];
    const facing = cut.hero.x < smith.x ? -1 : 1;
    const sprite = (x, y, alpha) => {
      const size = SPRITE_SIZE * smith.scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(smith.angle);
      // 쓰러졌다가 일어나는 모습: 처음엔 옆으로 누워 있다
      ctx.rotate((1 - smith.standing) * Math.PI / 2);
      ctx.scale(facing, 1);
      ctx.drawImage(img, -anchor[0] * size, -anchor[1] * size, size, size);
      ctx.restore();
    };
    if (!reducedMotion) smith.trail.forEach((p, i) => sprite(p.x, p.y, smith.alpha * 0.25 * (1 - i / smith.trail.length)));
    if (!cut.kicked) {
      // 보스의 붉은 기운
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 8);
      ctx.fillStyle = `rgba(217,68,58,${0.15 + 0.15 * pulse})`;
      ctx.beginPath();
      ctx.arc(smith.x, smith.y, boss.radius + 30, 0, Math.PI * 2);
      ctx.fill();
    }
    sprite(smith.x, smith.y, smith.alpha);

    const { img: bullet } = assets.bullet;
    for (const b of cut.bullets) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.drawImage(bullet, -16, -8, 32, 16);
      ctx.restore();
    }
  }

  /**
   * 계단 컷씬의 문: 옥상에서는 계단실(배경 그림의 작은 건물) 문이 열려 어두운 계단이 보이고,
   * 복도에서는 왼쪽 벽 아래쪽 문이 열린다. 문 위에 '계단' 표지.
   */
  function drawStairsDoor(cut, stage) {
    const roof = stage !== 'corridor';
    const d = roof ? ROOF_STAIRS : CORRIDOR_STAIRS;
    const x = d.x - d.w / 2, y = d.y - d.h / 2;
    ctx.save();
    // 열린 문 안쪽: 어두운 계단
    ctx.fillStyle = '#1E2228';
    ctx.fillRect(x, y, d.w, d.h);
    ctx.strokeStyle = '#5E6672';
    ctx.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      if (roof) { ctx.moveTo(x + 6, y + (d.h * i) / 4); ctx.lineTo(x + d.w - 6, y + (d.h * i) / 4); }
      else { ctx.moveTo(x + (d.w * i) / 4, y + 6); ctx.lineTo(x + (d.w * i) / 4, y + d.h - 6); }
      ctx.stroke();
    }
    // 문짝: 열리는 만큼 접힌다
    ctx.fillStyle = '#8A5A2B';
    if (roof) ctx.fillRect(x, y, d.w * (1 - cut.door * 0.85), d.h);
    else ctx.fillRect(x, y, d.w, d.h * (1 - cut.door * 0.85));
    // '계단' 표지
    const sx = roof ? d.x : d.x + 46, sy = roof ? y - 22 : y - 18;
    ctx.fillStyle = '#2E9E5B';
    ctx.beginPath(); ctx.roundRect(sx - 34, sy - 13, 68, 26, 6); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(roof ? '계단 ▼' : '계단', sx, sy + 1);
    ctx.restore();
  }

  /** 라이트닝 컷씬(옥상): 무전하는 주인공과 날아와 머무는 라이트닝(이륙하며 커짐) */
  function drawLightningCutscene(match, cut, inputs, time, reducedMotion) {
    const hero = match.players.find((p) => p.id === cut.hero.id);
    if (hero && cut.scene === 'roof' && cut.hero.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = cut.hero.alpha;
      drawPlayer({ ...hero, plane: false, x: cut.hero.x, y: cut.hero.y, aim: -Math.PI / 2, hurt: 0, alive: true }, { moveAxis: 0, aiming: false }, time, reducedMotion);
      ctx.restore();
    }
    if (cut.plane.visible) drawLightning(cut.plane.x, cut.plane.y, cut.plane.angle + Math.PI / 2, cut.plane.scale, time, reducedMotion);
  }

  /** 컷씬: 위아래 검은 띠(영화처럼)와 아래 띠의 자막 */
  function drawLetterbox(cut) {
    const k = Math.min(1, cut.t / 0.5);
    const h = 70 * k;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ARENA_WIDTH, 22 * k); // 위 띠는 얇게(ISB 레일의 스미스 요원이 가리지 않게)
    ctx.fillRect(0, ARENA_HEIGHT - h, ARENA_WIDTH, h);
    if (!cut.caption || k < 1) return;
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(cut.caption, ARENA_WIDTH / 2, ARENA_HEIGHT - h / 2);
  }

  /** 킬캠 카메라 목표: 장면의 focus(쓰러진 요원·주인공)와 zoom. 킬캠이 아니면 전체 화면. */
  function moveCamera(killcam, dt, reducedMotion) {
    const shot = killcam?.shot;
    const focus = shot?.focus ? killcam[shot.focus] : null;
    const target = focus ? { x: focus.x, y: focus.y, z: shot.zoom } : { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, z: 1 };
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    cam.x += (target.x - cam.x) * k;
    cam.y += (target.y - cam.y) * k;
    cam.z += (target.z - cam.z) * k;
  }

  /** 킬캠 중 경기장 위(카메라와 함께 확대)에 그리는 것: 무전기와 말풍선, 주인공 둘레의 반짝이 */
  function drawKillcamWorld(match, k, time, reducedMotion) {
    const mode = k.shot.mode;
    if (mode === 'radio') {
      const { x, y } = k.victim;
      // 바닥에 누운 요원 손의 무전기
      ctx.fillStyle = '#30353E';
      ctx.fillRect(x + 26, y - 8, 14, 24);
      ctx.strokeStyle = '#30353E';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + 36, y - 8); ctx.lineTo(x + 40, y - 24); ctx.stroke();
      const blink = reducedMotion || Math.sin(time * 12) > 0;
      ctx.fillStyle = blink ? '#FF3B30' : '#7A2A33';
      ctx.beginPath(); ctx.arc(x + 33, y - 2, 3, 0, Math.PI * 2); ctx.fill();
    }
    // 말풍선(무전·도발)
    if (k.shot.bubble) {
      const { x, y } = k.victim;
      const text = k.shot.bubble;
      ctx.font = 'bold 22px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 24;
      const bx = x + 50, by = y + 30;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(bx, by, w, 38, 12); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 10, by); ctx.lineTo(x + 38, y + 14); ctx.lineTo(bx + 26, by); ctx.fill();
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 12, by + 20);
    }
    if (mode === 'sigh') {
      // 한숨: 이마의 땀방울
      const { x, y } = k.hero;
      const drop = reducedMotion ? 0 : (time * 20) % 14;
      ctx.fillStyle = '#7FC4F2';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 34, y - 70 + drop);
      ctx.quadraticCurveTo(x + 46, y - 50 + drop, x + 34, y - 46 + drop);
      ctx.quadraticCurveTo(x + 22, y - 50 + drop, x + 34, y - 70 + drop);
      ctx.fill(); ctx.stroke();
    }
    if (mode === 'what') {
      // 깜짝: 머리 위 물음표·느낌표
      const { x, y } = k.hero;
      const bob = reducedMotion ? 0 : Math.sin(time * 10) * 4;
      ctx.font = 'bold 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = '#D9443A';
      ctx.strokeText('?!', x + 40, y - 92 + bob);
      ctx.fillText('?!', x + 40, y - 92 + bob);
    }
    if (mode === 'hero') {
      const { x, y } = k.hero;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + (reducedMotion ? 0 : time * 2);
        const r = 70 + (reducedMotion ? 0 : Math.sin(time * 6 + i) * 8);
        star(x + Math.cos(a) * r, y - 20 + Math.sin(a) * r * 0.7, i % 2 ? 9 : 14, i % 2 ? '#FFD45E' : '#FFFFFF');
      }
    }
  }

  /** 반짝이 별 */
  function star(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.4 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** 킬캠 화면 안내: 검은 띠·자막, 처치 순간 'K.O.!', 스미스 요원 무전(붉은 화면 + 초상) */
  function drawKillcamOverlay(k, time, reducedMotion) {
    const mode = k.shot.mode;
    if (mode === 'smith') {
      const t = k.t - 1.4;
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 4);
      ctx.fillStyle = `rgba(110,0,0,${0.35 + 0.1 * pulse})`;
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
      // 무전 화면: 오른쪽에서 밀려 들어오는 스미스 요원 초상
      const slide = reducedMotion ? 1 : Math.min(1, t / 0.4);
      const { img, anchor } = assets['isb-agent-1'];
      const size = 520;
      const px = ARENA_WIDTH - 330 + (1 - slide) * 500, py = 560;
      ctx.save();
      ctx.fillStyle = '#1A0B0D';
      ctx.beginPath(); ctx.roundRect(px - 250, py - 400, 500, 520, 24); ctx.fill();
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath(); ctx.roundRect(px - 250, py - 400, 500, 520, 24); ctx.clip();
      ctx.drawImage(img, px - anchor[0] * size, py - anchor[1] * size, size, size);
      ctx.fillStyle = 'rgba(200,20,30,0.28)'; // 붉은 무전 화면 색
      ctx.fillRect(px - 250, py - 400, 500, 520);
      // 무전 잡음 줄
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let y = py - 400; y < py + 120; y += 8) ctx.fillRect(px - 250, y + ((time * 60) % 8), 500, 2);
      ctx.restore();
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FF3B30';
      ctx.fillText(reducedMotion || Math.sin(time * 6) > -0.3 ? '● 무전 수신 중' : '', px, py - 430);
    }
    if (mode === 'kill') {
      // 처치 순간: 'K.O.!'가 커졌다 자리 잡는다
      const s = reducedMotion ? 1 : 1 + Math.max(0, 0.6 - k.t) * 1.5;
      ctx.save();
      ctx.translate(ARENA_WIDTH / 2, ARENA_HEIGHT * 0.5); // 확대된 요원(레일 쪽)을 가리지 않게 가운데
      ctx.scale(s, s);
      ctx.font = 'bold 96px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = '#D9443A';
      ctx.strokeText('K.O.!', 0, 0);
      ctx.fillText('K.O.!', 0, 0);
      ctx.restore();
    }
    drawLetterbox({ t: k.t, caption: k.shot.caption });
  }

  /** R-10 컷씬 끝: 주인공이 어깨에 멘 RPG(로켓이 끼워진 발사관) */
  function drawHeldRpg(pose) {
    ctx.save();
    ctx.translate(pose.x + Math.cos(pose.aim) * 20, pose.y - 6 + Math.sin(pose.aim) * 20);
    ctx.rotate(pose.aim);
    ctx.fillStyle = '#4E6B3A';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-34, -9, 76, 18, 5); ctx.fill(); ctx.stroke();
    ctx.drawImage(assets.rocket.img, 30, -11, 44, 22);
    ctx.restore();
  }

  /**
   * R-10 엔딩 컷씬: 다시 떠오른 R-10(지지직 불꽃), 주인공이 쏜 RPG 로켓. 폭발 뒤 R-10은 흐려지며 사라진다.
   * 레이저 난사는 'laser' 이벤트 효과로 그린다.
   */
  function drawR10Cutscene(match, cut, time, reducedMotion) {
    const boss = match.players.find((p) => p.id === cut.bossId);
    const { r10 } = cut;
    const { img, anchor } = assets[boss.characterId];
    const size = SPRITE_SIZE * r10.scale;
    const wobble = reducedMotion ? 0 : Math.sin(time * 30) * 4 * (1 - r10.rise * 0.5);
    ctx.save();
    ctx.globalAlpha = r10.alpha;
    ctx.translate(r10.x + wobble, r10.y - r10.rise * 10);
    ctx.rotate((1 - r10.rise) * 0.5);
    ctx.drawImage(img, -anchor[0] * size, -anchor[1] * size, size, size);
    ctx.restore();
    if (r10.alpha > 0 && !reducedMotion) {
      // 고장 불꽃
      for (let i = 0; i < 4; i++) {
        if (Math.sin(time * 25 + i * 1.7) < 0.3) continue;
        const a = time * 7 + i * 1.6;
        star(r10.x + Math.cos(a) * 50, r10.y + Math.sin(a) * 34, 8, '#FFD45E');
      }
    }
    if (cut.rocket && !cut.rocket.hit) {
      const { x, y, angle } = cut.rocket;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = '#FFB23F';
      ctx.beginPath(); ctx.moveTo(-20, -7); ctx.lineTo(-48 - (reducedMotion ? 0 : Math.random() * 12), 0); ctx.lineTo(-20, 7); ctx.fill();
      ctx.drawImage(assets.rocket.img, -26, -13, 52, 26);
      ctx.restore();
    }
  }

  /* ───────── 건 카타(옆에서 본 시점) ─────────
   * 밤 하늘·도시 불빛을 뒤로 한 옥상 끝에서 주인공(왼쪽)과 스미스 요원(오른쪽)이 마주 본다.
   * 스미스 요원의 공격 자세(점프·슬라이딩·정면 조준·단검)와 주인공의 반격(숙이기·공중제비·쳐내기·단검 막기)을
   * 공격 상태(warn 빛나는 중, counter 반격, hit 피격)와 진행도로 그린다.
   */
  const KATA_FLOOR = 800, KATA_HX = 470, KATA_SX = 1130, KATA_SIZE = SPRITE_SIZE * 2.8, KATA_FOOT = 0.95;
  const kEase = (k) => { const c = Math.max(0, Math.min(1, k)); return c * c * (3 - 2 * c); };
  const kClamp = (k) => Math.max(0, Math.min(1, k));
  // 도시 불빛: 건물 높이·창문을 한 번만 정해 둔다
  const KATA_CITY = Array.from({ length: 18 }, (_, i) => {
    const h = 160 + ((i * 97) % 7) * 45 + ((i * 31) % 3) * 30;
    return { x: i * 92 - 20, w: 84 + ((i * 13) % 3) * 10, h, lit: (i * 7919) % 97 };
  });

  /** 2스테이지(복도) 건 카타 배경: ISB 본부 복도를 옆에서 본 모습(벽·문·천장 조명·붉은 카펫) */
  function drawKataCorridor(time, reducedMotion) {
    const wall = ctx.createLinearGradient(0, 0, 0, KATA_FLOOR);
    wall.addColorStop(0, '#3A4150');
    wall.addColorStop(1, '#5E6672');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    // 천장과 조명
    ctx.fillStyle = '#262B35';
    ctx.fillRect(0, 0, ARENA_WIDTH, 120);
    for (let x = 140; x < ARENA_WIDTH; x += 330) {
      const on = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 3 + x);
      ctx.fillStyle = `rgba(255,244,214,${0.16 * on})`;
      ctx.beginPath(); ctx.moveTo(x - 30, 120); ctx.lineTo(x + 30, 120); ctx.lineTo(x + 130, KATA_FLOOR); ctx.lineTo(x - 130, KATA_FLOOR); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#FFF4D6';
      ctx.fillRect(x - 40, 112, 80, 10);
    }
    // 벽 패널과 문
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3;
    for (let x = 0; x < ARENA_WIDTH; x += 200) { ctx.beginPath(); ctx.moveTo(x, 120); ctx.lineTo(x, KATA_FLOOR); ctx.stroke(); }
    for (const x of [250, 1010]) {
      ctx.fillStyle = '#8A5A2B';
      ctx.fillRect(x, KATA_FLOOR - 330, 150, 330);
      ctx.fillStyle = '#FFD45E';
      ctx.beginPath(); ctx.arc(x + 128, KATA_FLOOR - 160, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#D56A26';
    ctx.beginPath(); ctx.roundRect(1330, 230, 140, 70, 10); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ISB', 1400, 267);
    // 바닥: 붉은 카펫
    ctx.fillStyle = '#4A4E57';
    ctx.fillRect(0, KATA_FLOOR, ARENA_WIDTH, ARENA_HEIGHT - KATA_FLOOR);
    ctx.fillStyle = '#8E3B3B';
    ctx.fillRect(0, KATA_FLOOR + 10, ARENA_WIDTH, 120);
    ctx.fillStyle = '#C9A24A';
    ctx.fillRect(0, KATA_FLOOR + 14, ARENA_WIDTH, 5);
    ctx.fillRect(0, KATA_FLOOR + 121, ARENA_WIDTH, 5);
  }

  /** 건 카타 배경(4스테이지 도로): 비 내리는 밤, 옆으로 흘러가는 도시. 둘은 달리는 트레일러 지붕 위에서 맞선다. */
  function drawKataRoad(time, reducedMotion) {
    const t = reducedMotion ? 0 : time;
    const sky = ctx.createLinearGradient(0, 0, 0, KATA_FLOOR);
    sky.addColorStop(0, '#070A18');
    sky.addColorStop(1, '#1D2140');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    // 먼 도시: 왼쪽으로 흘러간다(가로로 이어 붙임)
    const span = ARENA_WIDTH + 200;
    const off = (t * 260) % span;
    for (const shift of [0, span]) {
      for (const b of KATA_CITY) {
        const x = b.x - off + shift;
        if (x > ARENA_WIDTH || x + b.w < 0) continue;
        const top = KATA_FLOOR - 120 - b.h;
        ctx.fillStyle = '#121630';
        ctx.fillRect(x, top, b.w, b.h + 120);
        for (let wy = top + 18; wy < KATA_FLOOR - 130; wy += 34) {
          for (let wx = 12; wx < b.w - 14; wx += 24) {
            if (((wx * 3 + wy * 7 + b.lit) % 5) >= 2) continue;
            ctx.fillStyle = 'rgba(255,214,110,0.5)';
            ctx.fillRect(x + wx, wy, 10, 14);
          }
        }
      }
    }
    // 가로등이 빠르게 지나간다
    for (let i = 0; i < 4; i++) {
      const x = ((i * 520 - t * 1100) % 2080 + 2080) % 2080 - 240;
      ctx.fillStyle = '#3A3F4D';
      ctx.fillRect(x, 260, 10, KATA_FLOOR - 260);
      ctx.fillRect(x, 260, 70, 8);
      const glow = ctx.createRadialGradient(x + 66, 270, 0, x + 66, 270, 120);
      glow.addColorStop(0, 'rgba(255,200,110,0.45)');
      glow.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 60, 150, 250, 240);
    }
    // 트레일러 지붕(발판)과 그 아래 젖은 도로·바퀴
    ctx.fillStyle = '#15181F';
    ctx.fillRect(0, KATA_FLOOR, ARENA_WIDTH, ARENA_HEIGHT - KATA_FLOOR);
    const roof = ctx.createLinearGradient(0, KATA_FLOOR, 0, KATA_FLOOR + 60);
    roof.addColorStop(0, '#A9B0BC');
    roof.addColorStop(1, '#5E6672');
    ctx.fillStyle = roof;
    ctx.fillRect(0, KATA_FLOOR, ARENA_WIDTH, 60);
    ctx.fillStyle = '#2E7BE0';
    ctx.fillRect(0, KATA_FLOOR + 60, ARENA_WIDTH, 70);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(0, KATA_FLOOR + 90, ARENA_WIDTH, 6);
    const spin = (t * 20) % (Math.PI * 2);
    for (const wx of [220, 420, 1180, 1380]) {
      ctx.fillStyle = '#0D0F14';
      ctx.beginPath(); ctx.arc(wx, KATA_FLOOR + 150, 42, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5E6672';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(wx + Math.cos(spin) * 30, KATA_FLOOR + 150 + Math.sin(spin) * 30); ctx.lineTo(wx - Math.cos(spin) * 30, KATA_FLOOR + 150 - Math.sin(spin) * 30); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(235,240,250,0.5)';
    for (let x = -((t * 1100) % 200); x < ARENA_WIDTH; x += 200) ctx.fillRect(x, ARENA_HEIGHT - 12, 110, 6);
    drawRain(time, reducedMotion);
  }

  function drawKataBackground(time, reducedMotion) {
    const sky = ctx.createLinearGradient(0, 0, 0, KATA_FLOOR);
    sky.addColorStop(0, '#0B1030');
    sky.addColorStop(0.6, '#2A1E4A');
    sky.addColorStop(1, '#5B2E4F');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    ctx.fillStyle = '#F6EFC8';
    ctx.beginPath(); ctx.arc(1320, 170, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(246,239,200,0.12)';
    ctx.beginPath(); ctx.arc(1320, 170, 120, 0, Math.PI * 2); ctx.fill();
    // 먼 도시
    for (const b of KATA_CITY) {
      const top = KATA_FLOOR - 120 - b.h;
      ctx.fillStyle = '#161A33';
      ctx.fillRect(b.x, top, b.w, b.h + 120);
      for (let wy = top + 18; wy < KATA_FLOOR - 130; wy += 34) {
        for (let wx = b.x + 12; wx < b.x + b.w - 14; wx += 24) {
          const on = ((wx * 3 + wy * 7 + b.lit) % 5) < 2;
          if (!on) continue;
          const flicker = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(time * 2 + wx + wy);
          ctx.fillStyle = `rgba(255,214,110,${0.55 * flicker})`;
          ctx.fillRect(wx, wy, 10, 14);
        }
      }
    }
    // 옥상 난간(뒤)과 바닥
    ctx.strokeStyle = '#5E6672';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(0, KATA_FLOOR - 120); ctx.lineTo(ARENA_WIDTH, KATA_FLOOR - 120); ctx.stroke();
    ctx.lineWidth = 4;
    for (let x = 20; x < ARENA_WIDTH; x += 80) { ctx.beginPath(); ctx.moveTo(x, KATA_FLOOR - 120); ctx.lineTo(x, KATA_FLOOR - 20); ctx.stroke(); }
    const floor = ctx.createLinearGradient(0, KATA_FLOOR, 0, ARENA_HEIGHT);
    floor.addColorStop(0, '#8C8579');
    floor.addColorStop(1, '#3E3A35');
    ctx.fillStyle = floor;
    ctx.fillRect(0, KATA_FLOOR, ARENA_WIDTH, ARENA_HEIGHT - KATA_FLOOR);
    ctx.fillStyle = '#B8B0A2';
    ctx.fillRect(0, KATA_FLOOR, ARENA_WIDTH, 8);
  }

  /** 옆 모습 캐릭터 하나. footY는 발 높이, pose: { facing, rot(라디안, 몸 가운데 기준), sx, sy, alpha, hurt, scale(크기 배율) } */
  function kataSprite(characterId, x, footY, pose = {}) {
    const { img, anchor } = assets[`${characterId}@pistol`] ?? assets[characterId];
    const { facing = 1, rot = 0, sx = 1, sy = 1, alpha = 1, hurt = false, scale = 1 } = pose;
    const size = KATA_SIZE * scale;
    const cy = footY - (KATA_FOOT - anchor[1]) * size * sy;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, cy);
    ctx.rotate(rot);
    ctx.scale(facing * sx, sy);
    if (hurt) ctx.filter = 'drop-shadow(0 0 18px #FF2A2A) saturate(1.6)';
    ctx.drawImage(img, -anchor[0] * size, -anchor[1] * size, size, size);
    ctx.restore();
    return { x, y: cy };
  }

  /** 몸 가운데(cx, cy)에서 각도 angle 쪽 총구 위치 */
  const kataMuzzle = (c, facing, rise = 0) => ({ x: c.x + facing * KATA_SIZE * 0.33, y: c.y - KATA_SIZE * 0.06 - rise });

  /** 총알 줄기(laser면 R-10의 붉은 레이저) */
  function kataTracer(x1, y1, x2, y2, k, laser = false) {
    if (k <= 0 || k >= 1) return;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.lineCap = 'round';
    ctx.strokeStyle = laser ? 'rgba(255,40,40,0.4)' : 'rgba(255,220,120,0.5)';
    ctx.lineWidth = laser ? 18 : 12;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = laser ? '#FF2A2A' : '#FFF6D6';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
    star(x1, y1, 26 * (1 - k), '#FFD45E');
  }

  function kataDagger(x, y, angle, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#5A3A1E';
    ctx.fillRect(-26, -6, 26, 12);
    ctx.fillStyle = '#30353E';
    ctx.fillRect(-2, -14, 8, 28);
    ctx.fillStyle = '#E6EAF0';
    ctx.strokeStyle = '#30353E';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(6, -8); ctx.lineTo(72, 0); ctx.lineTo(6, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function kataPistol(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#2A2E35';
    ctx.fillRect(-26, -9, 52, 16);
    ctx.fillRect(-26, 0, 16, 30);
    ctx.restore();
  }

  function kataWord(text, x, y, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size / 6;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /**
   * 지금 공격의 두 사람 자세를 그린다. 적은 쓰러뜨린 요원·스미스 요원·R-10 중 하나이고,
   * R-10(드론)은 공중에 떠서 상공 레이저·저공 돌진·정면 레이저·프로펠러 돌진으로 같은 자리를 움직인다.
   */
  function drawKataActors(match, k, time, reducedMotion) {
    const hero = match.players.find((p) => p.id === k.heroId);
    const foe = match.players.find((p) => p.id === k.foeId);
    const { drone } = k;
    // 드론은 바닥 위에 떠 있다(둥실)
    const hover = drone ? 190 + (reducedMotion ? 0 : Math.sin(time * 4) * 10) : 0;
    const a = k.attack;
    const u = a?.state === 'warn' ? kClamp(a.t / KATA_WARN) : 0;
    const r = a && a.state !== 'warn' ? kClamp(a.t / KATA_RESOLVE) : 0;
    const back = kEase((r - 0.6) / 0.4); // 장면 끝에 제자리로
    const ok = a?.state === 'counter', hit = a?.state === 'hit';
    let hx = KATA_HX, hFoot = KATA_FLOOR, hRot = 0, hSy = 1, hSx = 1;
    let sx = KATA_SX, sFoot = KATA_FLOOR - hover, sRot = 0, sSy = 1;
    const sHurt = ok && r > 0.25 && r < 0.6;
    const hHurt = hit && r < 0.45;
    const fx = []; // 몸 위에 그릴 효과(총알 줄기 등)
    const stagger = k.finish !== null ? Math.sin(time * 9) * 0.12 : 0;

    if (a?.kind === 1) {
      // 점프 사격: 웅크렸다 뛰어올라 공중에서 아래로 쏜다
      const air = a.state === 'warn' ? 330 * kEase((u - 0.25) / 0.75) : 330 * (1 - kEase(r / 0.6));
      sFoot = KATA_FLOOR - hover - air;
      sSy = a.state === 'warn' && u < 0.25 && !drone ? 0.86 : 1;
      sRot = a.state === 'warn' ? -0.25 * u : ok ? -0.25 + r * 4 * (1 - back) : -0.25 * (1 - r);
      if (ok) { hSy = r < 0.75 ? 0.6 : 0.6 + 0.4 * kEase((r - 0.75) / 0.25); hSx = 1.12 - 0.12 * back; }
    } else if (a?.kind === 2) {
      // 슬라이딩 사격: 뒤로 누워 미끄러져 들어온다
      const slideX = 860;
      sx = a.state === 'warn' ? KATA_SX + (slideX - KATA_SX) * kEase(u) : slideX + (KATA_SX - slideX) * back;
      const lie = a.state === 'warn' ? kEase(u / 0.4) : 1 - back;
      // 사람은 얼굴이 하늘을 보게 뒤로 눕고(왼쪽을 본 채), 드론은 앞으로 기울어 바닥 가까이 내려온다
      sRot = drone ? -0.35 * lie : 1.15 * lie;
      sFoot = drone ? KATA_FLOOR - hover + (hover - 40) * lie : KATA_FLOOR - 18 * lie;
      if (ok) {
        // 공중제비: 뒤로 한 바퀴 돌며 높이 뛰어오른다
        const flip = kClamp(r / 0.75);
        hFoot = KATA_FLOOR - 300 * Math.sin(Math.PI * flip);
        hRot = -Math.PI * 2 * kEase(flip);
        hx = KATA_HX - 60 * Math.sin(Math.PI * flip);
      }
    } else if (a?.kind === 3) {
      // 정면 권총: 한 걸음 다가와 똑바로 겨눈다(붉은 조준선)
      sx = a.state === 'warn' ? KATA_SX - 60 * kEase(u) : KATA_SX - 60 * (1 - back);
      if (ok) hx = KATA_HX + (sx - 230 - KATA_HX) * kEase(r / 0.22) * (1 - back);
    } else if (a?.kind === 4) {
      // 단검 찌르기: 단검을 들고 주인공에게 달려든다
      const near = KATA_HX + 200;
      sx = a.state === 'warn' ? KATA_SX + (near - KATA_SX) * kEase(u) : ok ? near + 120 * kEase(r / 0.3) + (KATA_SX - near - 120) * back : near + (KATA_SX - near) * back;
      sRot = a.state === 'warn' ? 0.12 * u : 0;
    }
    if (hit) { hx -= 40 * Math.sin(Math.PI * kClamp(r / 0.4)); }
    if (k.finish !== null) sRot += stagger;

    const shake = (on) => (on && !reducedMotion ? Math.sin(time * 80) * 6 : 0);
    const H = kataSprite(hero.characterId, hx + shake(hHurt), hFoot, { facing: 1, rot: hRot, sx: hSx, sy: hSy, hurt: hHurt });
    if (k.boss) {
      // 보스(스미스 요원·R-10): 붉은 기운
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 6);
      ctx.fillStyle = `rgba(217,68,58,${0.12 + 0.12 * pulse})`;
      ctx.beginPath(); ctx.ellipse(sx, sFoot - KATA_SIZE * 0.3, KATA_SIZE * 0.3, KATA_SIZE * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    }
    const S = kataSprite(foe.characterId, sx + shake(sHurt), sFoot, { facing: -1, rot: sRot, sy: sSy, hurt: sHurt, scale: drone ? 0.9 : 1 });
    const hm = kataMuzzle(H, 1);
    // 드론의 레이저 발사기는 몸 앞쪽 가운데
    const sm = drone ? { x: S.x - KATA_SIZE * 0.3, y: S.y } : kataMuzzle(S, -1);

    if (a?.kind === 3 && a.state === 'warn') {
      // 붉은 조준선이 주인공 가슴으로
      ctx.save();
      ctx.strokeStyle = `rgba(255,40,40,${0.4 + 0.5 * u})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 8]);
      ctx.beginPath(); ctx.moveTo(sm.x, sm.y); ctx.lineTo(H.x + 20, H.y); ctx.stroke();
      ctx.restore();
    }
    if (a?.kind === 4) {
      // 적의 단검(쳐내지면 하늘로 튕겨 나간다). 드론은 단검 대신 프로펠러로 들이받는다.
      if (drone) {
        if (a.state === 'warn' || hit) star(S.x - KATA_SIZE * 0.3, S.y - 40, 22 + (reducedMotion ? 0 : Math.sin(time * 40) * 6), '#E6EAF0');
      } else if (ok && r > 0.2) {
        const f = kClamp((r - 0.2) / 0.6);
        if (f < 1) kataDagger(sx - 120 + 260 * f, S.y - 60 - 380 * Math.sin(Math.PI * f * 0.8), -1 + f * 12, 1.1);
      } else {
        const thrust = a.state === 'warn' ? kEase((u - 0.6) / 0.4) : hit ? 1 : 0.6;
        kataDagger(S.x - KATA_SIZE * 0.22 - 60 * thrust, S.y - 10, Math.PI + 0.25 * (1 - thrust), 1.1);
      }
      if (ok) {
        kataDagger(H.x + KATA_SIZE * 0.2 + 40 * Math.sin(Math.PI * kClamp(r / 0.3)), H.y - 30, -0.6 + 0.9 * kClamp(r / 0.3), 1.1);
        if (r < 0.35) { star((H.x + S.x) / 2, H.y - 40, 70 * (1 - r / 0.35), '#FFFFFF'); kataWord('챙!', (H.x + S.x) / 2, H.y - 150, 70, '#FFD45E', 1 - r / 0.35); }
      }
    }
    if (a?.kind === 3 && ok) {
      // 쳐낸 권총이 빙글빙글 날아간다(드론은 포신을 쳐내 불꽃만)
      const f = kClamp((r - 0.15) / 0.6);
      if (!drone && r > 0.15 && f < 1) kataPistol(sx + 40 + 300 * f, S.y - 40 - 420 * Math.sin(Math.PI * f * 0.8), f * 14);
      if (r < 0.3) star(sm.x, sm.y, 50 * (1 - r / 0.3), '#FFFFFF');
      fx.push(() => kataTracer(hm.x, hm.y, S.x, S.y - 10, (r - 0.3) / 0.25));
    }
    // 반격 사격(1 숙여서 위로, 2 공중제비 중 아래로)
    if (ok && a.kind === 1) fx.push(() => kataTracer(hm.x, hm.y - 30, S.x, S.y, (r - 0.08) / 0.25));
    if (ok && a.kind === 2) fx.push(() => kataTracer(H.x, H.y, S.x, S.y, (r - 0.35) / 0.25));
    // 피격: 적의 공격이 주인공에게(드론은 붉은 레이저)
    if (hit && a.kind !== 4) fx.push(() => kataTracer(sm.x, sm.y, H.x, H.y, r / 0.25, drone));
    if (drone && a?.kind === 3 && a.state === 'warn') star(sm.x, sm.y, 14 + 24 * u, '#FF2A2A'); // 레이저 충전
    if (hit && r < 0.6) kataWord(`-${KATA_DAMAGE}`, H.x + 60, H.y - 200 - r * 80, 64, '#FF3B30', 1 - r / 0.6);
    if (ok && r < 0.7) kataWord(['', '격추!', '공중제비!', '쳐내기!', '막았다!'][a.kind], S.x, S.y - 230 - r * 60, 56, '#7CF29A', 1 - r / 0.7);
    for (const f of fx) f();
  }

  /** 눌러야 할 버튼 안내: 빛나는 키캡과 남은 시간 고리 */
  function drawKataPrompt(k, time, reducedMotion) {
    const a = k.attack;
    if (a?.state !== 'warn') return;
    const left = 1 - kClamp(a.t / KATA_WARN);
    const x = ARENA_WIDTH / 2, y = 330;
    const glow = reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(time * 30);
    ctx.save();
    ctx.fillStyle = `rgba(255,212,94,${0.25 * glow})`;
    ctx.beginPath(); ctx.arc(x, y, 120, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#FFD45E';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(x, y, 104, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
    ctx.fillStyle = '#FFF6D6';
    ctx.strokeStyle = '#30353E';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.roundRect(x - 70, y - 70, 140, 140, 22); ctx.fill(); ctx.stroke();
    ctx.restore();
    kataWord(String(a.kind), x, y + 4, 110, '#B3261E');
    const move = movesOf(k)[a.kind];
    kataWord(`${move.name} → ${a.kind} ${move.hint}`, x, y + 150, 40, '#FFD45E');
  }

  /** 위쪽 안내: 제목, 대응 횟수(10칸), 주인공 체력 */
  function drawKataHud(match, k, time, reducedMotion) {
    const hero = match.players.find((p) => p.id === k.heroId);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ARENA_WIDTH, 50);
    ctx.fillRect(0, ARENA_HEIGHT - 80, ARENA_WIDTH, 80);
    kataWord('건 카타', ARENA_WIDTH / 2, 110, 64, '#FFFFFF');
    const w = 46, gap = 12, x0 = ARENA_WIDTH / 2 - (k.goal * (w + gap) - gap) / 2;
    for (let i = 0; i < k.goal; i++) {
      ctx.fillStyle = i < k.done ? '#7CF29A' : 'rgba(255,255,255,0.2)';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x0 + i * (w + gap), 160, w, 22, 6); ctx.fill(); ctx.stroke();
    }
    kataWord(`대응 ${k.done} / ${k.goal}`, ARENA_WIDTH / 2, 210, 30, '#FFFFFF');
    // 주인공 체력
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${hero.id} ${hero.name}`, 60, 100);
    drawHpBar(ctx, 60, 125, 380, 22, hero.hp, hero.maxHp);
    ctx.fillText(`${hero.hp} / ${hero.maxHp}`, 60, 175);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FF8A80';
    ctx.fillText(foeName(match.players.find((p) => p.id === k.foeId)), ARENA_WIDTH - 60, 100);
    // 자막
    if (k.caption) {
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(k.caption, ARENA_WIDTH / 2, ARENA_HEIGHT - 40);
    }
    if (!k.attack && k.t < k.intro) {
      const s = kEase(k.t / 0.4);
      kataWord('건 카타 모드!', ARENA_WIDTH / 2, 420, 120 * s, '#FFD45E', Math.min(1, (k.intro - k.t) / 0.4));
    }
    if (k.finish !== null) kataWord('건 카타 완료!', ARENA_WIDTH / 2, 420, 110, '#7CF29A');
  }

  function drawGunKata(match, time, reducedMotion) {
    const k = match.gunkata;
    // 옥상(1스테이지)은 밤의 옥상 끝, 복도(2스테이지)는 본부 복도, 도로(4스테이지)는 달리는 트레일러 지붕
    if (match.story?.stage === 'corridor') drawKataCorridor(time, reducedMotion);
    else if (match.story?.stage === 'road') drawKataRoad(time, reducedMotion);
    else drawKataBackground(time, reducedMotion);
    drawKataActors(match, k, time, reducedMotion);
    drawKataPrompt(k, time, reducedMotion);
    drawKataHud(match, k, time, reducedMotion);
  }

  function floatText(text, x, y, color) {
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = color;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }

  return {
    /** step()이 돌려준 이벤트로 짧은 수명의 효과를 만든다. */
    addEvents(events) {
      for (const e of events) {
        if (e.type === 'fire') recoil[e.playerId] = RECOIL_TIME;
        if (e.type === 'hit') effects.push({ kind: 'hit', x: e.x, y: e.y, damage: e.damage, age: 0 });
        if (e.type === 'block') effects.push({ kind: 'block', x: e.x, y: e.y, age: 0 });
        if (e.type === 'explode') effects.push({ kind: 'explode', x: e.x, y: e.y, radius: e.radius, age: 0 });
        if (e.type === 'megalaser') effects.push({ kind: 'megalaser', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, aim: e.aim, hit: e.hit, age: 0 });
        if (e.type === 'laser') effects.push({ kind: 'laser', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, age: 0 });
        if (e.type === 'cover-break') effects.push({ kind: 'debris', x: e.x, y: e.y, age: 0 });
        if (e.type === 'dodge') effects.push({ kind: 'miss', x: e.x, y: e.y, age: 0 });
        if (e.type === 'kick') effects.push({ kind: 'kick', x: e.x, y: e.y, age: 0 });
        if (e.type === 'ceiling-break') effects.push({ kind: 'debris', x: e.x, y: e.y, age: 0 });
        if (e.type === 'land') effects.push({ kind: 'explode', x: e.x, y: e.y + 20, radius: 90, age: 0 });
      }
    },
    reset() {
      effects = [];
      for (const id of Object.keys(recoil)) delete recoil[id];
      Object.assign(cam, { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, z: 1 });
    },
    draw(match, inputs, dt, time, reducedMotion) {
      elapsedTime = match.tick * TICK;
      ctx.setTransform(canvas.width / ARENA_WIDTH, 0, 0, canvas.height / ARENA_HEIGHT, 0, 0);
      // 스토리 모드 건 카타: 옆에서 본 시점의 다른 화면
      if (match.gunkata) {
        drawGunKata(match, time, reducedMotion);
        return;
      }
      const killcam = match.killcam;
      moveCamera(killcam, dt, reducedMotion);
      ctx.save();
      if (cam.z > 1.001) {
        // 확대해도 경기장 밖이 보이지 않게 중심을 가둔다
        const hw = ARENA_WIDTH / 2 / cam.z, hh = ARENA_HEIGHT / 2 / cam.z;
        const cx = Math.min(ARENA_WIDTH - hw, Math.max(hw, cam.x)), cy = Math.min(ARENA_HEIGHT - hh, Math.max(hh, cam.y));
        ctx.translate(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
        ctx.scale(cam.z, cam.z);
        ctx.translate(-cx, -cy);
      }
      // 천장이 울리는 장면(쿠쿵!): 화면이 흔들린다
      if (killcam?.shot.mode === 'rumble' && !reducedMotion) ctx.translate(Math.sin(time * 70) * 12, Math.cos(time * 53) * 9);
      const story = match.story;
      // 스토리 모드 2스테이지는 복도, 3스테이지는 하늘, 4스테이지는 비 내리는 밤의 도로 배경. 라이트닝 컷씬에서 옥상으로 올라가면 옥상 배경.
      const roofScene = match.cutscene?.kind === 'lightning' && match.cutscene.scene === 'roof' && story.stage !== 'sky';
      if (story?.stage === 'sky') drawSkyBackground(time, reducedMotion);
      else if (story?.stage === 'road') drawRoadBackground(time, reducedMotion);
      else ctx.drawImage((story?.stage === 'corridor' && !roofScene ? assets.corridor : assets.arena).img, 0, 0, ARENA_WIDTH, ARENA_HEIGHT);
      if (story?.elevator && !roofScene) drawElevator(story.elevator);
      if (story?.turrets && !roofScene) for (const t of story.turrets) drawTurret(t, story, time, reducedMotion);
      if (story?.ceiling) drawCeiling(story.ceiling, time, reducedMotion);
      if (match.cutscene?.kind === 'stairs') drawStairsDoor(match.cutscene, story.stage);

      // 배경 레일은 장식이므로 정확한 판정 Y에 기준선을 덧그린다.
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      for (const team of ['isb', 'earth']) {
        ctx.strokeStyle = TEAM_COLOR[team];
        ctx.beginPath();
        ctx.moveTo(MIN_X, RAIL_Y[team]); ctx.lineTo(MAX_X, RAIL_Y[team]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      drawCovers(match.covers, story?.stage === 'road' ? time : null, reducedMotion);

      const paused = match.phase === 'paused';
      const cut = match.cutscene;
      for (const p of match.players) {
        if (!paused && recoil[p.id] > 0) recoil[p.id] -= dt;
        if (p.entering) continue; // 줄 타고 내려오는 요원은 헬리콥터 위에 그린다
        // 라이트닝 컷씬: 하늘로 바뀌기 전에는 주인공·라이트닝을 컷씬이 따로 그린다(동료는 안 보임)
        if (cut?.kind === 'lightning' && !cut.switched && p.team === 'earth') continue;
        // 낙하산 컷씬: 지구방위팀(라이트닝·낙하산·차)은 컷씬이 따로 그린다
        if (cut?.kind === 'parachute' && p.team === 'earth') continue;
        // 4스테이지 도로: 모두 달리는 차 지붕 위에 선다
        if (story?.stage === 'road') drawCar(p.x, p.y, p.team, time, reducedMotion, p.alive ? 1 : 0.7);
        // 데스스타 엔딩: 데스스타와 컷씬 주인공의 라이트닝은 따로 그린다
        if (cut?.kind === 'deathstar' && (p.id === cut.bossId || p.id === cut.heroId)) continue;
        if (cut?.kind === 'stairs' && p.team === 'earth') {
          // 계단 컷씬의 주인공: 계단실 문으로 걸어가 내려가며 작아지고 흐려진다(복도에서는 문에서 걸어 나온다)
          const h = cut.heroes.find((c) => c.id === p.id);
          if (!h || h.alpha <= 0.01) continue;
          ctx.save();
          ctx.globalAlpha = h.alpha;
          drawPlayer({ ...p, alive: h.alive, x: h.x, y: h.y, scale: p.scale * h.scale, aim: -Math.PI / 2, hurt: 0 },
            { moveAxis: h.walk, aiming: false }, time, reducedMotion);
          ctx.restore();
          continue;
        }
        if (cut && p.id === cut.bossId) continue; // 엔딩 컷씬의 보스는 따로 그린다
        if (cut && p.id === cut.heroId) {
          // 컷씬의 주인공: 권총(R-10 컷씬 끝에는 RPG)을 들고 보스를 겨누며, 발차기 때 앞으로 뛰어든다
          const pose = { ...p, x: cut.hero.x, y: cut.hero.y - cut.hero.lunge * 50, aim: cut.hero.aim, weapon: cut.hero.weapon };
          drawPlayer(pose, { moveAxis: 0, aiming: false }, time, reducedMotion);
          if (cut.hero.weapon === 'rpg' && !cut.rocket) drawHeldRpg(pose);
          continue;
        }
        drawPlayer(p, inputs[p.id], time, reducedMotion);
      }

      for (const b of match.projectiles) {
        if (b.weapon === 'jet') {
          // 전투기 미사일: 팀 로켓과 구분되는 붉은 동체 + 흰 테두리, 꼬리 불꽃
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(Math.atan2(b.vy, b.vx));
          ctx.fillStyle = '#FFB23F';
          ctx.beginPath();
          ctx.moveTo(-16, -5); ctx.lineTo(-30 - Math.random() * 8, 0); ctx.lineTo(-16, 5);
          ctx.fill();
          ctx.fillStyle = '#D9443A';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(20, 0); ctx.lineTo(10, -7); ctx.lineTo(-16, -7); ctx.lineTo(-16, 7); ctx.lineTo(10, 7);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          continue;
        }
        if (b.thrown) {
          // 수류탄: 날아가는 동안 커졌다 작아지며 포물선처럼 보이게 한다.
          const k = Math.min(1, Math.abs(b.y - b.startY) / Math.max(1, Math.abs(b.endY - b.startY)));
          const r = 11 * (1 + 0.7 * Math.sin(Math.PI * k));
          ctx.fillStyle = 'rgba(48,53,62,0.25)';
          ctx.beginPath();
          ctx.arc(b.x + 8, b.y + 10, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#4E6B3A';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#C9CDD2';
          ctx.fillRect(b.x - r * 0.3, b.y - r - 5, r * 0.6, 6);
          continue;
        }
        if (b.weapon === 'crossbow') {
          // 석궁 화살: 가는 나무 살 + 은색 촉 + 깃
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(Math.atan2(b.vy, b.vx));
          ctx.strokeStyle = '#8A5A2B';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(12, 0); ctx.stroke();
          ctx.fillStyle = '#C9CDD2';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(10, -5); ctx.lineTo(10, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#D9443A';
          ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-26, -6); ctx.lineTo(-14, 0); ctx.lineTo(-26, 6); ctx.closePath(); ctx.fill();
          ctx.restore();
          continue;
        }
        if (b.weapon === 'shotgun') {
          // 샷건 산탄: 작고 둥근 알갱이
          ctx.fillStyle = '#FFD45E';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          continue;
        }
        if (b.weapon === 'laser') {
          // R-10 레이저 탄환: 붉게 빛나는 짧은 빛줄기
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(Math.atan2(b.vy, b.vx));
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(255,40,40,0.35)';
          ctx.lineWidth = 14;
          ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(16, 0); ctx.stroke();
          ctx.strokeStyle = '#FF2A2A';
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(14, 0); ctx.stroke();
          ctx.strokeStyle = '#FFE3E3';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(12, 0); ctx.stroke();
          ctx.restore();
          continue;
        }
        if (b.weapon === 'turret' || b.weapon === 'tank') {
          // 복도 포탑 포탄: 검은 쇳덩이 + 노란 불꽃 꼬리
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(Math.atan2(b.vy, b.vx));
          ctx.fillStyle = '#FFB23F';
          ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(-28 - (reducedMotion ? 0 : Math.random() * 8), 0); ctx.lineTo(-10, 6); ctx.fill();
          ctx.fillStyle = '#2A2E35';
          ctx.strokeStyle = '#FFD45E';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
          continue;
        }
        if (b.weapon === 'flak') {
          // 데스스타 산탄: 주황 포탄
          ctx.fillStyle = '#FF8A3D';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          continue;
        }
        const rocket = b.weapon === 'rpg' || b.weapon === 'missile' || b.weapon === 'dsmissile';
        const { img } = assets[rocket ? 'rocket' : 'bullet'];
        const sniper = b.weapon === 'sniper';
        const smg = b.weapon === 'smg';
        const w = rocket ? 44 : sniper ? 48 : smg ? 24 : 32, h = rocket ? 22 : sniper ? 14 : smg ? 12 : 16;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }

      if (match.jet?.kind === 'tank') drawTank(match.jet, time, reducedMotion);
      else if (match.jet) drawJet(match.jet);
      if (cut?.kind === 'parachute') drawParachuteCutscene(match, cut, time, reducedMotion);
      else if (cut?.kind === 'r10') drawR10Cutscene(match, cut, time, reducedMotion);
      else if (cut?.kind === 'smith') drawCutsceneActors(match, cut, time, reducedMotion);
      else if (cut?.kind === 'lightning' && !cut.switched) drawLightningCutscene(match, cut, inputs, time, reducedMotion);
      else if (cut?.kind === 'deathstar') {
        const c = cut;
        drawDeathstar(c.ds.x, c.ds.y + DS_DRAW_DY, DS_DRAW_SCALE * c.ds.scale, time, reducedMotion, c.ds.alpha, c.ds.angle);
        // 승리의 롤: 옆으로 한 바퀴(가로 폭이 cos로 줄었다 늘어남)
        ctx.save();
        ctx.translate(c.hero.x, c.hero.y);
        ctx.scale(Math.cos(c.hero.roll) || 0.05, 1);
        drawLightning(0, 0, 0, 1.05, time, reducedMotion);
        ctx.restore();
      }
      if (match.story) {
        drawStoryCraft(match.story, time, reducedMotion);
        for (const p of match.players) if (p.entering) drawEntering(p, inputs[p.id], time, reducedMotion);
      }

      if (!paused) for (const fx of effects) fx.age += dt;
      effects = effects.filter((fx) => fx.age < EFFECT_TIME);
      for (const fx of effects) {
        if (fx.kind === 'megalaser') {
          if (fx.age < MEGA_TIME) drawMegaLaser(fx);
          continue;
        }
        if (fx.kind === 'laser') {
          if (fx.age >= LASER_TIME) continue;
          // 붉은 레이저: 넓고 옅은 빛 + 가운데 밝은 심
          ctx.globalAlpha = 1 - fx.age / LASER_TIME * 0.6;
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(255,40,40,0.35)';
          ctx.lineWidth = 16;
          ctx.beginPath(); ctx.moveTo(fx.x1, fx.y1); ctx.lineTo(fx.x2, fx.y2); ctx.stroke();
          ctx.strokeStyle = '#FF2A2A';
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(fx.x1, fx.y1); ctx.lineTo(fx.x2, fx.y2); ctx.stroke();
          ctx.strokeStyle = '#FFD0D0';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(fx.x1, fx.y1); ctx.lineTo(fx.x2, fx.y2); ctx.stroke();
          ctx.lineCap = 'butt';
          ctx.globalAlpha = 1;
          continue;
        }
        if (fx.kind === 'miss') {
          ctx.globalAlpha = 1 - fx.age / EFFECT_TIME;
          floatText('MISS', fx.x + 60, fx.y - 40 - (reducedMotion ? 0 : fx.age * 60), '#9A9EA5');
          ctx.globalAlpha = 1;
          continue;
        }
        if (fx.kind === 'kick') {
          const size = 150 * (reducedMotion ? 1 : 0.6 + fx.age * 1.5);
          ctx.globalAlpha = 1 - fx.age / EFFECT_TIME;
          ctx.drawImage(assets['hit-spark'].img, fx.x - size / 2, fx.y - size / 2, size, size);
          ctx.font = 'bold 72px system-ui, sans-serif';
          ctx.lineWidth = 10;
          ctx.strokeStyle = '#fff';
          ctx.fillStyle = '#D9443A';
          ctx.textAlign = 'center';
          ctx.strokeText('퍽!', fx.x + 90, fx.y - 30);
          ctx.fillText('퍽!', fx.x + 90, fx.y - 30);
          ctx.globalAlpha = 1;
          continue;
        }
        if (fx.kind === 'debris') {
          if (fx.age < DEBRIS_TIME) drawDebris(fx, reducedMotion);
          continue;
        }
        if (fx.kind === 'explode') {
          if (fx.age >= EXPLODE_TIME) continue;
          const k = fx.age / EXPLODE_TIME;
          const r = (fx.radius ?? WEAPONS.rpg.splash.radius) * (reducedMotion ? 1 : 0.4 + 0.6 * k);
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = '#FF9D3F';
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFD45E';
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }
        if (fx.age < SPARK_TIME) {
          const size = fx.kind === 'block' ? 40 : 72;
          ctx.drawImage(assets['hit-spark'].img, fx.x - size / 2, fx.y - size / 2, size, size);
        }
        if (fx.kind === 'hit') {
          const rise = reducedMotion ? 0 : fx.age * 60;
          floatText(`-${fx.damage}`, fx.x + 50, fx.y - 30 - rise, '#D9443A');
        }
      }

      if (killcam) drawKillcamWorld(match, killcam, time, reducedMotion);
      ctx.restore(); // 카메라 끝: 아래는 화면에 고정된 안내

      if (killcam) {
        drawKillcamOverlay(killcam, time, reducedMotion);
      } else if (cut) {
        // 계단 컷씬: 스테이지가 바뀌는 동안 화면이 어두워졌다 밝아진다
        if ((cut.kind === 'stairs' || cut.kind === 'lightning' || cut.kind === 'parachute') && cut.fade > 0) {
          ctx.fillStyle = `rgba(0,0,0,${cut.fade})`;
          ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
        }
        // 라이트닝 이륙: 하얗게 번쩍이며 하늘로
        if (cut.kind === 'lightning' && cut.flash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${cut.flash})`;
          ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
        }
        drawLetterbox(cut);
      } else {
        drawTeam('isb', match.players);
        drawTeam('earth', match.players);
        if (match.story) drawStoryHud(match.story);
      }

      if (match.phase === 'countdown') {
        ctx.font = 'bold 200px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 12;
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = INK;
        const n = String(Math.ceil(match.countdown));
        ctx.strokeText(n, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
        ctx.fillText(n, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
      }
    },
  };
}
