import { dungeonData } from '../data.js';

/** 던전 규칙 (순수 함수): 층별 적 전투력/구성, 층 보상, 최초 도달 마일스톤 */

export function floorEnemyCP(floor: number): number {
  return dungeonData.baseCP * Math.pow(dungeonData.cpGrowth, floor - 1);
}

export function floorEnemyUnitId(floor: number): string {
  let id = dungeonData.enemyByFloor[0].unitId;
  for (const band of dungeonData.enemyByFloor) if (floor >= band.fromFloor) id = band.unitId;
  return id;
}

/** 층 클리어 자원 보상 (층이 깊을수록, 영지 레벨이 높을수록 증가) */
export function floorReward(floor: number, territoryLevel: number): Record<string, number> {
  const mult =
    (1 + dungeonData.rewardGrowthPerFloor * (floor - 1)) *
    (1 + dungeonData.levelScalePerLevel * (territoryLevel - 1));
  return Object.fromEntries(
    Object.entries(dungeonData.floorReward).map(([k, v]) => [k, Math.floor(v * mult)]),
  );
}

/** 이번에 처음 도달한 층(prevBest+1 .. newBest)에서 얻는 마일스톤 보상 */
export function milestoneRewards(
  prevBest: number,
  newBest: number,
): { speedupMin: number; equipment: number } {
  const { speedupEvery, speedupMinPerStep, equipmentEvery } = dungeonData.milestones;
  let speedupMin = 0;
  let equipment = 0;
  for (let f = prevBest + 1; f <= newBest; f++) {
    if (f % speedupEvery === 0) speedupMin += speedupMinPerStep * (f / speedupEvery);
    if (f % equipmentEvery === 0) equipment++;
  }
  return { speedupMin, equipment };
}
