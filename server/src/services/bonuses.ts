import { db } from '../db/db.js';
import { researchData } from '../data.js';

/** 하위(leaf) 모듈: DB/데이터만 의존 — 다른 서비스가 안전하게 가져다 쓸 수 있다. */

export type ResearchEffect = 'production' | 'train' | 'combat' | 'carry';

export function researchLevels(characterId: number): Record<string, number> {
  const rows = db
    .prepare('SELECT tech_id, level FROM research WHERE character_id = ?')
    .all(characterId) as unknown as { tech_id: string; level: number }[];
  return Object.fromEntries(rows.map((r) => [r.tech_id, r.level]));
}

/** 연구 효과 합 (예: combat 0.09 = 전투력 +9%) */
export function researchBonus(characterId: number, effect: ResearchEffect): number {
  const levels = researchLevels(characterId);
  return researchData.techs
    .filter((t) => t.effect === effect)
    .reduce((sum, t) => sum + t.perLevel * (levels[t.id] ?? 0), 0);
}

/** 장착 장비 보정 합 (%) */
export function equipPct(characterId: number): number {
  const row = db
    .prepare(
      'SELECT COALESCE(SUM(power),0) AS p FROM equipment WHERE character_id = ? AND equipped = 1',
    )
    .get(characterId) as { p: number };
  return row.p;
}

/** 전투력 배수 = (1 + 장비 보정) × (1 + 연구 '전술' 보정) */
export function combatMultiplier(characterId: number): number {
  return (1 + equipPct(characterId) / 100) * (1 + researchBonus(characterId, 'combat'));
}
