import { db, transaction } from '../db/db.js';
import { buildings, gameConfig, pvpConfig, races, units } from '../data.js';
import { protectionEnd } from './pvpRules.js';
import { unitCP } from './battleService.js';
import { combatMultiplier, equipPct } from './bonuses.js';
import { runRaidIfDue } from './raidService.js';
import {
  GameError,
  ensureNodes,
  listBuildings,
  overview,
  settle,
  territoryLandRadius,
} from './territoryService.js';

export { GameError };

export interface CharacterState {
  id: number;
  serverId: number;
  race: string;
  territoryName: string;
  territoryLevel: number;
  resources: Record<string, number>;
  buildings: ReturnType<typeof listBuildings>;
  /** 영지 땅 반경: 칸 i, j 가 -R..R 이면 내 땅 (영지 레벨이 오르면 넓어진다) */
  landRadius: number;
  /** 일반 건물이 다 자랐을 때의 한 변 칸 수 (자동 배치가 이만큼 자리를 남긴다) */
  growSize: number;
  units: { unitId: string; count: number }[];
  totalTroops: number;
  totalCP: number;
  serverNow: number;
  protectedUntil: number;
  speedupSec: number;
  pvpCooldownUntil: number;
  equipBonusPct: number;
  unitCP: Record<string, number>;
  trainSlots: number;
  trainQueue: { id: number; unitId: string; amount: number; finishAt: number }[];
  queuedTroops: number;
  levelUp: { to: number; finishAt: number } | null;
  maxTroops: number;
  storageCap: number;
  buildSlots: number;
  constructing: number;
  awayTroops: number;
  idleTroops: number;
  logs: { key: string; params: Record<string, unknown>; at: number }[];
}

/** 유닛 전투력 = (attack + defense + hp/10) × 종족 보정 × 계열 보정 (장비 보정은 Phase 4) */
export function totalCP(
  raceId: string,
  stock: { unitId: string; count: number }[],
  equipMult = 1,
): number {
  let sum = 0;
  for (const s of stock) {
    const u = units.units.find((x) => x.id === s.unitId);
    if (u) sum += unitCP(raceId, u, equipMult) * s.count;
  }
  return Math.round(sum);
}

export function getCharacter(userId: number, serverId: number): CharacterState | null {
  const find = db.prepare('SELECT * FROM characters WHERE user_id = ? AND server_id = ?');
  const first = find.get(userId, serverId) as Record<string, string | number> | undefined;
  if (!first) return null;
  const id = first.id as number;
  runRaidIfDue(id); // NPC 침공 (예정 시각이 지났으면 이번 접속 때 발생)
  settle(id); // 레벨업 완료/생산 정산 후 최신 행을 다시 읽는다
  const c = find.get(userId, serverId) as Record<string, string | number>;
  const r = db.prepare('SELECT * FROM resources WHERE character_id = ?').get(id) as Record<
    string,
    number
  >;
  const equipMult = combatMultiplier(id);
  const b = listBuildings(id);
  const u = db
    .prepare('SELECT unit_id AS unitId, count FROM unit_stock WHERE character_id = ?')
    .all(id) as unknown as CharacterState['units'];
  return {
    id,
    serverId,
    race: c.race as string,
    territoryName: c.territory_name as string,
    territoryLevel: c.territory_level as number,
    resources: {
      food: Math.floor(r.food),
      wood: Math.floor(r.wood),
      stone: Math.floor(r.stone),
      iron: Math.floor(r.iron),
      gold: Math.floor(r.gold),
    },
    buildings: b,
    landRadius: territoryLandRadius(c.territory_level as number),
    growSize: buildings.footprint.default[buildings.footprint.default.length - 1],
    units: u,
    totalTroops: u.reduce((s, x) => s + x.count, 0),
    totalCP: totalCP(c.race as string, u, equipMult),
    unitCP: Object.fromEntries(
      units.units
        .filter((x) => x.race === c.race)
        .map((x) => [x.id, unitCP(c.race as string, x, equipMult)]),
    ),
    equipBonusPct: Math.round(equipPct(id) * 10) / 10,
    speedupSec: (c.speedup_sec as number | null) ?? 0,
    protectedUntil: protectionEnd(
      c.created_at as number,
      (c.protection_until as number | null) ?? null,
      pvpConfig.protectionHours,
    ),
    pvpCooldownUntil: c.last_attack_at
      ? (c.last_attack_at as number) + pvpConfig.cooldownSec * 1000
      : 0,
    ...overview(id),
  };
}

export function createCharacter(
  userId: number,
  serverId: number,
  raceId: string,
  territoryName: string,
): CharacterState {
  const server = db.prepare('SELECT id FROM servers WHERE id = ?').get(serverId);
  if (!server) throw new GameError('SERVER_NOT_FOUND', 404);
  const race = races.races.find((r) => r.id === raceId && r.enabled);
  if (!race) throw new GameError('INVALID_RACE');
  if (typeof territoryName !== 'string') throw new GameError('INVALID_TERRITORY_NAME');
  const name = territoryName.trim();
  const { min, max } = gameConfig.territoryName;
  if (name.length < min || name.length > max) throw new GameError('INVALID_TERRITORY_NAME');
  if (getCharacter(userId, serverId)) throw new GameError('CHARACTER_EXISTS', 409);

  const startUnit = units.units.find((u) => u.id === race.startUnit);
  if (!startUnit) throw new GameError('START_UNIT_MISSING', 500);

  const now = Date.now();
  const { start } = gameConfig;
  transaction(() => {
    const res = db
      .prepare(
        'INSERT INTO characters (user_id, server_id, race, territory_name, territory_level, created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(userId, serverId, raceId, name, start.territoryLevel, now);
    const cid = Number(res.lastInsertRowid);
    const r = start.resources;
    db.prepare(
      'INSERT INTO resources (character_id, food, wood, stone, iron, gold, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run(cid, r.food, r.wood, r.stone, r.iron, r.gold, now);
    const insB = db.prepare(
      'INSERT INTO buildings (character_id, type, level, position_x, position_y) VALUES (?,?,?,?,?)',
    );
    for (const b of start.buildings) insB.run(cid, b.type, b.level, b.x, b.y);
    ensureNodes(cid, start.territoryLevel);
    db.prepare('INSERT INTO unit_stock (character_id, unit_id, count) VALUES (?,?,?)').run(
      cid,
      startUnit.id,
      start.tier1UnitCount,
    );
  });
  return getCharacter(userId, serverId)!;
}
