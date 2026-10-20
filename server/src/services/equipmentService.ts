import { db, transaction } from '../db/db.js';
import { equipmentData, races } from '../data.js';
import { GameError, characterStorageCap, settle, speedBonusFor } from './territoryService.js';
import {
  effectivePower,
  enhanceChance,
  enhanceCost,
  fuseChance,
  nextGrade,
  promotedPower,
} from './equipmentRules.js';
import { rollPower } from './equipmentRoll.js';

interface ItemRow {
  id: number;
  type: string;
  grade: string;
  power: number;
  enhance: number;
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
      'SELECT COALESCE(SUM(power * (1 + enhance * ?)),0) AS p FROM equipment WHERE character_id = ? AND equipped = 1',
    )
    .get(equipmentData.enhance.powerPerLevel, characterId) as { p: number };
  return 1 + row.p / 100;
}

export function equipmentState(characterId: number) {
  settle(characterId);
  const ch = db.prepare('SELECT territory_level FROM characters WHERE id = ?').get(characterId) as {
    territory_level: number;
  };
  const items = db
    .prepare(
      'SELECT id, type, grade, power, enhance, equipped, created_at FROM equipment WHERE character_id = ? ORDER BY equipped DESC, id DESC',
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
      enhance: i.enhance,
      effectivePower: effectivePower(i.power, i.enhance),
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
      'SELECT id, type, grade, power, enhance, equipped, created_at FROM equipment WHERE id = ? AND character_id = ?',
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

function requireSmithy(characterId: number): void {
  const smithy = db
    .prepare(
      "SELECT 1 FROM buildings WHERE character_id = ? AND type = 'smithy' AND (upgrade_finish_at IS NULL OR upgrade_finish_at <= ?)",
    )
    .get(characterId, Date.now());
  if (!smithy) throw new GameError('NO_SMITHY');
}

/** 자원이 충분한지 확인하고 차감한다 (호출은 트랜잭션 안에서) */
function payCost(characterId: number, cost: Record<string, number>): void {
  const res = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(cost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');
  for (const [k, v] of Object.entries(cost))
    db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
}

export type EnhanceResult = 'success' | 'fail' | 'promoted';

/**
 * 장비 강화: +1 시도 (실패해도 단계는 유지, 비용만 소모).
 * 최대 강화(+10)에 성공하면 다음 등급으로 승급하며 강화 단계는 0으로 돌아간다 (품질 비율은 유지).
 * 최고 등급은 +10 까지만 강화할 수 있다.
 */
export function enhanceItem(
  characterId: number,
  itemId: number,
  rng: () => number = Math.random,
): EnhanceResult {
  settle(characterId);
  requireSmithy(characterId);
  const item = ownItem(characterId, itemId);
  const max = equipmentData.enhance.maxLevel;
  if (item.enhance >= max) throw new GameError('ENHANCE_MAX');
  const cost = enhanceCost(item.grade, item.enhance);
  const ok = rng() < enhanceChance(item.enhance);
  return transaction(() => {
    payCost(characterId, cost);
    if (!ok) return 'fail';
    const lv = item.enhance + 1;
    const up = lv >= max ? nextGrade(item.grade) : null;
    if (up) {
      db.prepare('UPDATE equipment SET grade = ?, power = ?, enhance = 0 WHERE id = ?').run(
        up,
        promotedPower(item.power, item.grade, up),
        item.id,
      );
      return 'promoted';
    }
    db.prepare('UPDATE equipment SET enhance = ? WHERE id = ?').run(lv, item.id);
    return 'success';
  });
}

/**
 * 장비 합성: 같은 등급 장비 2개(장착 중 제외)를 소모해 낮은 확률로 상위 등급 장비 1개를 얻는다.
 * 실패하면 2개 모두 사라지고 분해 환급의 일부만 돌려준다. 결과 종류는 두 장비 중 무작위.
 */
export function fuseItems(
  characterId: number,
  idA: number,
  idB: number,
  rng: () => number = Math.random,
): { success: boolean; item: { type: string; grade: string; power: number } | null } {
  settle(characterId);
  requireSmithy(characterId);
  if (idA === idB) throw new GameError('FUSE_INVALID');
  const a = ownItem(characterId, idA);
  const b = ownItem(characterId, idB);
  if (a.equipped || b.equipped) throw new GameError('ITEM_EQUIPPED');
  if (a.grade !== b.grade) throw new GameError('FUSE_INVALID');
  const up = nextGrade(a.grade);
  const chance = fuseChance(a.grade);
  if (!up || chance <= 0) throw new GameError('FUSE_MAX_GRADE');
  const race = (
    db.prepare('SELECT race FROM characters WHERE id = ?').get(characterId) as { race: string }
  ).race;
  const success = rng() < chance;
  return transaction(() => {
    payCost(characterId, equipmentData.fusion.cost);
    db.prepare('DELETE FROM equipment WHERE id IN (?, ?)').run(a.id, b.id);
    if (success) {
      const type = rng() < 0.5 ? a.type : b.type;
      const power = rollPower(race, up, rng);
      db.prepare(
        'INSERT INTO equipment (character_id, type, grade, power, equipped, created_at) VALUES (?,?,?,?,0,?)',
      ).run(characterId, type, up, power, Date.now());
      return { success: true, item: { type, grade: up, power } };
    }
    // 실패: 분해 환급의 일부 (보관 상한 초과분은 버림)
    const salvage = equipmentData.grades.find((g) => g.id === a.grade)!.salvage;
    const cap = characterStorageCap(characterId);
    const have = db
      .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
      .get(characterId) as Record<string, number>;
    for (const [k, v] of Object.entries(salvage)) {
      const refund = Math.floor(v * 2 * equipmentData.fusion.failRefundRatio);
      const next = Math.max(have[k], Math.min(cap, have[k] + refund));
      db.prepare(`UPDATE resources SET ${k} = ? WHERE character_id = ?`).run(next, characterId);
    }
    return { success: false, item: null };
  });
}
