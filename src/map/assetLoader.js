/**
 * 素材加载模块（渐进式加载版）
 *
 * 封装 PixiJS 纹理加载逻辑，从 renderer.js 中抽离
 * 职责：分优先级加载纹理、生成回退色块、构建精灵图集、返回纹理映射和瓦片尺寸
 *
 * 优化策略：
 * 1. 分优先级加载：critical（地面）→ high（道路/沙滩）→ normal（装饰物）→ low（船/山坡）
 * 2. 先用回退色块占位，critical 纹理就绪后立即开始渲染
 * 3. 后续纹理异步加载，通过回调通知替换
 * 4. 集成 AtlasBuilder，加载后自动将独立纹理合并为精灵图集
 */

import * as PIXI from 'pixi.js';
import { TILE_COLORS, TILE_ASSETS, TILE } from './constants';
import { AtlasBuilder } from './atlasBuilder';

// ────────────────────────────────────────────
// 加载优先级分组
// ────────────────────────────────────────────

/**
 * 纹理加载优先级分组
 * - critical: 地面基础纹理，必须加载完才开始渲染
 * - high: 道路、沙滩等结构纹理，第二批加载
 * - normal: 装饰物纹理（树/石/草丛），第三批加载
 * - low: 船/山坡等使用频率低的纹理，最后加载
 */
const LOAD_PRIORITY = {
  critical: new Set([
    TILE.GRASS, TILE.GRASS_1, TILE.GRASS_2, TILE.WATER,
  ]),
  high: new Set([
    TILE.CORNER_TL, TILE.CORNER_TR, TILE.CORNER_BR, TILE.CORNER_BL,
    TILE.EDGE_T, TILE.EDGE_R, TILE.EDGE_B, TILE.EDGE_L,
    TILE.ROAD_H, TILE.ROAD_V,
    TILE.ROAD_CORNER_TL, TILE.ROAD_CORNER_TR, TILE.ROAD_CORNER_BL, TILE.ROAD_CORNER_BR,
    TILE.ROAD_T_DOWN, TILE.ROAD_T_LEFT, TILE.ROAD_T_UP, TILE.ROAD_T_RIGHT,
    TILE.ROAD_CROSS,
    TILE.ROAD_END_UP, TILE.ROAD_END_RIGHT, TILE.ROAD_END_DOWN, TILE.ROAD_END_LEFT,
    TILE.STONE_ROAD_H, TILE.STONE_ROAD_V,
    TILE.STONE_ROAD_CORNER_TL, TILE.STONE_ROAD_CORNER_TR,
    TILE.STONE_ROAD_CORNER_BL, TILE.STONE_ROAD_CORNER_BR,
    TILE.STONE_ROAD_T_DOWN, TILE.STONE_ROAD_T_LEFT, TILE.STONE_ROAD_T_UP, TILE.STONE_ROAD_T_RIGHT,
    TILE.STONE_ROAD_CROSS,
  ]),
  normal: new Set([
    TILE.TREE_1, TILE.TREE_2, TILE.TREE_3, TILE.TREE_MANY,
    TILE.STONE_SMALL, TILE.STONE_BIG, TILE.STONE_2, TILE.STONE_3,
    TILE.ROCK_SMALL, TILE.ROCK_PILE, TILE.ROCK_2, TILE.ROCK_3,
    TILE.BUSH, TILE.BERRY,
  ]),
  low: new Set([
    TILE.HILL_TL, TILE.HILL_TC, TILE.HILL_TR,
    TILE.HILL_ML, TILE.HILL_MC, TILE.HILL_MR,
    TILE.HILL_BL, TILE.HILL_BC, TILE.HILL_BR,
    TILE.SHIP, TILE.PIRATE_SHIP,
  ]),
};

/**
 * 优先级排序顺序
 */
const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];

/**
 * 加载结果
 * @typedef {object} AssetLoadResult
 * @property {Object<number, PIXI.Texture>} textures - 瓦片类型 → 纹理映射（图集子帧纹理）
 * @property {{ w: number, h: number }} tileSize - 瓦片像素尺寸
 * @property {PIXI.Texture|null} atlasTexture - 图集纹理（用于销毁时释放）
 * @property {boolean} atlasEnabled - 是否启用了图集
 * @property {Function|null} onTexturesReady - 渐进式加载回调，后续纹理就绪时调用
 */

