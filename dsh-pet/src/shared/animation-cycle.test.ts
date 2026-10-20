import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationCycle } from './animation-cycle.ts';
import { DEFAULT_PHYSICS, throwStep } from './physics.ts';

const config = { intervalSec: 60, random: ['安静', '开心', '焦急'], collision: '呆滞' };

describe('表情轮播与碰撞', () => {
  test('短片重复结束不换表情，满 60 秒才换成另一段', () => {
    const cycle = new AnimationCycle(config, '安静', 1000);
    for (let now = 2000; now < 61000; now += 1000) {
      assert.equal(cycle.due(now), false);
      assert.equal(cycle.resume(now), '安静');
    }
    assert.equal(cycle.due(61000), true);
    assert.notEqual(cycle.resume(61000), '安静');
    assert.equal(cycle.due(120999), false);
    assert.equal(cycle.due(121000), true);
  });

  test('多次反弹只触发表情一次，运动没停即使过了一分钟仍呆滞', () => {
    const cycle = new AnimationCycle(config, '安静', 0);
    assert.equal(cycle.hit(), '呆滞');
    assert.equal(cycle.hit(), null);
    assert.equal(cycle.resume(120000), '呆滞');
    assert.equal(cycle.due(120000), false);
    assert.equal(cycle.hit(), null);
    const next = cycle.settle(125000);
    assert.ok(next && config.random.includes(next));
    assert.notEqual(next, '安静');
    assert.notEqual(next, '呆滞');
    assert.equal(cycle.settle(126000), null);
    assert.equal(cycle.due(184999), false);
    assert.equal(cycle.due(185000), true);
  });

  test('屏幕边缘碰撞到物理 atRest 的整段流程，停稳后排除呆滞和碰撞前素材', () => {
    const cycle = new AnimationCycle(config, '安静', 0);
    let state = { x: 95, y: 0, vx: 800, vy: 0 };
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 200 };
    let hits = 0;
    let settled = false;
    for (let frame = 1; frame <= 3600; frame++) {
      const res = throwStep(state, 1 / 60, bounds, DEFAULT_PHYSICS);
      state = res;
      if (res.bounced && cycle.hit()) hits++;
      if (!cycle.colliding) continue;
      assert.equal(cycle.resume((frame * 1000) / 60), '呆滞');
      if (res.atRest) {
        const next = cycle.settle((frame * 1000) / 60);
        assert.ok(next === '开心' || next === '焦急');
        settled = true;
        break;
      }
    }
    assert.equal(hits, 1);
    assert.equal(settled, true);
  });

  test('抓取/指令接管解除碰撞，下一次撞击可再次触发', () => {
    const cycle = new AnimationCycle(config, '安静', 0);
    cycle.hit();
    cycle.cancel(3000);
    assert.equal(cycle.resume(3001), '安静');
    assert.equal(cycle.due(62999), false);
    assert.equal(cycle.hit(), '呆滞');
  });

  test('连续随机抽选都排除当前素材与呆滞', () => {
    const cycle = new AnimationCycle(config, '安静', 0);
    let previous = cycle.current;
    for (let minute = 1; minute <= 100; minute++) {
      const next = cycle.resume(minute * 60000);
      assert.ok(config.random.includes(next));
      assert.notEqual(next, previous);
      assert.notEqual(next, '呆滞');
      previous = next;
    }
  });
});
