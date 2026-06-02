/**
 * 船精灵模块
 * 封装 Ship 类和 ShipFleet 管理器，从 renderer.js 中抽离
 *
 * 坐标体系：worldX/worldY 为瓦片坐标（浮点数），与 mapContainer 一致
 */

import * as PIXI from 'pixi.js';
import { TILE, WATER_CONFIG } from './constants';

// ────────────────────────────────────────────
// Ship - 单艘船精灵
// ────────────────────────────────────────────

/**
 * 船精灵类
 *
 * 在水域上随机航行，沿任意方向移动
 * 船头始终朝向移动方向
 * 到达巡逻边界时随机转向
 */
export class Ship {
  /**
   * @param {object} options
   * @param {PIXI.Texture} options.texture - 船纹理
   * @param {number} options.tileType - TILE.SHIP 或 TILE.PIRATE_SHIP
   * @param {number} options.worldX - 初始世界X坐标
   * @param {number} options.worldY - 初始世界Y坐标
   * @param {number} [options.speed] - 航行速度（瓦片/秒，默认0.6~1.5随机）
   * @param {number} [options.heading] - 初始航向角（弧度，0=北，顺时针，默认随机）
   * @param {number} [options.patrolMinX] - X巡逻范围最小值
   * @param {number} [options.patrolMaxX] - X巡逻范围最大值
   * @param {number} [options.patrolMinY] - Y巡逻范围最小值
   * @param {number} [options.patrolMaxY] - Y巡逻范围最大值
   */
  constructor(options = {}) {
    this.worldX = options.worldX;
    this.worldY = options.worldY;
    this.speed = options.speed ?? (0.6 + Math.random() * 0.9);
    this.heading = options.heading ?? (Math.random() * Math.PI * 2);
    this.patrolMinX = options.patrolMinX;
    this.patrolMaxX = options.patrolMaxX;
    this.patrolMinY = options.patrolMinY;
    this.patrolMaxY = options.patrolMaxY;

    // 转向计时器：定期随机微调航向
    this._turnTimer = 1 + Math.random() * 3;
    this._turnInterval = 1 + Math.random() * 4;

    // 波浪微漂移
    this._driftPhase = Math.random() * Math.PI * 2;

    // 创建精灵
    this.sprite = new PIXI.Sprite(options.texture);
    this.sprite.anchor.set(0.5);
    this.tileType = options.tileType;

    // 保持原始宽高比，以高度为基准缩放到2个瓦片高度
    const texW = options.texture.width;
    const texH = options.texture.height;
    const aspect = texW / texH;
    this.sprite.height = 2;
    this.sprite.width = 2 * aspect;
    if (this.sprite.width > 2.4) {
      this.sprite.width = 2.4;
      this.sprite.height = 2.4 / aspect;
    }

    this._updateSpritePosition();
  }

  /**
   * 碰撞半径（瓦片单位），用于船与船之间的碰撞检测
   */
  get collisionRadius() {
    return Math.max(this.sprite.width, this.sprite.height) * 0.45;
  }

  /**
   * 每帧更新
   * @param {number} dt - 帧间隔时间（秒）
   * @param {Ship[]} otherShips - 其他船只列表（用于碰撞检测）
   */
  update(dt, otherShips) {
    // 定期随机微调航向
    this._turnTimer -= dt;
    if (this._turnTimer <= 0) {
      this._turnTimer = this._turnInterval;
      this.heading += (Math.random() - 0.5) * Math.PI / 3;
    }

    // 波浪微漂移
    this._driftPhase += 0.5 * dt;
    const driftOffset = Math.sin(this._driftPhase) * 0.02;

    // 根据航向移动
    const effectiveHeading = this.heading + driftOffset;
    const dx = Math.sin(effectiveHeading) * this.speed * dt;
    const dy = -Math.cos(effectiveHeading) * this.speed * dt;

    const newX = this.worldX + dx;
    const newY = this.worldY + dy;

    // 碰撞检测
    if (otherShips && otherShips.length > 0) {
      const myRadius = this.collisionRadius;
      for (const other of otherShips) {
        if (other === this) continue;
        const distSq = (newX - other.worldX) ** 2 + (newY - other.worldY) ** 2;
        const minDist = myRadius + other.collisionRadius;
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq) || 0.01;
          const pushAngle = Math.atan2(this.worldX - other.worldX, -(this.worldY - other.worldY));
          this.heading = pushAngle + (Math.random() - 0.5) * Math.PI / 3;
          if (dist < minDist) {
            const pushAmount = (minDist - dist) * 0.5 + 0.1;
            this.worldX += Math.sin(pushAngle) * pushAmount;
            this.worldY -= Math.cos(pushAngle) * pushAmount;
          }
          this._updateSpritePosition();
          return;
        }
      }
    }

    this.worldX = newX;
    this.worldY = newY;

    // 边界反弹
    let needRedirect = false;
    if (this.patrolMinX !== undefined && this.worldX <= this.patrolMinX) {
      this.worldX = this.patrolMinX;
      needRedirect = true;
    }
    if (this.patrolMaxX !== undefined && this.worldX >= this.patrolMaxX) {
      this.worldX = this.patrolMaxX;
      needRedirect = true;
    }
    if (this.patrolMinY !== undefined && this.worldY <= this.patrolMinY) {
      this.worldY = this.patrolMinY;
      needRedirect = true;
    }
    if (this.patrolMaxY !== undefined && this.worldY >= this.patrolMaxY) {
      this.worldY = this.patrolMaxY;
      needRedirect = true;
    }

    if (needRedirect) {
      const centerX = (this.patrolMinX + this.patrolMaxX) / 2;
      const centerY = (this.patrolMinY + this.patrolMaxY) / 2;
      const toCenterAngle = Math.atan2(centerX - this.worldX, -(centerY - this.worldY));
      this.heading = toCenterAngle + (Math.random() - 0.5) * Math.PI / 1.5;
    }

    this._updateSpritePosition();
  }

  /** @private 更新精灵位置和旋转 */
  _updateSpritePosition() {
    this.sprite.x = this.worldX;
    this.sprite.y = this.worldY;
    // 船头朝向航向（原图船头朝下，加π转向前进方向）
    this.sprite.rotation = this.heading + Math.PI;
  }

  /** 销毁精灵 */
  destroy() {
    if (this.sprite) {
      if (this.sprite.parent) {
        this.sprite.parent.removeChild(this.sprite);
      }
      this.sprite.destroy();
      this.sprite = null;
    }
  }
}