/**
 * 素材加载器（渐进式加载版）
 *
 * 使用方式：
 *   const result = await AssetLoader.load({ progressive: true, onBatchReady: callback });
 *   // critical 纹理就绪后立即返回，后续批次通过 onBatchReady 回调通知
 */
export class AssetLoader {
  /**
   * 加载所有瓦片纹理（支持渐进式加载）
   *
   * @param {object} [options]
   * @param {boolean} [options.useAtlas=true] - 是否启用精灵图集
   * @param {PIXI.Renderer} [options.renderer] - PixiJS 渲染器（图集构建需要）
   * @param {boolean} [options.progressive=false] - 是否启用渐进式加载
   *   - false: 等待所有纹理加载完成后返回（兼容旧行为）
   *   - true: critical 纹理就绪后立即返回，后续批次通过 onBatchReady 回调通知
   * @param {Function} [options.onBatchReady] - 渐进式加载批次回调
   *   - 签名: (batchTextures: Object<number, PIXI.Texture>, batchPriority: string) => void
   *   - 当新的一批纹理加载完成时调用，调用者可以在此替换精灵纹理
   * @returns {Promise<AssetLoadResult>}
   */
  static async load(options = {}) {
    const {
      useAtlas = true,
      renderer = null,
      progressive = false,
      onBatchReady = null,
    } = options;

    const rawTextures = {};
    let tileW = 64;
    let tileH = 64;

    // ── 先为所有纹理创建回退色块 ──
    const allEntries = Object.entries(TILE_ASSETS);
    for (const [key] of allEntries) {
      const tileType = parseInt(key);
      rawTextures[tileType] = AssetLoader._createFallbackTexture(tileType);
    }

    // ── 按优先级分批加载 ──
    if (progressive) {
      // 渐进式模式：先加载 critical，立即返回
      const criticalEntries = allEntries.filter(([key]) =>
        LOAD_PRIORITY.critical.has(parseInt(key))
      );

      await AssetLoader._loadBatch(criticalEntries, rawTextures);

      // 尝试用 critical 纹理构建初始图集
      const initialResult = AssetLoader._buildAtlas(rawTextures, useAtlas, renderer);

      // 在后台继续加载后续批次
      AssetLoader._loadRemainingBatches(
        allEntries, rawTextures, useAtlas, renderer,
        initialResult, onBatchReady
      );

      return {
        textures: initialResult.textures,
        tileSize: AssetLoader._getTileSize(rawTextures),
        atlasTexture: initialResult.atlasTexture,
        atlasEnabled: initialResult.atlasEnabled,
        onTexturesReady: null, // 渐进式通过 onBatchReady 回调
      };
    }

    // ── 非渐进式模式：等待所有纹理加载完成（兼容旧行为） ──
    // 仍然按优先级顺序加载，但等待全部完成
    for (const priority of PRIORITY_ORDER) {
      const batchEntries = allEntries.filter(([key]) =>
        LOAD_PRIORITY[priority].has(parseInt(key))
      );
      await AssetLoader._loadBatch(batchEntries, rawTextures);
    }

    const tileSize = AssetLoader._getTileSize(rawTextures);

    // 构建图集
    const atlasResult = AssetLoader._buildAtlas(rawTextures, useAtlas, renderer);

    return {
      textures: atlasResult.textures,
      tileSize,
      atlasTexture: atlasResult.atlasTexture,
      atlasEnabled: atlasResult.atlasEnabled,
      onTexturesReady: null,
    };
  }

  /**
   * 加载一批纹理
   * @private
   * @param {[string, string][]} entries - [key, path] 数组
   * @param {Object<number, PIXI.Texture>} target - 目标纹理映射
   */
  static async _loadBatch(entries, target) {
    const loadPromises = entries.map(async ([key, path]) => {
      try {
        const texture = await PIXI.Assets.load(path);
        return { key: parseInt(key), texture };
      } catch {
        // 加载失败，保留回退色块
        return { key: parseInt(key), texture: null };
      }
    });

    const results = await Promise.all(loadPromises);
    for (const { key, texture } of results) {
      if (texture) {
        // 替换回退色块为真实纹理
        if (target[key] && target[key] !== texture) {
          target[key].destroy(true);
        }
        target[key] = texture;
      }
    }
  }

