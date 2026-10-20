/**
 * 영지 배치 규칙 (순수 함수). 영지는 (i, j) 정사각 격자이고, 건물은 n×n 칸을 차지한다.
 * 건물의 (x, y) 는 차지한 칸 중 i, j 가 가장 작은 칸이다. 영주관은 영지 가운데에 고정된다.
 * 클라이언트(client/src/scenes/layout.ts)에도 같은 규칙이 있다 — 바꾸면 양쪽을 함께 바꿀 것.
 */
import { buildings, territoryLevels } from '../data.js';

export interface Rect {
  i: number;
  j: number;
  n: number;
}

/** 영주관이 앞으로 가장 크게 차지할 칸(4×4)은 처음부터 비워 둔다: i, j ∈ [-2, 1] */
export const HALL_RESERVE: Rect = { i: -2, j: -2, n: 4 };

/** 레벨에 따른 건물 한 변 칸 수 (레벨이 오르면 커진다) */
export function footprintOf(type: string, level: number): number {
  const table =
    (buildings.footprint as Record<string, number[]>)[type] ?? buildings.footprint.default;
  return table[Math.min(Math.max(level, 1), table.length) - 1];
}

/** 영주관 한 변 칸 수와 그 자리(영지 가운데) */
export function hallRect(level: number): Rect {
  const n = footprintOf('town_hall', level);
  return { i: -Math.floor(n / 2), j: -Math.floor(n / 2), n };
}

/** 영지 레벨에 따른 땅 반경: 칸 i, j 가 -R..R 안이면 내 땅 */
export function landRadius(level: number): number {
  const lv = [...territoryLevels.levels].filter((l) => l.level <= level).pop();
  return lv?.landRadius ?? 3;
}

const overlap = (a: Rect, b: Rect): boolean =>
  a.i < b.i + b.n && b.i < a.i + a.n && a.j < b.j + b.n && b.j < a.j + a.n;

/** r 을 놓을 수 있는지: 내 땅 안이고, 영주관 자리와 다른 건물과 겹치지 않아야 한다 */
export function fits(radius: number, r: Rect, others: Rect[]): boolean {
  if (r.i < -radius || r.j < -radius || r.i + r.n - 1 > radius || r.j + r.n - 1 > radius)
    return false;
  if (overlap(r, HALL_RESERVE)) return false;
  return !others.some((o) => overlap(r, o));
}

/** 영주관에서 가까운 빈자리를 찾는다 (없으면 null). 같은 입력이면 항상 같은 결과. */
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
