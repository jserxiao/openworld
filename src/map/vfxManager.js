/**
 * 特效管理器 (VFX Manager)
 *
 * 管理爆炸和火苗动画精灵的创建、播放和销毁。
 * 由 ProjectileManager 命中回调触发，先播放爆炸效果，
 * 爆炸结束后在目标船只上生成持续燃烧的火苗。
 *
 * 抽象要点：
 * - 爆炸特效：缩放 + 透明度动画，播完自动移除
 * - 火苗特效：跟随目标船只，固定在船体中间位置，定时器控制生命周期
 * - 精灵池复用：减少频繁创建/销毁的 GC 压力
 * - 每帧更新所有活跃特效，过期自动回收
 *
 * 所有数值常量定义在 constants.js 的 EXPLOSION_CONFIG / FIRE_CONFIG 中
 */

import * as PIXI from 'pixi.js';
import { TILE, EXPLOSION_CONFIG, FIRE_CONFIG } from './constants';

/**
 * 爆炸特效实例
 * @typedef {object} ExplosionVFX
 * @property {PIXI.Sprite} sprite - 爆炸精灵
 * @property {number} x - 位置X（瓦片坐标）
 * @property {number} y - 位置Y（瓦片坐标）
 * @property {number} targetEid - 目标船只实体ID（用于生成跟随火苗）
 * @property {number} elapsed - 已播放时间（秒）
 * @property {number} duration - 总播放时长（秒）
 * @property {boolean} done - 是否播放完毕
 */

/**
 * 火苗特效实例
 * @typedef {object} FireVFX
 * @property {PIXI.Sprite} sprite - 火苗精灵
 * @property {number} targetEid - 跟随的目标船只实体ID
 * @property {number} elapsed - 已存在时间（秒）
 * @property {number} lifetime - 总生命周期（秒）
 * @property {boolean} done - 是否过期
 */

/**
 * 特效管理器
 */
export class VfxManager {
  /**
   * @param {object} textures - 瓦片纹理映射
   * @param {PIXI.Container} container - 特效精灵挂载的容器
   * @param {object} [ecsRefs] - ECS 组件引用（用于查询船只位置实现火苗跟随）
   * @param {object} ecsRefs.Position - ECS Position 组件
   * @param {object} ecsRefs.Navigating - ECS Navigating 组件
   * @param {object} ecsRefs.world - bitECS 世界
   * @param {Function} ecsRefs.hasComponent - hasComponent 函数
   */
  constructor(textures, container, ecsRefs = null) {
    /** @type {object} */
    this._textures = textures;

    /** @type {PIXI.Container} */
    this._container = container;

    /** @type {ExplosionVFX[]} 活跃爆炸特效 */
    this._explosions = [];

    /** @type {FireVFX[]} 活跃火苗特效 */
    this._fires = [];

    /** @type {PIXI.Sprite[]} 爆炸精灵池 */
    this._explosionPool = [];

    /** @type {PIXI.Sprite[]} 火苗精灵池 */
    this._firePool = [];

    // ECS 组件引用（用于火苗跟随船只）
    /** @type {object|null} */
    this._ecsRefs = ecsRefs;
  }

  /**
   * 诊断属性
   */
  get explosionCount() { return this._explosions.length; }
  get fireCount() { return this._fires.length; }

  /**
   * 在指定位置创建爆炸特效，爆炸结束后自动在目标船只上生成火苗
   *
   * @param {number} x - 瓦片坐标X
   * @param {number} y - 瓦片坐标Y
   * @param {number} [targetEid=-1] - 目标船只实体ID（火苗将跟随该船只）
   */
  createExplosion(x, y, targetEid = -1) {
    const sprite = this._acquireExplosionSprite();
    sprite.x = x;
    sprite.y = y;
    sprite.visible = true;
    sprite.alpha = 1;
    sprite.scale.set(EXPLOSION_CONFIG.scaleStart, EXPLOSION_CONFIG.scaleStart);

    this._explosions.push({
      sprite,
      x,
      y,
      targetEid,
      elapsed: 0,
      duration: EXPLOSION_CONFIG.duration,
      done: false,
    });
  }

