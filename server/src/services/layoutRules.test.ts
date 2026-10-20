import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HALL_RESERVE, autoSpot, fits, footprintOf, hallRect, landRadius } from './layoutRules.js';

test('건물은 레벨이 오르면 커지고, 영주관은 가운데에 놓인다', () => {
  assert.equal(footprintOf('farm', 1), 1);
  assert.equal(footprintOf('farm', 10), 2);
  assert.ok(footprintOf('town_hall', 10) > footprintOf('town_hall', 1));
  const h = hallRect(10);
  assert.ok(h.i >= HALL_RESERVE.i && h.i + h.n <= HALL_RESERVE.i + HALL_RESERVE.n);
});

test('영지 땅은 레벨이 오를수록 넓어진다', () => {
  assert.ok(landRadius(10) > landRadius(1));
  for (let lv = 2; lv <= 10; lv++) assert.ok(landRadius(lv) >= landRadius(lv - 1));
});

test('땅 밖, 영주관 자리, 다른 건물과 겹치는 자리에는 놓을 수 없다', () => {
  const R = 3;
  assert.equal(fits(R, { i: 3, j: 3, n: 1 }, []), true);
  assert.equal(fits(R, { i: 3, j: 3, n: 2 }, []), false); // 땅 밖으로 나감
  assert.equal(fits(R, { i: 4, j: 0, n: 1 }, []), false);
  assert.equal(fits(R, { i: 0, j: 0, n: 1 }, []), false); // 영주관 자리
  assert.equal(fits(R, { i: 2, j: 2, n: 1 }, [{ i: 2, j: 2, n: 1 }]), false);
  assert.equal(fits(R, { i: 2, j: 2, n: 1 }, [{ i: 1, j: 1, n: 2 }]), false); // 2×2 에 포함
});

test('자동 배치는 영주관 가까운 빈자리를 항상 같은 순서로 고른다', () => {
  const a = autoSpot(5, 1, []);
  const b = autoSpot(5, 1, []);
  assert.deepEqual(a, b);
  assert.ok(a && fits(5, { ...a, n: 1 }, []));
  const taken = [{ ...a!, n: 1 }];
  const c = autoSpot(5, 1, taken);
  assert.ok(c && (c.i !== a!.i || c.j !== a!.j));
});

test('빈 땅이 없으면 자동 배치는 null 을 돌려준다', () => {
  const R = 3;
  const all = [];
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) all.push({ i, j, n: 1 });
  assert.equal(autoSpot(R, 1, all), null);
});