// ────────────────────────────────────────────
// ShipFleet - 船队管理器
// ────────────────────────────────────────────

/**
 * 船队管理器
 * 负责创建、更新、销毁所有船只
 * 从 MapCanvasRenderer 中抽离，使渲染器不必关心船只细节
 */
export class ShipFleet {
  /**
   * @param {object} textures - 瓦片纹理映射 { [TILE.SHIP]: Texture, [TILE.PIRATE_SHIP]: Texture }
   * @param {{ w: number, h: number }} tileSize - 瓦片像素尺寸
   * @param {{ x: number, y: number, zoom: number }} viewport - 初始视口
   */
  constructor(textures, tileSize, viewport) {
    /** @type {Ship[]} */
    this._ships = [];
    /** @type {PIXI.Container} */
    this.container = new PIXI.Container();
    /** @type {Function|null} ticker 回调引用 */
    this._tickerFn = null;

    this._textures = textures;
    this._tileSize = tileSize;
    this._viewport = viewport;

    this._createFleet();
    this._startTicker();
  }

  /**
   * 更新视口引用（外部视口变化时调用）
   * @param {{ x: number, y: number, zoom: number }} viewport
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

    // 水域范围
    const waterMinX = shoreX + 2;
    const waterMaxX = shoreX + 100;

    // Y轴范围
    const tileW = this._tileSize.w;
    const zoom = this._viewport.zoom;
    const screenH = window.innerHeight;
    const halfViewY = screenH / (2 * zoom * tileW);
    const waterMinY = -halfViewY * 3;
    const waterMaxY = halfViewY * 3;

    // 生成 15~25 艘船
    const shipCount = 15 + Math.floor(Math.random() * 10);

    for (let i = 0; i < shipCount; i++) {
      const isPirate = Math.random() < 0.35;
      const texture = isPirate ? pirateTexture : shipTexture;
      if (!texture) continue;

      // 随机初始位置：靠近岸线的概率更高
      let x;
      const posRoll = Math.random();
      if (posRoll < 0.5) {
        x = waterMinX + Math.random() * 8;
      } else if (posRoll < 0.8) {
        x = waterMinX + 8 + Math.random() * 20;
      } else {
        x = waterMinX + 28 + Math.random() * 70;
      }

      const y = waterMinY + Math.random() * (waterMaxY - waterMinY);

      const ship = new Ship({
        texture,
        tileType: isPirate ? TILE.PIRATE_SHIP : TILE.SHIP,
        worldX: x,
        worldY: y,
        speed: isPirate ? (0.5 + Math.random() * 0.8) : (0.3 + Math.random() * 0.6),
        patrolMinX: waterMinX,
        patrolMaxX: waterMaxX,
        patrolMinY: waterMinY,
        patrolMaxY: waterMaxY,
      });

      this._ships.push(ship);
      this.container.addChild(ship.sprite);
    }
  }

  /**
   * 注册 PixiJS ticker 驱动船只移动
   * @private
   */
  _startTicker() {
    if (this._ships.length === 0) return;

    // PixiJS v8 ticker 回调参数是 deltaTime（数字），1.0 = 60fps 一帧
    this._tickerFn = (deltaTime) => {
      const dt = (deltaTime || 0) / 60;
      for (const ship of this._ships) {
        ship.update(dt, this._ships);
      }
    };
  }

  /**
   * 将 ticker 回调添加到 PIXI.Ticker
   * @param {PIXI.Ticker} ticker
   */
  attachTicker(ticker) {
    if (this._tickerFn && ticker) {
      ticker.add(this._tickerFn);
    }
  }

  /**
   * 从 PIXI.Ticker 移除回调
   * @param {PIXI.Ticker} ticker
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
    // 精灵已被 container.destroy 销毁，只需清空引用
    for (const ship of this._ships) {
      ship.sprite = null;
    }
    this._ships = [];
    this.container.destroy({ children: true });
    this.container = null;
    this._tickerFn = null;
  }
}
