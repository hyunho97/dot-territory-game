/**
 * 영지 배치: 등각(아이소메트릭) 격자. 칸 (i, j) 의 중심이 화면의 한 점에 대응한다.
 * 영지 땅은 i, j 가 -R..R 인 정사각 영역이고(R 은 영지 레벨에 따라 커진다), 건물은 n×n 칸을 차지한다.
 * 건물의 (x, y) 는 차지한 칸 중 i, j 가 가장 작은 칸. 영주관은 가운데에 고정.
 * 서버(server/src/services/layoutRules.ts)에도 같은 규칙이 있다 — 바꾸면 양쪽을 함께 바꿀 것.
 */
export const TILE_W = 112; // 칸(마름모) 가로
export const TILE_H = 56; // 칸 세로
/** 세계(바닥 그림) 크기와 (0,0) 칸의 화면 좌표 */
export const WORLD_W = 2000;
export const WORLD_H = 1200;
export const CENTER_X = 1000;
export const CENTER_Y = 640;

/** 격자 좌표(i, j; 소수 가능) → 세계 좌표. i 는 오른쪽 아래, j 는 왼쪽 아래 방향 */
export const isoToScreen = (i: number, j: number): [number, number] => [
  CENTER_X + ((i - j) * TILE_W) / 2,
  CENTER_Y + ((i + j) * TILE_H) / 2,
];

/** 세계 좌표 → 격자 좌표(소수). 칸 (i, j) 의 한가운데가 정수 값이다 */
export const screenToIso = (x: number, y: number): [number, number] => {
  const a = ((x - CENTER_X) * 2) / TILE_W; // i - j
  const b = ((y - CENTER_Y) * 2) / TILE_H; // i + j
  return [(a + b) / 2, (b - a) / 2];
};

export interface Rect {
  i: number;
  j: number;
  n: number;
}

/** 영주관이 앞으로 가장 크게 차지할 칸(4×4)은 처음부터 비워 둔다 */
export const HALL_RESERVE: Rect = { i: -2, j: -2, n: 4 };

const overlap = (a: Rect, b: Rect): boolean =>
  a.i < b.i + b.n && b.i < a.i + a.n && a.j < b.j + b.n && b.j < a.j + a.n;

/** r 을 놓을 수 있는지: 내 땅 안이고, 영주관 자리와 다른 건물과 겹치지 않아야 한다 */
export function fits(radius: number, r: Rect, others: Rect[]): boolean {
  if (r.i < -radius || r.j < -radius || r.i + r.n - 1 > radius || r.j + r.n - 1 > radius)
    return false;
  if (overlap(r, HALL_RESERVE)) return false;
  return !others.some((o) => overlap(r, o));
}

/** 영주관에서 가까운 빈자리 (없으면 null) */
export function autoSpot(
  radius: number,
  n: number,
  others: Rect[],
): { i: number; j: number } | null {
  const cand: { i: number; j: number; d: number; a: number }[] = [];
  for (let i = -radius; i <= radius; i++)
    for (let j = -radius; j <= radius; j++) {
      const ci = i + (n - 1) / 2;
      const cj = j + (n - 1) / 2;
      cand.push({ i, j, d: ci * ci + cj * cj, a: Math.atan2(cj, ci) });
    }
  cand.sort((p, q) => p.d - q.d || p.a - q.a);
  for (const c of cand) if (fits(radius, { i: c.i, j: c.j, n }, others)) return { i: c.i, j: c.j };
  return null;
}
