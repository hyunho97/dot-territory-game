import { db, transaction } from '../db/db.js';
import { buildings, exploration, gameConfig, races, territoryLevels, units } from '../data.js';
import { rollGrade, rollPower } from './equipmentRoll.js';
import { guildBonus, researchBonus } from './bonuses.js';
import { grantRandomEquipment } from './equipmentGrant.js';
import { addSpeedup } from './speedupGrant.js';
import { rollExpeditionEvent } from './exploreEvents.js';
import type { BuildingDef } from '../data.js';

export class GameError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

const RESOURCES = ['food', 'wood', 'stone', 'iron', 'gold'] as const;

interface BuildingRow {
  id: number;
  type: string;
  level: number;
  upgrade_finish_at: number | null;
  levelup_to: number | null;
  levelup_finish_at: number | null;
}

function defOf(type: string): BuildingDef | undefined {
  return buildings.buildings.find((b) => b.id === type);
}
function raceMods(raceId: string) {
  return races.races.find((r) => r.id === raceId)!.mods;
}
function isActive(b: BuildingRow, now: number): boolean {
  return b.upgrade_finish_at === null || b.upgrade_finish_at <= now;
}
/** 신규 건설 중이거나 업그레이드 중인 건물은 건설 슬롯을 점유한다 */
function isBusy(b: BuildingRow, now: number): boolean {
  return !isActive(b, now) || (b.levelup_finish_at !== null && b.levelup_finish_at > now);
}
function loadBuildings(characterId: number): BuildingRow[] {
  return db
    .prepare(
      'SELECT id, type, level, upgrade_finish_at, levelup_to, levelup_finish_at FROM buildings WHERE character_id = ?',
    )
    .all(characterId) as unknown as BuildingRow[];
}

/** 레벨 이하 중 가장 높은 구간의 최대 병력 + 주거지 보너스 */
export function maxTroops(level: number, activeBuildings: BuildingRow[], now: number): number {
  const base = [...territoryLevels.levels].filter((l) => l.level <= level).pop()?.maxTroops ?? 0;
  const bonus = activeBuildings
    .filter((b) => isActive(b, now))
    .reduce((s, b) => s + (defOf(b.type)?.popBonus ?? 0) * b.level, 0);
  return base + bonus;
}
export function storageCap(level: number, activeBuildings: BuildingRow[], now: number): number {
  const bonus = activeBuildings
    .filter((b) => isActive(b, now))
    .reduce((s, b) => s + (defOf(b.type)?.storageBonus ?? 0) * b.level, 0);
  return gameConfig.storage.base + (level - 1) * gameConfig.storage.perLevel + bonus;
}
/** 캐릭터의 현재 창고 상한 (영지 레벨 + 완공된 창고 보너스) */
export function characterStorageCap(characterId: number, now = Date.now()): number {
  const lvl = (
    db.prepare('SELECT territory_level FROM characters WHERE id = ?').get(characterId) as {
      territory_level: number;
    }
  ).territory_level;
  return storageCap(lvl, loadBuildings(characterId), now);
}
export function buildSlots(level: number): number {
  const { base, levelsPerExtra } = gameConfig.buildSlots;
  return base + Math.floor(level / levelsPerExtra);
}
export function trainSlots(level: number): number {
  const { base, levelsPerExtra } = gameConfig.trainSlots;
  return base + Math.floor(level / levelsPerExtra);
}
/** 막사(모집)/대장간(제작) 레벨 효과: 완공된 건물 중 가장 높은 레벨 기준, 레벨당 perLevel 만큼 (Lv.1 은 0) */
function speedBonusOf(
  activeBuildings: BuildingRow[],
  kind: 'train' | 'craft',
  now: number,
): number {
  let best = 0;
  for (const b of activeBuildings) {
    const sb = defOf(b.type)?.speedBonus;
    if (sb?.kind === kind && isActive(b, now)) best = Math.max(best, sb.perLevel * (b.level - 1));
  }
  return best;
}
export function speedBonusFor(
  characterId: number,
  kind: 'train' | 'craft',
  now = Date.now(),
): number {
  return speedBonusOf(loadBuildings(characterId), kind, now);
}
export function expeditionSlots(level: number): number {
  const { base, levelsPerExtra } = exploration.slots;
  return base + Math.floor(level / levelsPerExtra);
}

