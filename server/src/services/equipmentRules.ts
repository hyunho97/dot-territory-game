import { equipmentData } from '../data.js';

/** 장비 강화/승급/합성 규칙 (순수 함수, data/equipment.json 기반) */

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function gradeIndex(gradeId: string): number {
  return equipmentData.grades.findIndex((g) => g.id === gradeId);
}

/** 다음 등급 id (최고 등급이면 null) */
export function nextGrade(gradeId: string): string | null {
  const i = gradeIndex(gradeId);
  return i >= 0 && i + 1 < equipmentData.grades.length ? equipmentData.grades[i + 1].id : null;
}

/** 강화 수치가 반영된 실제 전투력 보정(%) */
export function effectivePower(power: number, enhance: number): number {
  return round1(power * (1 + enhance * equipmentData.enhance.powerPerLevel));
}

/** 현재 +level 에서 +1 을 시도할 때의 성공 확률 */
export function enhanceChance(level: number): number {
  const { successRate } = equipmentData.enhance;
  return successRate[Math.min(Math.max(level, 0), successRate.length - 1)];
}

/** 현재 +level 에서 +1 을 시도하는 비용 (등급이 높고 강화 단계가 높을수록 비쌈) */
export function enhanceCost(gradeId: string, level: number): Record<string, number> {
  const { cost, levelGrowth, gradeGrowth } = equipmentData.enhance;
  const mult = (1 + level * levelGrowth) * (1 + Math.max(gradeIndex(gradeId), 0) * gradeGrowth);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cost)) out[k] = Math.ceil(v * mult);
  return out;
}

/** 승급 시 같은 품질(등급 내 편차)을 유지한 채 새 등급의 보정값으로 환산 */
export function promotedPower(power: number, fromGrade: string, toGrade: string): number {
  const from = equipmentData.grades.find((g) => g.id === fromGrade)!;
  const to = equipmentData.grades.find((g) => g.id === toGrade)!;
  return round1((power / from.power) * to.power);
}

/** 같은 등급 2개를 합성할 때 상위 등급이 나올 확률 (합성 불가 등급이면 0) */
export function fuseChance(gradeId: string): number {
  return equipmentData.fusion.chance[gradeId] ?? 0;
}