  /**
   * 在后台加载剩余优先级批次
   * @private
   */
  static _loadRemainingBatches(
    allEntries, rawTextures, useAtlas, renderer,
    initialResult, onBatchReady
  ) {
    const remainingPriorities = ['high', 'normal', 'low'];
    let currentIndex = 0;

    const loadNext = async () => {
      if (currentIndex >= remainingPriorities.length) {
        // 所有纹理加载完毕，重新构建完整图集
        if (useAtlas && onBatchReady) {
          try {
            const fullAtlas = renderer
              ? AtlasBuilder.buildWithRenderer(rawTextures, renderer)
              : AtlasBuilder.build(rawTextures);

            if (fullAtlas.atlasTexture) {
              onBatchReady(fullAtlas.textures, 'complete');
              console.info(
                `[AssetLoader] Full atlas rebuilt: ${fullAtlas.atlasWidth}x${fullAtlas.atlasHeight}px`
              );
            }
          } catch (err) {
            console.warn('[AssetLoader] Full atlas rebuild failed:', err);
            // 回退：逐个纹理通知
            onBatchReady({ ...rawTextures }, 'complete');
          }
        }
        return;
      }

      const priority = remainingPriorities[currentIndex];
      currentIndex++;

      const batchEntries = allEntries.filter(([key]) =>
        LOAD_PRIORITY[priority].has(parseInt(key))
      );

      await AssetLoader._loadBatch(batchEntries, rawTextures);

      // 通知调用者有新纹理可用
      if (onBatchReady) {
        const batchTextures = {};
        for (const [key] of batchEntries) {
          const tileType = parseInt(key);
          batchTextures[tileType] = rawTextures[tileType];
        }
        onBatchReady(batchTextures, priority);
      }

      // 调度下一批（让出主线程，避免阻塞渲染）
      requestAnimationFrame(loadNext);
    };

    // 启动后台加载
    requestAnimationFrame(loadNext);
  }

  /**
   * 从已加载纹理中检测瓦片尺寸
   * @private
   */
  static _getTileSize(rawTextures) {
    const grass = rawTextures[TILE.GRASS_1] || rawTextures[TILE.GRASS];
    if (grass) {
      return { w: grass.width, h: grass.height };
    }
    return { w: 64, h: 64 };
  }

  /**
   * 构建精灵图集
   * @private
   */
  static _buildAtlas(rawTextures, useAtlas, renderer) {
    let atlasTexture = null;
    let finalTextures = rawTextures;

    if (useAtlas) {
      try {
        const atlasResult = renderer
          ? AtlasBuilder.buildWithRenderer(rawTextures, renderer)
          : AtlasBuilder.build(rawTextures);

        if (atlasResult.atlasTexture) {
          finalTextures = atlasResult.textures;
          atlasTexture = atlasResult.atlasTexture;

          const tileCount = Object.keys(rawTextures).length;
          console.info(
            `[AssetLoader] Atlas built: ${atlasResult.atlasWidth}x${atlasResult.atlasHeight}px, ` +
            `${tileCount} tiles merged`
          );
        }
      } catch (err) {
        console.warn('[AssetLoader] Atlas build failed, using individual textures:', err);
      }
    }

    return {
      textures: finalTextures,
      atlasTexture,
      atlasEnabled: !!atlasTexture,
    };
  }

  /**
   * 为加载失败的瓦片生成纯色回退纹理
   * @param {number} tileType
   * @returns {PIXI.Texture}
   * @private
   */
  static _createFallbackTexture(tileType) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const hex = TILE_COLORS[tileType] || 0x555555;
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 64, 64);
    return PIXI.Texture.from(c);
  }

  /**
   * 为 HTML 页面生成 <link rel="preload"> 标签
   * 将 critical 优先级纹理添加到预加载提示，加速首次渲染
   *
   * @returns {HTMLLinkElement[]} 创建的 link 元素数组
   */
  static addPreloadHints() {
    const links = [];
    for (const [key, path] of Object.entries(TILE_ASSETS)) {
      if (LOAD_PRIORITY.critical.has(parseInt(key))) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = path;
        document.head.appendChild(link);
        links.push(link);
      }
    }
    return links;
  }

  /**
   * 清除 preload 提示
   * @param {HTMLLinkElement[]} links
   */
  static removePreloadHints(links) {
    for (const link of links) {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    }
  }
}
