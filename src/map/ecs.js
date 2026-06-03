/**
 * ECS 架构层 - 基于 bitECS
 *
 * 将 Ship 实体拆分为数据组件(Component) + 逻辑系统(System)
 * 优势：
 * - 数据与逻辑分离，组件可自由组合
 * - 系统独立可测试，易于扩展新行为
 * - bitECS 的 SoA 内存布局对缓存友好，大量实体时性能远超 OOP
 * - 查询(Query)自动维护匹配实体集，无需手动管理列表
 *
 * 组件清单：
 *   Position      - 世界坐标 (x, y)
 *   Velocity      - 速度 (vx, vy)
 *   PatrolBounds  - 巡逻范围 (minX, maxX, minY, maxY)
 *   ShipSprite    - 渲染相关 (spriteIndex, tileType)
 *   Navigating    - 航行行为 (heading, speed, turnTimer, turnInterval, driftPhase)
 *   Combat        - 战斗行为 (cooldown, range, charging, stopped, targetEid)
 *
 * 系统清单：
 *   navigationSystem  - 航行更新（转向、移动、边界反弹，停船时跳过）
 *   collisionSystem   - 碰撞检测与推离
 *   combatSystem      - 战斗逻辑（搜索目标、停船蓄力、发射弹药）
 *   spriteSyncSystem  - 将 ECS 数据同步到 PIXI 精灵
 */

import { createWorld, addEntity, removeEntity } from 'bitecs';
import { defineComponent, Types, defineQuery, enterQuery, exitQuery,
         addComponent, removeComponent, hasComponent } from 'bitecs/legacy';
import * as PIXI from 'pixi.js';
import { TILE, WATER_CONFIG, DIRT_CONFIG, NAVIGATION_CONFIG, COLLISION_CONFIG, COMBAT_RUNTIME_CONFIG, FLEET_CONFIG } from './constants';
import { gameEvents, GameEvent } from './eventBus';
import { SpatialHash } from './spatialHash';

// bitECS 0.4 移除了 defineSystem，它本质上是一个恒等函数
const defineSystem = (fn) => fn;

// ────────────────────────────────────────────
// 组件定义 (Component)
// ────────────────────────────────────────────

/** 世界坐标 */
export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
});

/** 速度向量 */
export const Velocity = defineComponent({
  vx: Types.f32,
  vy: Types.f32,
});

/** 巡逻范围 */
export const PatrolBounds = defineComponent({
  minX: Types.f32,
  maxX: Types.f32,
  minY: Types.f32,
  maxY: Types.f32,
});

/** 渲染相关（spriteIndex 关联到外部精灵数组） */
export const ShipSprite = defineComponent({
  spriteIndex: Types.i32,   // 在外部 _spriteRefs 数组中的索引
  tileType: Types.ui8,      // TILE.SHIP 或 TILE.PIRATE_SHIP
});

/** 航行行为 */
export const Navigating = defineComponent({
  heading: Types.f32,       // 航向角（弧度）
  speed: Types.f32,         // 航行速度
  turnTimer: Types.f32,     // 转向计时器
  turnInterval: Types.f32,  // 转向间隔
  driftPhase: Types.f32,    // 波浪漂移相位
});

/** 战斗行为（仅海盗船拥有） */
export const Combat = defineComponent({
  cooldown: Types.f32,         // 攻击冷却计时器（秒）
  cooldownMax: Types.f32,      // 攻击冷却间隔（秒）
  range: Types.f32,            // 攻击范围（瓦片坐标单位）
  charging: Types.f32,         // 停船蓄力计时器（>0 表示正在蓄力）
  chargingMax: Types.f32,      // 蓄力所需时间（秒）
  targetEid: Types.i32,        // 锁定的目标实体 ID（-1 表示无目标）
  targetX: Types.f32,          // 蓄力时锁定的目标位置X（瓦片坐标）
  targetY: Types.f32,          // 蓄力时锁定的目标位置Y（瓦片坐标）
  stopped: Types.ui8,          // 是否处于停船状态 (0/1)
});

// ────────────────────────────────────────────
// 查询定义 (Query)
// ────────────────────────────────────────────

/** 查询所有船实体 */
const shipQuery = defineQuery([Position, Velocity, PatrolBounds, ShipSprite, Navigating]);

/** 新进入查询的实体（用于初始化精灵） */
const shipEnterQuery = enterQuery(shipQuery);

