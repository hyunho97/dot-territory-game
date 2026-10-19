import { guildBossData } from '../data.js';

/** 길드 보스 규칙 (순수 함수) */

export type BossTier = (typeof guildBossData.tiers)[number];

/** 길드 레벨로 소환할 수 있는 가장 높은 등급 */
export function tierFor(guildLevel: number): BossTier {
  let tier = guildBossData.tiers[0];
  for (const t of guildBossData.tiers) if (guildLevel >= t.minGuildLevel) tier = t;
  return tier;
}

/** 보스 체력 = max(멤버 전투력 합 × 배수, 등급 최소 체력) — 소환 직전에 멤버를 모아 약하게 만드는 꼼수를 막는 하한 */
export function bossHp(memberCPSum: number, tier: BossTier): number {
  return Math.round(Math.max(memberCPSum * guildBossData.hpMultiplier, tier.hpFloor));
}

/** 공격 피해 = 출전 군대 전투력 × (0.85 ~ 1.15) */
export function rollDamage(armyCP: number, rng: () => number = Math.random): number {
  const [lo, hi] = guildBossData.damageJitter;
  return Math.round(armyCP * (lo + rng() * (hi - lo)));
}

/** 보스 반격으로 잃는 병력: 유닛 종류마다 ceil(수량 × 비율) */
export function bossLosses(
  army: { unitId: string; count: number }[],
): { unitId: string; count: number }[] {
  return army
    .map((u) => ({
      unitId: u.unitId,
      count: Math.min(u.count, Math.ceil(u.count * guildBossData.lossRatio)),
    }))
    .filter((l) => l.count > 0);
}

/** 참가자 보상 (처치 실패 시 비율만큼 축소) */
export function scaleReward(reward: Record<string, number>, ratio: number): Record<string, number> {
  return Object.fromEntries(Object.entries(reward).map(([k, v]) => [k, Math.floor(v * ratio)]));
}

/** 오늘 남은 공격 횟수 */
export function ticketsLeft(attacksToday: number): number {
  return Math.max(0, guildBossData.ticketsPerDay - attacksToday);
}
