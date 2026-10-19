import { db } from '../db/db.js';

/** 가속(초) 지급 — 리프 모듈(다른 서비스에서 순환 import 없이 사용) */
export function addSpeedup(characterId: number, sec: number): void {
  db.prepare('UPDATE characters SET speedup_sec = COALESCE(speedup_sec, 0) + ? WHERE id = ?').run(
    sec,
    characterId,
  );
}