/** 退出查询的实体（用于清理精灵） */
const shipExitQuery = exitQuery(shipQuery);

/** 查询所有拥有战斗组件的实体（海盗船） */
const combatQuery = defineQuery([Position, Navigating, ShipSprite, Combat]);

/** 查询所有普通船实体（无战斗组件，用于寻找攻击目标） */
const targetQuery = defineQuery([Position, Velocity, PatrolBounds, ShipSprite, Navigating]);

// 导出 targetQuery 供命中检测使用（ProjectileManager 需要搜索附近实体）
export { targetQuery };

// ────────────────────────────────────────────
// 系统 (System)
// ────────────────────────────────────────────

/**
 * 航行系统：更新航向、应用移动、边界反弹
 * @param {World} world - bitECS 世界
 * @returns {World}
 */
export const navigationSystem = defineSystem((world) => {
  const ents = shipQuery(world);
  const dt = world.dt || 0;

  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];

    // 如果船只处于停船蓄力状态（Combat.stopped === 1），跳过航行更新
    if (hasComponent(world, Combat, eid) && Combat.stopped[eid] === 1) {
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;
      continue;
    }

    // 定期随机微调航向
    Navigating.turnTimer[eid] -= dt;
    if (Navigating.turnTimer[eid] <= 0) {
      Navigating.turnTimer[eid] = Navigating.turnInterval[eid];
      Navigating.heading[eid] += (Math.random() - 0.5) * NAVIGATION_CONFIG.turnAmplitude;
    }

    // 波浪微漂移
    Navigating.driftPhase[eid] += NAVIGATION_CONFIG.driftRate * dt;
    const driftOffset = Math.sin(Navigating.driftPhase[eid]) * NAVIGATION_CONFIG.driftAmplitude;
    const effectiveHeading = Navigating.heading[eid] + driftOffset;

    // 根据航向计算速度分量
    const speed = Navigating.speed[eid];
    Velocity.vx[eid] = Math.sin(effectiveHeading) * speed;
    Velocity.vy[eid] = -Math.cos(effectiveHeading) * speed;

    // 更新位置
    Position.x[eid] += Velocity.vx[eid] * dt;
    Position.y[eid] += Velocity.vy[eid] * dt;

    // 边界反弹
    let needRedirect = false;
    if (Position.x[eid] <= PatrolBounds.minX[eid]) {
      Position.x[eid] = PatrolBounds.minX[eid];
      needRedirect = true;
    }
    if (Position.x[eid] >= PatrolBounds.maxX[eid]) {
      Position.x[eid] = PatrolBounds.maxX[eid];
      needRedirect = true;
    }
    if (Position.y[eid] <= PatrolBounds.minY[eid]) {
      Position.y[eid] = PatrolBounds.minY[eid];
      needRedirect = true;
    }
    if (Position.y[eid] >= PatrolBounds.maxY[eid]) {
      Position.y[eid] = PatrolBounds.maxY[eid];
      needRedirect = true;
    }

    if (needRedirect) {
      const cx = (PatrolBounds.minX[eid] + PatrolBounds.maxX[eid]) / 2;
      const cy = (PatrolBounds.minY[eid] + PatrolBounds.maxY[eid]) / 2;
      const toCenterAngle = Math.atan2(cx - Position.x[eid], -(cy - Position.y[eid]));
      Navigating.heading[eid] = toCenterAngle + (Math.random() - 0.5) * NAVIGATION_CONFIG.bounceHeadingOffset;
    }
  }

  return world;
});

/**
 * 碰撞系统：船与船之间的碰撞检测和推离
 * 使用空间哈希 (SpatialHash) 替代 O(n²) 暴力检测
 * - 船数量 < 30 时差异不大，但可线性扩展到 100+ 实体
 * - 每帧重建哈希表，开销 O(n)，碰撞查询平均 O(n)
 * @param {World} world - bitECS 世界
 * @param {SpatialHash} [spatialHash] - 外部空间哈希实例（复用避免 GC）
 * @returns {World}
 */
