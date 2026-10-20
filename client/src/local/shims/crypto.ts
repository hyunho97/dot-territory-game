/** 브라우저용 `node:crypto` 대체. 혼자 하는 판에는 비밀번호가 없으므로 해시 함수는 형식만 맞춘다. */
export class Bytes extends Uint8Array {
  toString(encoding?: string): string {
    if (encoding === 'hex')
      return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    return Array.from(this, (b) => String.fromCharCode(b)).join('');
  }
}

export function randomBytes(n: number): Bytes {
  const b = new Bytes(n);
  crypto.getRandomValues(b);
  return b;
}

export function scryptSync(password: string, salt: string, len: number): Bytes {
  // 보안용이 아님 (온라인 서버에서만 실제 scrypt 를 쓴다)
  const out = new Bytes(len);
  let h = 2166136261;
  const s = password + salt;
  for (let i = 0; i < len; i++) {
    h = Math.imul(h ^ s.charCodeAt(i % Math.max(1, s.length)), 16777619) >>> 0;
    out[i] = h & 0xff;
  }
  return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
