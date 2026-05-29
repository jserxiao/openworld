/**
 * 树木生成器
 * 在草地格子上随机生成树木（大树/小树）
 */

import { TILE } from './constants';

/**
 * 判断瓦片是否是树木类型
 * @param {number} tile
 * @returns {boolean}
 */
export function isTreeTile(tile) {
  return tile === TILE.TREE_BIG || tile === TILE.TREE_SMALL;
}

/**
 * 在地图上随机生成树木
 * 只会在草地格子上放置树木，不覆盖池塘、道路等已有元素
 *
 * @param {object} options
 * @param {Uint8Array[]} options.map - 地图数据（会被原地修改）
 * @param {number} options.mapW - 地图列数
 * @param {number} options.mapH - 地图行数
 * @param {number} [options.count=30] - 生成树木的数量
 * @param {number} [options.bigRatio=0.4] - 大树占比（0~1）
 * @param {number} [options.seed] - 随机种子（可选，用于可重复生成）
 * @returns {{ trees: Array<{x: number, y: number, type: number}> }} 生成的树木列表
 */
export function generateTrees(options) {
  const {
    map,
    mapW,
    mapH,
    count = 30,
    bigRatio = 0.4,
    seed,
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

  const actualCount = Math.min(count, shuffled.length);
  const bigCount = Math.round(actualCount * bigRatio);
  const trees = [];

  for (let i = 0; i < actualCount; i++) {
    const { x, y } = shuffled[i];
    const type = i < bigCount ? TILE.TREE_BIG : TILE.TREE_SMALL;
    map[y][x] = type;
    trees.push({ x, y, type });
  }

  return { trees };
}