export const collisionSystem = (spatialHash) => defineSystem((world) => {
  const ents = shipQuery(world);
  const minDist = COLLISION_CONFIG.minDist;
  const minDistSq = minDist * minDist;

  // 重建空间哈希（每帧清空 + 重新插入）
  spatialHash.clear();
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    spatialHash.insert(eid, Position.x[eid], Position.y[eid]);
  }

  // 使用空间哈希查询碰撞对
  const pairs = spatialHash.queryCollisionPairs(minDist);

  for (const { a, b, distSq } of pairs) {
    const dx = Position.x[a] - Position.x[b];
    const dy = Position.y[a] - Position.y[b];
    const dist = Math.sqrt(distSq) || 0.01;
    const pushAngle = Math.atan2(dx, -dy);

    // 推离
    if (dist < minDist) {
      const pushAmount = (minDist - dist) * COLLISION_CONFIG.pushFactor + COLLISION_CONFIG.pushBase;
      Position.x[a] += Math.sin(pushAngle) * pushAmount;
      Position.y[a] -= Math.cos(pushAngle) * pushAmount;
      Position.x[b] -= Math.sin(pushAngle) * pushAmount;
      Position.y[b] += Math.cos(pushAngle) * pushAmount;
    }

    // 碰撞时改变航向
    Navigating.heading[a] = pushAngle + (Math.random() - 0.5) * COLLISION_CONFIG.headingOffset;
    Navigating.heading[b] = pushAngle + Math.PI + (Math.random() - 0.5) * COLLISION_CONFIG.headingOffset;

    // 发出碰撞事件
    gameEvents.emit(GameEvent.SHIP_COLLISION, { entityA: a, entityB: b });
  }

  return world;
});

/**
 * 精灵同步系统：将 ECS 数据同步到 PIXI 精灵
 * @param {World} world - bitECS 世界
 * @param {PIXI.Sprite[]} spriteRefs - 外部精灵引用数组
 * @returns {World}
 */
export const spriteSyncSystem = (spriteRefs) => defineSystem((world) => {
  const ents = shipQuery(world);

  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    const idx = ShipSprite.spriteIndex[eid];
    const sprite = spriteRefs[idx];
    if (!sprite) continue;

    sprite.x = Position.x[eid];
    sprite.y = Position.y[eid];
    sprite.rotation = Navigating.heading[eid] + Math.PI;
  }

  return world;
});

/**
 * 战斗系统：海盗船搜索目标 → 停船蓄力 → 发射弹药
 *
 * 攻击流程：
 * 1. 冷却结束 → 搜索最近普通船作为目标
 * 2. 开始停船蓄力（speed 归零，charging 递增）
 * 3. 蓄力完成 → 发出 SHIP_ATTACK 事件 → 重置冷却
 * 4. 蓄力/攻击期间不移动
 *
 * @param {Function} onAttack - 攻击回调 (attackerEid, targetEid, startX, startY, targetX, targetY) => void
 * @returns {Function}
 */
