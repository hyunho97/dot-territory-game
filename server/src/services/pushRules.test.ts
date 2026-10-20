import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMessages } from './pushRules.js';

describe('pushRules', () => {
  it('한 가지 일이면 그 문구, 여러 가지면 묶어서 한 개로 만든다', () => {
    const m = buildMessages([
      { userId: 1, kind: 'build' },
      { userId: 2, kind: 'train' },
      { userId: 2, kind: 'craft' },
      { userId: 2, kind: 'train' }, // 같은 종류 중복은 한 번만
    ]);
    assert.equal(m.size, 2);
    assert.match(m.get(1)!.body, /건설/);
    assert.equal(m.get(1)!.tag, 'build');
    assert.match(m.get(2)!.body, /외 1건/);
    assert.equal(m.get(2)!.tag, 'multi');
  });

  it('이벤트가 없으면 알림이 없다', () => {
    assert.equal(buildMessages([]).size, 0);
  });
});
