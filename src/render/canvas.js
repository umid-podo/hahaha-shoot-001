import {
  ARENA_WIDTH, ARENA_HEIGHT, RAIL_Y, MIN_X, MAX_X, BODY_RADIUS, SPRITE_SIZE, TEAM_COLOR, TEAM_NAME,
  MAX_HP, WEAPONS, COVER,
} from '../game/config.js';

const INK = '#30353E';
const MAX_DPR = 2;
const RECOIL_TIME = 0.08;
const SPARK_TIME = 0.15;
const EFFECT_TIME = 0.6;
const EXPLODE_TIME = 0.4;
const LASER_TIME = 0.1;
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
  let effects = [];
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
    // 무기별 그림(manifest id '<캐릭터>@<무기>')이 있으면 그것을, 없으면 기본 그림을 쓴다.
    const { img, anchor } = assets[`${p.characterId}@${p.weapon}`] ?? assets[p.characterId];
    const size = SPRITE_SIZE * p.scale; // 드론처럼 크게 그리는 캐릭터도 판정 원은 같다
    const color = TEAM_COLOR[p.team];
    const hurt = p.hurt > 0;

    if (!p.alive) {
      // 쓰러진 캐릭터: 옆으로 눕히고 흐리게, KO 표시
      ctx.save();
      ctx.translate(p.x, p.y + 10);
      ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = 0.45;
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(img, -anchor[0] * size, -anchor[1] * size, size, size);
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

    // 판정 위치를 알려주는 몸 중심 팀 링. 피격 직후에는 빨갛게 번쩍인다.
    ctx.lineWidth = hurt ? 5 : 3;
    ctx.strokeStyle = hurt ? '#D9443A' : color;
    ctx.globalAlpha = hurt ? 1 : 0.45;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BODY_RADIUS + (hurt ? 6 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 드론은 늘 둥실 떠 있고, 사람은 걸을 때만 통통 튄다.
    const bounce = reducedMotion ? 0
      : p.drone ? Math.sin(time * 5 + p.x * 0.01) * 5
      : input.moveAxis !== 0 ? Math.sin(time * 20) * 2 : 0;
    const squash = !reducedMotion && recoil[p.id] > 0 ? 0.92 : 1;
    const shake = !reducedMotion && hurt ? Math.sin(time * 90) * 3 : 0;
    const facing = Math.cos(p.aim) < 0 ? -1 : 1; // 원본은 오른쪽을 본다. 반전 시 앵커도 함께 반전된다.
    ctx.save();
    ctx.translate(p.x + shake, p.y + bounce);
    ctx.scale(facing * squash, squash);
    ctx.globalAlpha = hurt ? 0.7 : 1;
    ctx.drawImage(img, -anchor[0] * size, -anchor[1] * size, size, size);
    ctx.restore();

    // 현재 조준 방향 눈금(항상) + 발사 준비 중에만 조준선
    const cos = Math.cos(p.aim), sin = Math.sin(p.aim);
    // 떼면 쏘는 무기(RPG)는 쿨타임 동안 눈금을 회색으로 표시
    // 떼면 쏘는 무기(RPG·저격총·수류탄)의 쿨타임, 방전, 과열 동안은 눈금을 회색으로 표시
    const weapon = WEAPONS[p.weapon];
    const reloading = (weapon.trigger === 'release' && p.cooldown > 0) ||
      (weapon.id === 'grenade' && p.grenadeCooldown > 0) ||
      (weapon.battery && p.battery <= 0) || (weapon.heat && p.overheat > 0);
    ctx.fillStyle = reloading ? '#9A9EA5' : color;
    ctx.beginPath();
    ctx.arc(p.x + cos * BODY_RADIUS, p.y + sin * BODY_RADIUS, 5, 0, Math.PI * 2);
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
    const label = `${p.id} ${p.name}`;
    const w = ctx.measureText(label).width + 16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(p.x - w / 2, p.y + 47, w, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p.x, p.y + 60);
    drawHpBar(ctx, p.x - HP_BAR.w / 2, p.y + 76, HP_BAR.w, HP_BAR.h, p.hp, p.maxHp);
    drawGauge(p, p.x - HP_BAR.w / 2, p.y + 76 + HP_BAR.h + 3, HP_BAR.w);
  }

  /**
   * 체력바 아래 무기 상태 막대. 레이저는 배터리(빨강), 기관단총은 열(주황, 과열 중엔 빨강 깜빡임),
   * 수류탄은 쿨타임 동안 남은 비율(회색). 해당 없으면 그리지 않는다.
   */
  function drawGauge(p, x, y, w) {
    const weapon = WEAPONS[p.weapon];
    let ratio, color;
    if (weapon.battery) {
      ratio = p.battery / weapon.battery.shots; color = '#E0312B';
    } else if (weapon.heat && (p.heat > 0 || p.overheat > 0)) {
      ratio = p.overheat > 0 ? 1 : p.heat / weapon.heat.max;
      color = p.overheat > 0 ? '#D9443A' : '#F2A33A';
    } else if (weapon.id === 'grenade') {
      ratio = 1 - p.grenadeCooldown / weapon.interval; color = p.grenadeCooldown > 0 ? '#9A9EA5' : '#3FAE4A';
    } else {
      return;
    }
    ctx.fillStyle = 'rgba(48,53,62,0.35)';
    ctx.fillRect(x, y, w, GAUGE_H);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), GAUGE_H);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, GAUGE_H);
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
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${p.id} ${p.name} · ${WEAPONS[p.weapon].name}`, x + 12, my + 2);
      ctx.textAlign = 'right';
      ctx.fillText(p.alive ? `${p.hp}` : 'KO', x + w - 12, my + 17);
      drawHpBar(ctx, x + 12, my + 12, w - 60, 10, p.hp, p.maxHp);
    });
  }

  /** 엄폐물: 콘크리트 방호벽. 팀 진영 엄폐물은 윗면에 팀 색 띠를 두른다. 깎일수록 금이 늘고 위에 내구도 바를 띄운다. */
  function drawCovers(covers) {
    for (const c of covers) {
      if (c.hp <= 0) continue;
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
    // 그림자: 옥상 위를 날고 있다는 느낌
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
        if (e.type === 'laser') effects.push({ kind: 'laser', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, age: 0 });
        if (e.type === 'cover-break') effects.push({ kind: 'debris', x: e.x, y: e.y, age: 0 });
      }
    },
    reset() { effects = []; for (const id of Object.keys(recoil)) delete recoil[id]; },
    draw(match, inputs, dt, time, reducedMotion) {
      ctx.setTransform(canvas.width / ARENA_WIDTH, 0, 0, canvas.height / ARENA_HEIGHT, 0, 0);
      ctx.drawImage(assets.arena.img, 0, 0, ARENA_WIDTH, ARENA_HEIGHT);

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

      drawCovers(match.covers);

      const paused = match.phase === 'paused';
      for (const p of match.players) {
        if (!paused && recoil[p.id] > 0) recoil[p.id] -= dt;
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
        const rocket = b.weapon === 'rpg';
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

      if (match.jet) drawJet(match.jet);

      if (!paused) for (const fx of effects) fx.age += dt;
      effects = effects.filter((fx) => fx.age < EFFECT_TIME);
      for (const fx of effects) {
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

      drawTeam('isb', match.players);
      drawTeam('earth', match.players);

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
