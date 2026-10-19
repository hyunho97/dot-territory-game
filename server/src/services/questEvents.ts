import { db } from '../db/db.js';
import { questsData } from '../data.js';
import type { QuestDef } from '../data.js';

/** 하위 모듈: 서비스/라우트가 게임 이벤트를 기록하는 진입점 (퀘스트 진행도 갱신) */

export type EventType =
  | 'build'
  | 'upgrade'
  | 'train'
  | 'expedition'
  | 'pveWin'
  | 'pvpAttack'
  | 'craft'
  | 'equip'
  | 'exchange'
  | 'research';

/** 일일 퀘스트 기준일 키 (data/quests.json 의 dayOffsetHours 시간대의 자정에 갱신) */
export function dayKey(now = Date.now()): number {
  return Math.floor((now + questsData.dayOffsetHours * 3_600_000) / 86_400_000);
}
export function nextResetAt(now = Date.now()): number {
  return (dayKey(now) + 1) * 86_400_000 - questsData.dayOffsetHours * 3_600_000;
}

function matches(q: QuestDef, type: EventType, detail?: string): boolean {
  const g = q.goal;
  if (!g.types || !g.types.includes(type)) return false;
  return !g.detail || g.detail === detail;
}

const UPSERT = `INSERT INTO quest_progress (character_id, quest_id, period, progress, claimed)
  VALUES (?, ?, ?, ?, 0)
  ON CONFLICT(character_id, quest_id, period) DO UPDATE SET progress = progress + excluded.progress`;

export function recordEvent(
  characterId: number,
  type: EventType,
  amount = 1,
  detail?: string,
): void {
  const stmt = db.prepare(UPSERT);
  const day = String(dayKey());
  for (const q of questsData.daily)
    if (matches(q, type, detail)) stmt.run(characterId, q.id, day, amount);
  for (const q of questsData.tutorial)
    if (matches(q, type, detail)) stmt.run(characterId, q.id, 'tutorial', amount);
}
