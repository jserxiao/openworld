/**
 * MapCanvasRenderer - 画布渲染协调层（无限地图版）
 *
 * 重构后的职责：
 * - 协调 Viewport、InteractionController、ShipFleet、AssetLoader、ChunkManager
 * - 管理区块容器的创建/销毁和装饰层重建
 * - 不再直接处理交互、加载、坐标转换等底层细节
 *
 * 坐标体系说明：
 * - 视口 (viewport.x, viewport.y) 使用瓦片坐标
 * - mapContainer 的缩放 = viewport.zoom * tileW
 * - 区块容器位置 = (chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE)（瓦片坐标）
 * - 所有精灵位置也使用瓦片坐标
 */

import * as PIXI from 'pixi.js';
import { TILE, TILE_ROTATION, CHUNK_SIZE, CHUNK_PRELOAD_MARGIN, WATER_CONFIG } from './constants';
import { ChunkManager } from './chunk';
import { Viewport } from './viewport';
import { InteractionController } from './interaction';
import { AssetLoader } from './assetLoader';
import { ShipFleet } from './ship';
import { isRoadTile, isHillTile, isBeachTile, isDecorSprite } from './tileUtils';

export class MapCanvasRenderer {
  /**
   * @param {object} [mapOptions] - 地图生成配置，透传给 ChunkManager
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
    /** @type {Viewport} 视口管理器 */
    this._viewport = new Viewport(this.tileSize);
    /** 上次渲染的区块集合key，用于增量更新 */
    this._lastRenderedChunks = new Set();
    /** 区块容器缓存 key=chunkKey -> PIXI.Container */
    this._chunkContainers = new Map();
    /** 装饰物容器（需要按y排序） */
    this._decorContainer = null;
    /** 装饰层重建节流 */
    this._decorRebuildPending = false;
    /** 是否有区块更新待渲染 */
    this._chunksUpdatePending = false;

    // ── 子模块（初始化时创建） ──
    /** @type {InteractionController|null} */
    this._interaction = null;
    /** @type {ShipFleet|null} */
    this._shipFleet = null;

    // ── 回调 ──
    this._onViewportChange = null;
    this._onTileHover = null;

