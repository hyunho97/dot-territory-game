import { db } from '../db/db.js';
import { fullArmy } from './pvpService.js';

export type RankType = 'cp' | 'level';

/** 같은 서버 영주 랭킹: 전투력 또는 영지 레벨(동률은 전투력). 상위 limit + 내 순위. */
export function ranking(characterId: number, type: RankType, limit = 20) {
  const me = db.prepare('SELECT server_id FROM characters WHERE id = ?').get(characterId) as {
    server_id: number;
  };
  const rows = db
    .prepare(
      'SELECT c.id, c.territory_name AS name, c.race, c.territory_level AS level, u.nickname AS owner FROM characters c JOIN users u ON u.id = c.user_id WHERE c.server_id = ?',
    )
    .all(me.server_id) as unknown as {
    id: number;
    name: string;
    race: string;
    level: number;
    owner: string;
  }[];
  const scored = rows.map((r) => {
    const cp = fullArmy(r.id, r.race).reduce((s, u) => s + u.cp * u.count, 0);
    return { ...r, cp: Math.round(cp * 10) / 10 };
  });
  scored.sort((a, b) =>
    type === 'cp' ? b.cp - a.cp || b.level - a.level : b.level - a.level || b.cp - a.cp,
  );
  const ranked = scored.map((r, i) => ({ rank: i + 1, ...r, isMe: r.id === characterId }));
  return {
    type,
    total: ranked.length,
    top: ranked.slice(0, limit),
    me: ranked.find((r) => r.isMe) ?? null,
  };
}
