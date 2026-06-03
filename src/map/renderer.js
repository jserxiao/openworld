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
import { TILE, TILE_ROTATION, CHUNK_SIZE, CHUNK_PRELOAD_MARGIN, WATER_CONFIG, DIRT_CONFIG } from './constants';
import { ChunkManager } from './chunk';
import { Viewport } from './viewport';
import { InteractionController } from './interaction';
import { AssetLoader } from './assetLoader';
import { ShipFleetECS as ShipFleet, Position, Navigating, Combat, targetQuery } from './ecs';
import { hasComponent } from 'bitecs/legacy';
import { isRoadTile, isHillTile, isBeachTile, isDecorSprite, isTreeTile, isDecorationTile, isDirtRoadTile, isDirtTile, isPurpleTreeTile, isMalachiteTile } from './tileUtils';
import { gameEvents, GameEvent } from './eventBus';
import { createSpritePool, createContainerPool } from './objectPool';
import { LODManager } from './lodManager';
import { DecorSpatialIndex } from './decorSpatialIndex';
import { ProjectileManager } from './projectileManager';
import { VfxManager } from './vfxManager';

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

    // ── 事件监听清理函数 ──
    this._eventUnsubs = [];

    // ── 图集纹理引用（销毁时需释放） ──
    this._atlasTexture = null;
    this._atlasEnabled = false;

    // ── 对象池（复用精灵和容器，减少 GC 压力） ──
    this._spritePool = createSpritePool({ maxSize: 4096 });
    this._containerPool = createContainerPool({ maxSize: 256 });

    // ── LOD 管理器（根据缩放调整渲染精度） ──
    this._lod = new LODManager();
    /** 当前 LOD 级别的 RenderTexture 分辨率 */
    this._currentRTResolution = 1.0;

    // ── 装饰层空间索引（替代全量遍历+排序） ──
    this._decorIndex = new DecorSpatialIndex();

    // ── 战斗子系统（弹道 + 特效） ──
    /** @type {ProjectileManager|null} */
    this._projectileManager = null;
    /** @type {VfxManager|null} */
    this._vfxManager = null;

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
        const tile = this.chunkManager.getTile(tileX, tileY);
        gameEvents.emit(GameEvent.TILE_HOVER, { tileX, tileY, tileType: tile });
      },
      screenToWorldTile: (sx, sy) => this._viewport.screenToWorldTile(sx, sy),
    });

    // 注册 Worker 回调
    this.chunkManager.setOnChunkReady((chunk) => {
      this._onChunkReady(chunk);
    });

    // ── 事件总线：仅做 emit，UI 层直接订阅 GameEvent.VIEWPORT_INFO ──
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

    // 更新 LOD 级别
    const lodChanged = this._lod.update(this._viewport.state.zoom);
    if (lodChanged) {
      this._currentRTResolution = this._lod.resolution;
      // LOD 级别变化时需要重新渲染所有可见区块容器
      if (this._lod.level === 2 && this._decorContainer) {
        // Low LOD: 隐藏整个装饰层
        this._decorContainer.visible = false;
      } else if (this._decorContainer) {
        this._decorContainer.visible = true;
      }
      // 重新渲染所有区块以应用新的 RenderTexture 分辨率
      this._rerenderAllChunks();
    }

    gameEvents.emit(GameEvent.VIEWPORT_MOVED, this._viewport.state);
    gameEvents.emit(GameEvent.VIEWPORT_INFO, this.getViewportInfo());
    // 节流重建装饰层
    if (!this._decorRebuildPending && this._lod.showDecorations) {
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
   * 移除指定区块容器并释放资源（归还对象池）
   * @private
   * @param {string} key - 区块key
   */
  _removeChunkContainer(key) {
    const container = this._chunkContainers.get(key);
    if (!container) return;

    // 从空间索引中移除该区块的装饰物
    const removedEntries = this._decorIndex.removeChunk(key);

    // 移除装饰物精灵，归还对象池
    if (this._decorContainer) {
      for (const entry of removedEntries) {
        this._decorContainer.removeChild(entry.sprite);
        this._spritePool.release(entry.sprite);
      }
    }
    // 释放 RenderTexture（不归池，GPU资源必须销毁）
    const groundSprite = container._groundSprite;
    if (groundSprite && groundSprite.texture) {
      groundSprite.texture.destroy(true);
    }
    // 归还 groundSprite 到精灵池
    if (groundSprite) {
      this._spritePool.release(groundSprite);
    }
    this.mapContainer.removeChild(container);
    // 归还容器到容器池
    this._containerPool.release(container);
    this._chunkContainers.delete(key);
  }

  /**
   * 为单个区块创建 PIXI 容器
   * 使用对象池复用精灵对象，减少 GC 压力
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

    // 临时收集地面精灵引用（烘焙后归还池）
    const groundSprites = [];

    for (let ly = 0; ly < S; ly++) {
      for (let lx = 0; lx < S; lx++) {
        const tile = chunk.map[ly][lx];
        const px = lx * tileW;
        const py = ly * tileH;

        // 确定当前格的底图类型：根据瓦片类型或世界坐标判断
        // 土地/土路/紫树/孔雀石都属于土地区域，底图用 dirtMap
        const worldX = offsetX + lx;
        const isDirtArea = isDirtTile(tile) || isDirtRoadTile(tile) || isPurpleTreeTile(tile) || isMalachiteTile(tile)
          || worldX >= DIRT_CONFIG.dirtStartX;
        const bgTile = isDirtArea
          ? (chunk.dirtMap && chunk.dirtMap[ly] ? chunk.dirtMap[ly][lx] : TILE.DIRT_1)
          : chunk.grassMap[ly][lx];
        const bgTexture = isDirtArea
          ? (textures[bgTile] || textures[TILE.DIRT_1] || textures[TILE.GRASS])
          : (textures[bgTile] || textures[TILE.GRASS]);

        // 装饰物：先铺底图（草地或土地），装饰物精灵单独收集
        if (isDecorSprite(tile)) {
          const bgSprite = this._spritePool.acquire();
          bgSprite.texture = bgTexture;
          bgSprite.x = px;
          bgSprite.y = py;
          groundGroup.addChild(bgSprite);
          groundSprites.push(bgSprite);

          const decorSprite = this._spritePool.acquire();
          decorSprite.texture = textures[tile] || textures[TILE.GRASS];
          const worldY = offsetY + ly;
          decorSprite.x = worldX;
          decorSprite.y = worldY;
          decorSprite.width = 1;
          decorSprite.height = 1;
          decorSprite.visible = false; // 初始不可见，等 _rebuildDecorLayer 设置
          decorSprites.push({ sprite: decorSprite, worldX, worldY, tileType: tile });
          continue;
        }

        // 道路和山坡铺底图（草地或土地）
        if (isRoadTile(tile) || isHillTile(tile)) {
          const bgSprite = this._spritePool.acquire();
          bgSprite.texture = bgTexture;
          bgSprite.x = px;
          bgSprite.y = py;
          groundGroup.addChild(bgSprite);
          groundSprites.push(bgSprite);
        }

        // 沙滩边缘瓦片：先铺水底图
        if (isBeachTile(tile)) {
          const waterBg = this._spritePool.acquire();
          waterBg.texture = textures[TILE.WATER] || textures[TILE.GRASS];
          waterBg.x = px;
          waterBg.y = py;
          groundGroup.addChild(waterBg);
          groundSprites.push(waterBg);
        }

        const sprite = this._spritePool.acquire();
        // 土地占位符用 dirtMap 变体，草地占位符用 grassMap 变体
        if (tile === TILE.GRASS) {
          sprite.texture = textures[chunk.grassMap[ly][lx]] || textures[TILE.GRASS];
        } else if (tile === TILE.DIRT) {
          sprite.texture = textures[(chunk.dirtMap && chunk.dirtMap[ly]) ? chunk.dirtMap[ly][lx] : TILE.DIRT_1] || textures[TILE.DIRT_1] || textures[TILE.GRASS];
        } else {
          sprite.texture = textures[tile] || textures[TILE.GRASS];
        }
        const rotation = TILE_ROTATION[tile] || 0;
        if (rotation !== 0) {
          sprite.anchor.set(0.5);
          sprite.x = px + tileW / 2;
          sprite.y = py + tileH / 2;
          sprite.rotation = rotation;
        } else {
          sprite.anchor.set(0, 0);
          sprite.x = px;
          sprite.y = py;
          sprite.rotation = 0;
        }
        groundGroup.addChild(sprite);
        groundSprites.push(sprite);
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

    // 归还地面精灵到对象池（烘焙后不再需要）
    for (const sp of groundSprites) {
      this._spritePool.release(sp);
    }
    groundGroup.destroy({ children: false }); // 不销毁子对象，它们已归还池

    // ── 第三步：创建区块容器 ──
    const container = this._containerPool.acquire();
    container.x = offsetX;
    container.y = offsetY;

    const groundSprite = this._spritePool.acquire();
    groundSprite.texture = renderTexture;
    groundSprite.scale.set(1 / tileW, 1 / tileH);
    groundSprite.anchor.set(0, 0);
    container.addChild(groundSprite);
    container._groundSprite = groundSprite;
    container._decorSprites = decorSprites;

    // ── 将装饰物注册到空间索引并添加到装饰层容器 ──
    if (this._decorContainer) {
      for (const entry of decorSprites) {
        this._decorIndex.insert(key, entry);
        this._decorContainer.addChild(entry.sprite);
      }
    } else {
      for (const entry of decorSprites) {
        this._decorIndex.insert(key, entry);
      }
    }

    this._chunkContainers.set(key, container);
    this.mapContainer.addChild(container);

    // 确保装饰层、船容器、弹药容器和特效容器始终在所有区块容器之上
    // addChild 会将已有子元素移到末尾（最上层），保证渲染层级正确
    if (this._decorContainer) {
      this.mapContainer.addChild(this._decorContainer);
    }
    if (this._shipFleet) {
      this.mapContainer.addChild(this._shipFleet.container);
    }
    // 弹药和特效必须在最上层，否则会被区块容器遮挡
    if (this._projectileContainer) {
      this.mapContainer.addChild(this._projectileContainer);
    }
    if (this._vfxContainer) {
      this.mapContainer.addChild(this._vfxContainer);
    }

    return container;
  }

  /**
   * 重建装饰物层（视口裁剪 + Y排序）
   * 优化策略：
   * - 精灵只在首次创建时 addChild，不再每帧 removeChildren + addChild
   * - 通过 sprite.visible 控制可见性，避免 PIXI 内部数组操作
   * - 使用精确的瓦片坐标范围做裁剪，margin 考虑精灵可能超出1瓦片的尺寸
   * - 排序后通过 setChildIndex 保证正确的绘制顺序
   * @private
   */
  _rebuildDecorLayer() {
    if (!this.mapContainer) return;

    if (!this._decorContainer) {
      this._decorContainer = new PIXI.Container();
      this._decorContainer.sortableChildren = true;
      this.mapContainer.addChild(this._decorContainer);
    }

    // 计算视口可见范围（精确瓦片坐标 + 装饰物尺寸余量）
    const range = this._viewport.getVisibleTileRange();
    const margin = 3; // 装饰物（如大树）可能向上/左延伸2-3瓦片
    const minX = range.x - margin;
    const maxX = range.endX + margin;
    const minY = range.y - margin;
    const maxY = range.endY + margin;

    // ── 使用空间索引查询可见装饰物 ──
    // 先将所有已索引的装饰物标记为不可见
    // （通过上一帧的可见集合快速操作）
    if (this._lastVisibleDecors) {
      for (const entry of this._lastVisibleDecors) {
        entry.sprite.visible = false;
      }
    }

    const hideSmallDecor = this._lod.level >= 2;
    const visibleDecors = this._decorIndex.queryRange(
      minX, maxX, minY, maxY, { hideSmallDecor }
    );

    // 设置可见性并按 worldY 排序
    for (const entry of visibleDecors) {
      entry.sprite.visible = true;
    }
    // PIXI sortableChildren = true 时会自动按 zIndex 排序
    for (let i = 0; i < visibleDecors.length; i++) {
      visibleDecors[i].sprite.zIndex = i;
    }

    // 缓存本帧可见集合，用于下一帧快速隐藏
    this._lastVisibleDecors = visibleDecors;

    // 确保渲染层级：装饰层 < 船容器 < 弹药容器 < 特效容器
    if (this._shipFleet) {
      this.mapContainer.addChild(this._shipFleet.container);
    }
    if (this._projectileContainer) {
      this.mapContainer.addChild(this._projectileContainer);
    }
    if (this._vfxContainer) {
      this.mapContainer.addChild(this._vfxContainer);
    }
  }

  /**
   * 加载素材纹理
   *
   * 初始加载时使用非渐进式模式（progressive=false），等待所有纹理就绪后一次性渲染，
   * 避免色块→真实图片的闪烁。后续如需热更新纹理可手动调用 loadAssets({ progressive: true })。
   *
   * @param {object} [options]
   * @param {boolean} [options.useAtlas=true] - 是否启用精灵图集合并
   * @param {boolean} [options.progressive=false] - 是否启用渐进式加载
   *   - true: critical 纹理就绪后立即返回，后续纹理通过回调替换（适合后台热更新）
   *   - false: 等待所有纹理加载完成后再渲染（适合初始加载，消除闪烁）
   * @returns {Promise<void>}
   */
  async loadAssets(options = {}) {
    const { useAtlas = true, progressive = false } = options;

    // 添加 preload 提示，加速 critical 纹理下载
    this._preloadHints = AssetLoader.addPreloadHints();

    const result = await AssetLoader.load({
      useAtlas,
      renderer: this.app?.renderer,
      progressive,
      onBatchReady: progressive ? (batchTextures, priority) => {
        this._onTexturesBatchReady(batchTextures, priority);
      } : null,
    });
    this.textures = result.textures;
    this.tileSize = result.tileSize;
    this._atlasTexture = result.atlasTexture;
    this._atlasEnabled = result.atlasEnabled;

    // 更新子模块的 tileSize
    this._viewport.updateTileSize(this.tileSize);
    if (this._interaction) {
      this._interaction.updateTileSize(this.tileSize);
    }

    // 初始化船队（传入攻击回调，海盗船发射弹药时触发）
    this._shipFleet = new ShipFleet(
      this.textures, this.tileSize, this._viewport.state,
      (attackerEid, targetEid, startX, startY, targetX, targetY) => {
        this._onShipAttack(attackerEid, targetEid, startX, startY, targetX, targetY);
      }
    );
    if (this.mapContainer && this._shipFleet.container) {
      this.mapContainer.addChild(this._shipFleet.container);
    }
    if (this.app?.ticker) {
      this._shipFleet.attachTicker(this.app.ticker);
    }

    // 初始化战斗子系统
    // 弹药容器和特效容器独立于船容器，保证渲染层级正确
    const projectileContainer = new PIXI.Container();
    const vfxContainer = new PIXI.Container();
    this._projectileContainer = projectileContainer;
    this._vfxContainer = vfxContainer;
    this.mapContainer.addChild(projectileContainer);
    this.mapContainer.addChild(vfxContainer);

    this._projectileManager = new ProjectileManager(
      this.textures, projectileContainer,
      (hitX, hitY, hitEid) => {
        // 弹药命中 → 创建爆炸特效（传入 hitEid 以便火苗跟随船只，-1 表示脱靶）
        if (this._vfxManager && hitEid >= 0) {
          this._vfxManager.createExplosion(hitX, hitY, hitEid);
        }
      }
    );

    // VfxManager 需要 ECS 组件引用以实现火苗跟随船只
    const ecsRefs = this._shipFleet ? {
      Position,
      Navigating,
      world: this._shipFleet.world,
      hasComponent,
    } : null;
    this._vfxManager = new VfxManager(this.textures, vfxContainer, ecsRefs);

    // ProjectileManager 需要 ECS 组件引用以实现命中检测
    if (this._shipFleet) {
      this._projectileManager.setEcsRefs({
        Position,
        Combat,
        world: this._shipFleet.world,
        hasComponent,
        shipQuery: targetQuery,
      });
    }

    // 注册 Ticker 更新弹道和特效
    if (this.app?.ticker) {
      this._combatTickerFn = (deltaTime) => {
        const dt = (deltaTime || 0) / 60;
        if (this._projectileManager) this._projectileManager.update(dt);
        if (this._vfxManager) this._vfxManager.update(dt);
      };
      this.app.ticker.add(this._combatTickerFn);
    }
  }

  /**
   * 海盗船攻击回调：发射弹药
   * 由 combatSystem 蓄力完成时触发
   * @private
   */
  _onShipAttack(attackerEid, targetEid, startX, startY, targetX, targetY) {
    console.log(
      `[Renderer] _onShipAttack called:`,
      `attacker=${attackerEid}, target=${targetEid},`,
      `from=(${startX.toFixed(1)}, ${startY.toFixed(1)}),`,
      `to=(${targetX.toFixed(1)}, ${targetY.toFixed(1)}),`,
      `projectileManager=${!!this._projectileManager}`,
    );
    if (this._projectileManager) {
      this._projectileManager.fire(
        attackerEid, targetEid, startX, startY, targetX, targetY
      );
    }
  }

  /**
   * 渐进式加载批次回调：新纹理就绪时替换精灵纹理
   * @private
   * @param {Object<number, PIXI.Texture>} batchTextures - 新加载的纹理
   * @param {string} priority - 批次优先级 ('high'|'normal'|'low'|'complete')
   */
  _onTexturesBatchReady(batchTextures, priority) {
    // 更新纹理映射
    for (const [key, texture] of Object.entries(batchTextures)) {
      this.textures[parseInt(key)] = texture;
    }

    // 清除 preload 提示
    if (this._preloadHints) {
      AssetLoader.removePreloadHints(this._preloadHints);
      this._preloadHints = null;
    }

    // 'complete' 表示所有纹理加载完毕且图集已重建
    if (priority === 'complete') {
      // 重新渲染所有区块以使用完整图集
      this._rerenderAllChunks();
      // 图集重建后纹理引用变化，更新船精灵纹理
      if (this._shipFleet) {
        this._shipFleet.updateTextures(this.textures);
      }
      // 更新战斗子系统纹理
      if (this._projectileManager) {
        this._projectileManager.updateTextures(this.textures);
      }
      if (this._vfxManager) {
        this._vfxManager.updateTextures(this.textures);
      }
      console.info('[Renderer] Progressive loading complete, all textures replaced');
      return;
    }

    // 对于高/普通/低优先级批次，需要重新渲染区块以替换纹理
    // 但重新渲染所有区块代价较高，所以只在 normal 和 low 完成时全量刷新
    // high 完成时只刷新可见区块（减少延迟感）
    if (priority === 'high') {
      // 高优先级：刷新当前可见区块
      this._requestVisibleChunks();
    } else if (priority === 'low') {
      // 低优先级纹理（船/山坡）就绪，更新船精灵纹理
      if (this._shipFleet) {
        this._shipFleet.updateTextures(this.textures);
      }
      this._rebuildDecorLayer();
    } else if (priority === 'normal') {
      // 装饰物纹理就绪，重建装饰层
      this._rebuildDecorLayer();
    }
  }

  /**
   * 初始渲染
   *
   * 渲染前先将画布设为不可见，所有区块渲染完成后通过淡入动画显示，
   * 避免区块逐个出现或色块→图片的视觉跳变。
   */
  async renderInitial() {
    this._lastRenderedChunks = new Set();
    this._chunkContainers = new Map();

    // 先隐藏画布，避免渲染过程中的视觉跳变
    const canvas = this.app?.view;
    if (canvas) {
      canvas.style.opacity = '0';
      canvas.style.transition = 'opacity 0.3s ease-in';
    }

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

    // 所有区块渲染完成，淡入画布
    if (canvas) {
      // 强制重排后再设置 opacity，确保 transition 生效
      // eslint-disable-next-line no-unused-expressions
      canvas.offsetHeight;
      canvas.style.opacity = '1';
    }
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
   * 重新渲染所有已缓存的区块容器（LOD 级别变化时调用）
   * @private
   */
  _rerenderAllChunks() {
    // 收集当前已加载的区块
    const loadedChunks = [];
    for (const [key, container] of this._chunkContainers) {
      const [cx, cy] = key.split(',').map(Number);
      const chunk = this.chunkManager.getChunkIfLoaded(cx, cy);
      if (chunk) {
        loadedChunks.push({ key, chunk });
      }
    }

    // 移除旧容器并重新渲染
    for (const { key } of loadedChunks) {
      this._removeChunkContainer(key);
    }
    for (const { chunk } of loadedChunks) {
      this._renderChunkContainer(chunk);
      this._lastRenderedChunks.add(`${chunk.chunkX},${chunk.chunkY}`);
    }

    // 重建装饰层
    if (this._lod.showDecorations) {
      this._rebuildDecorLayer();
    }
  }

  /**
   * 清空所有区块容器（归还对象池）
   * @private
   */
  _clearAllContainers() {
    for (const [, container] of this._chunkContainers) {
      const groundSprite = container._groundSprite;
      if (groundSprite && groundSprite.texture) {
        groundSprite.texture.destroy(true);
      }
      if (groundSprite) {
        this._spritePool.release(groundSprite);
      }
      // 归还装饰物精灵
      if (container._decorSprites) {
        for (const { sprite } of container._decorSprites) {
          this._spritePool.release(sprite);
        }
      }
      this.mapContainer.removeChild(container);
      this._containerPool.release(container);
    }
    this._chunkContainers.clear();
    this._lastRenderedChunks = new Set();

    // 清空装饰层空间索引
    this._decorIndex.clear();
    this._lastVisibleDecors = null;

    if (this._decorContainer) {
      this._decorContainer.removeChildren();
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
   * 注册视口变化回调（通过事件总线）
   * @param {Function} cb
   * @returns {Function} 取消订阅函数
   */
  setOnViewportChange(cb) {
    const unsub = gameEvents.on(GameEvent.VIEWPORT_INFO, cb);
    this._eventUnsubs.push(unsub);
    return unsub;
  }

  /**
   * 注册瓦片悬停回调（通过事件总线）
   * @param {Function} cb
   * @returns {Function} 取消订阅函数
   */
  setOnTileHover(cb) {
    const unsub = gameEvents.on(GameEvent.TILE_HOVER, (data) => {
      cb(data.tileX, data.tileY, data.tileType);
    });
    this._eventUnsubs.push(unsub);
    return unsub;
  }

  /**
   * 销毁渲染器，释放资源
   */
  destroy() {
    // 清理战斗子系统
    if (this._combatTickerFn && this.app?.ticker) {
      this.app.ticker.remove(this._combatTickerFn);
      this._combatTickerFn = null;
    }
    if (this._projectileManager) {
      this._projectileManager.destroy();
      this._projectileManager = null;
    }
    if (this._vfxManager) {
      this._vfxManager.destroy();
      this._vfxManager = null;
    }
    this._projectileContainer = null;
    this._vfxContainer = null;

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

    // 清理事件总线监听
    for (const unsub of this._eventUnsubs) {
      if (typeof unsub === 'function') unsub();
    }
    this._eventUnsubs = [];

    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    this._clearAllContainers();

    // 清理 preload 提示
    if (this._preloadHints) {
      AssetLoader.removePreloadHints(this._preloadHints);
      this._preloadHints = null;
    }

    // 释放图集纹理
    if (this._atlasTexture) {
      this._atlasTexture.destroy(true);
      this._atlasTexture = null;
    }
    this._atlasEnabled = false;

    // 销毁对象池
    this._spritePool.destroy();
    this._containerPool.destroy();

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
