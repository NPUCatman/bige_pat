import type { Animations } from './types';

/** 定时表情状态机：短 GIF 自己循环，只有定时到点或碰撞状态变化才换素材。 */
export class AnimationCycle {
  declare current: string;
  declare colliding: boolean;
  declare private nextAt: number;
  declare private readonly config: NonNullable<Animations['behavior']>;

  constructor(config: NonNullable<Animations['behavior']>, initial: string, now = Date.now()) {
    this.colliding = false;
    this.config = config;
    this.current = config.random.includes(initial) ? initial : config.random[0];
    this.nextAt = now + config.intervalSec * 1000;
  }

  due(now = Date.now()): boolean {
    return !this.colliding && now >= this.nextAt;
  }

  private choose(now: number, avoid?: string): string {
    const pool = this.config.random.filter((name) => name !== this.config.collision);
    const alternatives = pool.filter((name) => name !== this.current && name !== avoid);
    const choices = alternatives.length ? alternatives : pool;
    this.current = choices[Math.floor(Math.random() * choices.length)] ?? this.current;
    this.nextAt = now + this.config.intervalSec * 1000;
    return this.current;
  }

  resume(now = Date.now(), avoid?: string): string {
    if (this.colliding) return this.config.collision;
    return this.due(now) ? this.choose(now, avoid) : this.current;
  }

  /** 一次飞行中的连续反弹只进入一次，不重新加载/重播呆滞。 */
  hit(): string | null {
    if (this.colliding) return null;
    this.colliding = true;
    return this.config.collision;
  }

  settle(now = Date.now(), avoid?: string): string | null {
    if (!this.colliding) return null;
    this.colliding = false;
    return this.choose(now, avoid);
  }

  /** 抓取、菜单或指令接管时终止上一场碰撞状态。 */
  cancel(now = Date.now()): void {
    this.colliding = false;
    this.nextAt = now + this.config.intervalSec * 1000;
  }
}
