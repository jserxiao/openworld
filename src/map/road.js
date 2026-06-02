/**
 * 道路生成器
 * 在已有地图上生成道路，自动处理拐角、丁字、十字路口
 *
 * 瓦片类型判断已抽离到 tileUtils.js，本模块不再重复定义
 */

import { TILE, DX, DY } from './constants';
import { isRoadTile as _isRoadTile, isStoneRoadTile as _isStoneRoadTile } from './tileUtils';

// 重新导出 tileUtils 中的判断函数，保持向后兼容
export { isRoadTile, isStoneRoadTile } from './tileUtils';

/**
 * 根据一个格子四个方向的邻接情况，决定应该放置什么道路瓦片
 * @param {boolean[]} dirs - 长度4的数组，[up, right, down, left]
 * @param {'road'|'stone'} type - 道路类型
 * @param {string|null} lastDir - 上一步方向
 * @returns {number} TILE 枚举值
 */
function resolveRoadTile(dirs, type = 'road', lastDir = null) {
  const [up, right, down, left] = dirs;
  const count = (up ? 1 : 0) + (right ? 1 : 0) + (down ? 1 : 0) + (left ? 1 : 0);

  const defaultH = type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
  const defaultV = type === 'stone' ? TILE.STONE_ROAD_V : TILE.ROAD_V;
  if (count === 0) {
    if (lastDir === 'up' || lastDir === 'down') return defaultV;
    return defaultH;
  }
  if (count === 4) return type === 'stone' ? TILE.STONE_ROAD_CROSS : TILE.ROAD_CROSS;

  if (count === 3) {
    if (type === 'stone') {
      if (!up) return TILE.STONE_ROAD_T_DOWN;
      if (!right) return TILE.STONE_ROAD_T_LEFT;
      if (!down) return TILE.STONE_ROAD_T_UP;
      if (!left) return TILE.STONE_ROAD_T_RIGHT;
    } else {
      if (!up) return TILE.ROAD_T_DOWN;
      if (!right) return TILE.ROAD_T_LEFT;
      if (!down) return TILE.ROAD_T_UP;
      if (!left) return TILE.ROAD_T_RIGHT;
    }
  }

  if (count === 2) {
    if (up && down) return type === 'stone' ? TILE.STONE_ROAD_V : TILE.ROAD_V;
    if (left && right) return type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
    if (down && right) return type === 'stone' ? TILE.STONE_ROAD_CORNER_BR : TILE.ROAD_CORNER_BR;
    if (left && down) return type === 'stone' ? TILE.STONE_ROAD_CORNER_BL : TILE.ROAD_CORNER_BL;
    if (up && left) return type === 'stone' ? TILE.STONE_ROAD_CORNER_TL : TILE.ROAD_CORNER_TL;
    if (right && up) return type === 'stone' ? TILE.STONE_ROAD_CORNER_TR : TILE.ROAD_CORNER_TR;
  }

  if (count === 1) {
    if (type === 'stone') {
      if (up || down) return TILE.STONE_ROAD_V;
      return TILE.STONE_ROAD_H;
    }
    if (up) return TILE.ROAD_END_UP;
    if (right) return TILE.ROAD_END_RIGHT;
    if (down) return TILE.ROAD_END_DOWN;
    if (left) return TILE.ROAD_END_LEFT;
  }

  return type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
}

/**
 * 在已有地图上生成道路
 * 道路采用曼哈顿路径（先水平后垂直），支持多条线段，交叉自动升级为丁字/十字
 *
 * @param {object} options
 * @param {Uint8Array[]} options.map - 已有地图数据（会被原地修改）
 * @param {number} options.mapW - 地图列数
 * @param {number} options.mapH - 地图行数
 * @param {Array<{start:[number,number], end:[number,number]}>} options.segments - 道路段数组
 * @param {'road'|'stone'} [options.type='road'] - 道路类型
 * @returns {{ map: Uint8Array[], mapW: number, mapH: number }}
 */
export function generateRoad(options) {
  const {
    map,
    mapW,
    mapH,
    segments = [],
    type = 'road',
  } = options;

  const defaultTile = type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
  const checkFn = type === 'stone' ? _isStoneRoadTile : _isRoadTile;

  // 1. 收集所有路径格子
  const roadCells = new Set();
  const cellDir = new Map();

  for (const seg of segments) {
    const [sx, sy] = seg.start;
    const [ex, ey] = seg.end;

    if (sx !== ex) {
      const xMin = Math.max(0, Math.min(sx, ex));
      const xMax = Math.min(mapW - 1, Math.max(sx, ex));
      const y = Math.max(0, Math.min(mapH - 1, sy));
      for (let x = xMin; x <= xMax; x++) {
        if (map[y][x] === TILE.GRASS) {
          const key = `${x},${y}`;
          roadCells.add(key);
          cellDir.set(key, 'h');
        }
      }
    }
    if (sy !== ey) {
      const yMin = Math.max(0, Math.min(sy, ey));
      const yMax = Math.min(mapH - 1, Math.max(sy, ey));
      const x = Math.max(0, Math.min(mapW - 1, ex));
      for (let y = yMin; y <= yMax; y++) {
        if (map[y][x] === TILE.GRASS) {
          const key = `${x},${y}`;
          roadCells.add(key);
          cellDir.set(key, 'v');
        }
      }
    }
  }

  // 2. 先把所有路径格标记为默认道路瓦片
  for (const key of roadCells) {
    const [x, y] = key.split(',').map(Number);
    map[y][x] = defaultTile;
  }

  // 3. 根据每个道路格的四邻接情况，重新解析为正确的道路瓦片类型
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 5) {
    changed = false;
    iterations++;

    for (const key of roadCells) {
      const [x, y] = key.split(',').map(Number);
      const dirs = [false, false, false, false];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && nx < mapW && ny >= 0 && ny < mapH && checkFn(map[ny][nx])) {
          dirs[d] = true;
        }
      }
      const dir = cellDir.get(key) || 'h';
      const lastDir = dir === 'v' ? 'down' : 'right';
      const newTile = resolveRoadTile(dirs, type, lastDir);
      if (map[y][x] !== newTile) {
        map[y][x] = newTile;
        changed = true;
      }
    }
  }

  return { map, mapW, mapH };
}