/** 탐험 매복 등으로 보유 병력 중 n명을 무작위(보유 수 비례)로 잃는다. 실제 손실 수를 반환. */
function loseRandomTroops(characterId: number, n: number): number {
  const rows = db
    .prepare('SELECT unit_id, count FROM unit_stock WHERE character_id = ? AND count > 0')
    .all(characterId) as unknown as { unit_id: string; count: number }[];
  let lost = 0;
  for (let i = 0; i < n; i++) {
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    if (total <= 0) break;
    let roll = Math.random() * total;
    const r = rows.find((x) => (roll -= x.count) < 0) ?? rows[0];
    r.count--;
    lost++;
    db.prepare(
      'UPDATE unit_stock SET count = count - 1 WHERE character_id = ? AND unit_id = ?',
    ).run(characterId, r.unit_id);
  }
  db.prepare('DELETE FROM unit_stock WHERE character_id = ? AND count <= 0').run(characterId);
  return lost;
}

/** 시간 경과 정산: 자원 건물 생산(오프라인 상한 적용) + 완료된 탐험 수확 */
export function settle(characterId: number, now = Date.now()): void {
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  transaction(() => {
    const res = db
      .prepare('SELECT * FROM resources WHERE character_id = ?')
      .get(characterId) as Record<string, number>;
    // 영지 레벨업 완료 처리
    const up = db
      .prepare('SELECT upgrade_to, upgrade_finish_at FROM characters WHERE id = ?')
      .get(characterId) as { upgrade_to: number | null; upgrade_finish_at: number | null };
    if (up.upgrade_to && up.upgrade_finish_at && up.upgrade_finish_at <= now) {
      db.prepare(
        'UPDATE characters SET territory_level = ?, upgrade_to = NULL, upgrade_finish_at = NULL WHERE id = ?',
      ).run(up.upgrade_to, characterId);
      db.prepare(
        "UPDATE buildings SET level = ? WHERE character_id = ? AND type = 'town_hall'",
      ).run(up.upgrade_to, characterId);
      db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
        characterId,
        'levelUp',
        JSON.stringify({ level: up.upgrade_to }),
        now,
      );
    }
    const lvl = (
      db.prepare('SELECT territory_level FROM characters WHERE id = ?').get(characterId) as {
        territory_level: number;
      }
    ).territory_level;
    const blds = loadBuildings(characterId);
    const cap = storageCap(lvl, blds, now);
    const gain =
      raceMods(ch.race).resourceGain *
      (1 + researchBonus(characterId, 'production') + guildBonus(characterId, 'production'));
    const values: Record<string, number> = {};
    for (const r of RESOURCES) values[r] = res[r];

    const from = Math.max(res.updated_at, now - gameConfig.offlineMaxHours * 3_600_000);
    for (const b of blds) {
      const prod = defOf(b.type)?.production;
      if (!prod) continue;
      const start = Math.max(from, b.upgrade_finish_at ?? 0);
      if (now <= start || values[prod.resource] >= cap) continue;
      // 이번 구간 중 업그레이드가 끝났다면 끝난 시점을 기준으로 구간을 나눠 이전/이후 레벨로 각각 계산
      const doneAt = b.levelup_to !== null ? (b.levelup_finish_at ?? Infinity) : Infinity;
      const split = Math.min(Math.max(doneAt, start), now);
      const hoursOld = (split - start) / 3_600_000;
      const hoursNew = (now - split) / 3_600_000;
      const afterLevel = b.levelup_to !== null && doneAt <= now ? b.levelup_to : b.level;
      values[prod.resource] = Math.min(
        cap,
        values[prod.resource] + prod.perHour * gain * (b.level * hoursOld + afterLevel * hoursNew),
      );
    }

    const done = db
      .prepare(
        'SELECT * FROM expeditions WHERE character_id = ? AND collected = 0 AND finish_at <= ?',
      )
      .all(characterId, now) as unknown as {
      id: number;
      resource: string;
      yield: number;
      troops: number;
    }[];
    for (const e of done) {
      // 복귀 시 랜덤 이벤트 (추가 수확/보물/장비 발견/매복) — 결과는 서버가 굴린다
      const evt = rollExpeditionEvent(ch.territory_level);
      const amount = Math.floor(e.yield * evt.yieldMult);
      values[e.resource] = Math.max(values[e.resource], Math.min(cap, values[e.resource] + amount));
      if (evt.bonusGold > 0)
        values.gold = Math.max(values.gold, Math.min(cap, values.gold + evt.bonusGold));
      if (evt.speedupMin > 0) addSpeedup(characterId, evt.speedupMin * 60);
      const found = evt.equipment ? grantRandomEquipment(characterId, ch.race) : null;
      const lost =
        evt.troopLossRatio > 0
          ? loseRandomTroops(characterId, Math.ceil(e.troops * evt.troopLossRatio))
          : 0;
      db.prepare('UPDATE expeditions SET collected = 1 WHERE id = ?').run(e.id);
      db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
        characterId,
        'expeditionDone',
        JSON.stringify({
          resource: e.resource,
          amount,
          event: evt.key,
          gold: evt.bonusGold,
          speedupMin: evt.speedupMin,
          lost,
          equipment: found,
        }),
        now,
      );
    }

    // 완료된 장비 제작 -> 등급/보정 롤(서버) 후 인벤토리에 추가
    const crafted = db
      .prepare(
        'SELECT id, type FROM craft_queue WHERE character_id = ? AND collected = 0 AND finish_at <= ?',
      )
      .all(characterId, now) as unknown as { id: number; type: string }[];
    for (const c of crafted) {
      const grade = rollGrade(ch.race);
      const power = rollPower(ch.race, grade);
      db.prepare(
        'INSERT INTO equipment (character_id, type, grade, power, equipped, created_at) VALUES (?,?,?,?,0,?)',
      ).run(characterId, c.type, grade, power, now);
      db.prepare('UPDATE craft_queue SET collected = 1 WHERE id = ?').run(c.id);
      db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
        characterId,
        'craftDone',
        JSON.stringify({ type: c.type, grade, power }),
        now,
      );
    }

    // 완료된 건물 업그레이드 -> 레벨 반영
    const upgraded = db
      .prepare(
        'SELECT id, type, levelup_to FROM buildings WHERE character_id = ? AND levelup_to IS NOT NULL AND levelup_finish_at <= ?',
      )
      .all(characterId, now) as unknown as { id: number; type: string; levelup_to: number }[];
    for (const u of upgraded) {
      db.prepare(
        'UPDATE buildings SET level = ?, levelup_to = NULL, levelup_finish_at = NULL WHERE id = ?',
      ).run(u.levelup_to, u.id);
      db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
        characterId,
        'buildingUpgraded',
        JSON.stringify({ type: u.type, level: u.levelup_to }),
        now,
      );
    }

    // 완료된 연구 -> 레벨 반영
    const job = db
      .prepare(
        'SELECT tech_id, to_level FROM research_job WHERE character_id = ? AND finish_at <= ?',
      )
      .get(characterId, now) as { tech_id: string; to_level: number } | undefined;
    if (job) {
      db.prepare(
        'INSERT INTO research (character_id, tech_id, level) VALUES (?,?,?) ON CONFLICT(character_id, tech_id) DO UPDATE SET level = excluded.level',
      ).run(characterId, job.tech_id, job.to_level);
      db.prepare('DELETE FROM research_job WHERE character_id = ?').run(characterId);
      db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
        characterId,
        'researchDone',
        JSON.stringify({ tech: job.tech_id, level: job.to_level }),
        now,
      );
    }

    // 완료된 병사 모집 -> 병력 반영
    const trained = db
      .prepare(
        'SELECT id, unit_id, amount FROM train_queue WHERE character_id = ? AND collected = 0 AND finish_at <= ?',
      )
      .all(characterId, now) as unknown as { id: number; unit_id: string; amount: number }[];
    for (const q of trained) {
      db.prepare(
        'INSERT INTO unit_stock (character_id, unit_id, count) VALUES (?,?,?) ON CONFLICT(character_id, unit_id) DO UPDATE SET count = count + excluded.count',
      ).run(characterId, q.unit_id, q.amount);
      db.prepare('UPDATE train_queue SET collected = 1 WHERE id = ?').run(q.id);
      db.prepare('INSERT INTO events (character_id, key, params, created_at) VALUES (?,?,?,?)').run(
        characterId,
        'trainDone',
        JSON.stringify({ unit: q.unit_id, amount: q.amount }),
        now,
      );
    }

    db.prepare(
      'UPDATE resources SET food=?, wood=?, stone=?, iron=?, gold=?, updated_at=? WHERE character_id=?',
    ).run(values.food, values.wood, values.stone, values.iron, values.gold, now, characterId);
  });
}

