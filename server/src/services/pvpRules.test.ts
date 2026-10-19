import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcPlunder, isInCpRange, protectionEnd } from './pvpRules.js';

const CFG = { cpRangeMin: 0.5, cpRangeMax: 1.5, plunderRatio: 0.1 };

describe('pvp rules', () => {
  it('전투력 범위는 내 전투력의 50%~150% 이다 (경계 포함)', () => {
    assert.equal(isInCpRange(1000, 500, CFG), true);
    assert.equal(isInCpRange(1000, 1500, CFG), true);
    assert.equal(isInCpRange(1000, 499, CFG), false);
    assert.equal(isInCpRange(1000, 1501, CFG), false);
    assert.equal(isInCpRange(0, 0, CFG), false);
  });

  it('약탈은 보호량을 제외한 보유량의 10% (내림) 이다', () => {
    const r = calcPlunder({ food: 2500, wood: 500, stone: 400, iron: 1234, gold: 0 }, 500, 0.1);
    assert.deepEqual(r, { food: 200, iron: 73 }); // 보호량 이하는 약탈 불가
  });

  it('보호 기간: 명시값이 없으면 생성 + 24시간, 있으면 그 값', () => {
    assert.equal(protectionEnd(1000, null, 24), 1000 + 24 * 3_600_000);
    assert.equal(protectionEnd(1000, 5000, 24), 5000);
  });
});
