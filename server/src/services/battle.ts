/**
 * 자동 전투 순수 함수 (GAME_SPEC 8-1).
 * DB/시간/전역 난수에 의존하지 않으며, 같은 입력 + 같은 seed 는 항상 같은 결과를 낸다.
 */

export interface ArmyUnit {
  unitId: string;
  /** 유닛 1기당 전투력 */
  cp: number;
  count: number;
}
export type Army = ArmyUnit[];

export interface BattleConfig {
  winnerLossRatio: number;
  loserLossRatio: number;
  drawLossRatio: number;
  /** 이긴 쪽 전투력이 상대의 이 배수 이상이면 이긴 쪽 손실 0 (압도적 전력 차) */
  noLossRatio?: number;
}
export interface Loss {
  unitId: string;
  count: number;
}
export type BattleLogEntry =
  | { type: 'cp'; aCP: number; bCP: number }
  | { type: 'result'; winner: 'A' | 'B' | 'draw' }
  | { type: 'loss'; side: 'A' | 'B'; unitId: string; count: number };

export interface BattleResult {
  winner: 'A' | 'B' | 'draw';
  aCP: number;
  bCP: number;
  aLosses: Loss[];
  bLosses: Loss[];
  log: BattleLogEntry[];
  seed: number;
}

const EPS = 1e-9;

/** mulberry32: 시드 기반 난수 (0 이상 1 미만) */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function armyCP(army: Army): number {
  return army.reduce((sum, u) => sum + u.cp * u.count, 0);
}

function toLosses(dead: Map<string, number>): Loss[] {
  return [...dead.entries()].map(([unitId, count]) => ({ unitId, count }));
}

/** 전원 사망 */
function wipeOut(army: Army): Loss[] {
  const dead = new Map<string, number>();
  for (const u of army) if (u.count > 0) dead.set(u.unitId, (dead.get(u.unitId) ?? 0) + u.count);
  return toLosses(dead);
}

/**
 * 개별 유닛 단위 무작위 추첨 (8-1.4).
 * 예산을 넘는 유닛은 건너뛰고 더 작은 전투력의 유닛으로 예산을 최대한 채운다.
 * 균등 확률로 하나씩 뽑는 것과 Fisher-Yates 셔플 후 순회는 동일한 분포다.
 */
export function pickLosses(army: Army, budget: number, rng: () => number): Loss[] {
  const pool: { unitId: string; cp: number }[] = [];
  for (const u of army) for (let i = 0; i < u.count; i++) pool.push({ unitId: u.unitId, cp: u.cp });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const dead = new Map<string, number>();
  let lost = 0;
  for (const u of pool) {
    if (lost + u.cp <= budget + EPS) {
      lost += u.cp;
      dead.set(u.unitId, (dead.get(u.unitId) ?? 0) + 1);
    }
  }
  return toLosses(dead);
}

/** 비율 손실: 1 이상이면 전멸, 아니면 (자기 CP × ratio) 예산만큼 무작위 손실 */
function applyLossRatio(army: Army, cpBase: number, ratio: number, rng: () => number): Loss[] {
  if (ratio >= 1) return wipeOut(army);
  if (ratio <= 0) return [];
  return pickLosses(army, cpBase * ratio, rng);
}

/** 압도적 전력 차: 이긴 쪽(winCP)이 진 쪽(loseCP)의 noLossRatio 배 이상 */
export function crushing(winCP: number, loseCP: number, config: BattleConfig): boolean {
  return !!config.noLossRatio && winCP >= loseCP * config.noLossRatio;
}

export function resolveBattle(
  armyA: Army,
  armyB: Army,
  config: BattleConfig,
  seed: number,
): BattleResult {
  const rng = createRng(seed);
  const aCP = armyCP(armyA);
  const bCP = armyCP(armyB);
  const log: BattleLogEntry[] = [{ type: 'cp', aCP, bCP }];

  let winner: BattleResult['winner'];
  let aLosses: Loss[];
  let bLosses: Loss[];
  if (aCP > bCP) {
    winner = 'A';
    bLosses = applyLossRatio(armyB, bCP, config.loserLossRatio, rng);
    aLosses = crushing(aCP, bCP, config)
      ? []
      : applyLossRatio(armyA, bCP, config.winnerLossRatio, rng); // 패배측 CP 기준
  } else if (aCP < bCP) {
    winner = 'B';
    aLosses = applyLossRatio(armyA, aCP, config.loserLossRatio, rng);
    bLosses = crushing(bCP, aCP, config)
      ? []
      : applyLossRatio(armyB, aCP, config.winnerLossRatio, rng);
  } else {
    winner = 'draw';
    aLosses = applyLossRatio(armyA, aCP, config.drawLossRatio, rng);
    bLosses = applyLossRatio(armyB, bCP, config.drawLossRatio, rng);
  }

  log.push({ type: 'result', winner });
  for (const l of aLosses) log.push({ type: 'loss', side: 'A', ...l });
  for (const l of bLosses) log.push({ type: 'loss', side: 'B', ...l });
  return { winner, aCP, bCP, aLosses, bLosses, log, seed };
}
