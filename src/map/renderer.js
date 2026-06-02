/**
 * MapCanvasRenderer - 画布渲染层（无限地图版）
 * 封装 PixiJS 操作，按区块(Chunk)渲染可见区域
 * 支持拖拽平移和滚轮缩放，视口驱动区块加载
 * 区块生成通过 Web Worker 异步执行，不阻塞主线程
 *
 * 坐标体系说明：
 * - 视口 (viewport.x, viewport.y) 使用瓦片坐标
 * - mapContainer 的缩放 = viewport.zoom * tileW（1个瓦片对应 tileW 个屏幕像素）
 * - 区块容器位置 = (chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE)（瓦片坐标）
 * - 所有精灵位置也使用瓦片坐标
 */

import * as PIXI from 'pixi.js';
import { TILE, TILE_COLORS, TILE_ASSETS, TILE_ROTATION, CHUNK_SIZE, CHUNK_PRELOAD_MARGIN, WATER_CONFIG } from './constants';
import { ChunkManager } from './chunk';
import { isRoadTile } from './road';
import { isTreeTile } from './tree';
import { isDecorationTile, isHillTile, isBeachTile, isWaterTile } from './decorations';

// ────────────────────────────────────────────
// 船精灵 - 水域随机航行动态精灵
// ────────────────────────────────────────────

/**
 * 船精灵类
 *
 * 在水域上随机航行，沿任意方向移动
 * 船头始终朝向移动方向
 * 到达巡逻边界时随机转向
 *
 * 坐标体系：worldX/worldY 为瓦片坐标（浮点数），与 mapContainer 一致
 */
class Ship {
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
    this._turnTimer = 1 + Math.random() * 3; // 1~4秒后转向
    this._turnInterval = 1 + Math.random() * 4; // 每次转向间隔

    // 波浪微漂移
    this._driftPhase = Math.random() * Math.PI * 2;

    // 创建精灵
    this.sprite = new PIXI.Sprite(options.texture);
    this.sprite.anchor.set(0.5);
    this.tileType = options.tileType;

    // 保持原始宽高比，以高度为基准缩放到2个瓦片高度（船比较大，容易看到）
    const texW = options.texture.width;
    const texH = options.texture.height;
    const aspect = texW / texH;
    this.sprite.height = 2;
    this.sprite.width = 2 * aspect;
    // 限制宽度不超过2.4瓦片
    if (this.sprite.width > 2.4) {
      this.sprite.width = 2.4;
      this.sprite.height = 2.4 / aspect;
    }

