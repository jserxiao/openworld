import * as PIXI from 'pixi.js';

/**
 * 通用对象池 (Object Pool)
 *
 * 复用 PIXI.Sprite / PIXI.Container 等对象，避免频繁创建/销毁导致的 GC 压力。
 * 在区块渲染和装饰层重建时，大量精灵被创建又销毁，对象池可将这些对象回收再利用。
 *
 * 使用方式：
 *   const spritePool = new ObjectPool(() => new PIXI.Sprite(), {
 *     reset: (sprite) => { sprite.texture = null; sprite.visible = true; },
 *     destroy: (sprite) => sprite.destroy(),
 *     maxSize: 1024,
 *   });
 *
 *   const sprite = spritePool.acquire();
 *   // ... 使用精灵 ...
 *   spritePool.release(sprite);
 *
 * 性能收益：
 * - 减少 new PIXI.Sprite() 调用，降低 V8 堆分配压力
 * - 减少 sprite.destroy() 调用，避免 GPU 资源反复申请/释放
 * - 频繁创建销毁场景（区块加载/卸载、装饰层重建）GC 停顿明显减少
 */

/**
 * @typedef {object} PoolOptions
 * @property {Function} [reset] - 对象回收时的重置函数 (obj) => void
 * @property {Function} [destroy] - 对象销毁函数 (obj) => void（池销毁时调用）
 * @property {number} [maxSize=1024] - 池最大容量（防止内存泄漏）
 * @property {number} [prealloc=0] - 预分配数量
 */

/**
 * 通用对象池
 * @template T
 */
export class ObjectPool {
  /**
   * @param {Function} factory - 对象工厂函数 () => T
   * @param {PoolOptions} [options]
   */
  constructor(factory, options = {}) {
    /** @type {Function} */
    this._factory = factory;
    /** @type {Function} */
    this._reset = options.reset || (() => {});
    /** @type {Function} */
    this._destroy = options.destroy || (() => {});
    /** @type {number} */
    this._maxSize = options.maxSize || 1024;

    /** @type {T[]} 空闲对象栈 */
    this._pool = [];

    /** @type {number} 当前借出数量 */
    this._activeCount = 0;

    /** @type {number} 总创建数量（含已借出和池中的） */
    this._totalCreated = 0;

    // 预分配
    if (options.prealloc > 0) {
      for (let i = 0; i < options.prealloc; i++) {
        this._pool.push(this._factory());
        this._totalCreated++;
      }
    }
  }

  /**
   * 从池中获取一个对象
   * 如果池为空则创建新对象
   * @returns {T}
   */
  acquire() {
    let obj;
    if (this._pool.length > 0) {
      obj = this._pool.pop();
    } else {
      obj = this._factory();
      this._totalCreated++;
    }
    this._activeCount++;
    return obj;
  }

  /**
   * 将对象归还到池中
   * @param {T} obj
   */
  release(obj) {
    if (!obj) return;

    this._reset(obj);
    this._activeCount--;

    if (this._pool.length < this._maxSize) {
      this._pool.push(obj);
    } else {
      // 池已满，直接销毁
      this._destroy(obj);
    }
  }

  /**
   * 批量获取对象
   * @param {number} count
   * @returns {T[]}
   */
  acquireBatch(count) {
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(this.acquire());
    }
    return result;
  }

  /**
   * 批量归还对象
   * @param {T[]} objects
   */
  releaseBatch(objects) {
    for (const obj of objects) {
      this.release(obj);
    }
  }

  /**
   * 预热池：提前创建指定数量的对象
   * @param {number} count
   */
  warmup(count) {
    for (let i = this._pool.length; i < count && i < this._maxSize; i++) {
      this._pool.push(this._factory());
      this._totalCreated++;
    }
  }

  /**
   * 清空池中所有空闲对象
   */
  clear() {
    for (const obj of this._pool) {
      this._destroy(obj);
    }
    this._pool.length = 0;
  }

  /**
   * 销毁整个池（包括所有空闲对象）
   */
  destroy() {
    this.clear();
    this._activeCount = 0;
  }

  /**
   * 获取池统计信息
   */
  getStats() {
    return {
      available: this._pool.length,
      active: this._activeCount,
      totalCreated: this._totalCreated,
      maxSize: this._maxSize,
    };
  }
}

// ────────────────────────────────────────────
// 预定义的 PIXI 对象池工厂
// ────────────────────────────────────────────

/**
 * 创建 PIXI.Sprite 对象池
 * @param {PoolOptions} [options]
 * @returns {ObjectPool<PIXI.Sprite>}
 */
export function createSpritePool(options = {}) {
  return new ObjectPool(
    () => {
      const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
      return sprite;
    },
    {
      reset: (sprite) => {
        sprite.texture = PIXI.Texture.EMPTY;
        sprite.x = 0;
        sprite.y = 0;
        sprite.width = 0;
        sprite.height = 0;
        sprite.scale.set(1, 1);
        sprite.rotation = 0;
        sprite.anchor.set(0, 0);
        sprite.alpha = 1;
        sprite.visible = true;
        sprite.zIndex = 0;
        sprite.tint = 0xffffff;
        if (options.reset) options.reset(sprite);
      },
      destroy: (sprite) => sprite.destroy(),
      maxSize: options.maxSize || 2048,
      prealloc: options.prealloc || 0,
    }
  );
}

/**
 * 创建 PIXI.Container 对象池
 * @param {PoolOptions} [options]
 * @returns {ObjectPool<PIXI.Container>}
 */
export function createContainerPool(options = {}) {
  return new ObjectPool(
    () => new PIXI.Container(),
    {
      reset: (container) => {
        container.removeChildren();
        container.x = 0;
        container.y = 0;
        container.scale.set(1, 1);
        container.alpha = 1;
        container.visible = true;
        // 清理自定义属性
        delete container._groundSprite;
        delete container._decorSprites;
        if (options.reset) options.reset(container);
      },
      destroy: (container) => container.destroy({ children: true }),
      maxSize: options.maxSize || 256,
      prealloc: options.prealloc || 0,
    }
  );
}
