import { db, transaction } from '../db/db.js';
import { battleConfig, pvpConfig, units } from '../data.js';
import { resolveBattle } from './battle.js';
import type { Army, BattleResult } from './battle.js';
import { applyLosses, selectArmy, unitCP } from './battleService.js';
import { combatMultiplier } from './bonuses.js';
import { calcPlunder, isInCpRange, protectionEnd } from './pvpRules.js';
import { GameError, characterStorageCap, settle } from './territoryService.js';

interface CharRow {
  id: number;
  user_id: number;
  server_id: number;
  race: string;
  territory_name: string;
  territory_level: number;
  created_at: number;
  protection_until: number | null;
  last_attack_at: number | null;
  nickname: string;
}

const CHAR_SQL =
  'SELECT c.id, c.user_id, c.server_id, c.race, c.territory_name, c.territory_level, c.created_at, c.protection_until, c.last_attack_at, u.nickname FROM characters c JOIN users u ON u.id = c.user_id';

const armyCPOf = (army: Army): number => army.reduce((s, u) => s + u.cp * u.count, 0);

/** 방어 시 참전하는 전 병력 (장비 보정 포함) */
export function fullArmy(characterId: number, race: string): Army {
  const mult = combatMultiplier(characterId);
  const stock = db
    .prepare('SELECT unit_id, count FROM unit_stock WHERE character_id = ? AND count > 0')
    .all(characterId) as unknown as { unit_id: string; count: number }[];
  const army: Army = [];
  for (const s of stock) {
    const def = units.units.find((u) => u.id === s.unit_id);
    if (def) army.push({ unitId: s.unit_id, cp: unitCP(race, def, mult), count: s.count });
  }
  return army;
}

const protectedUntilOf = (r: CharRow): number =>
  protectionEnd(r.created_at, r.protection_until, pvpConfig.protectionHours);
const cooldownUntilOf = (r: CharRow): number =>
  r.last_attack_at ? r.last_attack_at + pvpConfig.cooldownSec * 1000 : 0;

/** 같은 서버에서 공격 가능한 상대 목록 (보호 중이거나 전투력 범위 밖이면 제외) */
export function pvpTargets(characterId: number) {
  const now = Date.now();
  const me = db.prepare(`${CHAR_SQL} WHERE c.id = ?`).get(characterId) as unknown as CharRow;
  const myCP = armyCPOf(fullArmy(me.id, me.race));
  const others = db
    .prepare(`${CHAR_SQL} WHERE c.server_id = ? AND c.id != ?`)
    .all(me.server_id, me.id) as unknown as CharRow[];
  const targets = others
    .filter((o) => protectedUntilOf(o) <= now)
    .map((o) => ({
      id: o.id,
      territoryName: o.territory_name,
      owner: o.nickname,
      race: o.race,
      level: o.territory_level,
      cp: Math.round(armyCPOf(fullArmy(o.id, o.race)) * 10) / 10,
    }))
    .filter((o) => isInCpRange(myCP, o.cp, pvpConfig))
    .sort((a, b) => Math.abs(a.cp - myCP) - Math.abs(b.cp - myCP))
    .slice(0, pvpConfig.maxTargets);
  return {
    serverNow: now,
    myCP: Math.round(myCP * 10) / 10,
    cooldownUntil: cooldownUntilOf(me),
    protectedUntil: protectedUntilOf(me),
    rangeMin: pvpConfig.cpRangeMin,
    rangeMax: pvpConfig.cpRangeMax,
    targets,
  };
}

export interface PvpOutcome extends BattleResult {
  stageId: 'pvp';
  targetName: string;
  armyA: { unitId: string; count: number }[];
  armyB: { unitId: string; count: number }[];
  rewards: Record<string, number>;
}

