/**
 * 匀速直线弹道管理器
 *
 * 管理弹药精灵的创建、匀速直线运动、命中检测和销毁。
 * 由 combatSystem 发出攻击事件时触发，弹药朝发射时锁定的目标位置匀速飞行，
 * 到达目标点后检测附近是否有实体在命中半径内。
 *
 * 核心设计：
 * - 发射时锁定目标位置，弹药朝该位置直线匀速飞行，不跟踪目标移动
 * - 到达目标点后，在命中半径内搜索实体，判断是否命中
 * - 命中：触发爆炸特效 → 火苗特效
 * - 脱靶：弹药到达目标点后无实体在命中范围内 → 直接消失
 * - 飞出最大射程仍未到达目标点 → 直接消失
 *
 * 所有数值常量定义在 constants.js 的 PROJECTILE_CONFIG 中
 */

import * as PIXI from 'pixi.js';
import { TILE, PROJECTILE_CONFIG } from './constants';
import { gameEvents, GameEvent } from './eventBus';

/**
 * 单个弹药实例
 * @typedef {object} Projectile
 * @property {PIXI.Sprite} sprite - 弹药精灵
 * @property {number} startX - 发射点X（瓦片坐标）
 * @property {number} startY - 发射点Y（瓦片坐标）
 * @property {number} targetX - 目标点X（瓦片坐标，发射时锁定）
 * @property {number} targetY - 目标点Y（瓦片坐标，发射时锁定）
 * @property {number} x - 当前位置X
 * @property {number} y - 当前位置Y
 * @property {number} vx - X方向速度分量（瓦片坐标单位/秒）
 * @property {number} vy - Y方向速度分量（瓦片坐标单位/秒）
 * @property {number} distTraveled - 已飞行距离（瓦片坐标单位）
 * @property {number} totalDist - 总飞行距离（发射点到目标点的距离）
 * @property {number} rotation - 飞行方向角（弧度）
 * @property {number} attackerEid - 发射方实体ID
 * @property {number} targetEid - 原始目标实体ID（用于命中检测优先匹配）
 * @property {boolean} arrived - 是否已到达目标点
 */

/**
 * 匀速直线弹道管理器
 */
export class ProjectileManager {
  /**
   * @param {object} textures - 瓦片纹理映射
   * @param {PIXI.Container} container - 弹药精灵挂载的容器
   * @param {Function} onHit - 弹药命中回调 (hitX, hitY, hitEid) => void
   *   hitEid: 被命中的实体ID，-1 表示脱靶
   */
  constructor(textures, container, onHit) {
    /** @type {object} */
    this._textures = textures;

    /** @type {PIXI.Container} */
    this._container = container;

    /** @type {Function} */
    this._onHit = onHit;

    /** @type {Projectile[]} 活跃弹药列表 */
    this._projectiles = [];

    /** @type {PIXI.Sprite[]} 空闲精灵池（复用减少 GC） */
    this._spritePool = [];

    // ECS 组件引用（命中检测需要查询实体位置，由外部注入）
    /** @type {object|null} */
    this._ecsRefs = null;
  }

  /**
   * 注入 ECS 组件引用（命中检测时需要查询实体位置）
   * @param {object} ecsRefs
   * @param {object} ecsRefs.Position - ECS Position 组件
   * @param {object} ecsRefs.world - bitECS 世界
   * @param {Function} ecsRefs.hasComponent - hasComponent 函数
   * @param {Function} ecsRefs.shipQuery - 船只查询函数
   * @param {object} ecsRefs.Combat - ECS Combat 组件（用于区分海盗船/普通船）
   */
  setEcsRefs(ecsRefs) {
    this._ecsRefs = ecsRefs;
  }

  /**
   * 诊断：活跃弹药数量
   */
  get activeCount() { return this._projectiles.length; }

  /**
   * 发射一枚弹药
   *
   * 弹药朝 (targetX, targetY) 方向匀速直线飞行，
   * 到达后检测命中半径内是否有实体。
   *
   * @param {number} attackerEid - 发射方实体ID
   * @param {number} targetEid - 原始目标实体ID（用于命中检测优先匹配）
   * @param {number} startX - 发射点X（瓦片坐标）
   * @param {number} startY - 发射点Y（瓦片坐标）
   * @param {number} targetX - 目标点X（瓦片坐标，发射时锁定）
   * @param {number} targetY - 目标点Y（瓦片坐标，发射时锁定）
   */
  fire(attackerEid, targetEid, startX, startY, targetX, targetY) {
    const sprite = this._acquireSprite();
    sprite.x = startX;
    sprite.y = startY;
    sprite.visible = true;

    // 计算飞行方向和总距离
    const dx = targetX - startX;
    const dy = targetY - startY;
    const totalDist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const rotation = Math.atan2(dy, dx);

    // 匀速：速度分量 = 方向 × 速度
    const speed = PROJECTILE_CONFIG.speed;
    const vx = Math.cos(rotation) * speed;
    const vy = Math.sin(rotation) * speed;

    sprite.rotation = rotation;

    this._projectiles.push({
      sprite,
      startX,
      startY,
      targetX,
      targetY,
      x: startX,
      y: startY,
      vx,
      vy,
      distTraveled: 0,
      totalDist,
      rotation,
      attackerEid,
      targetEid,
      arrived: false,
    });

    // 发出攻击事件
    gameEvents.emit(GameEvent.SHIP_ATTACK, {
      attackerEid,
      targetEid,
      startX,
      startY,
      targetX,
      targetY,
    });
  }

