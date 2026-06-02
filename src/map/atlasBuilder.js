/**
 * 精灵图集构建器 (Runtime Texture Atlas)
 *
 * 将所有独立瓦片纹理动态合并为一张大图集（Spritesheet），
 * 减少 WebGL 纹理绑定切换次数，降低 Draw Call。
 *
 * 工作原理：
 * 1. 接收 { tileType → Texture } 映射
 * 2. 使用矩形装箱算法（行优先）将所有纹理排列到一张大 Canvas 上
 * 3. 记录每个纹理在新图集中的 Frame 矩形
 * 4. 从 Canvas 生成单一 PIXI.Texture，再为每个 tileType 创建子帧纹理
 *
 * 性能收益：
 * - WebGL 纹理绑定从 N 次降低到 1 次（同一图集内的精灵共享纹理）
 * - 渲染批次合并：PixiJS 可将同图集精灵批量提交
 * - 内存占用降低：减少 GPU 纹理对象数量
 */

import * as PIXI from 'pixi.js';
import { TILE } from './constants';

/**
 * 纹理帧信息
 * @typedef {object} AtlasFrame
 * @property {number} x - 图集中的X偏移
 * @property {number} y - 图集中的Y偏移
 * @property {number} w - 帧宽度
 * @property {number} h - 帧高度
 */

/**
 * 图集构建结果
 * @typedef {object} AtlasBuildResult
 * @property {Object<number, PIXI.Texture>} textures - tileType → 子帧纹理映射
 * @property {PIXI.Texture} atlasTexture - 图集纹理
 * @property {Object<number, AtlasFrame>} frames - tileType → 帧信息映射
 * @property {number} atlasWidth - 图集宽度
 * @property {number} atlasHeight - 图集高度
 */

/**
 * 行优先矩形装箱器
 * 将矩形按行排列，每行填满后换行
 * 适用于大小相近的瓦片纹理
 */
class RowPacker {
  constructor(maxWidth) {
    this.maxWidth = maxWidth;
    this.currentX = 0;
    this.currentY = 0;
    this.rowHeight = 0;
    this.totalHeight = 0;
  }

  /**
   * 尝试放入一个矩形
   * @param {number} w
   * @param {number} h
   * @returns {{ x: number, y: number } | null} 放置位置，放不下返回 null
   */
  place(w, h) {
    // 当前行放不下，换行
    if (this.currentX + w > this.maxWidth) {
      this.currentY += this.rowHeight;
      this.currentX = 0;
      this.rowHeight = 0;
    }

    const pos = { x: this.currentX, y: this.currentY };
    this.currentX += w;
    this.rowHeight = Math.max(this.rowHeight, h);
    this.totalHeight = Math.max(this.totalHeight, this.currentY + this.rowHeight);

    return pos;
  }
}

/**
 * 精灵图集构建器
 */
export class AtlasBuilder {
  /**
   * 最大图集边长（WebGL 安全限制，大多数设备支持 4096+）
   */
  static MAX_ATLAS_SIZE = 4096;

  /**
   * 纹理之间的像素间距（防止纹理渗透/bleeding）
   */
  static PADDING = 2;

  /**
   * 从原始纹理映射构建精灵图集
   *
   * @param {Object<number, PIXI.Texture>} rawTextures - tileType → 原始纹理映射
   * @returns {AtlasBuildResult}
   */
  static build(rawTextures) {
    const padding = AtlasBuilder.PADDING;

    // 1. 收集所有纹理尺寸，计算总面积
    const entries = [];
    let totalArea = 0;
    let maxWidth = 0;
    let maxHeight = 0;

    for (const [key, texture] of Object.entries(rawTextures)) {
      const tileType = parseInt(key);
      const w = texture.width + padding * 2;
      const h = texture.height + padding * 2;
      entries.push({ tileType, texture, w, h });
      totalArea += w * h;
      maxWidth = Math.max(maxWidth, w);
      maxHeight = Math.max(maxHeight, h);
    }

    // 2. 按高度降序排列（高的先放，减少碎片）
    entries.sort((a, b) => b.h - a.h);

    // 3. 估算图集宽度（取面积平方根的 1.5 倍，兼顾宽高比）
    let atlasWidth = Math.min(
      AtlasBuilder.MAX_ATLAS_SIZE,
      Math.max(maxWidth, Math.ceil(Math.sqrt(totalArea) * 1.5))
    );
    // 对齐到2的幂（可选，有利于GPU效率）
    atlasWidth = AtlasBuilder._nextPow2(atlasWidth);

    // 4. 装箱
    const packer = new RowPacker(atlasWidth);
    /** @type {Object<number, { x: number, y: number, w: number, h: number }>} */
    const framePositions = {};

    for (const entry of entries) {
      const pos = packer.place(entry.w, entry.h);
      if (!pos) {
        console.warn(`[AtlasBuilder] Cannot fit tile ${entry.tileType}, skipping`);
        continue;
      }
      framePositions[entry.tileType] = {
        x: pos.x + padding,
        y: pos.y + padding,
        w: entry.w - padding * 2,
        h: entry.h - padding * 2,
      };
    }

    let atlasHeight = AtlasBuilder._nextPow2(packer.totalHeight);

    // 安全检查
    if (atlasHeight > AtlasBuilder.MAX_ATLAS_SIZE) {
      console.warn('[AtlasBuilder] Atlas height exceeds MAX_ATLAS_SIZE, falling back to individual textures');
      return AtlasBuilder._fallbackResult(rawTextures);
    }

    // 5. 绘制到 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = atlasWidth;
    canvas.height = atlasHeight;
    const ctx = canvas.getContext('2d');

    // 清除为透明
    ctx.clearRect(0, 0, atlasWidth, atlasHeight);

    // 提取原始纹理的像素数据并绘制到图集 Canvas
    for (const entry of entries) {
      const frame = framePositions[entry.tileType];
      if (!frame) continue;

      // 从 PIXI Texture 获取源 Canvas/Image
      const source = entry.texture.baseTexture?.resource?.source;
      if (source) {
        ctx.drawImage(
          source,
          frame.x, frame.y, frame.w, frame.h
        );
      }
    }

    // 6. 创建图集纹理和子帧纹理
    const atlasTexture = PIXI.Texture.from(canvas);
    const textures = {};
    const frames = {};

    for (const [tileTypeStr, frame] of Object.entries(framePositions)) {
      const tileType = parseInt(tileTypeStr);

      // 创建子帧矩形
      const frameRect = new PIXI.Rectangle(frame.x, frame.y, frame.w, frame.h);
      const origRect = new PIXI.Rectangle(0, 0, frame.w, frame.h);

      // 从图集纹理裁剪子帧纹理
      const subTexture = new PIXI.Texture(
        atlasTexture.baseTexture,
        frameRect,
        origRect,
        origRect
      );

      textures[tileType] = subTexture;
      frames[tileType] = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    }

    return {
      textures,
      atlasTexture,
      frames,
      atlasWidth,
      atlasHeight,
    };
  }

