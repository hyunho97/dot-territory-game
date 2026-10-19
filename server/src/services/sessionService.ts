import { db } from '../db/db.js';
import { gameConfig } from '../data.js';
import { settle } from './territoryService.js';

const RES = ['food', 'wood', 'stone', 'iron', 'gold'] as const;

function currentResources(characterId: number): Record<string, number> {
  const r = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  return Object.fromEntries(RES.map((k) => [k, Math.floor(r[k])]));
}

/** 접속 중임을 기록: 마지막 접속 시각과 그 시점의 자원 스냅샷 */
export function touchSeen(characterId: number, now = Date.now()): void {
  db.prepare('UPDATE characters SET last_seen_at = ?, seen_res = ? WHERE id = ?').run(
    now,
    JSON.stringify(currentResources(characterId)),
    characterId,
  );
}

export interface OfflineReport {
  awaySec: number;
  resourceDelta: Record<string, number>;
  events: { key: string; params: Record<string, unknown>; at: number }[];
}

/**
 * 영지 입장: 마지막 접속 이후 자리 비운 동안 일어난 일(자원 증감, 완료/습격 이벤트)을 요약한다.
 * 자리를 비운 시간이 짧거나 첫 접속이면 null.
 */
export function enterSession(characterId: number): OfflineReport | null {
  const now = Date.now();
  settle(characterId, now);
  const ch = db
    .prepare('SELECT last_seen_at, seen_res FROM characters WHERE id = ?')
    .get(characterId) as { last_seen_at: number | null; seen_res: string | null };
  let report: OfflineReport | null = null;
  if (ch.last_seen_at && now - ch.last_seen_at >= gameConfig.offlineReportMinSec * 1000) {
    const before = ch.seen_res ? (JSON.parse(ch.seen_res) as Record<string, number>) : {};
    const after = currentResources(characterId);
    const delta = Object.fromEntries(RES.map((k) => [k, after[k] - (before[k] ?? after[k])]));
    const events = (
      db
        .prepare(
          'SELECT key, params, created_at AS at FROM events WHERE character_id = ? AND created_at > ? ORDER BY id LIMIT 200',
        )
        .all(characterId, ch.last_seen_at) as unknown as {
        key: string;
        params: string;
        at: number;
      }[]
    ).map((e) => ({
      key: e.key,
      params: JSON.parse(e.params) as Record<string, unknown>,
      at: e.at,
    }));
    const hasDelta = Object.values(delta).some((v) => v !== 0);
    if (hasDelta || events.length > 0) {
      report = {
        awaySec: Math.round((now - ch.last_seen_at) / 1000),
        resourceDelta: delta,
        events,
      };
    }
  }
  touchSeen(characterId, now);
  return report;
}