export function overview(characterId: number, now = Date.now()) {
  const ch = db
    .prepare('SELECT territory_level, upgrade_to, upgrade_finish_at FROM characters WHERE id = ?')
    .get(characterId) as {
    territory_level: number;
    upgrade_to: number | null;
    upgrade_finish_at: number | null;
  };
  const blds = loadBuildings(characterId);
  const stock = db
    .prepare('SELECT COALESCE(SUM(count),0) AS n FROM unit_stock WHERE character_id = ?')
    .get(characterId) as { n: number };
  const away = db
    .prepare(
      'SELECT COALESCE(SUM(troops),0) AS n FROM expeditions WHERE character_id = ? AND collected = 0',
    )
    .get(characterId) as { n: number };
  const trainQueue = db
    .prepare(
      'SELECT id, unit_id AS unitId, amount, finish_at AS finishAt FROM train_queue WHERE character_id = ? AND collected = 0 ORDER BY finish_at',
    )
    .all(characterId) as unknown as {
    id: number;
    unitId: string;
    amount: number;
    finishAt: number;
  }[];
  const logs = db
    .prepare(
      'SELECT key, params, created_at AS at FROM events WHERE character_id = ? ORDER BY id DESC LIMIT 5',
    )
    .all(characterId) as unknown as { key: string; params: string; at: number }[];
  return {
    serverNow: now,
    trainBonus: speedBonusOf(blds, 'train', now),
    craftBonus: speedBonusOf(blds, 'craft', now),
    levelUp:
      ch.upgrade_to && ch.upgrade_finish_at
        ? { to: ch.upgrade_to, finishAt: ch.upgrade_finish_at }
        : null,
    maxTroops: maxTroops(ch.territory_level, blds, now),
    storageCap: storageCap(ch.territory_level, blds, now),
    trainSlots: trainSlots(ch.territory_level),
    trainQueue,
    queuedTroops: trainQueue.reduce((sum, q) => sum + q.amount, 0),
    buildSlots: buildSlots(ch.territory_level),
    constructing: blds.filter((b) => isBusy(b, now)).length,
    awayTroops: away.n,
    idleTroops: Math.max(0, stock.n - away.n),
    logs: logs.map((l) => ({ key: l.key, params: JSON.parse(l.params), at: l.at })),
  };
}

