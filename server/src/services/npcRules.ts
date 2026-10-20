import { territoryLevels } from '../data.js';

/** 가상 플레이어(NPC) 규칙 (순수 함수) */

const DAY_MS = 86_400_000;

/** 영지 레벨 n 에 도달하는 데 걸리는 누적 일수 (레벨업 대기시간의 합) */
export function cumulativeDaysTo(level: number): number {
  return territoryLevels.levels
    .filter((l) => l.level >= 2 && l.level <= level)
    .reduce((s, l) => s + (l.timeSec ?? 0) / 86_400, 0);
}

/** NPC 의 가상 나이(일)에 대응하는 영지 레벨 */
export function levelAtAge(ageDays: number): number {
  let lv = 1;
  for (const l of territoryLevels.levels)
    if (l.level >= 2 && ageDays >= cumulativeDaysTo(l.level)) lv = l.level;
  return lv;
}

/** NPC 마다 성장 속도가 조금씩 다르다 (0.6 ~ 1.4) */
export function npcSpeed(id: number): number {
  return 0.6 + ((id * 7919) % 100) / 125;
}

/** 가상 나이(일) = 실제 경과일 × 속도 + 시작 나이 */
export function virtualAgeDays(
  createdAt: number,
  now: number,
  speed: number,
  baseAgeDays: number,
): number {
  return Math.max(0, (now - createdAt) / DAY_MS) * speed + baseAgeDays;
}

/** 레벨에 맞는 병력 구성: 쓸 수 있는 가장 높은 두 티어를 60% / 40% 로 채운다 */
export function armyPlan(
  pool: { id: string; tier: number }[],
  total: number,
): { unitId: string; count: number }[] {
  if (pool.length === 0 || total <= 0) return [];
  const tiers = [...new Set(pool.map((u) => u.tier))].sort((a, b) => b - a);
  const top = pool.filter((u) => u.tier === tiers[0]);
  const next = tiers[1] !== undefined ? pool.filter((u) => u.tier === tiers[1]) : [];
  const out = new Map<string, number>();
  const spread = (list: { id: string }[], n: number): void => {
    const per = Math.floor(n / list.length);
    let rest = n - per * list.length;
    for (const u of list) {
      const c = per + (rest-- > 0 ? 1 : 0);
      if (c > 0) out.set(u.id, (out.get(u.id) ?? 0) + c);
    }
  };
  if (next.length === 0) spread(top, total);
  else {
    const a = Math.round(total * 0.6);
    spread(top, a);
    spread(next, total - a);
  }
  return [...out].map(([unitId, count]) => ({ unitId, count }));
}
