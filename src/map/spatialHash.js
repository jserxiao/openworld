/**
 * 空间哈希 (Spatial Hash)
 *
 * 将空间划分为固定大小的网格单元格，每个实体根据其位置分配到对应的单元格中。
 * 碰撞检测时只需检查相邻单元格中的实体，将 O(n²) 降为 O(n) 平均。
 *
 * 适用于：
 * - 船只碰撞检测（当前 O(n²)，船数量少时差距不大，但可扩展到 100+ 船）
 * - NPC / 怪物 / 弹道等大量移动实体的碰撞
 * - 装饰物空间查询
 *
 * 使用方式：
 *   const hash = new SpatialHash(cellSize);
 *   hash.insert(entity, x, y);
 *   const nearby = hash.query(x, y, radius);
 *   hash.clear();
 */

/**
 * 空间哈希表
 */
export class SpatialHash {
  /**
   * @param {number} cellSize - 单元格大小（瓦片坐标单位）
   *   选择建议：约为最大碰撞半径的 2 倍，确保相邻单元格覆盖所有可能的碰撞
   */
  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    /** @type {Map<string, Array<{entity: any, x: number, y: number}>>} */
    this._cells = new Map();
  }

  /**
   * 计算坐标对应的单元格 key
   * @private
   * @param {number} x
   * @param {number} y
   * @returns {string}
   */
  _key(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  /**
   * 插入实体到空间哈希
   * @param {any} entity - 实体标识（ID、ECS eid、对象引用等）
   * @param {number} x - 世界X坐标
   * @param {number} y - 世界Y坐标
   */
  insert(entity, x, y) {
    const key = this._key(x, y);
    let cell = this._cells.get(key);
    if (!cell) {
      cell = [];
      this._cells.set(key, cell);
    }
    cell.push({ entity, x, y });
  }

  /**
   * 查询指定位置附近的所有实体
   * @param {number} x - 查询中心X
   * @param {number} y - 查询中心Y
   * @param {number} radius - 查询半径
   * @returns {Array<{entity: any, x: number, y: number, distSq: number}>} 附近的实体列表（按距离平方排序）
   */
  query(x, y, radius) {
    const results = [];
    const radiusSq = radius * radius;

    // 计算需要查询的单元格范围
    const minCX = Math.floor((x - radius) / this.cellSize);
    const maxCX = Math.floor((x + radius) / this.cellSize);
    const minCY = Math.floor((y - radius) / this.cellSize);
    const maxCY = Math.floor((y + radius) / this.cellSize);

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const cell = this._cells.get(`${cx},${cy}`);
        if (!cell) continue;

        for (const entry of cell) {
          const dx = entry.x - x;
          const dy = entry.y - y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= radiusSq) {
            results.push({ ...entry, distSq });
          }
        }
      }
    }

    return results;
  }

  /**
   * 查询指定区域内的所有实体对（用于碰撞检测）
   * 每对只返回一次 (a, b) 其中 a < b（通过引用比较）
   *
   * @param {number} collisionRadius - 碰撞半径
   * @returns {Array<{a: any, b: any, distSq: number}>} 碰撞对列表
   */
  queryCollisionPairs(collisionRadius) {
    const pairs = [];
    const collisionRadiusSq = collisionRadius * collisionRadius;
    const checked = new Set(); // 防止重复检测

    for (const [, cell] of this._cells) {
      // 单元格内部碰撞
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const a = cell[i];
          const b = cell[j];
          const pairKey = a.entity < b.entity
            ? `${a.entity}:${b.entity}`
            : `${b.entity}:${a.entity}`;

          if (checked.has(pairKey)) continue;
          checked.add(pairKey);

          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= collisionRadiusSq) {
            pairs.push({ a: a.entity, b: b.entity, distSq });
          }
        }
      }
    }

    // 相邻单元格间的碰撞
    const visitedPairs = new Set();
    for (const [key, cell] of this._cells) {
      const [cx, cy] = key.split(',').map(Number);

      // 只检查右、下、右下、左下 4 个方向（避免重复）
      const neighbors = [
        [cx + 1, cy],
        [cx, cy + 1],
        [cx + 1, cy + 1],
        [cx - 1, cy + 1],
      ];

      for (const [nx, ny] of neighbors) {
        const neighborKey = `${nx},${ny}`;
        const neighborCell = this._cells.get(neighborKey);
        if (!neighborCell) continue;

        for (const a of cell) {
          for (const b of neighborCell) {
            const pairKey = a.entity < b.entity
              ? `${a.entity}:${b.entity}`
              : `${b.entity}:${a.entity}`;

            if (visitedPairs.has(pairKey)) continue;
            visitedPairs.add(pairKey);

            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= collisionRadiusSq) {
              pairs.push({ a: a.entity, b: b.entity, distSq });
            }
          }
        }
      }
    }

    return pairs;
  }

  /**
   * 清空所有数据（每帧重建前调用）
   */
  clear() {
    this._cells.clear();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalEntries = 0;
    let maxCellSize = 0;
    for (const cell of this._cells.values()) {
      totalEntries += cell.length;
      maxCellSize = Math.max(maxCellSize, cell.length);
    }
    return {
      cellCount: this._cells.size,
      totalEntries,
      maxCellSize,
      cellSize: this.cellSize,
    };
  }
}
