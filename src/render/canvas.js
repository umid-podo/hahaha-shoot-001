import {
  ARENA_WIDTH, ARENA_HEIGHT, RAIL_Y, MIN_X, MAX_X, BODY_RADIUS, SPRITE_SIZE, TEAM_COLOR, TEAM_NAME,
  MAX_HP, WEAPONS,
} from '../game/config.js';

const INK = '#30353E';
const MAX_DPR = 2;
const RECOIL_TIME = 0.08;
const SPARK_TIME = 0.15;
const EFFECT_TIME = 0.6;
const EXPLODE_TIME = 0.4;
// 오른쪽 팀 체력판. 상단은 윗변, 하단은 아랫변 기준으로 캐릭터·체력바와 겹치지 않게 둔다.
const TEAM_BOX = { isbTop: 190, earthBottom: 590 };
const HP_BAR = { w: 88, h: 10 };

function hpColor(ratio) {
  return ratio > 0.5 ? '#3FAE4A' : ratio > 0.25 ? '#F2B233' : '#D9443A';
}

function drawHpBar(ctx, x, y, w, h, hp) {
  const ratio = hp / MAX_HP;
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
    const { img, anchor } = assets[p.characterId];
    const color = TEAM_COLOR[p.team];
    const hurt = p.hurt > 0;

    if (!p.alive) {
      // 쓰러진 캐릭터: 옆으로 눕히고 흐리게, KO 표시
      ctx.save();
      ctx.translate(p.x, p.y + 10);
      ctx.rotate(Math.PI / 2);
      ctx.globalAlpha = 0.45;
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(img, -anchor[0] * SPRITE_SIZE, -anchor[1] * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE);
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

    const bounce = !reducedMotion && input.moveAxis !== 0 ? Math.sin(time * 20) * 2 : 0;
    const squash = !reducedMotion && recoil[p.id] > 0 ? 0.92 : 1;
    const shake = !reducedMotion && hurt ? Math.sin(time * 90) * 3 : 0;
    const facing = Math.cos(p.aim) < 0 ? -1 : 1; // 원본은 오른쪽을 본다. 반전 시 앵커도 함께 반전된다.
    ctx.save();
    ctx.translate(p.x + shake, p.y + bounce);
    ctx.scale(facing * squash, squash);
    ctx.globalAlpha = hurt ? 0.7 : 1;
    ctx.drawImage(img, -anchor[0] * SPRITE_SIZE, -anchor[1] * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE);
    ctx.restore();

    // 현재 조준 방향 눈금(항상) + 발사 준비 중에만 조준선
    const cos = Math.cos(p.aim), sin = Math.sin(p.aim);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x + cos * BODY_RADIUS, p.y + sin * BODY_RADIUS, 5, 0, Math.PI * 2);
    ctx.fill();
    if (input.aiming) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(p.x + cos * 38, p.y + sin * 38);
      ctx.lineTo(p.x + cos * 190, p.y + sin * 190);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(p.x + cos * 200, p.y + sin * 200);
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
    drawHpBar(ctx, p.x - HP_BAR.w / 2, p.y + 76, HP_BAR.w, HP_BAR.h, p.hp);
  }

  /** 팀별 체력 요약: 팀 이름과 멤버마다 이름·총기·체력바 */
  function drawTeam(team, players) {
    const members = players.filter((p) => p.team === team);
    const w = 190, h = 40 + members.length * 30, x = 990;
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
      drawHpBar(ctx, x + 12, my + 12, w - 60, 10, p.hp);
    });
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
        if (e.type === 'explode') effects.push({ kind: 'explode', x: e.x, y: e.y, age: 0 });
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

      const paused = match.phase === 'paused';
      for (const p of match.players) {
        if (!paused && recoil[p.id] > 0) recoil[p.id] -= dt;
        drawPlayer(p, inputs[p.id], time, reducedMotion);
      }

      for (const b of match.projectiles) {
        const rocket = b.weapon === 'rpg';
        const { img } = assets[rocket ? 'rocket' : 'bullet'];
        const w = rocket ? 44 : 32, h = rocket ? 22 : 16;
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
        if (fx.kind === 'explode') {
          if (fx.age >= EXPLODE_TIME) continue;
          const k = fx.age / EXPLODE_TIME;
          const r = WEAPONS.rpg.splash.radius * (reducedMotion ? 1 : 0.4 + 0.6 * k);
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
