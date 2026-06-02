/**
 * 素材加载模块
 * 封装 PixiJS 纹理加载逻辑，从 renderer.js 中抽离
 * 职责：并行加载纹理、生成回退色块、返回纹理映射和瓦片尺寸
 */

import * as PIXI from 'pixi.js';
import { TILE_COLORS, TILE_ASSETS, TILE } from './constants';

/**
 * 加载结果
 * @typedef {object} AssetLoadResult
 * @property {Object<number, PIXI.Texture>} textures - 瓦片类型 → 纹理映射
 * @property {{ w: number, h: number }} tileSize - 瓦片像素尺寸（取自 GRASS_1 纹理）
 */

/**
 * 素材加载器
 * 负责并行加载所有瓦片纹理，加载失败的瓦片自动生成纯色回退纹理
 */
export class AssetLoader {
  /**
   * 加载所有瓦片纹理
   * @returns {Promise<AssetLoadResult>}
   */
  static async load() {
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
        const fallback = AssetLoader._createFallbackTexture(tileType);
        return { key: tileType, texture: fallback, isGrass1: false };
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

    return {
      textures: rawTextures,
      tileSize: { w: tileW, h: tileH },
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
}
