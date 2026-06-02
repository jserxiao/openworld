/**
 * 装饰物生成器
 * 在草地格子上随机生成石块、岩块、草丛、浆果丛等装饰物
 * 支持聚集效应
 *
 * 瓦片类型判断已抽离到 tileUtils.js，本模块不再重复定义
 */

import { TILE } from './constants';
import { createSeededRandom, buildCumWeights, weightedRandom } from './utils';

// 重新导出 tileUtils 中的判断函数，保持向后兼容
export {
  isDecorationTile,
  isStoneTile,
  isRockTile,
  isBushTile,
  isHillTile,
  isBeachTile,
  isWaterTile,
  isWaterAreaTile,
} from './tileUtils';

/**
 * 在地图上随机生成装饰物
 * 只会在草地格子上放置，不覆盖道路、已有装饰物等
 * 支持聚集效应：少量概率在已有装饰物附近密集出现
 *
 * @param {object} options
 * @param {Uint8Array[]} options.map - 地图数据（会被原地修改）
 * @param {number} options.mapW - 地图列数
 * @param {number} options.mapH - 地图行数
 * @param {Array<{tile: number, weight: number}>} options.variants - 装饰物变体权重表
 * @param {number} [options.count=30] - 生成装饰物的数量
 * @param {number} [options.seed] - 随机种子（可选，用于可重复生成）
 * @param {number} [options.clusterChance=0.2] - 聚集概率（0~1）
 * @param {number} [options.clusterRadius=2] - 聚集半径
 * @returns {{ decorations: Array<{x: number, y: number, type: number}> }} 生成的装饰物列表
 */
export function generateDecorations(options) {
  const {
    map,
    mapW,
    mapH,
    variants,
    count = 30,
    seed,
    clusterChance = 0.2,
    clusterRadius = 2,
  } = options;

  if (!variants || variants.length === 0) return { decorations: [] };

  // 收集所有可用草地格子
  const grassCells = [];
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      if (map[y][x] === TILE.GRASS) {
        grassCells.push({ x, y });
      }
    }
  }

  if (grassCells.length === 0) return { decorations: [] };

  const random = createSeededRandom(seed ?? Date.now());

  // Fisher-Yates 洗牌，随机选取位置
  const shuffled = grassCells.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // 预计算变体权重累积表
  const { cumWeights, totalWeight } = buildCumWeights(variants);

  const actualCount = Math.min(count, shuffled.length);
  const decorations = [];
  const usedPositions = new Set();

  for (let i = 0; i < actualCount; i++) {
    let x, y;

    // 聚集效应：如果已有装饰物，尝试在附近生成
    if (decorations.length > 0 && random() < clusterChance) {
      const centerIndex = Math.floor(random() * decorations.length);
      const center = decorations[centerIndex];
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

    // 如果没有触发聚集或聚集失败，使用随机位置
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
    decorations.push({ x, y, type });
  }

  return { decorations };
}