export function listBuildings(characterId: number) {
  return loadBuildings(characterId).map((b) => ({
    id: b.id,
    type: b.type,
    level: b.level,
    finishAt: b.upgrade_finish_at,
    upgradeTo: b.levelup_to,
    upgradeFinishAt: b.levelup_finish_at,
  }));
}

export function build(characterId: number, type: string): void {
  settle(characterId);
  const now = Date.now();
  const def = defOf(type);
  if (!def || !def.buildable) throw new GameError('INVALID_BUILDING');
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  if (def.unlockLevel > ch.territory_level) throw new GameError('BUILDING_LOCKED');
  const blds = loadBuildings(characterId);
  if (blds.filter((b) => b.type === type).length >= def.maxCount)
    throw new GameError('BUILDING_MAX');
  if (blds.filter((b) => isBusy(b, now)).length >= buildSlots(ch.territory_level))
    throw new GameError('BUILD_SLOTS_FULL');

  const costRate = raceMods(ch.race).costRate;
  const cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(def.cost)) cost[k] = Math.ceil(v * costRate);
  const res = db
    .prepare('SELECT * FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(cost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');

  transaction(() => {
    for (const [k, v] of Object.entries(cost))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    db.prepare(
      'INSERT INTO buildings (character_id, type, level, upgrade_finish_at, position_x, position_y) VALUES (?,?,?,?,?,?)',
    ).run(characterId, type, 1, now + def.buildTimeSec * 1000, blds.length, 0);
  });
}

/** 건물 업그레이드: 건물 레벨은 영지 레벨(영주관)과 건물별 maxLevel 을 넘을 수 없다. */
export function upgradeBuilding(characterId: number, buildingId: number): void {
  settle(characterId);
  const now = Date.now();
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  const blds = loadBuildings(characterId);
  const b = blds.find((x) => x.id === buildingId);
  if (!b) throw new GameError('BUILDING_NOT_FOUND', 404);
  const def = defOf(b.type);
  if (!def?.maxLevel) throw new GameError('NOT_UPGRADABLE');
  if (isBusy(b, now)) throw new GameError('BUILDING_BUSY');
  if (b.level >= def.maxLevel) throw new GameError('BUILDING_MAX_LEVEL');
  if (b.level >= ch.territory_level) throw new GameError('NEED_TERRITORY_LEVEL');
  if (blds.filter((x) => isBusy(x, now)).length >= buildSlots(ch.territory_level))
    throw new GameError('BUILD_SLOTS_FULL');

  const { costGrowth, timeGrowth } = buildings.upgrade;
  const costRate = raceMods(ch.race).costRate;
  const cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(def.cost))
    cost[k] = Math.ceil(v * Math.pow(costGrowth, b.level) * costRate);
  const res = db
    .prepare('SELECT * FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(cost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');

  const durationMs = Math.ceil(def.buildTimeSec * Math.pow(timeGrowth, b.level)) * 1000;
  transaction(() => {
    for (const [k, v] of Object.entries(cost))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    db.prepare('UPDATE buildings SET levelup_to = ?, levelup_finish_at = ? WHERE id = ?').run(
      b.level + 1,
      now + durationMs,
      b.id,
    );
  });
}

