/**
 * 원점 중심·반지름 r인 원과 선분 (x0,y0)→(x1,y1)의 가장 이른 접촉 시각 t∈[0,1]. 없으면 null.
 * 움직이는 대상은 호출 측에서 탄환 좌표에서 대상 좌표를 빼 상대 운동 선분으로 넘긴다.
 */
export function segmentCircleTime(x0, y0, x1, y1, r) {
  const c = x0 * x0 + y0 * y0 - r * r;
  if (c <= 0) return 0;
  const dx = x1 - x0, dy = y1 - y0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (x0 * dx + y0 * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** 원점 중심, 반폭 hw·반높이 hh인 축 정렬 사각형과 선분의 가장 이른 접촉 시각 (slab 방식). */
export function segmentRectTime(x0, y0, x1, y1, hw, hh) {
  let t0 = 0, t1 = 1;
  for (const [p, d, h] of [[x0, x1 - x0, hw], [y0, y1 - y0, hh]]) {
    if (d === 0) {
      if (p < -h || p > h) return null;
      continue;
    }
    let a = (-h - p) / d, b = (h - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
