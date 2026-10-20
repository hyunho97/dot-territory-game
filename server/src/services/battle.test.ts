import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { armyCP, resolveBattle } from './battle.js';
import type { Army, BattleConfig, Loss } from './battle.js';

const CONFIG: BattleConfig = { winnerLossRatio: 0.5, loserLossRatio: 1.0, drawLossRatio: 0.5 };

const sumCP = (losses: Loss[], army: Army): number =>
  losses.reduce((s, l) => s + l.count * (army.find((u) => u.unitId === l.unitId)?.cp ?? 0), 0);
const countOf = (losses: Loss[]): number => losses.reduce((s, l) => s + l.count, 0);

describe('battle', () => {
  const strong: Army = [
    { unitId: 'warrior', cp: 40, count: 15 }, // 600
    { unitId: 'archer', cp: 30, count: 10 }, // 300
    { unitId: 'mage', cp: 25, count: 4 }, // 100
  ]; // 1000
  const weak: Army = [
    { unitId: 'militia', cp: 20, count: 20 }, // 400
    { unitId: 'archer', cp: 30, count: 6 }, // 180
    { unitId: 'mage', cp: 20, count: 1 }, // 20
  ]; // 600

  it('A 승리 / B 승리 / 무승부를 판정한다', () => {
    assert.equal(resolveBattle(strong, weak, CONFIG, 1).winner, 'A');
    assert.equal(resolveBattle(weak, strong, CONFIG, 1).winner, 'B');
    const same: Army = [{ unitId: 'x', cp: 10, count: 5 }];
    assert.equal(resolveBattle(same, same, CONFIG, 1).winner, 'draw');
  });

  it('패배 측 참전 유닛은 전멸한다', () => {
    const r = resolveBattle(strong, weak, CONFIG, 7);
    assert.equal(
      countOf(r.bLosses),
      weak.reduce((s, u) => s + u.count, 0),
    );
    assert.equal(sumCP(r.bLosses, weak), armyCP(weak));
    const r2 = resolveBattle(weak, strong, CONFIG, 7);
    assert.equal(
      countOf(r2.aLosses),
      weak.reduce((s, u) => s + u.count, 0),
    );
  });

  it('승리 측 손실 전투력은 패배측_CP × 0.5 를 초과하지 않는다', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = resolveBattle(strong, weak, CONFIG, seed);
      const lost = sumCP(r.aLosses, strong);
      assert.ok(lost <= armyCP(weak) * 0.5 + 1e-9, `seed ${seed}: lost ${lost}`);
      // 보유 수량을 넘어 죽지 않는다
      for (const l of r.aLosses) {
        const owned = strong.find((u) => u.unitId === l.unitId)!.count;
        assert.ok(l.count <= owned);
      }
    }
  });

  it('예산을 최대한 채운다 (건너뛴 뒤 더 작은 유닛으로 보충)', () => {
    // 예산 300, 유닛 CP 40 -> 7기(280)까지 가능, 20 단위 이하 유닛이 있으면 더 채워진다
    const a: Army = [
      { unitId: 'big', cp: 40, count: 30 },
      { unitId: 'small', cp: 10, count: 30 },
    ];
    const b: Army = [{ unitId: 'e', cp: 10, count: 60 }]; // 600 -> 예산 300, a 는 1500 으로 승리
    for (let seed = 1; seed <= 50; seed++) {
      const r = resolveBattle(a, b, CONFIG, seed);
      const lost = sumCP(r.aLosses, a);
      assert.ok(lost <= 300 + 1e-9);
      assert.ok(lost >= 290, `seed ${seed}: lost ${lost}`); // 10 단위 유닛이 있어 거의 채워짐
    }
  });

  it('무승부는 양측이 자기 CP 의 50% 까지 손실한다', () => {
    const a: Army = [{ unitId: 'x', cp: 10, count: 10 }];
    const b: Army = [{ unitId: 'y', cp: 20, count: 5 }];
    const r = resolveBattle(a, b, CONFIG, 3);
    assert.equal(r.winner, 'draw');
    assert.ok(sumCP(r.aLosses, a) <= 50 + 1e-9);
    assert.ok(sumCP(r.bLosses, b) <= 50 + 1e-9);
  });

  it('같은 시드는 같은 결과, 다른 시드는 (대체로) 다른 결과를 낸다', () => {
    const r1 = resolveBattle(strong, weak, CONFIG, 12345);
    const r2 = resolveBattle(strong, weak, CONFIG, 12345);
    assert.deepEqual(r1, r2);
    const variants = new Set<string>();
    for (let seed = 1; seed <= 30; seed++)
      variants.add(JSON.stringify(resolveBattle(strong, weak, CONFIG, seed).aLosses));
    assert.ok(variants.size > 1);
  });

  it('설정값을 반영한다 (loserLossRatio < 1)', () => {
    const r = resolveBattle(strong, weak, { ...CONFIG, loserLossRatio: 0.5 }, 5);
    assert.ok(sumCP(r.bLosses, weak) <= 300 + 1e-9);
  });

  it('전투력이 noLossRatio 배 이상 차이 나면 이긴 쪽은 손실이 없다', () => {
    const cfg: BattleConfig = { ...CONFIG, noLossRatio: 3 };
    const tiny: Army = [{ unitId: 'militia', cp: 20, count: 10 }]; // 200
    const huge: Army = [{ unitId: 'warrior', cp: 40, count: 20 }]; // 800 (4배)
    const a = resolveBattle(huge, tiny, cfg, 3);
    assert.equal(a.winner, 'A');
    assert.equal(countOf(a.aLosses), 0);
    assert.equal(countOf(a.bLosses), 10); // 진 쪽은 그대로 전멸
    const b = resolveBattle(tiny, huge, cfg, 3); // 방어측이 압승해도 동일
    assert.equal(countOf(b.bLosses), 0);
    // 3배 미만이면 기존대로 손실 발생
    const mid: Army = [{ unitId: 'warrior', cp: 40, count: 10 }]; // 400 (2배)
    assert.ok(countOf(resolveBattle(mid, tiny, cfg, 3).aLosses) > 0);
    // 옵션이 없으면 적용하지 않는다
    assert.ok(countOf(resolveBattle(huge, tiny, CONFIG, 3).aLosses) > 0);
  });
});
