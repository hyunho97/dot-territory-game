import { db, transaction } from '../db/db.js';
import { battleConfig, pve, races, units } from '../data.js';
import type { UnitData } from '../data.js';
import { resolveBattle } from './battle.js';
import { combatMultiplier } from './bonuses.js';
import type { Army, BattleResult } from './battle.js';
import { dayKey } from './questEvents.js';
import { addSpeedup } from './speedupGrant.js';
import { GameError, characterStorageCap, overview, settle } from './territoryService.js';

/** 유닛 1기 전투력 = (attack + defense + hp/10) × 종족 보정 × 계열 보정 (장비 보정은 Phase 4) */
export function unitCP(raceId: string, u: UnitData, equipMult = 1): number {
  const mods = races.races.find((r) => r.id === raceId)?.mods;
  const base = u.baseStats.attack + u.baseStats.defense + u.baseStats.hp / 10;
  return base * (mods?.combatPower ?? 1) * (mods?.classPower[u.class] ?? 1) * equipMult;
}

/** PvE 적군: 종족 보정 없이 기본 능력치로 계산 (stage.cpMultiplier 로 조정 가능) */
function enemyArmy(stage: (typeof pve.stages)[number]): Army {
  return stage.army.map((a) => {
    const u = units.units.find((x) => x.id === a.unitId)!;
    return {
      unitId: a.unitId,
      cp: unitCP('__neutral__', u) * (stage.cpMultiplier ?? 1),
      count: a.count,
    };
  });
}

/** 첫 클리어 보상을 이미 받은 스테이지 (quest_progress 의 'pve_first' 기간으로 기록) */
/** 오늘 이 스테이지에서 보상을 받은 승리 횟수 */
function rewardedToday(characterId: number, stageId: string): number {
  const r = db
    .prepare(
      'SELECT progress FROM quest_progress WHERE character_id = ? AND quest_id = ? AND period = ?',
    )
    .get(characterId, stageId, `pve_day_${dayKey()}`) as { progress: number } | undefined;
  return r?.progress ?? 0;
}

function clearedStages(characterId: number): Set<string> {
  const rows = db
    .prepare("SELECT quest_id FROM quest_progress WHERE character_id = ? AND period = 'pve_first'")
    .all(characterId) as unknown as { quest_id: string }[];
  return new Set(rows.map((r) => r.quest_id));
}

export function stageList(characterId: number) {
  const level = (
    db.prepare('SELECT territory_level FROM characters WHERE id = ?').get(characterId) as {
      territory_level: number;
    }
  ).territory_level;
  return pve.stages.map((s) => {
    const army = enemyArmy(s);
    return {
      id: s.id,
      requiredLevel: s.requiredLevel,
      locked: s.requiredLevel > level,
      army: army.map((a) => ({ unitId: a.unitId, count: a.count, cp: a.cp })),
      enemyCP: army.reduce((sum, a) => sum + a.cp * a.count, 0),
      reward: s.reward,
      firstClearSpeedupMin: s.firstClearSpeedupMin ?? 0,
      cleared: clearedStages(characterId).has(s.id),
      rewardLeft: Math.max(0, pve.dailyRewardWins - rewardedToday(characterId, s.id)),
    };
  });
}

export interface BattleOutcome extends BattleResult {
  speedupMin?: number;
  /** 오늘 보상 상한 초과로 보상이 지급되지 않음 */
  rewardCapped?: boolean;
  stageId: string;
  armyA: { unitId: string; count: number }[];
  armyB: { unitId: string; count: number }[];
  rewards: Record<string, number>;
}

/** 참전 병력 선택 검증: 종족 유닛/보유 수량/출전 가능(대기) 병력을 서버가 확인하고 전투력을 계산한다. */
export function selectArmy(
  characterId: number,
  selection: Record<string, number>,
): { armyA: Army; total: number } {
  const ch = db.prepare('SELECT race FROM characters WHERE id = ?').get(characterId) as {
    race: string;
  };
  const stock = new Map(
    (
      db
        .prepare('SELECT unit_id, count FROM unit_stock WHERE character_id = ?')
        .all(characterId) as unknown as { unit_id: string; count: number }[]
    ).map((r) => [r.unit_id, r.count]),
  );
  const equipMult = combatMultiplier(characterId);
  const armyA: Army = [];
  let total = 0;
  for (const [unitId, raw] of Object.entries(selection ?? {})) {
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0) throw new GameError('INVALID_ARMY');
    if (count === 0) continue;
    const def = units.units.find((u) => u.id === unitId && u.race === ch.race);
    if (!def) throw new GameError('INVALID_ARMY');
    if (count > (stock.get(unitId) ?? 0)) throw new GameError('NOT_ENOUGH_TROOPS');
    armyA.push({ unitId, cp: unitCP(ch.race, def, equipMult), count });
    total += count;
  }
  if (total < 1) throw new GameError('EMPTY_ARMY');
  if (total > overview(characterId).idleTroops) throw new GameError('NOT_ENOUGH_TROOPS');
  return { armyA, total };
}

