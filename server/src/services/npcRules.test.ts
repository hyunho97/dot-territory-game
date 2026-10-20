import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { armyPlan, cumulativeDaysTo, levelAtAge, npcSpeed, virtualAgeDays } from './npcRules.js';

describe('npcRules', () => {
  it('나이에 따라 영지 레벨이 오르고 Lv.10 은 약 1년', () => {
    assert.equal(levelAtAge(0), 1);
    assert.equal(levelAtAge(0.1), 3); // 1분 + 30분 ≈ 0.02일
    assert.ok(levelAtAge(3) >= 4);
    const lv10 = cumulativeDaysTo(10);
    assert.ok(lv10 > 300 && lv10 < 420);
    assert.equal(levelAtAge(lv10 + 1), 10);
    assert.equal(levelAtAge(lv10 - 5), 9);
  });

  it('성장 속도는 0.6~1.4 범위', () => {
    for (let id = 1; id < 300; id++) {
      const s = npcSpeed(id);
      assert.ok(s >= 0.6 && s <= 1.4);
    }
  });

  it('가상 나이는 시작 나이에 경과일×속도를 더한다', () => {
    const day = 86_400_000;
    assert.equal(virtualAgeDays(0, 2 * day, 1.5, 10), 13);
    assert.equal(virtualAgeDays(5 * day, 0, 1, 0), 0); // 미래면 0
  });

  it('병력 구성: 합계가 정확하고 상위 두 티어로 나뉜다', () => {
    const pool = [
      { id: 'a', tier: 1 },
      { id: 'b', tier: 2 },
      { id: 'c', tier: 2 },
      { id: 'd', tier: 3 },
    ];
    const plan = armyPlan(pool, 100);
    assert.equal(
      plan.reduce((s, p) => s + p.count, 0),
      100,
    );
    assert.deepEqual(plan.map((p) => p.unitId).sort(), ['b', 'c', 'd']);
    assert.equal(armyPlan([], 10).length, 0);
  });
});