    // ── 窗口 resize 监听 ──
    this._onResize = null;
  }

  /**
   * 获取当前视口状态（兼容旧接口）
   */
  get viewport() {
    return this._viewport.state;
  }

  /**
   * 设置视口状态
   */
  set viewport(state) {
    this._viewport.state = state;
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
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
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
        this._viewport.applyTransform(this.mapContainer);
      }
    };
    window.addEventListener('resize', this._onResize);

    // 注册交互控制器
    this._interaction = new InteractionController({
      canvas,
      getViewport: () => this._viewport.state,
      setViewport: (state) => { this._viewport.state = state; },
      tileSize: this.tileSize,
      onViewportMoved: () => this._onViewportMoved(),
      onTileHover: (tileX, tileY) => {
        if (this._onTileHover) {
          const tile = this.chunkManager.getTile(tileX, tileY);
          this._onTileHover(tileX, tileY, tile);
        }
      },
      screenToWorldTile: (sx, sy) => this._viewport.screenToWorldTile(sx, sy),
    });

    // 注册 Worker 回调
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
    this._renderChunkContainer(chunk);
    this._lastRenderedChunks.add(key);
    if (!this._chunksUpdatePending) {
      this._chunksUpdatePending = true;
      requestAnimationFrame(() => {
        this._rebuildDecorLayer();
        this._chunksUpdatePending = false;
      });
    }
  }

  /**
   * 视口移动后的处理
   * @private
   */
  _onViewportMoved() {
    this._requestVisibleChunks();
    this._viewport.applyTransform(this.mapContainer);

    // 更新船队视口引用
    if (this._shipFleet) {
      this._shipFleet.updateViewport(this._viewport.state);
    }

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
   * 请求加载视口范围内的区块
   * @private
   */
  _requestVisibleChunks() {
    if (!this.mapContainer) return;

    const range = this._viewport.getVisibleTileRange();

    const startCX = Math.floor(range.x / CHUNK_SIZE) - CHUNK_PRELOAD_MARGIN;
    const startCY = Math.floor(range.y / CHUNK_SIZE) - CHUNK_PRELOAD_MARGIN;
    const endCX = Math.floor(range.endX / CHUNK_SIZE) + CHUNK_PRELOAD_MARGIN;
    const endCY = Math.floor(range.endY / CHUNK_SIZE) + CHUNK_PRELOAD_MARGIN;

    const currentChunkKeys = new Set();
    const needLoad = [];

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const key = `${cx},${cy}`;
        currentChunkKeys.add(key);

        const chunk = this.chunkManager.getChunkIfLoaded(cx, cy);
        if (chunk) {
          if (!this._lastRenderedChunks.has(key)) {
            this._renderChunkContainer(chunk);
          }
        } else {
          needLoad.push({ chunkX: cx, chunkY: cy });
        }
      }
    }

    // 移除不再可见的区块容器
    for (const key of this._lastRenderedChunks) {
      if (!currentChunkKeys.has(key)) {
        this._removeChunkContainer(key);
      }
    }

    this._lastRenderedChunks = currentChunkKeys;

    // 批量请求未加载的区块
    if (needLoad.length > 0) {
      this.chunkManager.loadVisibleChunks(
        range.x, range.y, range.w, range.h, CHUNK_PRELOAD_MARGIN
      ).then(() => {
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
   * 移除指定区块容器并释放资源
   * @private
   * @param {string} key - 区块key
   */
  _removeChunkContainer(key) {
    const container = this._chunkContainers.get(key);
    if (!container) return;

    // 移除装饰物精灵
    if (container._decorSprites && this._decorContainer) {
      for (const { sprite } of container._decorSprites) {
        this._decorContainer.removeChild(sprite);
        sprite.destroy();
      }
    }
    // 释放 RenderTexture
    const groundSprite = container._groundSprite;
    if (groundSprite && groundSprite.texture) {
      groundSprite.texture.destroy(true);
    }
    this.mapContainer.removeChild(container);
    container.destroy({ children: true });
    this._chunkContainers.delete(key);
  }

  /**
   * 为单个区块创建 PIXI 容器
   * @private
   */
  _renderChunkContainer(chunk) {
    const key = `${chunk.chunkX},${chunk.chunkY}`;

    // 如果已有容器，先移除
    const existing = this._chunkContainers.get(key);
    if (existing) {
      this._removeChunkContainer(key);
    }

    const S = CHUNK_SIZE;
    const textures = this.textures;
    const tileW = this.tileSize.w;
    const tileH = this.tileSize.h;

    // 区块在世界中的瓦片偏移
    const offsetX = chunk.chunkX * S;
    const offsetY = chunk.chunkY * S;

    // ── 第一步：构建临时容器，包含所有地面瓦片精灵 ──
    const groundGroup = new PIXI.Container();

    // 收集装饰物（用于全局y排序）
    const decorSprites = [];

    for (let ly = 0; ly < S; ly++) {
      for (let lx = 0; lx < S; lx++) {
        const tile = chunk.map[ly][lx];
        const px = lx * tileW;
        const py = ly * tileH;

        // 装饰物：先铺草地底图，装饰物精灵单独收集
        if (isDecorSprite(tile)) {
          const grassTile = chunk.grassMap[ly][lx];
          const bgSprite = new PIXI.Sprite(textures[grassTile] || textures[TILE.GRASS]);
          bgSprite.x = px;
          bgSprite.y = py;
          groundGroup.addChild(bgSprite);

          const decorSprite = new PIXI.Sprite(textures[tile] || textures[TILE.GRASS]);
          decorSprite.x = offsetX + lx;
          decorSprite.y = offsetY + ly;
          decorSprite.width = 1;
          decorSprite.height = 1;
          decorSprites.push({ sprite: decorSprite, worldY: offsetY + ly });
          continue;
        }

        // 道路和山坡铺草地底图
        if (isRoadTile(tile) || isHillTile(tile)) {
          const grassTile = chunk.grassMap[ly][lx];
          const bgSprite = new PIXI.Sprite(textures[grassTile] || textures[TILE.GRASS]);
          bgSprite.x = px;
          bgSprite.y = py;
          groundGroup.addChild(bgSprite);
        }

        // 沙滩边缘瓦片：先铺水底图
        if (isBeachTile(tile)) {
          const waterBg = new PIXI.Sprite(textures[TILE.WATER] || textures[TILE.GRASS]);
          waterBg.x = px;
          waterBg.y = py;
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
          sprite.x = px + tileW / 2;
          sprite.y = py + tileH / 2;
          sprite.rotation = rotation;
        } else {
          sprite.x = px;
          sprite.y = py;
        }
        groundGroup.addChild(sprite);
      }
    }

    // ── 第二步：将地面容器渲染到 RenderTexture ──
    const rtWidth = S * tileW;
    const rtHeight = S * tileH;
    const renderTexture = PIXI.RenderTexture.create({
      width: rtWidth,
      height: rtHeight,
      resolution: 1,
    });
    this.app.renderer.render(groundGroup, { renderTexture });
    groundGroup.destroy({ children: true });

    // ── 第三步：创建区块容器 ──
    const container = new PIXI.Container();
    container.x = offsetX;
    container.y = offsetY;

    const groundSprite = new PIXI.Sprite(renderTexture);
    groundSprite.scale.set(1 / tileW, 1 / tileH);
    container.addChild(groundSprite);
    container._groundSprite = groundSprite;
    container._decorSprites = decorSprites;

    this._chunkContainers.set(key, container);
    this.mapContainer.addChild(container);

    // 确保装饰层和船容器始终在所有区块容器之上
    if (this._decorContainer) {
      this.mapContainer.addChild(this._decorContainer);
    }
    if (this._shipFleet) {
      this.mapContainer.addChild(this._shipFleet.container);
    }

    return container;
  }

  /**
   * 重建装饰物层（视口裁剪 + Y排序）
   * @private
   */
  _rebuildDecorLayer() {
    if (!this.mapContainer) return;

    if (!this._decorContainer) {
      this._decorContainer = new PIXI.Container();
      this.mapContainer.addChild(this._decorContainer);
    }

    this._decorContainer.removeChildren();

    // 计算视口可见范围
    const range = this._viewport.getVisibleTileRange();
    const margin = 2;
    const minX = range.x - margin;
    const maxX = range.endX + margin;
    const minY = range.y - margin;
    const maxY = range.endY + margin;

    // 收集可见范围内的装饰物
    const visibleDecors = [];
    for (const [, container] of this._chunkContainers) {
      if (!container._decorSprites) continue;
      for (const decor of container._decorSprites) {
        if (decor.worldY >= minY && decor.worldY <= maxY &&
            decor.sprite.x >= minX && decor.sprite.x <= maxX) {
          visibleDecors.push(decor);
        }
      }
    }

    visibleDecors.sort((a, b) => a.worldY - b.worldY);
    for (const { sprite } of visibleDecors) {
      this._decorContainer.addChild(sprite);
    }

    // 确保船容器在装饰层之上
    if (this._shipFleet) {
      this.mapContainer.addChild(this._shipFleet.container);
    }
  }

  /**
   * 加载素材纹理（委托给 AssetLoader）
   * @returns {Promise<void>}
   */
  async loadAssets() {
    const result = await AssetLoader.load();
    this.textures = result.textures;
    this.tileSize = result.tileSize;

    // 更新子模块的 tileSize
    this._viewport.updateTileSize(this.tileSize);
    if (this._interaction) {
      this._interaction.updateTileSize(this.tileSize);
    }

    // 纹理加载完后初始化船队
    this._shipFleet = new ShipFleet(this.textures, this.tileSize, this._viewport.state);
    this.mapContainer.addChild(this._shipFleet.container);
    this._shipFleet.attachTicker(this.app.ticker);
  }

  /**
   * 初始渲染
   */
  async renderInitial() {
    this._lastRenderedChunks = new Set();
    this._chunkContainers = new Map();

    const range = this._viewport.getVisibleTileRange();
    const chunks = await this.chunkManager.loadVisibleChunks(
      range.x, range.y, range.w, range.h, CHUNK_PRELOAD_MARGIN
    );

    for (const chunk of chunks) {
      const key = `${chunk.chunkX},${chunk.chunkY}`;
      this._lastRenderedChunks.add(key);
      this._renderChunkContainer(chunk);
    }

    this._rebuildDecorLayer();
    this._viewport.applyTransform(this.mapContainer);
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
    this._viewport.reset();
    this._clearAllContainers();
    this._requestVisibleChunks();
    this._rebuildDecorLayer();
    this._viewport.applyTransform(this.mapContainer);
  }

  /**
   * 将视图居中到指定世界瓦片坐标
   */
  centerOn(worldTileX, worldTileY) {
    this._viewport.centerOn(worldTileX, worldTileY);
    this._onViewportMoved();
  }

  /**
   * 将视图居中到岸线附近
   */
  centerOnShoreline() {
    const shoreX = WATER_CONFIG.shoreX;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileW = this.tileSize.w;
    const zoom = this._viewport.state.zoom;
    this._viewport.state.x = shoreX - (screenW * 0.25) / (zoom * tileW);
    this._viewport.state.y = -screenH / (2 * zoom * tileW);
    this._onViewportMoved();
  }

  /**
   * 清空所有区块容器
   * @private
   */
  _clearAllContainers() {
    for (const [, container] of this._chunkContainers) {
      const groundSprite = container._groundSprite;
      if (groundSprite && groundSprite.texture) {
        groundSprite.texture.destroy(true);
      }
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
    const { tileX, tileY } = this._viewport.screenToWorldTile(clientX, clientY);
    return { tileX, tileY, valid: true };
  }

  /**
   * 获取当前视口信息
   */
  getViewportInfo() {
    const stats = this.chunkManager.getStats();
    return this._viewport.getInfo(stats);
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
    if (this._interaction) {
      this._interaction.setOnTileHover(cb ? (tileX, tileY) => {
        if (this._onTileHover) {
          const tile = this.chunkManager.getTile(tileX, tileY);
          this._onTileHover(tileX, tileY, tile);
        }
      } : null);
    }
  }

  /**
   * 销毁渲染器，释放资源
   */
  destroy() {
    // 清理船队
    if (this._shipFleet) {
      this._shipFleet.detachTicker(this.app.ticker);
      this._shipFleet.destroy();
      this._shipFleet = null;
    }

    // 清理交互控制器
    if (this._interaction) {
      this._interaction.destroy();
      this._interaction = null;
    }

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
