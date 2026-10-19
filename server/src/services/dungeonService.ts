import { db, transaction } from '../db/db.js';
import { battleConfig, dungeonData, units } from '../data.js';
import { armyCP, resolveBattle } from './battle.js';
import type { Army } from './battle.js';
import { applyLosses, selectArmy, unitCP } from './battleService.js';
import { floorEnemyCP, floorEnemyUnitId, floorReward, milestoneRewards } from './dungeonRules.js';
import { grantRandomEquipment, inventoryFull } from './equipmentGrant.js';
import type { GrantedItem } from './equipmentGrant.js';
import { dayKey, nextResetAt } from './questEvents.js';
import { addSpeedup } from './speedupGrant.js';
import { GameError, characterStorageCap, settle } from './territoryService.js';

interface Progress {
  best_floor: number;
  day: number;
  entries_used: number;
}

function progressOf(characterId: number): { best: number; used: number } {
  const row = db
    .prepare('SELECT best_floor, day, entries_used FROM dungeon_progress WHERE character_id = ?')
    .get(characterId) as Progress | undefined;
  if (!row) return { best: 0, used: 0 };
  return { best: row.best_floor, used: row.day === dayKey() ? row.entries_used : 0 };
}

function levelOf(characterId: number): { race: string; level: number } {
  const c = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  return { race: c.race, level: c.territory_level };
}

export function dungeonState(characterId: number) {
  settle(characterId);
  const { level } = levelOf(characterId);
  const { best, used } = progressOf(characterId);
  const preview = [];
  for (let f = best + 1; f <= Math.min(dungeonData.maxFloors, best + 5); f++)
    preview.push({
      floor: f,
      enemyCP: Math.round(floorEnemyCP(f)),
      enemyUnitId: floorEnemyUnitId(f),
      reward: floorReward(f, level),
    });
  return {
    serverNow: Date.now(),
    resetAt: nextResetAt(),
    minLevel: dungeonData.minTerritoryLevel,
    locked: level < dungeonData.minTerritoryLevel,
    bestFloor: best,
    maxFloors: dungeonData.maxFloors,
    entriesLeft: Math.max(0, dungeonData.dailyEntries - used),
    maxEntries: dungeonData.dailyEntries,
    preview,
    milestones: dungeonData.milestones,
  };
}

export interface FloorResult {
  floor: number;
  enemyCP: number;
  myCP: number;
  winner: 'A' | 'B' | 'draw';
  lost: number;
}

/**
 * 던전 도전: 선택한 병력으로 1층부터 자동 전투를 이어가며 stopAt 층까지(또는 패배할 때까지) 진행한다.
 * 층마다 손실이 누적되고, 입장 횟수는 하루 제한이 있으며, 마일스톤 보상은 처음 도달한 층에서만 지급된다.
 */
export function runDungeon(characterId: number, selection: Record<string, number>, stopAt: number) {
  settle(characterId);
  const { race, level } = levelOf(characterId);
  if (level < dungeonData.minTerritoryLevel) throw new GameError('DUNGEON_LOCKED');
  if (!Number.isInteger(stopAt) || stopAt < 1 || stopAt > dungeonData.maxFloors)
    throw new GameError('INVALID_FLOOR');
  const { best, used } = progressOf(characterId);
  if (used >= dungeonData.dailyEntries) throw new GameError('DUNGEON_NO_ENTRY');

  const { armyA } = selectArmy(characterId, selection);
  const army: Army = armyA.map((u) => ({ ...u }));
  const lostTotal = new Map<string, number>();
  const floors: FloorResult[] = [];
  const resources: Record<string, number> = {};
  let cleared = 0;
  let reason: 'stop' | 'defeat' | 'max' = 'stop';

  for (let floor = 1; floor <= stopAt; floor++) {
    const enemyId = floorEnemyUnitId(floor);
    const def = units.units.find((u) => u.id === enemyId)!;
    const per = unitCP('__neutral__', def);
    const enemyCP = floorEnemyCP(floor);
    const enemy: Army = [
      { unitId: enemyId, cp: per, count: Math.max(1, Math.round(enemyCP / per)) },
    ];
    const myCP = armyCP(army);
    const seed = Math.floor(Math.random() * 0xffffffff);
    const r = resolveBattle(army, enemy, battleConfig, seed);
    let lost = 0;
    for (const l of r.aLosses) {
      lost += l.count;
      lostTotal.set(l.unitId, (lostTotal.get(l.unitId) ?? 0) + l.count);
      const u = army.find((x) => x.unitId === l.unitId);
      if (u) u.count -= l.count;
    }
    floors.push({
      floor,
      enemyCP: Math.round(enemyCP),
      myCP: Math.round(myCP),
      winner: r.winner,
      lost,
    });
    if (r.winner !== 'A') {
      reason = 'defeat';
      break;
    }
    cleared = floor;
    for (const [k, v] of Object.entries(floorReward(floor, level)))
      resources[k] = (resources[k] ?? 0) + v;
    if (floor === dungeonData.maxFloors) reason = 'max';
    if (army.every((u) => u.count <= 0)) {
      if (floor < stopAt) reason = 'defeat';
      break;
    }
  }

  const newBest = Math.max(best, cleared);
  const ms = milestoneRewards(best, newBest);
  const stockFull = ms.equipment > 0 && inventoryFull(characterId);
  const granted: GrantedItem[] = [];
  const paid: Record<string, number> = {};

  transaction(() => {
    applyLosses(
      characterId,
      [...lostTotal.entries()].map(([unitId, count]) => ({ unitId, count })),
    );
    const res = db
      .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
      .get(characterId) as Record<string, number>;
    const cap = characterStorageCap(characterId);
    for (const [k, v] of Object.entries(resources)) {
      const next = Math.max(res[k], Math.min(cap, res[k] + v)); // 상한 초과분은 버림
      paid[k] = Math.floor(next - res[k]);
      db.prepare(`UPDATE resources SET ${k} = ? WHERE character_id = ?`).run(next, characterId);
    }
    if (ms.speedupMin > 0) addSpeedup(characterId, ms.speedupMin * 60);
    if (!stockFull)
      for (let i = 0; i < ms.equipment; i++) {
        const it = grantRandomEquipment(characterId, race);
        if (it) granted.push(it);
      }
    db.prepare(
      `INSERT INTO dungeon_progress (character_id, best_floor, day, entries_used) VALUES (?,?,?,1)
       ON CONFLICT(character_id) DO UPDATE SET best_floor = excluded.best_floor,
         entries_used = CASE WHEN day = excluded.day THEN entries_used + 1 ELSE 1 END, day = excluded.day`,
    ).run(characterId, newBest, dayKey());
    db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
      characterId,
      'dungeonDone',
      JSON.stringify({ cleared, best: newBest, reason }),
      Date.now(),
    );
  });

  return {
    floors,
    cleared,
    reason,
    newBest: newBest > best,
    bestFloor: newBest,
    resources: paid,
    speedupMin: ms.speedupMin,
    equipment: granted,
    equipmentSkipped: stockFull,
    survivors: army.filter((u) => u.count > 0).map((u) => ({ unitId: u.unitId, count: u.count })),
    state: dungeonState(characterId),
  };
}
