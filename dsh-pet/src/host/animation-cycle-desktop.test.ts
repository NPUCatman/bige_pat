import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { AnimationCycle } from '../shared/animation-cycle.ts';
import * as physics from '../shared/physics.ts';
import { rollKind } from '../shared/pickers.ts';
import { planMove } from '../shared/motion.ts';
import { PET_REF_WIDTH } from '../shared/constants.ts';

const source = readFileSync(new URL('../../runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const behavior = { intervalSec: 60, random: ['安静', '开心', '焦急'], collision: '呆滞' };

interface TestSprite {
  anim: string;
  once: boolean;
  facing: string;
  animationCycle: AnimationCycle;
  throwRef: number | null;
  throwState: unknown;
  frozen: boolean;
  switchTo: (name: string, once: boolean) => void;
  playIdle: () => void;
  handleEnded: () => void;
  showCollision: () => void;
  finishCollision: () => void;
  startThrow: (x: number, y: number, vx: number, vy: number) => void;
  stopThrow: (preserve?: boolean) => void;
  onDeskHit: (vx: number, vy: number) => void;
  weights: { idle: number; turn: number; move: number };
  pet: { fixedEnabled: boolean };
  videoA: { currentTime: number; style: { transform: string } };
  videoB: { currentTime: number; style: { transform: string } };
  pos: { x: number; y: number };
  moveRef: number | null;
}

function scenario() {
  let now = 0;
  let timer: (() => void) | null = null;
  let raf: (() => void) | null = null;
  const changes: string[] = [];
  const context = vm.createContext({
    S: { AnimationCycle, rollKind, planMove, PET_REF_WIDTH, ...physics },
    Date: { now: () => now },
    performance: { now: () => now },
    VIEW: { w: 240, h: 200 },
    AREAS: [{ x: 0, y: 0, width: 240, height: 200 }],
    window: {
      __dshPetDebug: {},
      setInterval: (callback: () => void) => {
        timer = callback;
        return 1;
      },
    },
    requestAnimationFrame: (callback: () => void) => {
      raf = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      raf = null;
    },
  });
  const constructor = vm.runInContext(source + '\nPetSprite', context) as { prototype: object };
  const sprite = Object.assign(Object.create(constructor.prototype), {
    anim: '安静',
    once: true,
    facing: 'left',
    frozen: false,
    animations: {
      behavior,
      turn: ['转向'],
      moves: {
        default: { minDist: 180, maxDist: 180, margin: 0, leadSec: 0.1, tailSec: 0.1 },
        actions: [{ name: '移动' }],
      },
    },
    weights: { idle: 100, turn: 0, move: 0 },
    pet: { fixedEnabled: false },
    animationCycle: new AnimationCycle(behavior, '安静', 0),
    animationCycleTimer: null,
    dragState: { active: false },
    moveRef: null,
    moveToken: 0,
    pendingMove: null,
    pending: null,
    customPos: null,
    size: 50,
    sideAllow: 0,
    front: 0,
    videoA: { currentTime: 0, duration: 1, style: { transform: '' } },
    videoB: { currentTime: 0, duration: 1, style: { transform: '' } },
    posFollow: null,
    throwRef: null,
    throwToken: 0,
    lastFlightReport: 0,
    pos: { x: 185, y: 10 },
    halfW: 25,
    halfH: 14,
    physics: { ...physics.DEFAULT_PHYSICS, restitution: 0.3, groundFriction: 10 },
    confineToScreen: false,
    throwSpaceOf: () =>
      physics.throwSpace({ areas: [{ x: 0, y: 0, width: 240, height: 200 }], size: 50, sideAllow: 0 }),
    stopMove: () => {},
    stopDragFollow: () => {},
    startSquash: () => {},
    resumeWorkStatusAnim: () => false,
    sendBounds(x: number, y: number) {
      this.pos = { x, y };
    },
    switchTo(name: string, once: boolean) {
      this.anim = name;
      this.once = once;
      changes.push(name);
    },
  }) as unknown as TestSprite;
  return {
    sprite,
    changes,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    tick: () => {
      const callback = timer;
      if (callback) callback();
    },
    frame: () => {
      const callback = raf;
      raf = null;
      if (callback) callback();
    },
  };
}

test('桌面真实随机链使用 loop，60 秒才切；点击 ended 恢复相同常规片段', () => {
  const s = scenario();
  s.sprite.playIdle();
  assert.equal(s.sprite.once, false);
  assert.equal(s.sprite.anim, '安静');
  s.advance(59999);
  s.tick();
  assert.deepEqual(s.changes, ['安静']);
  s.advance(1);
  s.tick();
  assert.notEqual(s.sprite.anim, '安静');
  const regular = s.sprite.anim;
  s.sprite.anim = '点击';
  s.sprite.once = true;
  s.sprite.handleEnded();
  assert.equal(s.sprite.anim, regular);
  assert.equal(s.sprite.once, false);
});

test('桌面真实抛掷循环：撞边播一次呆滞，连续反弹不重启，落定马上随机', () => {
  const s = scenario();
  s.sprite.startThrow(185, 10, 800, 0);
  let observedCollision = false;
  for (let frame = 0; frame < 3600 && s.sprite.throwRef !== null; frame++) {
    s.advance(1000 / 60);
    s.frame();
    if (s.sprite.animationCycle.colliding) {
      observedCollision = true;
      assert.equal(s.sprite.anim, '呆滞');
      assert.equal(s.sprite.once, false);
    }
  }
  assert.equal(observedCollision, true);
  assert.equal(s.sprite.throwRef, null);
  assert.equal(s.changes.filter((name) => name === '呆滞').length, 1);
  assert.ok(s.sprite.anim === '开心' || s.sprite.anim === '焦急');
});

test('桌面被撞回调连续触发不重播，主动停止立即离开呆滞', () => {
  const s = scenario();
  s.sprite.onDeskHit(500, 0);
  s.sprite.onDeskHit(400, 0);
  assert.deepEqual(s.changes, ['呆滞']);
  s.sprite.stopThrow();
  assert.equal(s.sprite.animationCycle.colliding, false);
  assert.notEqual(s.sprite.anim, '呆滞');
});

test('分钟切换仍按原权重随机转向，始终循环新周期 GIF', () => {
  const s = scenario();
  s.sprite.weights = { idle: 0, turn: 100, move: 0 };
  s.sprite.playIdle();
  s.advance(60000);
  s.tick();
  assert.equal(s.sprite.facing, 'right');
  assert.equal(s.sprite.videoA.style.transform, 'scaleX(-1)');
  assert.equal(s.sprite.videoB.style.transform, 'scaleX(-1)');
  assert.notEqual(s.sprite.anim, '转向');
  assert.equal(s.sprite.once, false);
  assert.equal(s.changes.length, 2);
});

test('分钟切换仍执行真实漫游规划和位移，位移结束不切回其他 GIF', () => {
  const s = scenario();
  s.sprite.weights = { idle: 0, turn: 0, move: 100 };
  s.sprite.playIdle();
  const initialX = s.sprite.pos.x;
  s.advance(60000);
  s.tick();
  const selected = s.sprite.anim;
  assert.notEqual(s.sprite.moveRef, null);
  s.sprite.videoA.currentTime = 0.5;
  s.frame();
  assert.ok(s.sprite.pos.x < initialX);
  s.sprite.videoA.currentTime = 0.95;
  s.frame();
  assert.equal(s.sprite.moveRef, null);
  assert.equal(s.sprite.anim, selected);
  assert.equal(s.sprite.once, false);
  assert.deepEqual(s.changes, ['安静', selected]);
});

test('固定宠物仍按原规则禁用分钟转向与漫游', () => {
  const s = scenario();
  s.sprite.weights = { idle: 0, turn: 100, move: 0 };
  s.sprite.pet.fixedEnabled = true;
  s.sprite.playIdle();
  s.advance(60000);
  s.tick();
  assert.equal(s.sprite.facing, 'left');
  assert.equal(s.sprite.moveRef, null);
});
