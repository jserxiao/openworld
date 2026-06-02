/**
 * 视口管理模块
 * 封装视口状态、坐标转换和变换计算
 * 从 renderer.js 中抽离，使渲染器不必关心坐标数学细节
 */

import { MAX_CACHED_CHUNKS } from './constants';

/**
 * 视口状态
 * @typedef {object} ViewportState
 * @property {number} x - 视口左上角瓦片X坐标
 * @property {number} y - 视口左上角瓦片Y坐标
 * @property {number} zoom - 缩放倍数
 */

/**
 * 视口信息（供 UI 显示）
 * @typedef {object} ViewportInfo
 * @property {number} x
 * @property {number} y
 * @property {number} zoom
 * @property {number} screenW
 * @property {number} screenH
 * @property {number} tileSize
 * @property {number} tileStartX
 * @property {number} tileStartY
 * @property {number} tileEndX
 * @property {number} tileEndY
 * @property {number} cachedChunks
 * @property {number} maxChunks
 * @property {number} pendingRequests
 * @property {boolean} workerReady
 */

/**
 * 视口管理器
 * 负责视口状态维护、屏幕坐标↔瓦片坐标转换、PixiJS 容器变换
 */
export class Viewport {
  /**
   * @param {{ w: number, h: number }} tileSize - 瓦片像素尺寸
   */
  constructor(tileSize) {
    /** @type {{ w: number, h: number }} */
    this.tileSize = tileSize;
    /** @type {ViewportState} */
    this.state = { x: 0, y: 0, zoom: 1 };
  }

  /**
   * 更新瓦片尺寸（纹理加载后可能变化）
   */
  updateTileSize(tileSize) {
    this.tileSize = tileSize;
  }

  // ────────────────────────────────────────────
  // 坐标转换
  // ────────────────────────────────────────────

  /**
   * 屏幕像素坐标 → 世界瓦片坐标
   * @param {number} screenX
   * @param {number} screenY
   * @returns {{ tileX: number, tileY: number }}
   */
  screenToWorldTile(screenX, screenY) {
    const tileW = this.tileSize.w;
    const { x, y, zoom } = this.state;
    const worldX = x + screenX / (zoom * tileW);
    const worldY = y + screenY / (zoom * tileW);
    return {
      tileX: Math.floor(worldX),
      tileY: Math.floor(worldY),
    };
  }

  /**
   * 获取视口在瓦片坐标系下的可见范围
   * @returns {{ x: number, y: number, w: number, h: number, endX: number, endY: number }}
   */
  getVisibleTileRange() {
    const { zoom, x, y } = this.state;
    const tileW = this.tileSize.w;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileViewW = screenW / (zoom * tileW);
    const tileViewH = screenH / (zoom * tileW);
    return {
      x, y,
      w: tileViewW,
      h: tileViewH,
      endX: x + tileViewW,
      endY: y + tileViewH,
    };
  }

  // ────────────────────────────────────────────
  // 视口变换
  // ────────────────────────────────────────────

  /**
   * 将视口变换应用到 PixiJS 容器
   * @param {PIXI.Container} mapContainer
   */
  applyTransform(mapContainer) {
    if (!mapContainer) return;
    const { zoom, x, y } = this.state;
    const tileW = this.tileSize.w;
    mapContainer.scale.set(zoom * tileW, zoom * tileW);
    mapContainer.x = -x * zoom * tileW;
    mapContainer.y = -y * zoom * tileW;
  }

  /**
   * 居中到指定世界瓦片坐标
   * @param {number} worldTileX
   * @param {number} worldTileY
   */
  centerOn(worldTileX, worldTileY) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const tileW = this.tileSize.w;
    this.state.x = worldTileX - screenW / (2 * this.state.zoom * tileW);
    this.state.y = worldTileY - screenH / (2 * this.state.zoom * tileW);
  }

  /**
   * 重置到原点
   */
  reset() {
    this.state = { x: 0, y: 0, zoom: 1 };
  }

  // ────────────────────────────────────────────
  // 视口信息
  // ────────────────────────────────────────────

  /**
   * 获取视口信息对象（供 UI 显示和回调使用）
   * @param {object} [chunkStats] - 区块管理器统计信息
   * @returns {ViewportInfo}
   */
  getInfo(chunkStats) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const { x, y, zoom } = this.state;
    const { w: tileW } = this.tileSize;
    const range = this.getVisibleTileRange();

    return {
      x: Math.floor(x),
      y: Math.floor(y),
      zoom,
      screenW,
      screenH,
      tileSize: tileW,
      tileStartX: Math.floor(x),
      tileStartY: Math.floor(y),
      tileEndX: Math.floor(range.endX),
      tileEndY: Math.floor(range.endY),
      cachedChunks: chunkStats?.cachedChunks ?? 0,
      maxChunks: chunkStats?.maxChunks ?? MAX_CACHED_CHUNKS,
      pendingRequests: chunkStats?.pendingRequests ?? 0,
      workerReady: chunkStats?.workerReady ?? false,
    };
  }
}