/** 영지 레벨업 시작: 자원(종족 비용 보정) 차감 + 완료 시각 저장. 동시에 하나만 가능. */
export function startLevelUp(characterId: number): void {
  settle(characterId);
  const now = Date.now();
  const ch = db
    .prepare('SELECT race, territory_level, upgrade_finish_at FROM characters WHERE id = ?')
    .get(characterId) as {
    race: string;
    territory_level: number;
    upgrade_finish_at: number | null;
  };
  if (ch.upgrade_finish_at) throw new GameError('LEVELUP_IN_PROGRESS');
  const next = territoryLevels.levels.find((l) => l.level === ch.territory_level + 1);
  if (!next || !next.cost || !next.timeSec) throw new GameError('MAX_LEVEL');

  const costRate = raceMods(ch.race).costRate;
  const cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(next.cost)) cost[k] = Math.ceil(v * costRate);
  const res = db
    .prepare('SELECT * FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(cost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');

  transaction(() => {
    for (const [k, v] of Object.entries(cost))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    db.prepare('UPDATE characters SET upgrade_to = ?, upgrade_finish_at = ? WHERE id = ?').run(
      next.level,
      now + next.timeSec! * 1000,
      characterId,
    );
  });
}

/** 병사 모집: 막사 필요, 영지 레벨/수용량/큐 슬롯/비용(종족 보정)을 서버가 검증 */
export function trainUnits(characterId: number, unitId: string, amount: number): void {
  settle(characterId);
  const now = Date.now();
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  const unit = units.units.find((u) => u.id === unitId && u.race === ch.race);
  if (!unit) throw new GameError('INVALID_UNIT');
  if (!Number.isInteger(amount) || amount < 1 || amount > gameConfig.maxTrainAmount)
    throw new GameError('INVALID_AMOUNT');
  if (unit.requiredTerritoryLevel > ch.territory_level) throw new GameError('UNIT_LOCKED');
  const blds = loadBuildings(characterId);
  if (!blds.some((b) => b.type === 'barracks' && isActive(b, now)))
    throw new GameError('NO_BARRACKS');
  const o = overview(characterId, now);
  if (o.trainQueue.length >= o.trainSlots) throw new GameError('TRAIN_SLOTS_FULL');
  const stock = (
    db
      .prepare('SELECT COALESCE(SUM(count),0) AS n FROM unit_stock WHERE character_id = ?')
      .get(characterId) as { n: number }
  ).n;
  if (stock + o.queuedTroops + amount > o.maxTroops) throw new GameError('TROOP_CAP');

  const mods = raceMods(ch.race);
  const cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(unit.cost)) cost[k] = Math.ceil(v * amount * mods.costRate);
  const res = db
    .prepare('SELECT * FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(cost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');

  const trainBonus = speedBonusOf(blds, 'train', now) + researchBonus(characterId, 'train');
  const durationMs =
    Math.ceil((unit.trainTimeSec * amount) / (mods.trainSpeed * (1 + trainBonus))) * 1000;
  transaction(() => {
    for (const [k, v] of Object.entries(cost))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    db.prepare(
      'INSERT INTO train_queue (character_id, unit_id, amount, start_at, finish_at) VALUES (?,?,?,?,?)',
    ).run(characterId, unitId, amount, now, now + durationMs);
  });
}

// ───────── 탐사 ─────────

