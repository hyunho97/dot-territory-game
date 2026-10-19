import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRng } from './battle.js';
import { gradeWeights, rollGrade, rollPower } from './equipmentRoll.js';

const share = (race: string, ids: string[]): number => {
  const w = gradeWeights(race);
  const total = w.reduce((s, x) => s + x.weight, 0);
  return w.filter((x) => ids.includes(x.id)).reduce((s, x) => s + x.weight, 0) / total;
};

describe('equipment roll', () => {
  it('인간은 기본 확률(60/25/10/4/1)을 그대로 쓴다', () => {
    const w = gradeWeights('human').map((x) => x.weight);
    assert.deepEqual(w, [60, 25, 10, 4, 1]);
  });

  it('드워프 > 엘프 > 인간 > 오크 순으로 희귀 이상 확률이 높다', () => {
    const high = ['rare', 'epic', 'legendary'];
    assert.ok(share('dwarf', high) > share('elf', high));
    assert.ok(share('elf', high) > share('human', high));
    assert.ok(share('human', high) > share('orc', high));
  });

  it('시드 난수로 재현 가능하고, 큰 표본에서 분포가 가중치와 비슷하다', () => {
    assert.equal(rollGrade('dwarf', createRng(9)), rollGrade('dwarf', createRng(9)));
    const rng = createRng(2024);
    let rareUp = 0;
    const N = 20000;
    for (let i = 0; i < N; i++)
      if (['rare', 'epic', 'legendary'].includes(rollGrade('human', rng))) rareUp++;
    assert.ok(Math.abs(rareUp / N - 0.15) < 0.02, `ratio ${rareUp / N}`);
  });

  it('장비 보정(%)은 등급이 높을수록 크고 드워프는 품질 보너스가 있다', () => {
    const rng = () => 0.5;
    assert.ok(rollPower('human', 'legendary', rng) > rollPower('human', 'common', rng));
    assert.ok(rollPower('dwarf', 'rare', rng) > rollPower('human', 'rare', rng));
  });
});
