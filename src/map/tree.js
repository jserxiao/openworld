/**
 * 树木生成器
 * 在草地格子上随机生成树木（一棵树/两棵树/三棵树/大量树）
 * 支持聚集效应：少量概率在已有树附近密集生成
 *
 * 瓦片类型判断已抽离到 tileUtils.js，本模块不再重复定义
 */

import { TILE, TREE_VARIANTS } from './constants';
import { createSeededRandom, buildCumWeights, weightedRandom } from './utils';

// 重新导出 tileUtils 中的判断函数，保持向后兼容
export { isTreeTile } from './tileUtils';

/**
 * 在地图上随机生成树木
 * 只会在草地格子上放置树木，不覆盖池塘、道路等已有元素
 * 树木类型按权重随机选择（一棵树最多，大量树最少）
 *
 * @param {object} options
 * @param {Uint8Array[]} options.map - 地图数据（会被原地修改）
 * @param {number} options.mapW - 地图列数
 * @param {number} options.mapH - 地图行数
 * @param {number} [options.count=60] - 生成树木的数量
 * @param {number} [options.seed] - 随机种子
 * @param {number} [options.clusterChance=0.25] - 聚集概率
 * @param {number} [options.clusterRadius=2] - 聚集半径
 * @returns {{ trees: Array<{x: number, y: number, type: number}> }} 生成的树木列表
 */
export function generateTrees(options) {
  const {
    map,
    mapW,
    mapH,
    count = 60,
    seed,
    clusterChance = 0.25,
    clusterRadius = 2,
  } = options;

  // 收集所有草地格子
  const grassCells = [];
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (map[y][x] === TILE.GRASS) {
        grassCells.push({ x, y });
      }
    }
  }

  if (grassCells.length === 0) return { trees: [] };

  const random = createSeededRandom(seed ?? Date.now());

  // Fisher-Yates 洗牌
  const shuffled = grassCells.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const { cumWeights, totalWeight } = buildCumWeights(TREE_VARIANTS);

  const actualCount = Math.min(count, shuffled.length);
  const trees = [];
  const usedPositions = new Set();

  for (let i = 0; i < actualCount; i++) {
    let x, y;

    // 聚集效应
    if (trees.length > 0 && random() < clusterChance) {
      const centerIndex = Math.floor(random() * trees.length);
      const center = trees[centerIndex];
      const candidates = [];
      for (let dy = -clusterRadius; dy <= clusterRadius; dy++) {
        for (let dx = -clusterRadius; dx <= clusterRadius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = center.x + dx;
          const ny = center.y + dy;
          if (nx >= 0 && nx < mapW && ny >= 0 && ny < mapH) {
            const key = `${nx},${ny}`;
            if (map[ny][nx] === TILE.GRASS && !usedPositions.has(key)) {
              candidates.push({ x: nx, y: ny });
            }
          }
        }
      }
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(random() * candidates.length)];
        x = pick.x;
        y = pick.y;
      }
    }

    if (x === undefined || y === undefined) {
      let found = false;
      while (i < shuffled.length && !found) {
        const candidate = shuffled[i];
        const key = `${candidate.x},${candidate.y}`;
        if (!usedPositions.has(key)) {
          x = candidate.x;
          y = candidate.y;
          found = true;
        }
        if (!found) i++;
      }
      if (!found) break;
    }

    const key = `${x},${y}`;
    if (usedPositions.has(key)) continue;

    usedPositions.add(key);
    const type = weightedRandom(cumWeights, totalWeight, random);
    map[y][x] = type;
    trees.push({ x, y, type });
  }

  return { trees };
}