export const combatSystem = (onAttack) => defineSystem((world) => {
  const pirates = combatQuery(world);
  const allShips = targetQuery(world);
  const dt = world.dt || 0;

  // 预过滤：只收集没有 Combat 组件的普通船（避免每帧重复 hasComponent 调用）
  const normalShips = [];
  for (let j = 0; j < allShips.length; j++) {
    const tid = allShips[j];
    if (!hasComponent(world, Combat, tid)) {
      normalShips.push(tid);
    }
  }

  for (let i = 0; i < pirates.length; i++) {
    const eid = pirates[i];

    // 冷却中
    if (Combat.cooldown[eid] > 0) {
      Combat.cooldown[eid] -= dt;
      // 冷却期间恢复航行
      if (Combat.stopped[eid] === 1) {
        Combat.stopped[eid] = 0;
      }
      continue;
    }

    // 正在蓄力（停船状态）
    if (Combat.charging[eid] > 0) {
      Combat.charging[eid] += dt;

      // 停船：将速度归零
      Navigating.speed[eid] = 0;
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;

      // 安全兜底：chargingMax 不应 <= 0
      const chargingMax = Combat.chargingMax[eid] > 0 ? Combat.chargingMax[eid] : COMBAT_RUNTIME_CONFIG.chargingMaxDefault;

      // 蓄力完成 → 发射
      if (Combat.charging[eid] >= chargingMax) {
        const targetEid = Combat.targetEid[eid];

        // 获取发射位置
        const startX = Position.x[eid];
        const startY = Position.y[eid];

        // 使用蓄力时锁定的目标位置（不再跟踪目标当前位置）
        // 目标在蓄力期间移动了 → 弹药打偏；目标未移动 → 命中
        const targetX = Combat.targetX[eid];
        const targetY = Combat.targetY[eid];

        // 发出攻击
        console.log(
          `[Combat] Pirate#${eid} fires!`,
          `from (${startX.toFixed(1)}, ${startY.toFixed(1)})`,
          `to (${targetX.toFixed(1)}, ${targetY.toFixed(1)})`,
        );
        if (onAttack) {
          onAttack(eid, targetEid, startX, startY, targetX, targetY);
        } else {
          console.warn(`[Combat] onAttack callback is missing!`);
        }

        // 重置状态
        Combat.charging[eid] = 0;
        Combat.targetEid[eid] = -1;
        Combat.targetX[eid] = 0;
        Combat.targetY[eid] = 0;
        Combat.cooldown[eid] = Combat.cooldownMax[eid] > 0 ? Combat.cooldownMax[eid] : 5;
        Combat.stopped[eid] = 0;

        // 恢复航行速度
        Navigating.speed[eid] = COMBAT_RUNTIME_CONFIG.speedMin + Math.random() * COMBAT_RUNTIME_CONFIG.speedRange;
      }
      continue;
    }

    // 寻找目标：在普通船中搜索最近的
    let bestTarget = -1;
    const range = Combat.range[eid] > 0 ? Combat.range[eid] : 40;
    let bestDistSq = range * range;

    for (let j = 0; j < normalShips.length; j++) {
      const tid = normalShips[j];

      const dx = Position.x[tid] - Position.x[eid];
      const dy = Position.y[tid] - Position.y[eid];
      const distSq = dx * dx + dy * dy;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestTarget = tid;
      }
    }

    // 找到目标 → 开始蓄力
    if (bestTarget >= 0) {
      Combat.targetEid[eid] = bestTarget;
      Combat.charging[eid] = COMBAT_RUNTIME_CONFIG.chargingStart; // 开始蓄力（>0 标记蓄力中）
      Combat.stopped[eid] = 1;

      // 锁定目标当前位置（蓄力期间目标移动会导致弹药打偏）
      Combat.targetX[eid] = Position.x[bestTarget];
      Combat.targetY[eid] = Position.y[bestTarget];

      if (Combat.chargingMax[eid] <= 0) {
        Combat.chargingMax[eid] = COMBAT_RUNTIME_CONFIG.chargingMaxDefault; // 安全兜底
      }

      // 立即停船
      Navigating.speed[eid] = 0;
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;

      console.log(
        `[Combat] Pirate#${eid} targeting Ship#${bestTarget},`,
        `dist=${Math.sqrt(bestDistSq).toFixed(1)} tiles,`,
        `chargingMax=${Combat.chargingMax[eid].toFixed(2)}s,`,
        `piratePos=(${Position.x[eid].toFixed(1)}, ${Position.y[eid].toFixed(1)}),`,
        `targetPos=(${Position.x[bestTarget].toFixed(1)}, ${Position.y[bestTarget].toFixed(1)})`,
      );
    }
  }

  return world;
});

// ────────────────────────────────────────────
// ShipFleet ECS 版本
// ────────────────────────────────────────────

/**
 * 基于 ECS 的船队管理器
 * 替代原 ShipFleet 类，使用 bitECS 管理所有船只
 */
export class ShipFleetECS {
  /**
   * @param {object} textures - 瓦片纹理映射
   * @param {{ w: number, h: number }} tileSize - 瓦片像素尺寸
   * @param {{ x: number, y: number, zoom: number }} viewport - 初始视口
   * @param {Function} [onAttack] - 攻击回调，海盗船发射弹药时触发
   *   签名: (attackerEid, targetEid, startX, startY, targetX, targetY) => void
   */
  constructor(textures, tileSize, viewport, onAttack) {
    /** @type {import('bitecs').World} */
    this.world = createWorld();
    this.world.dt = 0;

    /** @type {PIXI.Container} */
    this.container = new PIXI.Container();

    /** @type {PIXI.Sprite[]} 精灵引用数组，与 ECS 的 ShipSprite.spriteIndex 对应 */
    this._spriteRefs = [];

    this._textures = textures;
    this._tileSize = tileSize;
    this._viewport = viewport;
    this._tickerFn = null;

    // 创建空间哈希（碰撞检测优化，复用避免 GC）
    this._spatialHash = new SpatialHash(4); // 单元格大小 4 瓦片

    // 创建碰撞系统（绑定空间哈希）
    this._collisionSystem = collisionSystem(this._spatialHash);

    // 创建精灵同步系统（绑定 spriteRefs）
    this._spriteSyncSystem = spriteSyncSystem(this._spriteRefs);

    // 创建战斗系统（绑定攻击回调）
    this._combatSystem = combatSystem(onAttack);

    // 生成船队
    this._createFleet();

    // 处理退出查询的实体（清理精灵）
    this._exitEnts = shipExitQuery;
  }

