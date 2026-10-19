import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  donationExp,
  guildBuff,
  guildLevel,
  maxMembers,
  nextLevelExp,
  validGuildName,
} from './guildRules.js';

describe('guild rules', () => {
  it('경험치로 길드 레벨 계산', () => {
    assert.equal(guildLevel(0), 1);
    assert.equal(guildLevel(2999), 1);
    assert.equal(guildLevel(3000), 2);
    assert.equal(guildLevel(320000), 10);
    assert.equal(guildLevel(9999999), 10);
    assert.equal(nextLevelExp(1), 3000);
    assert.equal(nextLevelExp(10), null);
  });

  it('레벨에 따라 정원과 버프가 증가한다 (레벨 1 버프는 0)', () => {
    assert.equal(maxMembers(1), 10);
    assert.equal(maxMembers(5), 18);
    assert.deepEqual(guildBuff(1), { production: 0, combat: 0 });
    assert.ok(guildBuff(10).production > guildBuff(2).production);
    assert.ok(Math.abs(guildBuff(10).production - 0.09) < 1e-9);
  });

  it('기부 경험치와 이름 검증', () => {
    assert.equal(donationExp(1000), 100);
    assert.equal(donationExp(5), 0);
    assert.equal(validGuildName('  용사단 '), '용사단');
    assert.equal(validGuildName('가'), null);
    assert.equal(validGuildName('가'.repeat(13)), null);
    assert.equal(validGuildName(7), null);
  });
});
