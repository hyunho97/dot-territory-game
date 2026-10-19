import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRng } from './battle.js';
import { rollExpeditionEvent } from './exploreEvents.js';

describe('expedition events', () => {
  it('이벤트 확률 밖이면 아무 일도 일어나지 않는다', () => {
    const r = rollExpeditionEvent(3, () => 0.99);
    assert.equal(r.key, null);
    assert.equal(r.yieldMult, 1);
    assert.equal(r.troopLossRatio, 0);
  });

  it('같은 시드는 같은 결과를 낸다', () => {
    assert.deepEqual(rollExpeditionEvent(5, createRng(7)), rollExpeditionEvent(5, createRng(7)));
  });

  it('큰 표본에서 이벤트 발생률은 설정값(35%) 근처이고 모든 이벤트가 나온다', () => {
    const rng = createRng(123);
    const counts: Record<string, number> = {};
    const N = 20000;
    let any = 0;
    for (let i = 0; i < N; i++) {
      const r = rollExpeditionEvent(5, rng);
      if (r.key) {
        any++;
        counts[r.key] = (counts[r.key] ?? 0) + 1;
      }
    }
    assert.ok(Math.abs(any / N - 0.35) < 0.02, `rate ${any / N}`);
    for (const id of ['bonus_cache', 'treasure', 'equipment_find', 'speedup_find', 'ambush'])
      assert.ok((counts[id] ?? 0) > 0, `${id} never happened`);
    // 가중치 3:2:1:1:3 -> 매복/추가수확이 장비 발견보다 훨씬 자주
    assert.ok(counts.ambush > counts.equipment_find * 2);
  });

  it('매복은 병력 손실 비율(10~30%)과 수확 감소를, 보물은 영지 레벨에 비례한 금을 준다', () => {
    const rngAmbush = (() => {
      const seq = [0, 0.99 /* 마지막 구간 = ambush */, 0.5];
      let i = 0;
      return () => seq[Math.min(i++, seq.length - 1)];
    })();
    const amb = rollExpeditionEvent(4, rngAmbush);
    assert.equal(amb.key, 'ambush');
    assert.ok(amb.troopLossRatio >= 0.1 && amb.troopLossRatio <= 0.3);
    assert.equal(amb.yieldMult, 0.5);

    const rngTreasure = (() => {
      const seq = [0, 0.4 /* bonus_cache(3) 다음 treasure(2) 구간 */];
      let i = 0;
      return () => seq[Math.min(i++, seq.length - 1)];
    })();
    const tr = rollExpeditionEvent(5, rngTreasure);
    assert.equal(tr.key, 'treasure');
    assert.equal(tr.bonusGold, 60 + 40 * 5);
  });

  it('가속 발견은 5~15분의 가속을 준다', () => {
    for (let seed = 1; seed < 3000; seed++) {
      const r = rollExpeditionEvent(3, createRng(seed));
      if (r.key === 'speedup_find') {
        assert.ok(r.speedupMin >= 5 && r.speedupMin <= 15);
        return;
      }
      assert.equal(r.speedupMin, 0);
    }
    assert.fail('speedup_find never rolled');
  });
});
