/**
 * 装饰物生成器
 * 在草地格子上随机生成石块、岩块、草丛、浆果丛等装饰物
 * 支持聚集效应
 */

import { TILE } from './constants';

/**
 * 判断瓦片是否是装饰物类型（石块、岩块、草丛、浆果丛）
 * @param {number} tile
 * @returns {boolean}
 */
export function isDecorationTile(tile) {
  return (tile >= TILE.STONE_SMALL && tile <= TILE.STONE_3)
    || (tile >= TILE.ROCK_SMALL && tile <= TILE.ROCK_3)
    || tile === TILE.BUSH
    || tile === TILE.BERRY;
}

/**
 * 判断瓦片是否是山坡类型
 * @param {number} tile
 * @returns {boolean}
 */
export function isHillTile(tile) {
  return tile >= TILE.HILL_TL && tile <= TILE.HILL_BR;
}

/**
 * 判断瓦片是否是石块类型
 * @param {number} tile
 * @returns {boolean}
 */
export function isStoneTile(tile) {
  return tile >= TILE.STONE_SMALL && tile <= TILE.STONE_3;
}

/**
 * 判断瓦片是否是岩块类型
 * @param {number} tile
 * @returns {boolean}
 */
export function isRockTile(tile) {
  return tile >= TILE.ROCK_SMALL && tile <= TILE.ROCK_3;
}

/**
 * 判断瓦片是否是草丛/浆果丛类型
 * @param {number} tile
 * @returns {boolean}
 */
export function isBushTile(tile) {
  return tile === TILE.BUSH || tile === TILE.BERRY;
}

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

  // 简单的伪随机数生成器（支持种子）
  let rngState = seed ?? Date.now();
  const random = () => {
    rngState = (rngState * 1664525 + 1013904223) & 0xffffffff;
    return (rngState >>> 0) / 0xffffffff;
  };

  // Fisher-Yates 洗牌，随机选取位置
  const shuffled = grassCells.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // 预计算变体权重累积表
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  const cumWeights = [];
  let cum = 0;
  for (const v of variants) {
    cum += v.weight;
    cumWeights.push({ tile: v.tile, cum });
  }

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
    const type = _weightedRandom(cumWeights, totalWeight);
    map[y][x] = type;
    decorations.push({ x, y, type });
  }

  return { decorations };
}

/**
 * 加权随机选择
 * @param {Array<{tile: number, cum: number}>} cumWeights - 累积权重表
 * @param {number} totalWeight - 总权重
 * @returns {number} TILE 枚举值
 */
function _weightedRandom(cumWeights, totalWeight) {
  const r = Math.random() * totalWeight;
  for (const { tile, cum } of cumWeights) {
    if (r < cum) return tile;
  }
  return cumWeights[cumWeights.length - 1].tile;
}
