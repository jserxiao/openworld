/**
 * 装饰层空间索引 (Spatial Index)
 *
 * 专为装饰物 Y 排序优化的空间索引结构。
 * 将装饰物按瓦片行分组存储，视口移动时只查询涉及的行，
 * 且行内装饰物天然有序，避免全量排序。
 *
 * 替代 _rebuildDecorLayer 中的 O(all_decors) 全量遍历 + O(n log n) 排序，
 * 优化为 O(visible_rows * avg_per_row) 的范围查询 + O(visible) 排序。
 */

import { isTreeTile } from './tileUtils';

/**
 * 装饰物条目
 * @typedef {object} DecorEntry
 * @property {PIXI.Sprite} sprite - 精灵引用
 * @property {number} worldX - 世界瓦片X坐标
 * @property {number} worldY - 世界瓦片Y坐标
 * @property {number} tileType - TILE 枚举值
 * @property {string} _chunkKey - 所属区块key
 */

/**
 * 按行分组的装饰物空间索引
 */
export class DecorSpatialIndex {
  constructor() {
    /**
     * 行索引：rowY -> DecorEntry[]
     * 每行内的装饰物按 worldX 排序
     * @type {Map<number, DecorEntry[]>}
     */
    this._rows = new Map();

    /**
     * 区块到行映射：chunkKey -> Set<rowY>
     * 用于区块移除时快速清理
     * @type {Map<string, Set<number>>}
     */
    this._chunkRows = new Map();

    /**
     * 总条目数
     */
    this._size = 0;
  }

  /**
   * 添加一个装饰物条目
   * @param {string} chunkKey - 所属区块 key
   * @param {DecorEntry} entry
   */
  insert(chunkKey, entry) {
    const rowY = entry.worldY;
    let row = this._rows.get(rowY);
    if (!row) {
      row = [];
      this._rows.set(rowY, row);
    }

    // 标记所属区块
    entry._chunkKey = chunkKey;
    row.push(entry);
    this._size++;

    // 记录区块到行映射
    let chunkRowSet = this._chunkRows.get(chunkKey);
    if (!chunkRowSet) {
      chunkRowSet = new Set();
      this._chunkRows.set(chunkKey, chunkRowSet);
    }
    chunkRowSet.add(rowY);
  }

  /**
   * 移除指定区块的所有装饰物
   * @param {string} chunkKey
   * @returns {DecorEntry[]} 被移除的条目列表
   */
  removeChunk(chunkKey) {
    const chunkRowSet = this._chunkRows.get(chunkKey);
    if (!chunkRowSet) return [];

    const removed = [];
    for (const rowY of chunkRowSet) {
      const row = this._rows.get(rowY);
      if (!row) continue;

      const remaining = [];
      for (const entry of row) {
        if (entry._chunkKey === chunkKey) {
          removed.push(entry);
          this._size--;
        } else {
          remaining.push(entry);
        }
      }

      if (remaining.length === 0) {
        this._rows.delete(rowY);
      } else {
        this._rows.set(rowY, remaining);
      }
    }

    this._chunkRows.delete(chunkKey);
    return removed;
  }

  /**
   * 查询指定瓦片坐标范围内的所有装饰物
   * 结果按 worldY 排序，行内按 worldX 有序
   *
   * @param {number} minX
   * @param {number} maxX
   * @param {number} minY
   * @param {number} maxY
   * @param {object} [options]
   * @param {boolean} [options.hideSmallDecor=false] - 是否隐藏小装饰物（石块/草丛）
   * @returns {DecorEntry[]} 可见装饰物列表
   */
  queryRange(minX, maxX, minY, maxY, options = {}) {
    const results = [];
    const { hideSmallDecor = false } = options;

    // 只遍历可见行范围内的行
    const minRow = Math.floor(minY);
    const maxRow = Math.ceil(maxY);

    for (let rowY = minRow; rowY <= maxRow; rowY++) {
      const row = this._rows.get(rowY);
      if (!row) continue;

      for (const entry of row) {
        // X 范围裁剪
        if (entry.worldX < minX || entry.worldX > maxX) continue;

        // LOD 过滤：低精度时只保留树
        if (hideSmallDecor && !isTreeTile(entry.tileType)) continue;

        results.push(entry);
      }
    }

    // 按 worldY 排序（行间已大致有序，insertion sort 会很快）
    results.sort((a, b) => a.worldY - b.worldY || a.worldX - b.worldX);

    return results;
  }

  /**
   * 清空所有索引数据
   */
  clear() {
    this._rows.clear();
    this._chunkRows.clear();
    this._size = 0;
  }

  /**
   * 获取总条目数
   */
  get size() {
    return this._size;
  }

  /**
   * 获取索引统计信息
   */
  getStats() {
    let maxRowSize = 0;
    for (const row of this._rows.values()) {
      maxRowSize = Math.max(maxRowSize, row.length);
    }
    return {
      totalEntries: this._size,
      rowCount: this._rows.size,
      maxRowSize,
      chunkCount: this._chunkRows.size,
    };
  }
}
