import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** 로그인 ID: 영문 소문자/숫자/밑줄 4~20자 (대소문자 구분 없이 소문자로 저장) */
export const LOGIN_ID_RE = /^[a-z0-9_]{4,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

export function normalizeLoginId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toLowerCase();
  return LOGIN_ID_RE.test(id) ? id : null;
}

export function validPassword(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= PASSWORD_MIN && raw.length <= PASSWORD_MAX;
}

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const a = scryptSync(password, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 로그인 실패 제한: 같은 (ID + IP) 로 windowMs 안에 maxFails 번 실패하면 잠시 차단 (메모리 기반) */
export class FailLimiter {
  private fails = new Map<string, number[]>();
  constructor(
    private maxFails = 5,
    private windowMs = 10 * 60_000,
  ) {}
  private recent(key: string, now: number): number[] {
    const list = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }
  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.maxFails;
  }
  fail(key: string, now = Date.now()): void {
    this.fails.set(key, [...this.recent(key, now), now]);
  }
  reset(key: string): void {
    this.fails.delete(key);
  }
}
