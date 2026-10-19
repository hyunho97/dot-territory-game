import { exploration } from '../data.js';

/** 탐험 복귀 시 굴리는 랜덤 이벤트 (순수 함수: rng 주입으로 테스트/재현 가능) */
export interface ExpeditionEventResult {
  key: string | null;
  yieldMult: number;
  bonusGold: number;
  equipment: boolean;
  troopLossRatio: number;
  speedupMin: number;
}

const NONE: ExpeditionEventResult = {
  key: null,
  yieldMult: 1,
  bonusGold: 0,
  equipment: false,
  troopLossRatio: 0,
  speedupMin: 0,
};

export function rollExpeditionEvent(
  territoryLevel: number,
  rng: () => number = Math.random,
): ExpeditionEventResult {
  if (rng() >= exploration.eventChance) return { ...NONE };
  const events = exploration.events;
  const total = events.reduce((s, e) => s + e.weight, 0);
  let roll = rng() * total;
  const picked = events.find((e) => (roll -= e.weight) < 0) ?? events[0];
  const result: ExpeditionEventResult = { ...NONE, key: picked.id };
  if (picked.yieldMult !== undefined) result.yieldMult = picked.yieldMult;
  if (picked.goldBase !== undefined)
    result.bonusGold = Math.round(picked.goldBase + (picked.goldPerLevel ?? 0) * territoryLevel);
  if (picked.id === 'equipment_find') result.equipment = true;
  if (picked.speedupMin) {
    const [lo, hi] = picked.speedupMin;
    result.speedupMin = lo + Math.floor(rng() * (hi - lo + 1));
  }
  if (picked.lossRatio) {
    const [lo, hi] = picked.lossRatio;
    result.troopLossRatio = lo + rng() * (hi - lo);
  }
  return result;
}
