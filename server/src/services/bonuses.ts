import { db } from '../db/db.js';
import { equipmentData, researchData } from '../data.js';
import { guildBuff, guildLevel } from './guildRules.js';

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
      'SELECT COALESCE(SUM(power * (1 + enhance * ?)),0) AS p FROM equipment WHERE character_id = ? AND equipped = 1',
    )
    .get(equipmentData.enhance.powerPerLevel, characterId) as { p: number };
  return row.p;
}

/** 소속 길드의 레벨 버프 (길드가 없으면 0). 길드 경험치는 guild_members → guilds 로 조회한다. */
export function guildBonus(characterId: number, kind: 'production' | 'combat'): number {
  const row = db
    .prepare(
      'SELECT g.exp AS exp FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.character_id = ?',
    )
    .get(characterId) as { exp: number } | undefined;
  return row ? guildBuff(guildLevel(row.exp))[kind] : 0;
}

/** 전투력 배수 = (1 + 장비 보정) × (1 + 연구 '전술' 보정) × (1 + 길드 버프) */
export function combatMultiplier(characterId: number): number {
  return (
    (1 + equipPct(characterId) / 100) *
    (1 + researchBonus(characterId, 'combat')) *
    (1 + guildBonus(characterId, 'combat'))
  );
}
