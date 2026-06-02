/**
 * MapCanvasRenderer - 画布渲染层（无限地图版）
 * 封装 PixiJS 操作，按区块(Chunk)渲染可见区域
 * 支持拖拽平移和滚轮缩放，视口驱动区块加载
 *
 * 坐标体系说明：
 * - 视口 (viewport.x, viewport.y) 使用瓦片坐标
 * - mapContainer 的缩放 = viewport.zoom * tileW（1个瓦片对应 tileW 个屏幕像素）
 * - 区块容器位置 = (chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE)（瓦片坐标）
 * - 所有精灵位置也使用瓦片坐标
 */

import * as PIXI from 'pixi.js';
import { TILE, TILE_COLORS, TILE_ASSETS, TILE_ROTATION, CHUNK_SIZE, CHUNK_PRELOAD_MARGIN } from './constants';
import { ChunkManager } from './chunk';
import { isRoadTile } from './road';
import { isTreeTile } from './tree';
import { isDecorationTile, isHillTile } from './decorations';

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
   * 视口移动后的处理：更新可见区块 + 应用变换
   */
  _onViewportMoved() {
    this._updateVisibleChunks();
    this._applyViewportTransform();
    if (this._onViewportChange) {
      this._onViewportChange(this.getViewportInfo());
    }
    // 节流重建装饰层（避免拖拽时频繁重建）
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
   * mapContainer 的坐标体系：
   * - 1个单位 = 1个瓦片
   * - 缩放后1个瓦片 = zoom * tileW 个屏幕像素
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
   * 更新可见区块（增量方式）
   */
  _updateVisibleChunks() {
    if (!this.mapContainer) return;

    const { zoom, x: viewX, y: viewY } = this.viewport;
    const tileW = this.tileSize.w;

    // 视口覆盖的瓦片范围
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileViewW = screenW / (zoom * tileW);
    const tileViewH = screenH / (zoom * tileW);

    // 获取可见区块
    const visibleChunks = this.chunkManager.getVisibleChunks(
      viewX, viewY, tileViewW, tileViewH, CHUNK_PRELOAD_MARGIN
    );

    const currentChunkKeys = new Set();

    // 渲染新增区块
    for (const chunk of visibleChunks) {
      const key = `${chunk.chunkX},${chunk.chunkY}`;
      currentChunkKeys.add(key);

      if (!this._lastRenderedChunks.has(key)) {
        this._renderChunkContainer(chunk);
      }
    }

    // 移除不再可见的区块容器
    for (const key of this._lastRenderedChunks) {
      if (!currentChunkKeys.has(key)) {
        const container = this._chunkContainers.get(key);
        if (container) {
          // 先清理该区块关联的装饰物精灵（从_decorContainer中移除）
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

    // 装饰层重建在 _onViewportMoved 中通过 requestAnimationFrame 节流执行
  }

  /**
   * 为单个区块创建 PIXI 容器
   * 所有坐标使用瓦片单位（1个单位 = 1个瓦片大小）
   */
  _renderChunkContainer(chunk) {
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

    const key = `${chunk.chunkX},${chunk.chunkY}`;
    this._chunkContainers.set(key, container);
    this.mapContainer.addChild(container);

    return container;
  }

  /**
   * 重建装饰物层（全局y排序）
   */
  _rebuildDecorLayer() {
    if (this._decorContainer) {
      this.mapContainer.removeChild(this._decorContainer);
      this._decorContainer.removeChildren();
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
  }

  /**
   * 加载素材纹理
   * @returns {Promise<void>}
   */
  async loadAssets() {
    const rawTextures = {};
    let tileW = 64;
    let tileH = 64;

    for (const [key, path] of Object.entries(TILE_ASSETS)) {
      try {
        const texture = await PIXI.Assets.load(path);
        rawTextures[parseInt(key)] = texture;
        if (parseInt(key) === TILE.GRASS_1) {
          tileW = texture.width;
          tileH = texture.height;
        }
      } catch {
        const tileType = parseInt(key);
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        const hex = TILE_COLORS[tileType] || 0x555555;
        const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, 64, 64);
        rawTextures[tileType] = PIXI.Texture.from(c);
      }
    }

    this.textures = rawTextures;
    this.tileSize = { w: tileW, h: tileH };
  }

  /**
   * 初始渲染（启动后首次绘制）
   */
  renderInitial() {
    this._lastRenderedChunks = new Set();
    this._chunkContainers = new Map();
    this._updateVisibleChunks();
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
    this._updateVisibleChunks();
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
      this.mapContainer.removeChild(this._decorContainer);
      this._decorContainer.removeChildren();
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
    this.chunkManager.clearCache();
  }
}
