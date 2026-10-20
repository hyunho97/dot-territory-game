import { db, transaction } from '../db/db.js';
import { units } from '../data.js';
import { getCharacter } from './characterService.js';
import { GameError, settle } from './territoryService.js';

export const ADMIN_ACTIONS = [
  'resources',
  'speedup',
  'finishAll',
  'setLevel',
  'fillTroops',
  'resetDaily',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

const TEN_YEARS_SEC = 10 * 365 * 86_400;
const BIG = 999_999_999;

export function isAdmin(userId: number): boolean {
  const r = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as
    { is_admin: number | null } | undefined;
  return !!r?.is_admin;
}

/** 테스트 전용 관리자 도구. users.is_admin = 1 인 계정만 호출할 수 있다 (route 에서 확인). */
export function adminAction(
  userId: number,
  serverId: number,
  characterId: number,
  action: AdminAction,
  value: number,
): { ok: true } {
  if (action === 'fillTroops') {
    settle(characterId);
    const ch = getCharacter(userId, serverId);
    if (!ch) throw new GameError('NO_CHARACTER');
    const room = ch.maxTroops - ch.totalTroops;
    const best = units.units
      .filter((u) => u.race === ch.race && u.requiredTerritoryLevel <= ch.territoryLevel)
      .sort((a, b) => b.tier - a.tier)[0];
    if (room > 0 && best)
      db.prepare(
        `INSERT INTO unit_stock (character_id, unit_id, count) VALUES (?,?,?)
         ON CONFLICT(character_id, unit_id) DO UPDATE SET count = count + excluded.count`,
      ).run(characterId, best.id, room);
    return { ok: true };
  }
  const now = Date.now();
  transaction(() => {
    switch (action) {
      case 'resources': {
        const v = Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), BIG) : BIG;
        db.prepare(
          'UPDATE resources SET food = ?, wood = ?, stone = ?, iron = ?, gold = ?, updated_at = ? WHERE character_id = ?',
        ).run(v, v, v, v, v, now, characterId);
        break;
      }
      case 'speedup':
        db.prepare('UPDATE characters SET speedup_sec = ? WHERE id = ?').run(
          TEN_YEARS_SEC,
          characterId,
        );
        break;
      case 'finishAll': {
        // 모든 진행 중 타이머를 지금으로 당긴다 (이후 정산이 완료 처리)
        const t = now - 1;
        db.prepare(
          'UPDATE characters SET upgrade_finish_at = ? WHERE id = ? AND upgrade_finish_at > ?',
        ).run(t, characterId, now);
        db.prepare(
          'UPDATE buildings SET upgrade_finish_at = ? WHERE character_id = ? AND upgrade_finish_at > ?',
        ).run(t, characterId, now);
        db.prepare(
          'UPDATE buildings SET levelup_finish_at = ? WHERE character_id = ? AND levelup_finish_at > ?',
        ).run(t, characterId, now);
        for (const tbl of ['train_queue', 'craft_queue', 'expeditions'])
          db.prepare(
            `UPDATE ${tbl} SET finish_at = ? WHERE character_id = ? AND collected = 0 AND finish_at > ?`,
          ).run(t, characterId, now);
        db.prepare(
          'UPDATE research_job SET finish_at = ? WHERE character_id = ? AND finish_at > ?',
        ).run(t, characterId, now);
        break;
      }
      case 'setLevel': {
        const lv = Math.floor(value);
        if (!(lv >= 1 && lv <= 10)) throw new GameError('INVALID_AMOUNT');
        db.prepare(
          'UPDATE characters SET territory_level = ?, upgrade_to = NULL, upgrade_finish_at = NULL WHERE id = ?',
        ).run(lv, characterId);
        break;
      }
      case 'resetDaily': {
        db.prepare('UPDATE dungeon_progress SET entries_used = 0 WHERE character_id = ?').run(
          characterId,
        );
        db.prepare('UPDATE guild_boss_part SET day_attacks = 0 WHERE character_id = ?').run(
          characterId,
        );
        db.prepare('DELETE FROM market_daily WHERE character_id = ?').run(characterId);
        db.prepare('DELETE FROM guild_donations WHERE character_id = ?').run(characterId);
        db.prepare(
          'UPDATE characters SET last_attack_at = NULL, protection_until = NULL WHERE id = ?',
        ).run(characterId);
        break;
      }
    }
  });
  if (action === 'finishAll' || action === 'setLevel') settle(characterId, Date.now());
  return { ok: true };
}
