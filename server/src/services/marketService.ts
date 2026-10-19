import { db, transaction } from '../db/db.js';
import { marketData } from '../data.js';
import { dayKey } from './questEvents.js';
import { GameError, characterStorageCap, settle } from './territoryService.js';

const RES = ['food', 'wood', 'stone', 'iron', 'gold'] as const;
type Res = (typeof RES)[number];

/** 교역소 레벨 -> 수수료 (레벨이 오를수록 낮아지며 minFee 아래로는 내려가지 않음) */
export function feeForLevel(level: number): number {
  return Math.max(marketData.minFee, marketData.baseFee - marketData.feePerLevel * (level - 1));
}

/** 환전 결과(수수료 포함, 정수 내림) */
export function exchangeOut(from: Res, to: Res, amount: number, fee: number): number {
  return Math.floor(((amount * marketData.values[from]) / marketData.values[to]) * (1 - fee));
}

function marketLevel(characterId: number, now: number): number {
  const row = db
    .prepare(
      "SELECT MAX(level) AS lv FROM buildings WHERE character_id = ? AND type = 'market' AND (upgrade_finish_at IS NULL OR upgrade_finish_at <= ?)",
    )
    .get(characterId, now) as { lv: number | null };
  return row.lv ?? 0;
}

function usedToday(characterId: number): number {
  const row = db
    .prepare('SELECT volume FROM market_daily WHERE character_id = ? AND day = ?')
    .get(characterId, dayKey()) as { volume: number } | undefined;
  return row?.volume ?? 0;
}

export function marketState(characterId: number) {
  settle(characterId);
  const now = Date.now();
  const level = marketLevel(characterId, now);
  return {
    serverNow: now,
    hasMarket: level > 0,
    level,
    fee: level > 0 ? feeForLevel(level) : marketData.baseFee,
    dailyLimit: marketData.dailyVolumePerLevel * level,
    usedToday: Math.round(usedToday(characterId)),
    values: marketData.values,
  };
}

/** 환전: 교역소 필요. 수수료와 하루 거래 한도(가치 합계 기준)를 서버가 적용한다. */
export function exchange(characterId: number, from: string, to: string, amount: number) {
  settle(characterId);
  const now = Date.now();
  const level = marketLevel(characterId, now);
  if (level < 1) throw new GameError('NO_MARKET');
  if (!RES.includes(from as Res) || !RES.includes(to as Res) || from === to)
    throw new GameError('INVALID_EXCHANGE');
  if (!Number.isInteger(amount) || amount < 1) throw new GameError('INVALID_AMOUNT');

  const volume = amount * marketData.values[from as Res];
  const limit = marketData.dailyVolumePerLevel * level;
  if (usedToday(characterId) + volume > limit) throw new GameError('MARKET_LIMIT');

  const res = db
    .prepare('SELECT food, wood, stone, iron, gold FROM resources WHERE character_id = ?')
    .get(characterId) as Record<string, number>;
  if (res[from] < amount) throw new GameError('NOT_ENOUGH_RESOURCES');
  const out = exchangeOut(from as Res, to as Res, amount, feeForLevel(level));
  if (out < 1) throw new GameError('INVALID_AMOUNT');
  const cap = characterStorageCap(characterId, now);
  const gained = Math.max(0, Math.min(out, Math.floor(cap - res[to]))); // 상한 초과분은 버림
  if (gained < 1) throw new GameError('STORAGE_FULL');

  transaction(() => {
    db.prepare(`UPDATE resources SET ${from} = ${from} - ? WHERE character_id = ?`).run(
      amount,
      characterId,
    );
    db.prepare(`UPDATE resources SET ${to} = ${to} + ? WHERE character_id = ?`).run(
      gained,
      characterId,
    );
    db.prepare(
      'INSERT INTO market_daily (character_id, day, volume) VALUES (?,?,?) ON CONFLICT(character_id, day) DO UPDATE SET volume = volume + excluded.volume',
    ).run(characterId, dayKey(), volume);
  });
  return { spent: amount, got: gained, lostToCap: out - gained };
}