  /**
   * 更新纹理映射（渐进式加载后续批次就绪时调用）
   * 替换所有船精灵的纹理为真实纹理
   * @param {object} textures - 新的纹理映射
   */
  updateTextures(textures) {
    this._textures = textures;
    const ents = shipQuery(this.world);
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      const idx = ShipSprite.spriteIndex[eid];
      const sprite = this._spriteRefs[idx];
      if (!sprite) continue;

      const tileType = ShipSprite.tileType[eid];
      const newTexture = textures[tileType];
      if (newTexture) {
        sprite.texture = newTexture;
        // 重新计算宽高比
        const texW = newTexture.width;
        const texH = newTexture.height;
        const aspect = texW / texH;
        sprite.height = 2;
        sprite.width = 2 * aspect;
        if (sprite.width > 2.4) {
          sprite.width = 2.4;
          sprite.height = 2.4 / aspect;
        }
      }
    }
  }

  /**
   * 更新视口引用
   */
  updateViewport(viewport) {
    this._viewport = viewport;
  }

  /**
   * 在水域上随机生成船队
   * @private
   */
  _createFleet() {
    const shoreX = WATER_CONFIG.shoreX;
    const pirateTexture = this._textures[TILE.PIRATE_SHIP];
    const shipTexture = this._textures[TILE.SHIP];

    const waterMinX = shoreX + 2;
    // 船只活动范围不能超过土地区域（右岸线处为沙滩，再往右是土地）
    const waterMaxX = Math.min(shoreX + 100, DIRT_CONFIG.dirtStartX - 2);

    const tileW = this._tileSize.w;
    const zoom = this._viewport.zoom;
    const screenH = window.innerHeight;
    const halfViewY = screenH / (2 * zoom * tileW);
    const waterMinY = -halfViewY * 3;
    const waterMaxY = halfViewY * 3;

    const shipCount = FLEET_CONFIG.shipCountMin + Math.floor(Math.random() * FLEET_CONFIG.shipCountRange);

    for (let i = 0; i < shipCount; i++) {
      const isPirate = Math.random() < FLEET_CONFIG.pirateChance;
      const texture = isPirate ? pirateTexture : shipTexture;
      if (!texture) continue;

      // 随机初始位置
      let x;
      const posRoll = Math.random();
      if (posRoll < FLEET_CONFIG.posNearWeight) {
        x = waterMinX + Math.random() * FLEET_CONFIG.nearRange;
      } else if (posRoll < FLEET_CONFIG.posMidWeight) {
        x = waterMinX + FLEET_CONFIG.midStart + Math.random() * FLEET_CONFIG.midRange;
      } else {
        x = waterMinX + FLEET_CONFIG.farStart + Math.random() * FLEET_CONFIG.farRange;
      }
      x = Math.min(x, waterMaxX);

      const y = waterMinY + Math.random() * (waterMaxY - waterMinY);
      const speed = isPirate ? (FLEET_CONFIG.pirateSpeedMin + Math.random() * FLEET_CONFIG.pirateSpeedRange) : (FLEET_CONFIG.shipSpeedMin + Math.random() * FLEET_CONFIG.shipSpeedRange);

      // 创建 PIXI 精灵
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      const texW = texture.width;
      const texH = texture.height;
      const aspect = texW / texH;
      sprite.height = 2;
      sprite.width = 2 * aspect;
      if (sprite.width > 2.4) {
        sprite.width = 2.4;
        sprite.height = 2.4 / aspect;
      }

      const spriteIndex = this._spriteRefs.length;
      this._spriteRefs.push(sprite);
      this.container.addChild(sprite);

      // 创建 ECS 实体
      const eid = addEntity(this.world);

      addComponent(this.world, Position, eid);
      Position.x[eid] = x;
      Position.y[eid] = y;

      addComponent(this.world, Velocity, eid);
      Velocity.vx[eid] = 0;
      Velocity.vy[eid] = 0;

      addComponent(this.world, PatrolBounds, eid);
      PatrolBounds.minX[eid] = waterMinX;
      PatrolBounds.maxX[eid] = waterMaxX;
      PatrolBounds.minY[eid] = waterMinY;
      PatrolBounds.maxY[eid] = waterMaxY;

      addComponent(this.world, ShipSprite, eid);
      ShipSprite.spriteIndex[eid] = spriteIndex;
      ShipSprite.tileType[eid] = isPirate ? TILE.PIRATE_SHIP : TILE.SHIP;

      addComponent(this.world, Navigating, eid);
      Navigating.heading[eid] = Math.random() * Math.PI * 2;
      Navigating.speed[eid] = speed;
      Navigating.turnTimer[eid] = 1 + Math.random() * 3;
      Navigating.turnInterval[eid] = 1 + Math.random() * 4;
      Navigating.driftPhase[eid] = Math.random() * Math.PI * 2;

      // 海盗船拥有战斗能力
      if (isPirate) {
        addComponent(this.world, Combat, eid);
        Combat.cooldown[eid] = FLEET_CONFIG.cooldownMin + Math.random() * FLEET_CONFIG.cooldownRange; // 初始随机冷却，较快进入战斗
        Combat.cooldownMax[eid] = FLEET_CONFIG.cooldownMaxMin + Math.random() * FLEET_CONFIG.cooldownMaxRange; // 攻击间隔
        Combat.range[eid] = FLEET_CONFIG.rangeMin + Math.random() * FLEET_CONFIG.rangeRange; // 攻击范围（水域跨度大）
        Combat.charging[eid] = 0;
        Combat.chargingMax[eid] = FLEET_CONFIG.chargingMaxMin + Math.random() * FLEET_CONFIG.chargingMaxRange; // 蓄力时间
        Combat.targetEid[eid] = -1;
        Combat.targetX[eid] = 0;
        Combat.targetY[eid] = 0;
        Combat.stopped[eid] = 0;
      }
    }
  }

  /**
   * 注册 PixiJS ticker 驱动 ECS 系统
   * @param {PIXI.Ticker} ticker
   */
  attachTicker(ticker) {
    // 诊断：打印战斗系统初始化状态
    const pirates = combatQuery(this.world);
    const allShips = targetQuery(this.world);
    const normalShips = allShips.filter(eid => !hasComponent(this.world, Combat, eid));
    console.log(
      `[Combat] Fleet initialized: ${allShips.length} ships total,`,
      `${pirates.length} pirates (with Combat),`,
      `${normalShips.length} normal ships (targets)`,
    );
    if (pirates.length > 0) {
      for (let i = 0; i < pirates.length; i++) {
        const eid = pirates[i];
        console.log(
          `  Pirate#${eid}: range=${Combat.range[eid].toFixed(1)},`,
          `cooldown=${Combat.cooldown[eid].toFixed(1)}s,`,
          `pos=(${Position.x[eid].toFixed(1)}, ${Position.y[eid].toFixed(1)})`,
        );
      }
    }

    this._tickerFn = (deltaTime) => {
      const dt = (deltaTime || 0) / 60;
      this.world.dt = dt;

      // 依次执行所有 ECS 系统
      navigationSystem(this.world);
      this._collisionSystem(this.world);
      this._combatSystem(this.world);
      this._spriteSyncSystem(this.world);

      // 处理已退出的实体（清理精灵）
      const exited = this._exitEnts(this.world);
      for (const eid of exited) {
        const idx = ShipSprite.spriteIndex[eid];
        const sprite = this._spriteRefs[idx];
        if (sprite) {
          this.container.removeChild(sprite);
          sprite.destroy();
          this._spriteRefs[idx] = null;
        }
      }
    };

    if (ticker) {
      ticker.add(this._tickerFn);
    }
  }

  /**
   * 从 PIXI.Ticker 移除回调
   */
  detachTicker(ticker) {
    if (this._tickerFn && ticker) {
      ticker.remove(this._tickerFn);
    }
  }

  /**
   * 销毁船队，释放资源
   */
  destroy() {
    // 清理所有精灵
    for (const sprite of this._spriteRefs) {
      if (sprite) sprite.destroy();
    }
    this._spriteRefs = [];

    this.container.destroy({ children: true });
    this.container = null;
    this._tickerFn = null;
  }
}
