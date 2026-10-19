import { db, transaction } from '../db/db.js';
import { equipmentData, races } from '../data.js';
import { GameError, characterStorageCap, settle, speedBonusFor } from './territoryService.js';

interface ItemRow {
  id: number;
  type: string;
  grade: string;
  power: number;
  equipped: number;
  created_at: number;
}

function craftSlots(level: number): number {
  const { base, levelsPerExtra } = equipmentData.craftSlots;
  return base + Math.floor(level / levelsPerExtra);
}

/** 장비 보정 배수 (8.4 "장비 보정"): 장착한 4슬롯 장비의 보정(%) 합 */
export function equipMultiplier(characterId: number): number {
  const row = db
    .prepare(
      'SELECT COALESCE(SUM(power),0) AS p FROM equipment WHERE character_id = ? AND equipped = 1',
    )
    .get(characterId) as { p: number };
  return 1 + row.p / 100;
}

export function equipmentState(characterId: number) {
  settle(characterId);
  const ch = db.prepare('SELECT territory_level FROM characters WHERE id = ?').get(characterId) as {
    territory_level: number;
  };
  const items = db
    .prepare(
      'SELECT id, type, grade, power, equipped, created_at FROM equipment WHERE character_id = ? ORDER BY equipped DESC, id DESC',
    )
    .all(characterId) as unknown as ItemRow[];
  const queue = db
    .prepare(
      'SELECT id, type, finish_at AS finishAt FROM craft_queue WHERE character_id = ? AND collected = 0 ORDER BY finish_at',
    )
    .all(characterId);
  const smithy = db
    .prepare(
      "SELECT 1 FROM buildings WHERE character_id = ? AND type = 'smithy' AND (upgrade_finish_at IS NULL OR upgrade_finish_at <= ?)",
    )
    .get(characterId, Date.now());
  return {
    serverNow: Date.now(),
    hasSmithy: !!smithy,
    craftSlots: craftSlots(ch.territory_level),
    maxInventory: equipmentData.maxInventory,
    multiplier: equipMultiplier(characterId),
    items: items.map((i) => ({
      id: i.id,
      type: i.type,
      grade: i.grade,
      power: i.power,
      equipped: i.equipped === 1,
    })),
    queue,
  };
}

/** 장비 제작 예약: 대장간 필요, 비용/시간에 종족 보정 적용. 등급은 완료 시점에 서버가 굴린다. */
export function craftEquipment(characterId: number, type: string): void {
  settle(characterId);
  const now = Date.now();
  const def = equipmentData.types.find((t) => t.id === type);
  if (!def) throw new GameError('INVALID_EQUIP_TYPE');
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  const smithy = db
    .prepare(
      "SELECT 1 FROM buildings WHERE character_id = ? AND type = 'smithy' AND (upgrade_finish_at IS NULL OR upgrade_finish_at <= ?)",
    )
    .get(characterId, now);
  if (!smithy) throw new GameError('NO_SMITHY');

  const queued = (
    db
      .prepare('SELECT COUNT(*) AS n FROM craft_queue WHERE character_id = ? AND collected = 0')
      .get(characterId) as { n: number }
  ).n;
  if (queued >= craftSlots(ch.territory_level)) throw new GameError('CRAFT_SLOTS_FULL');
  const owned = (
    db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE character_id = ?').get(characterId) as {
      n: number;
    }
  ).n;
  if (owned + queued >= equipmentData.maxInventory) throw new GameError('INVENTORY_FULL');

  const mods = races.races.find((r) => r.id === ch.race)!.mods;
  const cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(def.cost)) cost[k] = Math.ceil(v * mods.costRate);
  const res = db
    .prepare('SELECT * FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(cost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');

  const craftBonus = speedBonusFor(characterId, 'craft', now);
  const durationMs = Math.ceil(def.craftTimeSec / (mods.trainSpeed * (1 + craftBonus))) * 1000;
  transaction(() => {
    for (const [k, v] of Object.entries(cost))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    db.prepare(
      'INSERT INTO craft_queue (character_id, type, start_at, finish_at) VALUES (?,?,?,?)',
    ).run(characterId, type, now, now + durationMs);
  });
}

function ownItem(characterId: number, itemId: number): ItemRow {
  const row = db
    .prepare(
      'SELECT id, type, grade, power, equipped, created_at FROM equipment WHERE id = ? AND character_id = ?',
    )
    .get(itemId, characterId) as ItemRow | undefined;
  if (!row) throw new GameError('ITEM_NOT_FOUND', 404);
  return row;
}

/** 슬롯(=장비 종류)당 1개: 같은 종류가 이미 장착되어 있으면 교체 */
export function equipItem(characterId: number, itemId: number): void {
  settle(characterId);
  const item = ownItem(characterId, itemId);
  transaction(() => {
    db.prepare('UPDATE equipment SET equipped = 0 WHERE character_id = ? AND type = ?').run(
      characterId,
      item.type,
    );
    db.prepare('UPDATE equipment SET equipped = 1 WHERE id = ?').run(item.id);
  });
}

export function unequipItem(characterId: number, itemId: number): void {
  settle(characterId);
  const item = ownItem(characterId, itemId);
  db.prepare('UPDATE equipment SET equipped = 0 WHERE id = ?').run(item.id);
}

/** 분해: 장착 중이 아닌 장비를 등급별 자원으로 환급 */
export function salvageItem(characterId: number, itemId: number): void {
  settle(characterId);
  const item = ownItem(characterId, itemId);
  if (item.equipped) throw new GameError('ITEM_EQUIPPED');
  const grade = equipmentData.grades.find((g) => g.id === item.grade)!;
  transaction(() => {
    db.prepare('DELETE FROM equipment WHERE id = ?').run(item.id);
    const cap = characterStorageCap(characterId);
    const have = db
      .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
      .get(characterId) as Record<string, number>;
    for (const [k, v] of Object.entries(grade.salvage)) {
      const next = Math.max(have[k], Math.min(cap, have[k] + v)); // 상한 초과분은 버림
      db.prepare(`UPDATE resources SET ${k} = ? WHERE character_id = ?`).run(next, characterId);
    }
  });
}
