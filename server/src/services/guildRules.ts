import { guildData } from '../data.js';

/** 길드 규칙 (순수 함수) */

export function guildLevel(exp: number): number {
  let level = 1;
  guildData.levelExp.forEach((need, i) => {
    if (exp >= need) level = i + 1;
  });
  return level;
}

export const maxGuildLevel = (): number => guildData.levelExp.length;

/** 다음 레벨까지 필요한 누적 경험치 (최대 레벨이면 null) */
export function nextLevelExp(level: number): number | null {
  return level >= guildData.levelExp.length ? null : guildData.levelExp[level];
}

export function maxMembers(level: number): number {
  return guildData.baseMembers + guildData.membersPerLevel * (level - 1);
}

/** 길드 레벨 버프: 레벨 1 은 0, 레벨당 일정 비율 증가 */
export function guildBuff(level: number): { production: number; combat: number } {
  return {
    production: guildData.buffPerLevel.production * (level - 1),
    combat: guildData.buffPerLevel.combat * (level - 1),
  };
}

/** 기부 가치(자원 가치 합) -> 길드 경험치 */
export function donationExp(value: number): number {
  return Math.floor(value * guildData.expPerValue);
}

export function validGuildName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  const { min, max } = guildData.nameLength;
  return name.length >= min && name.length <= max ? name : null;
}