  /**
   * 每帧更新所有弹药位置
   *
   * 匀速直线飞行：
   *   x += vx * dt
   *   y += vy * dt
   *
   * 到达目标点或飞出最大射程后，执行命中检测或消失
   *
   * @param {number} dt - 帧间隔（秒）
   */
  update(dt) {
    const speed = PROJECTILE_CONFIG.speed;
    const maxRange = PROJECTILE_CONFIG.maxRange;

    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const p = this._projectiles[i];

      // 匀速直线移动
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.distTraveled += speed * dt;

      p.sprite.x = p.x;
      p.sprite.y = p.y;

      // 判断是否到达目标点
      if (!p.arrived && p.distTraveled >= p.totalDist) {
        p.arrived = true;
      }

      // 到达目标点 → 执行命中检测
      if (p.arrived) {
        this._onArrival(p, i);
        continue;
      }

      // 飞出最大射程仍未到达 → 脱靶消失
      if (p.distTraveled >= maxRange) {
        this._releaseProjectile(i);
        continue;
      }
    }
  }

  /**
   * 弹药到达目标点后的命中检测
   *
   * 策略：
   * 1. 优先检测原始目标是否在命中半径内
   * 2. 若原始目标不在范围内，搜索所有船实体，找到命中半径内最近的
   * 3. 命中半径内无实体 → 脱靶，弹药消失
   *
   * @private
   * @param {Projectile} p
   * @param {number} index - 在 _projectiles 中的索引
   */
  _onArrival(p, index) {
    let hitEid = -1;
    let hitX = p.targetX;
    let hitY = p.targetY;

    if (this._ecsRefs) {
      const { Position, world, hasComponent, shipQuery, Combat } = this._ecsRefs;
      const hitRadius = PROJECTILE_CONFIG.hitRadius;
      const hitRadiusSq = hitRadius * hitRadius;

      // 1. 优先检测原始目标
      if (p.targetEid >= 0 && hasComponent(world, Position, p.targetEid)) {
        const dx = Position.x[p.targetEid] - p.targetX;
        const dy = Position.y[p.targetEid] - p.targetY;
        if (dx * dx + dy * dy <= hitRadiusSq) {
          hitEid = p.targetEid;
          hitX = Position.x[p.targetEid];
          hitY = Position.y[p.targetEid];
        }
      }

      // 2. 原始目标未命中 → 搜索所有普通船
      if (hitEid < 0) {
        const ents = shipQuery(world);
        let bestDistSq = hitRadiusSq;

        for (let j = 0; j < ents.length; j++) {
          const eid = ents[j];

          // 跳过攻击者自身
          if (eid === p.attackerEid) continue;

          // 跳过海盗船（同阵营不攻击）
          if (hasComponent(world, Combat, eid)) continue;

          if (!hasComponent(world, Position, eid)) continue;

          const dx = Position.x[eid] - p.targetX;
          const dy = Position.y[eid] - p.targetY;
          const distSq = dx * dx + dy * dy;

          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            hitEid = eid;
            hitX = Position.x[eid];
            hitY = Position.y[eid];
          }
        }
      }
    }

    if (hitEid >= 0) {
      // 命中！
      this._onProjectileHit(hitX, hitY, hitEid);
    }
    // 无论命中还是脱靶，弹药都消失
    this._releaseProjectile(index);
  }

  /**
   * 更新纹理映射
   * @param {object} textures - 新的纹理映射
   */
  updateTextures(textures) {
    this._textures = textures;
  }

  /**
   * 弹药命中处理
   * @private
   * @param {number} hitX - 命中点X
   * @param {number} hitY - 命中点Y
   * @param {number} hitEid - 被命中的实体ID
   */
  _onProjectileHit(hitX, hitY, hitEid) {
    // 发出命中事件
    gameEvents.emit(GameEvent.SHIP_HIT, {
      targetEid: hitEid,
      x: hitX,
      y: hitY,
    });

    // 触发命中回调（用于创建爆炸特效）
    if (this._onHit) {
      this._onHit(hitX, hitY, hitEid);
    }
  }

  /**
   * 释放弹药资源
   * @private
   * @param {number} index - 在 _projectiles 中的索引
   */
  _releaseProjectile(index) {
    const p = this._projectiles[index];
    p.sprite.visible = false;
    this._container.removeChild(p.sprite);

    // 归还精灵池
    if (this._spritePool.length < PROJECTILE_CONFIG.poolMax) {
      this._spritePool.push(p.sprite);
    } else {
      p.sprite.destroy();
    }

    this._projectiles.splice(index, 1);
  }

  /**
   * 从池中获取弹药精灵
   * @private
   * @returns {PIXI.Sprite}
   */
  _acquireSprite() {
    if (this._spritePool.length > 0) {
      const sprite = this._spritePool.pop();
      this._container.addChild(sprite);
      return sprite;
    }

    const texture = this._textures[TILE.CANNONBALL] || PIXI.Texture.EMPTY;
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = PROJECTILE_CONFIG.size;
    sprite.height = PROJECTILE_CONFIG.size;
    this._container.addChild(sprite);
    return sprite;
  }

  /**
   * 销毁管理器，释放所有资源
   */
  destroy() {
    // 释放活跃弹药精灵
    for (const p of this._projectiles) {
      p.sprite.destroy();
    }
    this._projectiles = [];

    // 释放精灵池
    for (const sprite of this._spritePool) {
      sprite.destroy();
    }
    this._spritePool = [];
  }
}
