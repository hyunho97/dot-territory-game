import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectivePower,
  enhanceChance,
  enhanceCost,
  fuseChance,
  nextGrade,
  promotedPower,
} from './equipmentRules.js';

describe('equipmentRules', () => {
  it('다음 등급과 최고 등급', () => {
    assert.equal(nextGrade('common'), 'uncommon');
    assert.equal(nextGrade('epic'), 'legendary');
    assert.equal(nextGrade('legendary'), null);
  });

  it('강화 수치가 전투력 보정에 반영된다', () => {
    assert.equal(effectivePower(10, 0), 10);
    assert.ok(effectivePower(10, 10) > effectivePower(10, 5));
    assert.ok(effectivePower(10, 5) > 10);
  });

  it('강화 확률은 단계가 오를수록 낮아지고 0~1 범위다', () => {
    let prev = 1;
    for (let l = 0; l < 10; l++) {
      const c = enhanceChance(l);
      assert.ok(c > 0 && c <= 1);
      assert.ok(c <= prev);
      prev = c;
    }
  });

  it('강화 비용은 단계/등급이 높을수록 비싸다', () => {
    const lo = enhanceCost('common', 0);
    const hi = enhanceCost('legendary', 9);
    for (const k of Object.keys(lo)) assert.ok(hi[k] > lo[k]);
  });

  it('승급 시 품질 비율이 유지된다', () => {
    // common 기본 2 → 편차 포함 2.3(1.15배) 이면 uncommon 기본 4 의 1.15배 = 4.6
    assert.equal(promotedPower(2.3, 'common', 'uncommon'), 4.6);
  });

  it('합성 확률은 낮고 최고 등급은 합성할 수 없다', () => {
    for (const g of ['common', 'uncommon', 'rare', 'epic']) {
      const c = fuseChance(g);
      assert.ok(c > 0 && c <= 0.2);
    }
    assert.equal(fuseChance('legendary'), 0);
  });
});