/** 전투 손실 반영 (트랜잭션 안에서 호출) */
export function applyLosses(
  characterId: number,
  losses: { unitId: string; count: number }[],
): void {
  for (const l of losses) {
    db.prepare(
      'UPDATE unit_stock SET count = count - ? WHERE character_id = ? AND unit_id = ?',
    ).run(l.count, characterId, l.unitId);
  }
  db.prepare('DELETE FROM unit_stock WHERE character_id = ? AND count <= 0').run(characterId);
}

export function startPveBattle(
  characterId: number,
  stageId: string,
  selection: Record<string, number>,
): BattleOutcome {
  settle(characterId);
  const now = Date.now();
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  const stage = pve.stages.find((s) => s.id === stageId);
  if (!stage) throw new GameError('INVALID_STAGE', 404);
  if (stage.requiredLevel > ch.territory_level) throw new GameError('STAGE_LOCKED');

  const { armyA } = selectArmy(characterId, selection);

  const armyB = enemyArmy(stage);
  const seed = Math.floor(Math.random() * 0xffffffff);
  const result = resolveBattle(armyA, armyB, battleConfig, seed);

  const rewards: Record<string, number> = {};
  const rewardOk =
    result.winner === 'A' && rewardedToday(characterId, stage.id) < pve.dailyRewardWins;
  if (rewardOk) Object.assign(rewards, stage.reward);
  // 첫 클리어 가속 보상 (스테이지당 1회)
  const firstClear =
    result.winner === 'A' &&
    (stage.firstClearSpeedupMin ?? 0) > 0 &&
    !clearedStages(characterId).has(stage.id);
  const speedupMin = firstClear ? (stage.firstClearSpeedupMin ?? 0) : 0;

  transaction(() => {
    applyLosses(characterId, result.aLosses);
    if (rewardOk)
      db.prepare(
        `INSERT INTO quest_progress (character_id, quest_id, period, progress, claimed) VALUES (?,?,?,1,0)
         ON CONFLICT(character_id, quest_id, period) DO UPDATE SET progress = progress + 1`,
      ).run(characterId, stage.id, `pve_day_${dayKey()}`);
    if (firstClear) {
      db.prepare(
        'INSERT OR IGNORE INTO quest_progress (character_id, quest_id, period, progress, claimed) VALUES (?,?,?,1,1)',
      ).run(characterId, stage.id, 'pve_first');
      addSpeedup(characterId, speedupMin * 60);
    }

    if (Object.keys(rewards).length > 0) {
      const res = db
        .prepare('SELECT * FROM resources WHERE character_id = ?')
        .get(characterId) as Record<string, number>;
      const cap = characterStorageCap(characterId, now);
      for (const [k, v] of Object.entries(rewards)) {
        const next = Math.max(res[k], Math.min(cap, res[k] + v)); // 상한 초과분은 버림
        db.prepare(`UPDATE resources SET ${k} = ? WHERE character_id = ?`).run(next, characterId);
      }
    }
    db.prepare(
      'INSERT INTO battle_logs (attacker_id, defender_id, defender_label, a_cp, b_cp, winner, a_losses_json, b_losses_json, seed, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      characterId,
      null,
      stage.id,
      result.aCP,
      result.bCP,
      result.winner,
      JSON.stringify(result.aLosses),
      JSON.stringify(result.bLosses),
      seed,
      now,
    );
    db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
      characterId,
      'battleDone',
      JSON.stringify({ stage: stage.id, winner: result.winner }),
      now,
    );
  });

  return {
    ...result,
    stageId: stage.id,
    armyA: armyA.map((a) => ({ unitId: a.unitId, count: a.count })),
    armyB: armyB.map((a) => ({ unitId: a.unitId, count: a.count })),
    rewards,
    rewardCapped: result.winner === 'A' && !rewardOk,
    speedupMin,
  };
}

export function battleHistory(characterId: number) {
  const rows = db
    .prepare(
      'SELECT id, defender_label AS stageId, a_cp AS aCP, b_cp AS bCP, winner, a_losses_json AS aLosses, created_at AS at FROM battle_logs WHERE attacker_id = ? ORDER BY id DESC LIMIT 10',
    )
    .all(characterId) as unknown as {
    id: number;
    stageId: string;
    aCP: number;
    bCP: number;
    winner: string;
    aLosses: string;
    at: number;
  }[];
  return rows.map((r) => ({ ...r, aLosses: JSON.parse(r.aLosses) as unknown }));
}