  /**
   * 在目标船只上创建火苗特效
   *
   * @param {number} targetEid - 跟随的目标船只实体ID
   * @param {number} [lifetime] - 火苗持续时间（秒），默认取 FIRE_CONFIG.lifetime
   */
  createFire(targetEid, lifetime = FIRE_CONFIG.lifetime) {
    const sprite = this._acquireFireSprite();
    sprite.visible = true;
    sprite.alpha = 1;

    // 初始位置和旋转设为船只当前状态
    const state = this._getShipState(targetEid);
    sprite.x = state.x;
    sprite.y = state.y;
    sprite.rotation = state.rotation;

    this._fires.push({
      sprite,
      targetEid,
      elapsed: 0,
      lifetime,
      done: false,
    });
  }

  /**
   * 获取船只位置和旋转（船体中间，即 Position 原点）
   * @private
   * @param {number} targetEid
   * @returns {{ x: number, y: number, rotation: number }}
   */
  _getShipState(targetEid) {
    if (!this._ecsRefs || targetEid < 0) {
      return { x: 0, y: 0, rotation: 0 };
    }

    const { Position, Navigating, world, hasComponent } = this._ecsRefs;

    // 检查目标实体是否仍存在且拥有 Position 组件
    if (!hasComponent(world, Position, targetEid)) {
      return { x: 0, y: 0, rotation: 0 };
    }

    // 船体中间 = Position 原点，无偏移；旋转与船精灵一致
    return {
      x: Position.x[targetEid],
      y: Position.y[targetEid],
      rotation: Navigating.heading[targetEid] + Math.PI,
    };
  }

  /**
   * 每帧更新所有特效
   *
   * 爆炸动画：
   *   前半段：从 scaleStart 缩放到 scaleEnd，快速放大
   *   后半段：透明度从1到0，淡出
   *
   * 火苗动画：
   *   跟随目标船只位置（船体中间）
   *   全程微缩放抖动 + 微位移抖动，模拟火焰跳动
   *   末尾 fadeTime 秒淡出
   *
   * @param {number} dt - 帧间隔（秒）
   */
  update(dt) {
    // 更新爆炸特效
    const growRatio = EXPLOSION_CONFIG.growRatio;
    const scaleStart = EXPLOSION_CONFIG.scaleStart;
    const scaleEnd = EXPLOSION_CONFIG.scaleEnd;
    const scaleRange = scaleEnd - scaleStart;

    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const vfx = this._explosions[i];
      vfx.elapsed += dt;

      const t = vfx.elapsed / vfx.duration;

      if (t < growRatio) {
        // 放大阶段
        const scale = scaleStart + scaleRange * (t / growRatio);
        vfx.sprite.scale.set(scale, scale);
        vfx.sprite.alpha = 1;
      } else {
        // 淡出阶段
        const fadeT = (t - growRatio) / (1 - growRatio);
        vfx.sprite.alpha = 1 - fadeT;
        vfx.sprite.scale.set(scaleEnd, scaleEnd); // 保持最大尺寸
      }

      // 播放完毕
      if (vfx.elapsed >= vfx.duration) {
        vfx.sprite.visible = false;
        this._container.removeChild(vfx.sprite);
        if (this._explosionPool.length < EXPLOSION_CONFIG.poolMax) {
          this._explosionPool.push(vfx.sprite);
        } else {
          vfx.sprite.destroy();
        }
        this._explosions.splice(i, 1);

        // 爆炸结束后在目标船只上生成火苗
        if (vfx.targetEid >= 0) {
          this.createFire(vfx.targetEid);
        }
      }
    }

    // 更新火苗特效
    const fireSize = FIRE_CONFIG.size;
    const fireFadeTime = FIRE_CONFIG.fadeTime;

