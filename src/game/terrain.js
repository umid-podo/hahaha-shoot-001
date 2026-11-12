import { JUMP } from './config.js';

/**
 * 지형(고지대·건물·다리·오르막길·천장)의 높이와 탄 충돌. update.js(이동·탄)와 ai.js(트인 자리 찾기)가 함께 쓴다.
 * 높이는 모두 경기장 바닥(0) 기준이고, 탄의 '실제 높이'는 발 높이(z) + 총 높이(SHOT_HEIGHT)다.
 */

/** 다리 상판 두께: 다리 밑으로는 지나가지만 상판(위 BRIDGE_THICK)은 탄을 막는다 */
export const BRIDGE_THICK = 30;

/** 고지대 g의 (x, y) 자리 높이. 오르막길(ramp)은 축을 따라 0에서 height까지 오른다 */
export function highAt(g, x, y) {
  if (!g.ramp) return g.height;
  const along = g.ramp.axis === 'x' ? (x - g.x) / g.w : (y - g.y) / g.h; // -0.5 ~ 0.5
  return g.height * Math.max(0, Math.min(1, 0.5 + along * g.ramp.dir));
}

/**
 * (x, y)의 바닥 높이: 그 자리를 덮는 고지대 중 가장 높은 것(없으면 0). z(발 높이)를 주면 다리(bridge)는
 * 그 위에 있을 때만 바닥으로 친다(아래에 있으면 밑으로 지나간다).
 */
export function groundAt(match, x, y, z = Infinity) {
  let h = 0;
  for (const g of match.highs ?? []) {
    if (!(Math.abs(x - g.x) < g.w / 2 - 0.01 && Math.abs(y - g.y) < g.h / 2 - 0.01)) continue;
    const top = highAt(g, x, y);
    if (g.bridge && z < top - JUMP.step - 1) continue;
    if (top > h) h = top;
  }
  return h;
}

/**
 * 3D 선분 (x0,y0,h0)→(x1,y1,h1)이 축 정렬 상자 [x±hw, y±hd, lo..hi]에 처음 들어가는 시각과 들어간 면의 축.
 * 시작점이 이미 안에 있으면 t 0. 닿지 않으면 null. axis: 'x'·'y'(옆면)·'h'(윗면·아랫면).
 */
export function segmentBoxTime(x0, y0, h0, x1, y1, h1, cx, cy, hw, hd, lo, hi) {
  let t0 = 0, t1 = 1, axis = null;
  const slabs = [['x', x0 - cx, x1 - x0, -hw, hw], ['y', y0 - cy, y1 - y0, -hd, hd], ['h', h0, h1 - h0, lo, hi]];
  for (const [name, p, d, a0, a1] of slabs) {
    if (d === 0) {
      if (p < a0 || p > a1) return null;
      continue;
    }
    let a = (a0 - p) / d, b = (a1 - p) / d;
    if (a > b) [a, b] = [b, a];
    if (a > t0) { t0 = a; axis = name; }
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return { t: t0, axis: axis ?? 'h' };
}

/** 구조물 g가 막는 높이 구간 [lo, hi]: 보통은 바닥부터 꼭대기까지, 다리는 상판만 */
const solidSpan = (g, top) => (g.bridge ? [top - BRIDGE_THICK, top] : [-1e6, top]);

/**
 * 탄(실제 높이 h)이 이번 틱 선분에서 처음 닿는 구조물·바닥·천장. { t, axis, kind, high } 또는 null.
 * 오르막길은 비탈 높이를 몇 점 짚어 본다. 바닥(높이 0)은 floor가 true일 때만(하늘 스테이지는 바닥이 없다), 천장은 match.ceiling.
 */
export function structureHit(match, x0, y0, h0, x1, y1, h1, { floor = true } = {}) {
  let best = null;
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  for (const g of match.highs ?? []) {
    const hw = g.w / 2, hd = g.h / 2;
    if (maxX < g.x - hw || minX > g.x + hw || maxY < g.y - hd || minY > g.y + hd) continue;
    if (g.ramp) {
      // 비탈: 선분을 짚어 가며 비탈 높이보다 낮아진 첫 점
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, h = h0 + (h1 - h0) * t;
        if (Math.abs(x - g.x) > hw || Math.abs(y - g.y) > hd) continue;
        if (h < highAt(g, x, y)) {
          if (!best || t < best.t) best = { t, axis: 'h', kind: 'wall', high: g };
          break;
        }
      }
      continue;
    }
    const [lo, hi] = solidSpan(g, g.height);
    const hit = segmentBoxTime(x0, y0, h0, x1, y1, h1, g.x, g.y, hw, hd, lo, hi);
    if (hit && (!best || hit.t < best.t)) best = { ...hit, kind: 'wall', high: g };
  }
  if (floor && h1 < 0 && h0 >= 0) {
    const t = h0 / (h0 - h1);
    if (!best || t < best.t) best = { t, axis: 'h', kind: 'floor' };
  }
  const ceil = match.ceiling;
  if (Number.isFinite(ceil) && h1 > ceil && h0 <= ceil) {
    const t = (ceil - h0) / (h1 - h0);
    if (!best || t < best.t) best = { t, axis: 'h', kind: 'ceiling' };
  }
  return best;
}

/** 두 점 사이 시선(사격선)이 구조물에 막히는지(AI가 트인 자리를 찾을 때) */
export function lineBlocked(match, x0, y0, h0, x1, y1, h1) {
  return !!structureHit(match, x0, y0, h0, x1, y1, h1, { floor: false });
}
