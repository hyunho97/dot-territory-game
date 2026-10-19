import { equipmentData } from '../data.js';

/** 종족 보정이 적용된 등급별 가중치 (희귀 이상에만 raceGradeMult 적용) */
export function gradeWeights(raceId: string): { id: string; weight: number }[] {
  const { grades, highGradeFrom, raceGradeMult } = equipmentData;
  const highIdx = grades.findIndex((g) => g.id === highGradeFrom);
  const mult = raceGradeMult[raceId] ?? 1;
  return grades.map((g, i) => ({ id: g.id, weight: g.weight * (i >= highIdx ? mult : 1) }));
}

export function rollGrade(raceId: string, rng: () => number = Math.random): string {
  const weights = gradeWeights(raceId);
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let roll = rng() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll < 0) return w.id;
  }
  return weights[0].id;
}

/** 장비 보정(%) = 등급 기본값 × 무작위 편차 × 종족 품질 보너스 */
export function rollPower(
  raceId: string,
  gradeId: string,
  rng: () => number = Math.random,
): number {
  const grade = equipmentData.grades.find((g) => g.id === gradeId)!;
  const [lo, hi] = equipmentData.powerRoll;
  const quality = equipmentData.raceQualityMult[raceId] ?? 1;
  return Math.round(grade.power * (lo + rng() * (hi - lo)) * quality * 10) / 10;
}
