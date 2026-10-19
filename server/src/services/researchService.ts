import { db, transaction } from '../db/db.js';
import { races, researchData } from '../data.js';
import { researchLevels } from './bonuses.js';
import { GameError, settle } from './territoryService.js';

/** 다음 레벨 비용(종족 비용 보정 적용)과 시간 */
function nextCost(techId: string, level: number, costRate: number) {
  const t = researchData.techs.find((x) => x.id === techId)!;
  const cost = Object.fromEntries(
    Object.entries(t.cost).map(([k, v]) => [
      k,
      Math.ceil(v * Math.pow(t.costGrowth, level) * costRate),
    ]),
  );
  const timeSec = Math.ceil(t.timeSec * Math.pow(t.timeGrowth, level));
  return { cost, timeSec };
}

function hasLab(characterId: number, now: number): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM buildings WHERE character_id = ? AND type = 'lab' AND (upgrade_finish_at IS NULL OR upgrade_finish_at <= ?)",
    )
    .get(characterId, now);
}

export function researchState(characterId: number) {
  settle(characterId);
  const now = Date.now();
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  const costRate = races.races.find((r) => r.id === ch.race)!.mods.costRate;
  const levels = researchLevels(characterId);
  const job = db
    .prepare(
      'SELECT tech_id AS techId, to_level AS toLevel, finish_at AS finishAt FROM research_job WHERE character_id = ?',
    )
    .get(characterId) as { techId: string; toLevel: number; finishAt: number } | undefined;
  return {
    serverNow: now,
    hasLab: hasLab(characterId, now),
    job: job ?? null,
    techs: researchData.techs.map((t) => {
      const level = levels[t.id] ?? 0;
      const maxed = level >= t.maxLevel;
      return {
        id: t.id,
        effect: t.effect,
        perLevel: t.perLevel,
        level,
        maxLevel: t.maxLevel,
        unlockLevel: t.unlockLevel,
        locked: t.unlockLevel > ch.territory_level,
        next: maxed ? null : nextCost(t.id, level, costRate),
      };
    }),
  };
}

/** 연구 시작: 연구소 필요, 동시에 하나만. 비용/시간은 서버가 계산한다. */
export function startResearch(characterId: number, techId: string): void {
  settle(characterId);
  const now = Date.now();
  const tech = researchData.techs.find((t) => t.id === techId);
  if (!tech) throw new GameError('INVALID_TECH', 404);
  const ch = db
    .prepare('SELECT race, territory_level FROM characters WHERE id = ?')
    .get(characterId) as { race: string; territory_level: number };
  if (!hasLab(characterId, now)) throw new GameError('NO_LAB');
  if (tech.unlockLevel > ch.territory_level) throw new GameError('TECH_LOCKED');
  const level = researchLevels(characterId)[techId] ?? 0;
  if (level >= tech.maxLevel) throw new GameError('TECH_MAX');
  if (db.prepare('SELECT 1 FROM research_job WHERE character_id = ?').get(characterId))
    throw new GameError('RESEARCH_BUSY');

  const costRate = races.races.find((r) => r.id === ch.race)!.mods.costRate;
  const { cost, timeSec } = nextCost(techId, level, costRate);
  const res = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(cost))
    if (res[k] < v) throw new GameError('NOT_ENOUGH_RESOURCES');

  transaction(() => {
    for (const [k, v] of Object.entries(cost))
      db.prepare(`UPDATE resources SET ${k} = ${k} - ? WHERE character_id = ?`).run(v, characterId);
    db.prepare(
      'INSERT INTO research_job (character_id, tech_id, to_level, finish_at) VALUES (?,?,?,?)',
    ).run(characterId, techId, level + 1, now + timeSec * 1000);
  });
}