    for (let i = this._fires.length - 1; i >= 0; i--) {
      const vfx = this._fires[i];
      vfx.elapsed += dt;

      // 跟随目标船只位置和旋转
      const state = this._getShipState(vfx.targetEid);
      // 加上微抖动效果（沿船体局部坐标）
      const jitterLocalX = Math.sin(vfx.elapsed * FIRE_CONFIG.jitterFreqX) * FIRE_CONFIG.jitterAmp;
      const jitterLocalY = Math.sin(vfx.elapsed * FIRE_CONFIG.jitterFreqY) * FIRE_CONFIG.jitterAmp;
      // 将局部抖动旋转到世界坐标
      const cosR = Math.cos(state.rotation);
      const sinR = Math.sin(state.rotation);
      vfx.sprite.x = state.x + jitterLocalX * cosR - jitterLocalY * sinR;
      vfx.sprite.y = state.y + jitterLocalX * sinR + jitterLocalY * cosR;
      vfx.sprite.rotation = state.rotation;

      // 火苗缩放抖动效果
      const flicker = Math.sin(vfx.elapsed * FIRE_CONFIG.flickerFreq1) * FIRE_CONFIG.flickerAmp1
                    + Math.sin(vfx.elapsed * FIRE_CONFIG.flickerFreq2) * FIRE_CONFIG.flickerAmp2;
      vfx.sprite.scale.set(fireSize + flicker, fireSize + flicker);

      // 末尾淡出
      const remaining = vfx.lifetime - vfx.elapsed;
      if (remaining <= fireFadeTime) {
        vfx.sprite.alpha = Math.max(0, remaining / fireFadeTime);
      }

      // 检查目标船只是否已不存在
      if (this._ecsRefs && vfx.targetEid >= 0) {
        const { Position, world, hasComponent } = this._ecsRefs;
        if (!hasComponent(world, Position, vfx.targetEid)) {
          // 目标船只已销毁，火苗也消失
          vfx.elapsed = vfx.lifetime;
        }
      }

      // 生命周期结束
      if (vfx.elapsed >= vfx.lifetime) {
        vfx.sprite.visible = false;
        this._container.removeChild(vfx.sprite);
        if (this._firePool.length < FIRE_CONFIG.poolMax) {
          this._firePool.push(vfx.sprite);
        } else {
          vfx.sprite.destroy();
        }
        this._fires.splice(i, 1);
      }
    }
  }

  /**
   * 更新纹理映射
   * @param {object} textures - 新的纹理映射
   */
  updateTextures(textures) {
    this._textures = textures;
  }

  /**
   * 从池中获取爆炸精灵
   * @private
   * @returns {PIXI.Sprite}
   */
  _acquireExplosionSprite() {
    if (this._explosionPool.length > 0) {
      const sprite = this._explosionPool.pop();
      this._container.addChild(sprite);
      return sprite;
    }

    const texture = this._textures[TILE.EXPLOSION] || PIXI.Texture.EMPTY;
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    this._container.addChild(sprite);
    return sprite;
  }

  /**
   * 从池中获取火苗精灵
   * @private
   * @returns {PIXI.Sprite}
   */
  _acquireFireSprite() {
    if (this._firePool.length > 0) {
      const sprite = this._firePool.pop();
      this._container.addChild(sprite);
      return sprite;
    }

    const texture = this._textures[TILE.FIRE] || PIXI.Texture.EMPTY;
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = FIRE_CONFIG.size;
    sprite.height = FIRE_CONFIG.size;
    this._container.addChild(sprite);
    return sprite;
  }

  /**
   * 销毁管理器，释放所有资源
   */
  destroy() {
    for (const vfx of this._explosions) {
      vfx.sprite.destroy();
    }
    this._explosions = [];

    for (const vfx of this._fires) {
      vfx.sprite.destroy();
    }
    this._fires = [];

    for (const sprite of this._explosionPool) {
      sprite.destroy();
    }
    this._explosionPool = [];

    for (const sprite of this._firePool) {
      sprite.destroy();
    }
    this._firePool = [];
  }
}
