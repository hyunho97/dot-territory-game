import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { floorEnemyCP, floorEnemyUnitId, floorReward, milestoneRewards } from './dungeonRules.js';

describe('dungeon rules', () => {
  it('적 전투력은 층마다 증가한다', () => {
    assert.equal(Math.round(floorEnemyCP(1)), 50);
    assert.ok(floorEnemyCP(10) > floorEnemyCP(9));
    assert.ok(floorEnemyCP(50) > floorEnemyCP(30) * 5);
  });

  it('층 구간별 적 유닛', () => {
    assert.equal(floorEnemyUnitId(1), 'undead_skeleton');
    assert.equal(floorEnemyUnitId(6), 'orc_grunt');
    assert.equal(floorEnemyUnitId(50), 'human_dragon');
  });

  it('보상은 층과 영지 레벨에 따라 커진다', () => {
    assert.ok(floorReward(10, 3).gold > floorReward(1, 3).gold);
    assert.ok(floorReward(5, 10).gold > floorReward(5, 3).gold);
  });

  it('마일스톤은 처음 도달한 층에서만 한 번 계산된다', () => {
    assert.deepEqual(milestoneRewards(0, 4), { speedupMin: 0, equipment: 0 });
    assert.deepEqual(milestoneRewards(0, 5), { speedupMin: 15, equipment: 0 });
    assert.deepEqual(milestoneRewards(0, 10), { speedupMin: 15 + 30, equipment: 1 });
    assert.deepEqual(milestoneRewards(10, 10), { speedupMin: 0, equipment: 0 });
    assert.deepEqual(milestoneRewards(7, 12), { speedupMin: 30, equipment: 1 });
  });
});