  /**
   * 从 Canvas 重新绘制图集（处理 PIXI 纹理不能直接 drawImage 的情况）
   * 使用 PIXI renderer 提取纹理像素
   *
   * @param {Object<number, PIXI.Texture>} rawTextures
   * @param {PIXI.Renderer} renderer - PixiJS 渲染器
   * @returns {AtlasBuildResult}
   */
  static buildWithRenderer(rawTextures, renderer) {
    const padding = AtlasBuilder.PADDING;

    // 1. 收集所有纹理尺寸
    const entries = [];
    let totalArea = 0;
    let maxWidth = 0;

    for (const [key, texture] of Object.entries(rawTextures)) {
      const tileType = parseInt(key);
      const w = texture.width + padding * 2;
      const h = texture.height + padding * 2;
      entries.push({ tileType, texture, w, h });
      totalArea += w * h;
      maxWidth = Math.max(maxWidth, w);
    }

    // 2. 按高度降序排列
    entries.sort((a, b) => b.h - a.h);

    // 3. 估算图集尺寸
    let atlasWidth = Math.min(
      AtlasBuilder.MAX_ATLAS_SIZE,
      Math.max(maxWidth, Math.ceil(Math.sqrt(totalArea) * 1.5))
    );
    atlasWidth = AtlasBuilder._nextPow2(atlasWidth);

    // 4. 装箱
    const packer = new RowPacker(atlasWidth);
    const framePositions = {};

    for (const entry of entries) {
      const pos = packer.place(entry.w, entry.h);
      if (!pos) continue;
      framePositions[entry.tileType] = {
        x: pos.x + padding,
        y: pos.y + padding,
        w: entry.w - padding * 2,
        h: entry.h - padding * 2,
        // 保存含 padding 的位置用于绘制
        px: pos.x,
        py: pos.y,
        pw: entry.w,
        ph: entry.h,
      };
    }

    let atlasHeight = AtlasBuilder._nextPow2(packer.totalHeight);
    if (atlasHeight > AtlasBuilder.MAX_ATLAS_SIZE) {
      return AtlasBuilder._fallbackResult(rawTextures);
    }

    // 5. 使用 PIXI RenderTexture 绘制图集
    const atlasRT = PIXI.RenderTexture.create({
      width: atlasWidth,
      height: atlasHeight,
      resolution: 1,
    });

    // 创建临时容器，放置所有原始纹理精灵
    const tempContainer = new PIXI.Container();

    for (const entry of entries) {
      const fp = framePositions[entry.tileType];
      if (!fp) continue;

      const sprite = new PIXI.Sprite(entry.texture);
      sprite.x = fp.px + padding;
      sprite.y = fp.py + padding;
      tempContainer.addChild(sprite);
    }

    // 渲染到图集 RenderTexture
    renderer.render(tempContainer, { renderTexture: atlasRT });
    tempContainer.destroy({ children: true });

    // 6. 创建子帧纹理
    const textures = {};
    const frames = {};

    for (const [tileTypeStr, fp] of Object.entries(framePositions)) {
      const tileType = parseInt(tileTypeStr);
      const frameRect = new PIXI.Rectangle(fp.x, fp.y, fp.w, fp.h);
      const origRect = new PIXI.Rectangle(0, 0, fp.w, fp.h);

      const subTexture = new PIXI.Texture(
        atlasRT.baseTexture,
        frameRect,
        origRect,
        origRect
      );

      textures[tileType] = subTexture;
      frames[tileType] = { x: fp.x, y: fp.y, w: fp.w, h: fp.h };
    }

    return {
      textures,
      atlasTexture: atlasRT,
      frames,
      atlasWidth,
      atlasHeight,
    };
  }

  /**
   * 下一个 2 的幂
   * @private
   */
  static _nextPow2(n) {
    let v = 1;
    while (v < n) v *= 2;
    return v;
  }

  /**
   * 回退方案：返回原始纹理（图集构建失败时使用）
   * @private
   */
  static _fallbackResult(rawTextures) {
    const frames = {};
    for (const [key, texture] of Object.entries(rawTextures)) {
      const tileType = parseInt(key);
      frames[tileType] = { x: 0, y: 0, w: texture.width, h: texture.height };
    }
    return {
      textures: { ...rawTextures },
      atlasTexture: null,
      frames,
      atlasWidth: 0,
      atlasHeight: 0,
    };
  }
}