/** 방어자가 접속하지 않아도 병력 전체가 자동 참전. 승리 시 보호량을 제외한 자원의 일부를 약탈. */
export function pvpAttack(
  characterId: number,
  targetId: number,
  selection: Record<string, number>,
): PvpOutcome {
  settle(characterId);
  const now = Date.now();
  const me = db.prepare(`${CHAR_SQL} WHERE c.id = ?`).get(characterId) as unknown as CharRow;
  const first = db.prepare(`${CHAR_SQL} WHERE c.id = ?`).get(targetId) as unknown as
    CharRow | undefined;
  if (!first || first.id === me.id || first.server_id !== me.server_id)
    throw new GameError('INVALID_TARGET', 404);
  settle(targetId);
  const target = db.prepare(`${CHAR_SQL} WHERE c.id = ?`).get(targetId) as unknown as CharRow;

  if (now < cooldownUntilOf(me)) throw new GameError('PVP_COOLDOWN');
  if (now < protectedUntilOf(target)) throw new GameError('TARGET_PROTECTED');

  const { armyA } = selectArmy(characterId, selection);
  const armyB = fullArmy(target.id, target.race);
  const myCP = armyCPOf(fullArmy(me.id, me.race));
  if (!isInCpRange(myCP, armyCPOf(armyB), pvpConfig)) throw new GameError('TARGET_OUT_OF_RANGE');

  const seed = Math.floor(Math.random() * 0xffffffff);
  const result = resolveBattle(armyA, armyB, battleConfig, seed);

  // 약탈 (공격 성공 시에만)
  const plunder: Record<string, number> = {};
  const gained: Record<string, number> = {};
  if (result.winner === 'A') {
    const res = db
      .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
      .get(targetId) as Record<string, number>;
    const mine = db
      .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
      .get(characterId) as Record<string, number>;
    const whLevels = (
      db
        .prepare(
          "SELECT COALESCE(SUM(level),0) AS n FROM buildings WHERE character_id = ? AND type = 'warehouse' AND (upgrade_finish_at IS NULL OR upgrade_finish_at <= ?)",
        )
        .get(targetId, now) as { n: number }
    ).n;
    const protectedAmount =
      pvpConfig.protectedBase + pvpConfig.protectedPerWarehouseLevel * whLevels;
    Object.assign(plunder, calcPlunder(res, protectedAmount, pvpConfig.plunderRatio));
    const cap = characterStorageCap(characterId, now);
    for (const [k, v] of Object.entries(plunder)) {
      gained[k] = Math.min(v, Math.max(0, Math.floor(cap - mine[k]))); // 보관 상한 초과분은 버림
    }
  }

  transaction(() => {
    applyLosses(characterId, result.aLosses);
    applyLosses(targetId, result.bLosses);
    for (const [k, v] of Object.entries(plunder))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, targetId);
    for (const [k, v] of Object.entries(gained))
      db.prepare(`UPDATE resources SET ${k} = ${k} + ? WHERE character_id = ?`).run(v, characterId);
    // 공격하면 신규 보호가 해제되고 쿨타임이 시작된다
    db.prepare('UPDATE characters SET last_attack_at = ?, protection_until = ? WHERE id = ?').run(
      now,
      now,
      characterId,
    );
    db.prepare(
      'INSERT INTO battle_logs (attacker_id, defender_id, defender_label, a_cp, b_cp, winner, a_losses_json, b_losses_json, seed, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      characterId,
      targetId,
      null,
      result.aCP,
      result.bCP,
      result.winner,
      JSON.stringify(result.aLosses),
      JSON.stringify(result.bLosses),
      seed,
      now,
    );
    const ev = db.prepare(
      'INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)',
    );
    ev.run(
      characterId,
      'pvpAttack',
      JSON.stringify({ target: target.territory_name, winner: result.winner }),
      now,
    );
    ev.run(
      targetId,
      'pvpDefended',
      JSON.stringify({
        attacker: me.territory_name,
        winner: result.winner,
        lost: result.bLosses.reduce((s, l) => s + l.count, 0),
      }),
      now,
    );
  });

  return {
    ...result,
    stageId: 'pvp',
    targetName: target.territory_name,
    armyA: armyA.map((a) => ({ unitId: a.unitId, count: a.count })),
    armyB: armyB.map((a) => ({ unitId: a.unitId, count: a.count })),
    rewards: gained,
  };
}