interface NodeRow {
  id: number;
  resource: string;
  x: number;
  y: number;
  remaining: number;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function spawnNode(characterId: number, level: number): void {
  const types = exploration.nodeTypes.filter((n) => n.unlockLevel <= level);
  const total = types.reduce((s, n) => s + n.weight, 0);
  let roll = Math.random() * total;
  const type = types.find((n) => (roll -= n.weight) < 0) ?? types[0];
  const existing = db
    .prepare('SELECT x, y FROM map_nodes WHERE character_id = ?')
    .all(characterId) as unknown as { x: number; y: number }[];
  for (let i = 0; i < 30; i++) {
    const dist = type.minDist + Math.random() * (type.maxDist - type.minDist);
    const angle = Math.random() * Math.PI * 2;
    const x = Math.round(Math.cos(angle) * dist);
    const y = Math.round(Math.sin(angle) * dist);
    if ((x === 0 && y === 0) || existing.some((e) => e.x === x && e.y === y)) continue;
    db.prepare(
      'INSERT INTO map_nodes (character_id, resource, x, y, remaining) VALUES (?,?,?,?,?)',
    ).run(
      characterId,
      type.resource,
      x,
      y,
      Math.round(
        randInt(type.amount[0], type.amount[1]) *
          (1 + (exploration.amountPerLevel ?? 0) * (level - 1)),
      ),
    );
    return;
  }
}

export function ensureNodes(characterId: number, level: number): void {
  const n = (
    db.prepare('SELECT COUNT(*) AS n FROM map_nodes WHERE character_id = ?').get(characterId) as {
      n: number;
    }
  ).n;
  for (let i = n; i < exploration.nodeCount; i++) spawnNode(characterId, level);
}

export function exploreState(characterId: number) {
  settle(characterId);
  const ch = db.prepare('SELECT territory_level FROM characters WHERE id = ?').get(characterId) as {
    territory_level: number;
  };
  ensureNodes(characterId, ch.territory_level);
  const nodes = db
    .prepare('SELECT id, resource, x, y, remaining FROM map_nodes WHERE character_id = ?')
    .all(characterId) as unknown as NodeRow[];
  const expeditions = db
    .prepare(
      'SELECT id, resource, x, y, troops, yield, start_at AS startAt, finish_at AS finishAt FROM expeditions WHERE character_id = ? AND collected = 0 ORDER BY finish_at',
    )
    .all(characterId);
  const o = overview(characterId);
  return {
    serverNow: o.serverNow,
    tileSec: exploration.tileSec,
    carryPerUnit: exploration.carryPerUnit,
    carryBonus: researchBonus(characterId, 'carry'),
    slots: expeditionSlots(ch.territory_level),
    idleTroops: o.idleTroops,
    nodes,
    expeditions,
  };
}

export function sendExpedition(characterId: number, nodeId: number, troops: number): void {
  settle(characterId);
  const now = Date.now();
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  const node = db
    .prepare(
      'SELECT id, resource, x, y, remaining FROM map_nodes WHERE id = ? AND character_id = ?',
    )
    .get(nodeId, characterId) as NodeRow | undefined;
  if (!node) throw new GameError('NODE_NOT_FOUND', 404);
  if (!Number.isInteger(troops) || troops < 1) throw new GameError('INVALID_TROOPS');
  const o = overview(characterId, now);
  if (troops > o.idleTroops) throw new GameError('NOT_ENOUGH_TROOPS');
  const active = (
    db
      .prepare('SELECT COUNT(*) AS n FROM expeditions WHERE character_id = ? AND collected = 0')
      .get(characterId) as { n: number }
  ).n;
  if (active >= expeditionSlots(ch.territory_level)) throw new GameError('EXPEDITION_SLOTS_FULL');

  const dist = Math.hypot(node.x, node.y);
  const roundTripMs = Math.ceil(dist * exploration.tileSec) * 2 * 1000;
  const yieldAmount = Math.min(
    node.remaining,
    Math.floor(
      troops *
        exploration.carryPerUnit *
        raceMods(ch.race).resourceGain *
        (1 + researchBonus(characterId, 'carry')),
    ),
  );
  transaction(() => {
    db.prepare(
      'INSERT INTO expeditions (character_id, resource, x, y, dist, troops, yield, start_at, finish_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      characterId,
      node.resource,
      node.x,
      node.y,
      dist,
      troops,
      yieldAmount,
      now,
      now + roundTripMs,
    );
    if (node.remaining - yieldAmount <= 0) {
      db.prepare('DELETE FROM map_nodes WHERE id = ?').run(node.id);
      spawnNode(characterId, ch.territory_level);
    } else {
      db.prepare('UPDATE map_nodes SET remaining = remaining - ? WHERE id = ?').run(
        yieldAmount,
        node.id,
      );
    }
  });
}
