import { db, transaction } from '../db/db.js';
import { questsData } from '../data.js';
import type { QuestDef } from '../data.js';
import { grantRandomEquipment, inventoryFull } from './equipmentGrant.js';
import type { GrantedItem } from './equipmentGrant.js';
import { dayKey, nextResetAt } from './questEvents.js';
import { addSpeedup } from './speedupGrant.js';
import { GameError, characterStorageCap, settle } from './territoryService.js';

interface CharInfo {
  race: string;
  territory_level: number;
  attendance_day: number | null;
  attendance_streak: number | null;
}

function charInfo(characterId: number): CharInfo {
  return db
    .prepare(
      'SELECT race, territory_level, attendance_day, attendance_streak FROM characters WHERE id = ?',
    )
    .get(characterId) as unknown as CharInfo;
}

function scaleReward(reward: Record<string, number>, scale: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(reward).map(([k, v]) => [
      k,
      k === 'equipment' || k === 'speedup' ? v : Math.floor(v * scale),
    ]),
  );
}
const levelScale = (level: number): number => 1 + questsData.rewardScalePerLevel * (level - 1);

function progressRows(characterId: number, period: string) {
  const rows = db
    .prepare(
      'SELECT quest_id, progress, claimed FROM quest_progress WHERE character_id = ? AND period = ?',
    )
    .all(characterId, period) as unknown as {
    quest_id: string;
    progress: number;
    claimed: number;
  }[];
  return new Map(rows.map((r) => [r.quest_id, r]));
}

function view(q: QuestDef, rows: ReturnType<typeof progressRows>, level: number, scale: number) {
  const row = rows.get(q.id);
  const progress = q.goal.state === 'territoryLevel' ? level : (row?.progress ?? 0);
  return {
    id: q.id,
    count: q.goal.count,
    progress: Math.min(progress, q.goal.count),
    claimed: row?.claimed === 1,
    reward: scaleReward(q.reward, scale),
  };
}

export function getQuests(characterId: number) {
  const now = Date.now();
  const ch = charInfo(characterId);
  const day = dayKey(now);
  const dailyRows = progressRows(characterId, String(day));
  const tutorialRows = progressRows(characterId, 'tutorial');
  const scale = levelScale(ch.territory_level);
  const daily = questsData.daily.map((q) => view(q, dailyRows, ch.territory_level, scale));
  const bonusClaimed = dailyRows.get('daily_bonus')?.claimed === 1;
  const streak =
    ch.attendance_day === day || ch.attendance_day === day - 1 ? (ch.attendance_streak ?? 0) : 0;
  const claimedToday = ch.attendance_day === day;
  const nextDay = (streak % questsData.attendance.length) + 1;
  return {
    serverNow: now,
    resetAt: nextResetAt(now),
    tutorial: questsData.tutorial.map((q) => view(q, tutorialRows, ch.territory_level, 1)),
    daily,
    dailyBonus: {
      complete: daily.every((d) => d.progress >= d.count),
      claimed: bonusClaimed,
      reward: questsData.dailyBonus.reward,
    },
    attendance: {
      streak,
      claimedToday,
      canClaim: !claimedToday,
      nextDay,
      rewards: questsData.attendance,
    },
  };
}

export interface GrantSummary {
  resources: Record<string, number>;
  equipment: GrantedItem | null;
  /** 지급된 가속 시간(분) */
  speedupMin: number;
}

/** 보상 지급: 자원은 창고 상한까지만(초과분 버림), 장비는 인벤토리가 가득 차면 호출 전에 막는다. */
function grant(characterId: number, race: string, reward: Record<string, number>): GrantSummary {
  const resources: Record<string, number> = {};
  const cap = characterStorageCap(characterId);
  const res = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  for (const [k, v] of Object.entries(reward)) {
    if (k === 'equipment') continue;
    if (k === 'speedup') {
      addSpeedup(characterId, v * 60);
      continue;
    }
    const next = Math.max(res[k], Math.min(cap, res[k] + v));
    resources[k] = Math.floor(next - res[k]);
    db.prepare(`UPDATE resources SET ${k} = ? WHERE character_id = ?`).run(next, characterId);
  }
  let equipment: GrantedItem | null = null;
  for (let i = 0; i < (reward.equipment ?? 0); i++)
    equipment = grantRandomEquipment(characterId, race);
  return { resources, equipment, speedupMin: reward.speedup ?? 0 };
}

function needsInventory(reward: Record<string, number>): boolean {
  return (reward.equipment ?? 0) > 0;
}

export function claimQuest(characterId: number, questId: string): GrantSummary {
  settle(characterId);
  const ch = charInfo(characterId);
  const day = String(dayKey());
  const dailyRows = progressRows(characterId, day);
  const tutorialRows = progressRows(characterId, 'tutorial');

  let period = day;
  let reward: Record<string, number>;
  if (questId === 'daily_bonus') {
    const all = questsData.daily.every((q) => {
      const v = view(q, dailyRows, ch.territory_level, 1);
      return v.progress >= v.count && v.claimed;
    });
    if (!all) throw new GameError('QUEST_NOT_COMPLETE');
    reward = questsData.dailyBonus.reward;
  } else {
    const isDaily = questsData.daily.some((q) => q.id === questId);
    const def = [...questsData.daily, ...questsData.tutorial].find((q) => q.id === questId);
    if (!def) throw new GameError('QUEST_NOT_FOUND', 404);
    period = isDaily ? day : 'tutorial';
    const v = view(def, isDaily ? dailyRows : tutorialRows, ch.territory_level, 1);
    if (v.progress < v.count) throw new GameError('QUEST_NOT_COMPLETE');
    reward = isDaily ? scaleReward(def.reward, levelScale(ch.territory_level)) : def.reward;
  }
  const existing = (period === day ? dailyRows : tutorialRows).get(questId);
  if (existing?.claimed === 1) throw new GameError('QUEST_ALREADY_CLAIMED');
  if (needsInventory(reward) && inventoryFull(characterId)) throw new GameError('INVENTORY_FULL');

  return transaction(() => {
    db.prepare(
      `INSERT INTO quest_progress (character_id, quest_id, period, progress, claimed) VALUES (?,?,?,0,1)
       ON CONFLICT(character_id, quest_id, period) DO UPDATE SET claimed = 1`,
    ).run(characterId, questId, period);
    return grant(characterId, ch.race, reward);
  });
}

/** 출석: 하루 1회, 연속 접속 일수에 따라 7일 주기 보상 */
export function claimAttendance(characterId: number): GrantSummary & { day: number } {
  settle(characterId);
  const ch = charInfo(characterId);
  const today = dayKey();
  if (ch.attendance_day === today) throw new GameError('ALREADY_CLAIMED_TODAY');
  const streak = ch.attendance_day === today - 1 ? (ch.attendance_streak ?? 0) + 1 : 1;
  const entry = questsData.attendance[(streak - 1) % questsData.attendance.length];
  if (needsInventory(entry.reward) && inventoryFull(characterId))
    throw new GameError('INVENTORY_FULL');
  return transaction(() => {
    db.prepare('UPDATE characters SET attendance_day = ?, attendance_streak = ? WHERE id = ?').run(
      today,
      streak,
      characterId,
    );
    return { ...grant(characterId, ch.race, entry.reward), day: entry.day };
  });
}