    this._updateSpritePosition();
  }

  /**
   * 每帧更新（由 ticker 调用）
   * @param {number} dt - 帧间隔时间（秒）
   */
  /**
   * 碰撞半径（瓦片单位），用于船与船之间的碰撞检测
   */
  get collisionRadius() {
    return Math.max(this.sprite.width, this.sprite.height) * 0.45;
  }

  update(dt, otherShips) {
    // 定期随机微调航向（模拟自然航行）
    this._turnTimer -= dt;
    if (this._turnTimer <= 0) {
      this._turnTimer = this._turnInterval;
      // 随机偏转 -30° ~ +30°
      this.heading += (Math.random() - 0.5) * Math.PI / 3;
    }

    // 波浪微漂移（叠加到航向上）
    this._driftPhase += 0.5 * dt;
    const driftOffset = Math.sin(this._driftPhase) * 0.02;

    // 根据航向移动
    // heading: 0=北(Y-), π/2=东(X+), π=南(Y+), 3π/2=西(X-)
    const effectiveHeading = this.heading + driftOffset;
    const dx = Math.sin(effectiveHeading) * this.speed * dt;
    const dy = -Math.cos(effectiveHeading) * this.speed * dt;

    // 计算新位置
    const newX = this.worldX + dx;
    const newY = this.worldY + dy;

    // 碰撞检测：检查新位置是否与其他船重叠
    if (otherShips && otherShips.length > 0) {
      const myRadius = this.collisionRadius;
      for (const other of otherShips) {
        if (other === this) continue;
        const distSq = (newX - other.worldX) ** 2 + (newY - other.worldY) ** 2;
        const minDist = myRadius + other.collisionRadius;
        if (distSq < minDist * minDist) {
          // 碰撞：计算从对方指向自己的方向，主动推开 + 转向
          const dist = Math.sqrt(distSq) || 0.01;
          const pushAngle = Math.atan2(this.worldX - other.worldX, -(this.worldY - other.worldY));
          // 1. 转向远离对方
          this.heading = pushAngle + (Math.random() - 0.5) * Math.PI / 3;
          // 2. 主动推开：如果已经重叠，沿远离方向移动推开距离
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

    // 边界反弹：到达巡逻边界时转向
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
      // 朝向巡逻区域中心方向偏转
      const centerX = (this.patrolMinX + this.patrolMaxX) / 2;
      const centerY = (this.patrolMinY + this.patrolMaxY) / 2;
      const toCenterAngle = Math.atan2(centerX - this.worldX, -(centerY - this.worldY));
      // 在朝向中心的方向上随机偏移 ±60°
      this.heading = toCenterAngle + (Math.random() - 0.5) * Math.PI / 1.5;
    }

    this._updateSpritePosition();
  }

  /**
   * 更新精灵位置和旋转
   * @private
   */
  _updateSpritePosition() {
    this.sprite.x = this.worldX;
    this.sprite.y = this.worldY;

    // 船头朝向航向
    // 船.png 原图船头朝下(南)，需要加 π 才能朝向前进方向
    // heading=0(北) → 旋转π(180°) → 船头从朝下变为朝上
    // heading 增大 = 顺时针旋转
    this.sprite.rotation = this.heading + Math.PI;
  }

  /**
   * 销毁精灵
   */
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

export class MapCanvasRenderer {
  /**
   * @param {object} [mapOptions] - 地图生成配置，透传给 ChunkManager
   * @param {object} [mapOptions.forest] - 森林生成配置，覆盖 FOREST_CONFIG 默认值
   */
  constructor(mapOptions = {}) {
    /** @type {PIXI.Application|null} */
    this.app = null;
    /** @type {PIXI.Container|null} 地图容器 */
    this.mapContainer = null;
    /** @type {Object<number, PIXI.Texture>} 瓦片纹理 */
    this.textures = {};
    /** @type {{ w: number, h: number }} 瓦片像素尺寸 */
    this.tileSize = { w: 64, h: 64 };
    /** @type {HTMLDivElement|null} */
    this.containerEl = null;

    // ── 无限地图相关 ──
    /** @type {ChunkManager} */
    this.chunkManager = new ChunkManager(mapOptions);
    /** 当前视口状态（瓦片坐标） */
    this.viewport = { x: 0, y: 0, zoom: 1 };
    /** 上次渲染的区块集合key，用于增量更新 */
    this._lastRenderedChunks = new Set();
    /** 区块容器缓存 key=chunkKey -> PIXI.Container */
    this._chunkContainers = new Map();
    /** 装饰物容器（需要按y排序） */
    this._decorContainer = null;
    /** 是否正在拖拽 */
    this._dragging = false;
    this._dragStart = { x: 0, y: 0 };
    this._viewportStart = { x: 0, y: 0 };
    /** 视口变化回调 */
    this._onViewportChange = null;
    /** 悬停回调 */
    this._onTileHover = null;
    /** 装饰层重建节流 */
    this._decorRebuildPending = false;
    /** 是否有区块更新待渲染（Worker返回后触发） */
    this._chunksUpdatePending = false;

    // ── 船 ──
    /** @type {Ship[]} 水域上的船 */
    this._ships = [];
    /** @type {Function|null} ticker 回调引用 */
    this._shipTickerFn = null;
    /** @type {PIXI.Container|null} 船专用容器（独立于装饰层，避免频繁重建） */
    this._shipContainer = null;
  }

  /**
   * 初始化 PixiJS 应用
   * @param {HTMLDivElement} containerEl - 挂载容器
   * @returns {Promise<void>}
   */
  async init(containerEl) {
    this.containerEl = containerEl;

    this.app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x0d1117,
      antialias: false,
      resolution: 1,
      autoDensity: false,
    });

    const canvas = this.app.view;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '0';

    containerEl.appendChild(canvas);

    this.mapContainer = new PIXI.Container();
    this.app.stage.addChild(this.mapContainer);

    // 窗口大小变化时自动调整画布
    this._onResize = () => {
      if (this.app) {
        this.app.renderer.resize(window.innerWidth, window.innerHeight);
        this._applyViewportTransform();
      }
    };
    window.addEventListener('resize', this._onResize);

    // 注册交互事件
    this._setupInteraction();

    // 注册 Worker 回调：Worker 返回区块数据后自动渲染
    this.chunkManager.setOnChunkReady((chunk) => {
      this._onChunkReady(chunk);
    });
  }

  /**
   * Worker 返回区块数据后的回调
   * @private
   */
  _onChunkReady(chunk) {
    const key = `${chunk.chunkX},${chunk.chunkY}`;
    // 渲染新区块容器
    this._renderChunkContainer(chunk);
    // 标记已渲染
    this._lastRenderedChunks.add(key);
    // 标记需要重建装饰层
    if (!this._chunksUpdatePending) {
      this._chunksUpdatePending = true;
      requestAnimationFrame(() => {
        this._rebuildDecorLayer();
        this._chunksUpdatePending = false;
      });
    }
  }

  /**
   * 设置鼠标/触摸交互（拖拽平移 + 滚轮缩放）
   */
  _setupInteraction() {
    const canvas = this.app.view;

    // 鼠标拖拽
    canvas.addEventListener('mousedown', (e) => {
      this._dragging = true;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._viewportStart = { x: this.viewport.x, y: this.viewport.y };
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        const tileW = this.tileSize.w;
        this.viewport.x = this._viewportStart.x - dx / (this.viewport.zoom * tileW);
        this.viewport.y = this._viewportStart.y - dy / (this.viewport.zoom * tileW);
        this._onViewportMoved();
      }

      // 悬停信息
      if (this._onTileHover && !this._dragging) {
        const { tileX, tileY } = this._screenToWorldTile(e.clientX, e.clientY);
        const tile = this.chunkManager.getTile(tileX, tileY);
        this._onTileHover(tileX, tileY, tile);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this._dragging) {
        this._dragging = false;
        canvas.style.cursor = 'grab';
      }
    });

    canvas.style.cursor = 'grab';

    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { tileX, tileY } = this._screenToWorldTile(e.clientX, e.clientY);

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.25, Math.min(3, this.viewport.zoom * zoomFactor));
      const tileW = this.tileSize.w;

      // 缩放时保持鼠标指向的世界瓦片坐标不变
      this.viewport.x = tileX - e.clientX / (newZoom * tileW);
      this.viewport.y = tileY - e.clientY / (newZoom * tileW);
      this.viewport.zoom = newZoom;

      this._onViewportMoved();
    }, { passive: false });

    // 触摸拖拽（移动端）
    let touchStart = null;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchStart = { x: t.clientX, y: t.clientY };
        this._viewportStart = { x: this.viewport.x, y: this.viewport.y };
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && touchStart) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - touchStart.x;
        const dy = t.clientY - touchStart.y;
        const tileW = this.tileSize.w;
        this.viewport.x = this._viewportStart.x - dx / (this.viewport.zoom * tileW);
        this.viewport.y = this._viewportStart.y - dy / (this.viewport.zoom * tileW);
        this._onViewportMoved();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      touchStart = null;
    });
  }

  /**
   * 屏幕像素坐标 -> 世界瓦片坐标
   */
  _screenToWorldTile(screenX, screenY) {
    const tileW = this.tileSize.w;
    const worldX = this.viewport.x + screenX / (this.viewport.zoom * tileW);
    const worldY = this.viewport.y + screenY / (this.viewport.zoom * tileW);
    return {
      tileX: Math.floor(worldX),
      tileY: Math.floor(worldY),
    };
  }

  /**
   * 视口移动后的处理：请求加载新区块 + 应用变换
   */
  _onViewportMoved() {
    this._requestVisibleChunks();
    this._applyViewportTransform();
    if (this._onViewportChange) {
      this._onViewportChange(this.getViewportInfo());
    }
    // 节流重建装饰层
    if (!this._decorRebuildPending) {
      this._decorRebuildPending = true;
      requestAnimationFrame(() => {
        this._rebuildDecorLayer();
        this._decorRebuildPending = false;
      });
    }
  }

  /**
   * 仅应用视口变换（不重新生成区块）
   */
  _applyViewportTransform() {
    if (!this.mapContainer) return;
    const { zoom, x, y } = this.viewport;
    const tileW = this.tileSize.w;
    this.mapContainer.scale.set(zoom * tileW, zoom * tileW);
    this.mapContainer.x = -x * zoom * tileW;
    this.mapContainer.y = -y * zoom * tileW;
  }

  /**
   * 请求加载视口范围内的区块
   * 对已加载的区块直接渲染，未加载的异步请求 Worker 生成
   * @private
   */
  _requestVisibleChunks() {
    if (!this.mapContainer) return;

    const { zoom, x: viewX, y: viewY } = this.viewport;
    const tileW = this.tileSize.w;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileViewW = screenW / (zoom * tileW);
    const tileViewH = screenH / (zoom * tileW);

    const startCX = Math.floor(viewX / CHUNK_SIZE) - CHUNK_PRELOAD_MARGIN;
    const startCY = Math.floor(viewY / CHUNK_SIZE) - CHUNK_PRELOAD_MARGIN;
    const endCX = Math.floor((viewX + tileViewW) / CHUNK_SIZE) + CHUNK_PRELOAD_MARGIN;
    const endCY = Math.floor((viewY + tileViewH) / CHUNK_SIZE) + CHUNK_PRELOAD_MARGIN;

    const currentChunkKeys = new Set();
    const needLoad = [];

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const key = `${cx},${cy}`;
        currentChunkKeys.add(key);

        const chunk = this.chunkManager.getChunkIfLoaded(cx, cy);
        if (chunk) {
          // 已加载：检查是否需要渲染
          if (!this._lastRenderedChunks.has(key)) {
            this._renderChunkContainer(chunk);
          }
        } else {
          // 未加载：请求 Worker 生成
          needLoad.push({ chunkX: cx, chunkY: cy });
        }
      }
    }

    // 移除不再可见的区块容器
    for (const key of this._lastRenderedChunks) {
      if (!currentChunkKeys.has(key)) {
        const container = this._chunkContainers.get(key);
        if (container) {
          if (container._decorSprites && this._decorContainer) {
            for (const { sprite } of container._decorSprites) {
              this._decorContainer.removeChild(sprite);
              sprite.destroy();
            }
          }
          this.mapContainer.removeChild(container);
          container.destroy({ children: true });
          this._chunkContainers.delete(key);
        }
      }
    }

    this._lastRenderedChunks = currentChunkKeys;

    // 批量请求未加载的区块
    if (needLoad.length > 0) {
      this.chunkManager.loadVisibleChunks(
        viewX, viewY, tileViewW, tileViewH, CHUNK_PRELOAD_MARGIN
      ).then(() => {
        // Worker 返回后，区块通过 _onChunkReady 回调自动渲染
        // 这里只需确保装饰层更新
        if (!this._chunksUpdatePending) {
          this._chunksUpdatePending = true;
          requestAnimationFrame(() => {
            this._rebuildDecorLayer();
            this._chunksUpdatePending = false;
          });
        }
      });
    }
  }

  /**
   * 为单个区块创建 PIXI 容器
   * 所有坐标使用瓦片单位（1个单位 = 1个瓦片大小）
   */
  _renderChunkContainer(chunk) {
    const key = `${chunk.chunkX},${chunk.chunkY}`;

    // 如果已有容器，先移除
    const existing = this._chunkContainers.get(key);
    if (existing) {
      if (existing._decorSprites && this._decorContainer) {
        for (const { sprite } of existing._decorSprites) {
          this._decorContainer.removeChild(sprite);
          sprite.destroy();
        }
      }
      this.mapContainer.removeChild(existing);
      existing.destroy({ children: true });
    }

    const S = CHUNK_SIZE;
    const textures = this.textures;

    // 区块在世界中的瓦片偏移
    const offsetX = chunk.chunkX * S;
    const offsetY = chunk.chunkY * S;

    const container = new PIXI.Container();
    container.x = offsetX;
    container.y = offsetY;

    // 地面层
    const groundGroup = new PIXI.Container();
    container.addChild(groundGroup);

    // 收集装饰物（用于全局y排序）
    const decorSprites = [];

    for (let ly = 0; ly < S; ly++) {
      for (let lx = 0; lx < S; lx++) {
        const tile = chunk.map[ly][lx];
        // 瓦片坐标（1个瓦片 = 1个单位）
        const px = lx;
        const py = ly;

        // 树木和装饰物：先铺草地底图
        if (isTreeTile(tile) || isDecorationTile(tile)) {
          const grassTile = chunk.grassMap[ly][lx];
          const bgSprite = new PIXI.Sprite(textures[grassTile] || textures[TILE.GRASS]);
          bgSprite.x = px;
          bgSprite.y = py;
          bgSprite.width = 1;
          bgSprite.height = 1;
          groundGroup.addChild(bgSprite);

          // 装饰物（稍后全局排序）
          const decorSprite = new PIXI.Sprite(textures[tile] || textures[TILE.GRASS]);
          decorSprite.x = offsetX + px;
          decorSprite.y = offsetY + py;
          decorSprite.width = 1;
          decorSprite.height = 1;
          decorSprites.push({ sprite: decorSprite, worldY: offsetY + py });
          continue;
        }

        // 道路和山坡铺草地底图
        if (isRoadTile(tile) || isHillTile(tile)) {
          const grassTile = chunk.grassMap[ly][lx];
          const bgSprite = new PIXI.Sprite(textures[grassTile] || textures[TILE.GRASS]);
          bgSprite.x = px;
          bgSprite.y = py;
          bgSprite.width = 1;
          bgSprite.height = 1;
          groundGroup.addChild(bgSprite);
        }

        // 沙滩边缘瓦片：先铺水底图（水.png做底），再铺沙滩素材
        if (isBeachTile(tile)) {
          const waterBg = new PIXI.Sprite(textures[TILE.WATER] || textures[TILE.GRASS]);
          waterBg.x = px;
          waterBg.y = py;
          waterBg.width = 1;
          waterBg.height = 1;
          groundGroup.addChild(waterBg);
        }

        const sprite = new PIXI.Sprite(
          tile === TILE.GRASS
            ? (textures[chunk.grassMap[ly][lx]] || textures[TILE.GRASS])
            : (textures[tile] || textures[TILE.GRASS])
        );
        const rotation = TILE_ROTATION[tile] || 0;
        if (rotation !== 0) {
          sprite.anchor.set(0.5);
          sprite.x = px + 0.5;
          sprite.y = py + 0.5;
          sprite.rotation = rotation;
        } else {
          sprite.x = px;
          sprite.y = py;
        }
        sprite.width = 1;
        sprite.height = 1;
        groundGroup.addChild(sprite);
      }
    }

    // 保存装饰物数据
    container._decorSprites = decorSprites;

    this._chunkContainers.set(key, container);
    this.mapContainer.addChild(container);

    // 确保装饰层和船容器始终在所有区块容器之上
    if (this._decorContainer) {
      this.mapContainer.addChild(this._decorContainer);
    }
    if (this._shipContainer) {
      this.mapContainer.addChild(this._shipContainer);
    }

    return container;
  }

  /**
   * 重建装饰物层（全局y排序）
   * 装饰物精灵由区块容器的 _decorSprites 管理，只移出/重新加入，不销毁
   */
  _rebuildDecorLayer() {
    if (!this.mapContainer) return;

    if (this._decorContainer) {
      // 只移出子对象，不销毁精灵（装饰物精灵被区块容器引用，需要保留）
      this._decorContainer.removeChildren();
      this.mapContainer.removeChild(this._decorContainer);
      this._decorContainer.destroy();
    }

    this._decorContainer = new PIXI.Container();
    this.mapContainer.addChild(this._decorContainer);

    const allDecors = [];
    for (const [, container] of this._chunkContainers) {
      if (container._decorSprites) {
        allDecors.push(...container._decorSprites);
      }
    }

    allDecors.sort((a, b) => a.worldY - b.worldY);
    for (const { sprite } of allDecors) {
      this._decorContainer.addChild(sprite);
    }

    // 确保船容器在装饰层之上
    if (this._shipContainer) {
      this.mapContainer.addChild(this._shipContainer);
    }
  }

  /**
   * 初始化船只 - 在水域上随机生成大量船
   * @private
   */
  _initShips() {
    if (!this.mapContainer || !this.app) return;

    const shoreX = WATER_CONFIG.shoreX;
    const pirateTexture = this.textures[TILE.PIRATE_SHIP];
    const shipTexture = this.textures[TILE.SHIP];

    // 水域范围：shoreX+2 到 shoreX+100
    const waterMinX = shoreX + 2;
    const waterMaxX = shoreX + 100;

    // Y轴范围：基于当前视口大小，让大部分船在可见范围内
    // 初始视口Y范围约为 -screenH/(2*zoom*tileW) ~ +screenH/(2*zoom*tileW)
    const tileW = this.tileSize.w;
    const zoom = this.viewport.zoom;
    const screenH = window.innerHeight;
    const halfViewY = screenH / (2 * zoom * tileW);
    // 船的Y范围 = 视口Y范围 × 3（既保证可见，又有些在屏幕外增加自然感）
    const waterMinY = -halfViewY * 3;
    const waterMaxY = halfViewY * 3;

    // 生成 15~25 艘船（减少数量但增大尺寸，更容易看到）
    const shipCount = 15 + Math.floor(Math.random() * 10);

    // 创建船专用容器（独立于装饰层，船每帧移动不需要重建装饰层）
    this._shipContainer = new PIXI.Container();
    this.mapContainer.addChild(this._shipContainer);

    for (let i = 0; i < shipCount; i++) {
      // 随机选择船类型
      const isPirate = Math.random() < 0.35; // 35% 海盗船
      const texture = isPirate ? pirateTexture : shipTexture;
      if (!texture) continue;

      // 随机初始位置：靠近岸线的概率更高
      let x;
      const posRoll = Math.random();
      if (posRoll < 0.5) {
        // 50% 在离岸 2~10 瓦片（最容易看到）
        x = waterMinX + Math.random() * 8;
      } else if (posRoll < 0.8) {
        // 30% 在离岸 10~30 瓦片
        x = waterMinX + 8 + Math.random() * 20;
      } else {
        // 20% 在离岸 30~100 瓦片（远处）
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
      this._shipContainer.addChild(ship.sprite);
    }

    // 注册 ticker 驱动船移动
    // PixiJS v8 ticker 回调参数是 deltaTime（数字，单位为帧），不是 ticker 对象
    if (this._ships.length > 0) {
      this._shipTickerFn = (deltaTime) => {
        // deltaTime 是帧间隔（1.0 = 60fps 下一帧），转为秒
        const dt = (deltaTime || 0) / 60;
        for (const ship of this._ships) {
          ship.update(dt, this._ships);
        }
      };
      this.app.ticker.add(this._shipTickerFn);
    }
  }

  /**
   * 加载素材纹理
   * @returns {Promise<void>}
   */
  async loadAssets() {
    const rawTextures = {};
    let tileW = 64;
    let tileH = 64;

    // 并行加载所有纹理
    const entries = Object.entries(TILE_ASSETS);
    const loadPromises = entries.map(async ([key, path]) => {
      try {
        const texture = await PIXI.Assets.load(path);
        return { key: parseInt(key), texture, isGrass1: parseInt(key) === TILE.GRASS_1 };
      } catch {
        const tileType = parseInt(key);
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        const hex = TILE_COLORS[tileType] || 0x555555;
        const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, 64, 64);
        return { key: tileType, texture: PIXI.Texture.from(c), isGrass1: false };
      }
    });

    const results = await Promise.all(loadPromises);
    for (const { key, texture, isGrass1 } of results) {
      rawTextures[key] = texture;
      if (isGrass1) {
        tileW = texture.width;
        tileH = texture.height;
      }
    }

    this.textures = rawTextures;
    this.tileSize = { w: tileW, h: tileH };

    // 纹理加载完后立即初始化船（不依赖区块渲染）
    this._initShips();
  }

  /**
   * 初始渲染（启动后首次绘制）
   * 异步加载视口区块，先渲染已加载的，Worker 返回后自动补充
   */
  async renderInitial() {
    this._lastRenderedChunks = new Set();
    this._chunkContainers = new Map();

    // 先请求所有可见区块（通过 Worker 异步生成）
    const { zoom, x: viewX, y: viewY } = this.viewport;
    const tileW = this.tileSize.w;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileViewW = screenW / (zoom * tileW);
    const tileViewH = screenH / (zoom * tileW);

    const chunks = await this.chunkManager.loadVisibleChunks(
      viewX, viewY, tileViewW, tileViewH, CHUNK_PRELOAD_MARGIN
    );

    // 渲染所有加载的区块
    for (const chunk of chunks) {
      const key = `${chunk.chunkX},${chunk.chunkY}`;
      this._lastRenderedChunks.add(key);
      this._renderChunkContainer(chunk);
    }

    this._rebuildDecorLayer();
    this._applyViewportTransform();
  }

  /**
   * 兼容旧接口
   * @deprecated 使用 renderInitial() 替代
   */
  render() {
    this.renderInitial();
  }

  /**
   * 重置视图到原点附近
   */
  resetView() {
    this.viewport = { x: 0, y: 0, zoom: 1 };
    this._clearAllContainers();
    this._requestVisibleChunks();
    this._rebuildDecorLayer();
    this._applyViewportTransform();
  }

  /**
   * 将视图居中到指定世界瓦片坐标
   */
  centerOn(worldTileX, worldTileY) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileW = this.tileSize.w;
    this.viewport.x = worldTileX - screenW / (2 * this.viewport.zoom * tileW);
    this.viewport.y = worldTileY - screenH / (2 * this.viewport.zoom * tileW);
    this._onViewportMoved();
  }

  /**
   * 将视图居中到岸线附近，让草地、沙滩、水域同时可见
   * 岸线放在屏幕左侧约1/4处，这样右侧3/4是水域
   */
  centerOnShoreline() {
    const shoreX = WATER_CONFIG.shoreX;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileW = this.tileSize.w;
    const zoom = this.viewport.zoom;
    // 岸线在屏幕左侧 1/4 处
    this.viewport.x = shoreX - (screenW * 0.25) / (zoom * tileW);
    this.viewport.y = -screenH / (2 * zoom * tileW);
    this._onViewportMoved();
  }

  /**
   * 清空所有区块容器
   */
  _clearAllContainers() {
    for (const [, container] of this._chunkContainers) {
      this.mapContainer.removeChild(container);
      container.destroy({ children: true });
    }
    this._chunkContainers.clear();
    this._lastRenderedChunks = new Set();

    if (this._decorContainer) {
      const oldChildren = this._decorContainer.removeChildren();
      for (const child of oldChildren) {
        child.destroy();
      }
      this.mapContainer.removeChild(this._decorContainer);
      this._decorContainer.destroy();
      this._decorContainer = null;
    }
  }

  /**
   * 将屏幕坐标转换为瓦片坐标
   */
  screenToTile(clientX, clientY) {
    const { tileX, tileY } = this._screenToWorldTile(clientX, clientY);
    return { tileX, tileY, valid: true };
  }

  /**
   * 获取当前视口信息
   */
  getViewportInfo() {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const { x, y, zoom } = this.viewport;
    const { w: tileW } = this.tileSize;
    const stats = this.chunkManager.getStats();

    const tileViewW = screenW / (zoom * tileW);
    const tileViewH = screenH / (zoom * tileW);

    return {
      x: Math.floor(x),
      y: Math.floor(y),
      zoom,
      screenW,
      screenH,
      tileSize: tileW,
      tileStartX: Math.floor(x),
      tileStartY: Math.floor(y),
      tileEndX: Math.floor(x + tileViewW),
      tileEndY: Math.floor(y + tileViewH),
      cachedChunks: stats.cachedChunks,
      maxChunks: stats.maxChunks,
      pendingRequests: stats.pendingRequests,
      workerReady: stats.workerReady,
    };
  }

  /**
   * 导出当前画布为 PNG
   */
  exportPNG() {
    if (!this.app) return;
    try {
      const url = this.app.renderer.extract.base64(this.app.stage);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'map.png';
      a.click();
    } catch (e) {
      console.error('导出失败:', e);
    }
  }

  /**
   * 获取画布 DOM 元素
   */
  getCanvas() {
    return this.app ? this.app.view : null;
  }

  /**
   * 获取 PIXI ticker
   */
  getTicker() {
    return this.app ? this.app.ticker : null;
  }

  /**
   * 注册视口变化回调
   */
  setOnViewportChange(cb) {
    this._onViewportChange = cb;
  }

  /**
   * 注册瓦片悬停回调
   */
  setOnTileHover(cb) {
    this._onTileHover = cb;
  }

  /**
   * 销毁渲染器，释放资源
   */
  destroy() {
    // 清理船只
    if (this._shipTickerFn && this.app) {
      this.app.ticker.remove(this._shipTickerFn);
      this._shipTickerFn = null;
    }

    // 清理船容器（销毁容器及其子精灵）
    if (this._shipContainer) {
      this._shipContainer.destroy({ children: true });
      this._shipContainer = null;
    }

    // 清空船引用（精灵已被船容器销毁，只需清空引用）
    for (const ship of this._ships) {
      ship.sprite = null;
    }
    this._ships = [];

    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    this._clearAllContainers();
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
    this.mapContainer = null;
    this.textures = {};
    this.containerEl = null;
    this.chunkManager.destroy();
  }
}
