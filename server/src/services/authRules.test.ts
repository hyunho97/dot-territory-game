import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FailLimiter,
  hashPassword,
  normalizeLoginId,
  validPassword,
  verifyPassword,
} from './authRules.js';

describe('auth rules', () => {
  it('로그인 ID 는 소문자로 정규화되고 형식을 검사한다', () => {
    assert.equal(normalizeLoginId('  Hero_01 '), 'hero_01');
    assert.equal(normalizeLoginId('ab'), null);
    assert.equal(normalizeLoginId('한글아이디'), null);
    assert.equal(normalizeLoginId('has space'), null);
    assert.equal(normalizeLoginId(123), null);
  });

  it('비밀번호 길이 검사', () => {
    assert.equal(validPassword('1234567'), false);
    assert.equal(validPassword('12345678'), true);
    assert.equal(validPassword('x'.repeat(65)), false);
    assert.equal(validPassword(12345678), false);
  });

  it('해시는 솔트마다 다르고 올바른 비밀번호만 통과한다', () => {
    const a = hashPassword('correct horse');
    const b = hashPassword('correct horse');
    assert.notEqual(a.hash, b.hash);
    assert.equal(verifyPassword('correct horse', a.salt, a.hash), true);
    assert.equal(verifyPassword('wrong horse', a.salt, a.hash), false);
  });

  it('실패 5회 후 차단되고 시간이 지나면 풀린다', () => {
    const l = new FailLimiter(5, 1000);
    for (let i = 0; i < 5; i++) l.fail('k', 100);
    assert.equal(l.blocked('k', 200), true);
    assert.equal(l.blocked('other', 200), false);
    assert.equal(l.blocked('k', 1200), false);
    l.fail('k', 1300);
    l.reset('k');
    assert.equal(l.blocked('k', 1301), false);
  });
});
