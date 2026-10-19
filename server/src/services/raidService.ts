import { db, transaction } from '../db/db.js';
import { pvpConfig, raidsData, units } from '../data.js';
import { resolveBattle } from './battle.js';
import type { Army } from './battle.js';
import { applyLosses, unitCP } from './battleService.js';
import { fullArmy } from './pvpService.js';
import { calcPlunder, protectionEnd } from './pvpRules.js';
import { addSpeedup } from './speedupGrant.js';
import { characterStorageCap, settle } from './territoryService.js';

/** NPC 침공: 일정 시간마다 영지를 습격. 접속(상태 조회) 시점에 예정 시각이 지났으면 한 번 발생한다. */

function nextRaidTime(now: number): number {
  const base = raidsData.intervalHours * 3_600_000;
  const jitter = (Math.random() * 2 - 1) * raidsData.intervalJitter;
  return Math.round(now + base * (1 + jitter));
}

function raiderUnitId(level: number): string {
  let id = raidsData.raiderByLevel[0].unitId;
  for (const r of raidsData.raiderByLevel) if (level >= r.fromLevel) id = r.unitId;
  return id;
}

export function runRaidIfDue(characterId: number): void {
  const now = Date.now();
  const ch = db
    .prepare(
      'SELECT race, territory_level, created_at, protection_until, next_raid_at FROM characters WHERE id = ?',
    )
    .get(characterId) as unknown as
    | {
        race: string;
        territory_level: number;
        created_at: number;
        protection_until: number | null;
        next_raid_at: number | null;
      }
    | undefined;
  if (!ch || ch.territory_level < raidsData.minTerritoryLevel) return;
  if (now < protectionEnd(ch.created_at, ch.protection_until, pvpConfig.protectionHours)) return;
  if (ch.next_raid_at === null) {
    db.prepare('UPDATE characters SET next_raid_at = ? WHERE id = ?').run(
      nextRaidTime(now),
      characterId,
    );
    return;
  }
  if (now < ch.next_raid_at) return;

  settle(characterId, now);
  const defenders = fullArmy(characterId, ch.race);
  const myCP = defenders.reduce((s, u) => s + u.cp * u.count, 0);
  const [lo, hi] = raidsData.strengthRatio;
  const target = Math.max(raidsData.minStrength, myCP * (lo + Math.random() * (hi - lo)));
  const unitId = raiderUnitId(ch.territory_level);
  const def = units.units.find((u) => u.id === unitId)!;
  const perUnit = unitCP('__neutral__', def);
  const raiders: Army = [{ unitId, cp: perUnit, count: Math.max(1, Math.round(target / perUnit)) }];

  const seed = Math.floor(Math.random() * 0xffffffff);
  const result = resolveBattle(raiders, defenders, raidsData.config, seed);
  // A = 침략자, B = 영지 방어군
  const playerWon = result.winner === 'B';
  const raidersWon = result.winner === 'A';

  const res = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  const plunder: Record<string, number> = {};
  const reward: Record<string, number> = {};
  if (raidersWon) {
    const wh = (
      db
        .prepare(
          "SELECT COALESCE(SUM(level),0) AS n FROM buildings WHERE character_id = ? AND type = 'warehouse' AND (upgrade_finish_at IS NULL OR upgrade_finish_at <= ?)",
        )
        .get(characterId, now) as { n: number }
    ).n;
    const protectedAmount = pvpConfig.protectedBase + pvpConfig.protectedPerWarehouseLevel * wh;
    Object.assign(plunder, calcPlunder(res, protectedAmount, raidsData.plunderRatio));
  } else if (playerWon) {
    const cap = characterStorageCap(characterId, now);
    const raiderCP = raiders[0].cp * raiders[0].count;
    for (const [k, per] of Object.entries(raidsData.rewardPerCP)) {
      reward[k] = Math.max(0, Math.min(Math.floor(raiderCP * per), Math.floor(cap - res[k])));
    }
  }

  transaction(() => {
    applyLosses(characterId, result.bLosses);
    for (const [k, v] of Object.entries(plunder))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    for (const [k, v] of Object.entries(reward))
      db.prepare(`UPDATE resources SET ${k} = ${k} + ? WHERE character_id = ?`).run(v, characterId);
    if (playerWon) addSpeedup(characterId, raidsData.winSpeedupMin * 60);
    db.prepare('UPDATE characters SET next_raid_at = ? WHERE id = ?').run(
      nextRaidTime(now),
      characterId,
    );
    db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
      characterId,
      'raid',
      JSON.stringify({
        winner: playerWon ? 'player' : raidersWon ? 'raiders' : 'draw',
        raiderCP: Math.round(raiders[0].cp * raiders[0].count),
        myCP: Math.round(myCP),
        lost: result.bLosses.reduce((s, l) => s + l.count, 0),
        plunder,
        reward,
        speedupMin: playerWon ? raidsData.winSpeedupMin : 0,
      }),
      now,
    );
  });
}
