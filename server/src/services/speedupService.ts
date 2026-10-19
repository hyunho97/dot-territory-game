import { db, transaction } from '../db/db.js';
import { GameError, settle } from './territoryService.js';

export type SpeedupTarget = 'levelup' | 'building' | 'research';

export function speedupBalance(characterId: number): number {
  const r = db.prepare('SELECT speedup_sec FROM characters WHERE id = ?').get(characterId) as {
    speedup_sec: number | null;
  };
  return r.speedup_sec ?? 0;
}

/**
 * 가속 아이템(초 단위 보유량)으로 진행 중인 타이머를 단축한다. 남은 시간 이상 쓰면 즉시 완료되며 남은 시간만큼만 소모한다.
 * 대상: 영지 레벨업 / 건물(신축·업그레이드) / 연구
 */
export function useSpeedup(
  characterId: number,
  target: SpeedupTarget,
  seconds: number,
  buildingId?: number,
): { used: number; remaining: number } {
  settle(characterId);
  const want = Math.floor(seconds);
  if (!Number.isFinite(want) || want <= 0) throw new GameError('INVALID_AMOUNT');
  const balance = speedupBalance(characterId);
  if (balance <= 0) throw new GameError('NO_SPEEDUP');
  const now = Date.now();

  // 대상 타이머의 (읽기, 쓰기) 를 한 쌍으로 구한다
  let finish: number | null = null;
  let write: (v: number) => void = () => undefined;
  if (target === 'levelup') {
    const r = db
      .prepare('SELECT upgrade_finish_at AS f FROM characters WHERE id = ?')
      .get(characterId) as { f: number | null };
    finish = r.f;
    write = (v) =>
      void db
        .prepare('UPDATE characters SET upgrade_finish_at = ? WHERE id = ?')
        .run(v, characterId);
  } else if (target === 'research') {
    const r = db
      .prepare('SELECT finish_at AS f FROM research_job WHERE character_id = ?')
      .get(characterId) as { f: number } | undefined;
    finish = r?.f ?? null;
    write = (v) =>
      void db
        .prepare('UPDATE research_job SET finish_at = ? WHERE character_id = ?')
        .run(v, characterId);
  } else if (target === 'building') {
    const bid = Number.isFinite(buildingId) ? (buildingId as number) : -1;
    const b = db
      .prepare(
        'SELECT upgrade_finish_at AS up, levelup_to AS lt, levelup_finish_at AS lf FROM buildings WHERE id = ? AND character_id = ?',
      )
      .get(bid, characterId) as
      { up: number | null; lt: number | null; lf: number | null } | undefined;
    if (!b) throw new GameError('BUILDING_NOT_FOUND', 404);
    // 신축 중이면 신축 타이머, 아니면 업그레이드 타이머
    if (b.up !== null && b.up > now) {
      finish = b.up;
      write = (v) =>
        void db.prepare('UPDATE buildings SET upgrade_finish_at = ? WHERE id = ?').run(v, bid);
    } else if (b.lt !== null && b.lf !== null) {
      finish = b.lf;
      write = (v) =>
        void db.prepare('UPDATE buildings SET levelup_finish_at = ? WHERE id = ?').run(v, bid);
    }
  }
  if (finish === null || finish <= now) throw new GameError('NOTHING_TO_SPEEDUP');

  const remainSec = Math.ceil((finish - now) / 1000);
  const used = Math.min(want, balance, remainSec);
  transaction(() => {
    write(used >= remainSec ? now : finish - used * 1000);
    db.prepare('UPDATE characters SET speedup_sec = speedup_sec - ? WHERE id = ?').run(
      used,
      characterId,
    );
  });
  settle(characterId);
  return { used, remaining: remainSec - used };
}
