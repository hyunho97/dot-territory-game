import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRng } from './battle.js';
import {
  bossHp,
  bossLosses,
  rollDamage,
  scaleReward,
  tierFor,
  ticketsLeft,
} from './guildBossRules.js';

describe('guild boss rules', () => {
  it('길드 레벨에 따라 보스 등급이 올라간다', () => {
    assert.equal(tierFor(1).id, 'troll');
    assert.equal(tierFor(3).id, 'troll');
    assert.equal(tierFor(4).id, 'giant');
    assert.equal(tierFor(10).id, 'dragon');
  });

  it('체력은 멤버 전투력 합 × 배수, 하한 보장', () => {
    const troll = tierFor(1);
    assert.equal(bossHp(100000, troll), 300000);
    assert.equal(bossHp(10, troll), troll.hpFloor);
  });

  it('피해는 전투력의 85%~115% 범위', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const d = rollDamage(1000, rng);
      assert.ok(d >= 850 && d <= 1150, `damage ${d}`);
    }
  });

  it('반격 손실은 종류마다 올림하고 수량을 넘지 않는다', () => {
    assert.deepEqual(
      bossLosses([
        { unitId: 'a', count: 25 },
        { unitId: 'b', count: 1 },
      ]),
      [
        { unitId: 'a', count: 2 },
        { unitId: 'b', count: 1 },
      ],
    );
    assert.deepEqual(bossLosses([{ unitId: 'a', count: 0 }]), []);
  });

  it('실패 보상 축소와 남은 공격 횟수', () => {
    assert.deepEqual(scaleReward({ gold: 1000, iron: 5 }, 0.3), { gold: 300, iron: 1 });
    assert.equal(ticketsLeft(0), 2);
    assert.equal(ticketsLeft(2), 0);
    assert.equal(ticketsLeft(5), 0);
  });
});
