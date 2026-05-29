/**
 * 道路生成器
 * 在已有地图上生成道路，自动处理拐角、丁字、十字路口
 */

import { TILE, DX, DY } from './constants';

/**
 * 判断一个瓦片类型是否是道路（包括普通路和石板路）
 */
export function isRoadTile(tile) {
  return (tile >= TILE.ROAD_H && tile <= TILE.ROAD_CROSS)
    || (tile >= TILE.STONE_ROAD_H && tile <= TILE.STONE_ROAD_CROSS);
}

/**
 * 判断一个瓦片类型是否是石板路
 */
export function isStoneRoadTile(tile) {
  return tile >= TILE.STONE_ROAD_H && tile <= TILE.STONE_ROAD_CROSS;
}

/**
 * 根据一个格子四个方向的邻接情况，决定应该放置什么道路瓦片
 * @param {boolean[]} dirs - 长度4的数组，[up, right, down, left] 表示该方向是否有路连通
 * @param {'road'|'stone'} type - 道路类型：'road' 普通路，'stone' 石板路
 * @returns {number} TILE 枚举值
 */
function resolveRoadTile(dirs, type = 'road', lastDir = null) {
  const [up, right, down, left] = dirs;
  const count = (up ? 1 : 0) + (right ? 1 : 0) + (down ? 1 : 0) + (left ? 1 : 0);

  const defaultH = type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
  const defaultV = type === 'stone' ? TILE.STONE_ROAD_V : TILE.ROAD_V;
  if (count === 0) {
    // 孤立格：优先按上一个方向延伸，否则默认水平
    if (lastDir === 'up' || lastDir === 'down') return defaultV;
    return defaultH;
  }
  if (count === 4) return type === 'stone' ? TILE.STONE_ROAD_CROSS : TILE.ROAD_CROSS; // 十字

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
    // 直路
    if (up && down) return type === 'stone' ? TILE.STONE_ROAD_V : TILE.ROAD_V;
    if (left && right) return type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
    // 拐角
    if (down && right) return type === 'stone' ? TILE.STONE_ROAD_CORNER_BR : TILE.ROAD_CORNER_BR;
    if (left && down) return type === 'stone' ? TILE.STONE_ROAD_CORNER_BL : TILE.ROAD_CORNER_BL;
    if (up && left) return type === 'stone' ? TILE.STONE_ROAD_CORNER_TL : TILE.ROAD_CORNER_TL;
    if (right && up) return type === 'stone' ? TILE.STONE_ROAD_CORNER_TR : TILE.ROAD_CORNER_TR;
  }

  if (count === 1) {
    // 死胡同，按唯一方向给一个直路
    if (up || down) return type === 'stone' ? TILE.STONE_ROAD_V : TILE.ROAD_V;
    return type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
  }

  return type === 'stone' ? TILE.STONE_ROAD_H : TILE.ROAD_H;
}

/**
 * 根据已有地图数据，检测 (x,y) 格四个方向是否与道路连通
 * @param {Uint8Array[]} map
 * @param {number} mapW
 * @param {number} mapH
 * @param {number} x - 列
 * @param {number} y - 行
 * @returns {boolean[]} [up, right, down, left]
 */
function getRoadDirs(map, mapW, mapH, x, y, type) {
  const dirs = [false, false, false, false];
  const checkFn = type === 'stone' ? isStoneRoadTile : isRoadTile;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d];
    const ny = y + DY[d];
    if (nx >= 0 && nx < mapW && ny >= 0 && ny < mapH && checkFn(map[ny][nx])) {
      dirs[d] = true;
    }
  }
  return dirs;
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
 *   start/end 格式为 [col, row]（即 [x, y]）
 *   每段生成一条从 start 到 end 的曼哈顿路径（先水平后垂直）
 * @param {'road'|'stone'} [options.type='road'] - 道路类型：'road' 普通路，'stone' 石板路
 * @returns {{ map: Uint8Array[], mapW: number, mapH: number }}
 *
 * @example
 * generateRoad({
 *   map, mapW, mapH,
 *   segments: [
 *     { start: [2, 5], end: [15, 5] },   // 水平路
 *     { start: [8, 2], end: [8, 12] },    // 垂直路（与上面交叉成十字）
 *     { start: [2, 8], end: [8, 8] },     // 水平路（与垂直路交叉成丁字）
 *   ],
 * })
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

  // 1. 收集所有路径格子的坐标集合（裁剪到地图范围内，跳过非草地格避免覆盖池塘等）
  //    同时记录每个格子所在段的主方向（水平/垂直），用于孤立格判断
  const roadCells = new Set();
  const cellDir = new Map(); // key → 'h' | 'v'

  for (const seg of segments) {
    const [sx, sy] = seg.start;
    const [ex, ey] = seg.end;

    // 先水平后垂直
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

  // 2. 先把所有路径格标记为默认道路瓦片（临时标记）
  for (const key of roadCells) {
    const [x, y] = key.split(',').map(Number);
    map[y][x] = defaultTile;
  }

  // 3. 根据每个道路格的四邻接情况，重新解析为正确的道路瓦片类型
  //    可能需要多轮迭代（丁字/十字的引入会改变邻居的邻接）
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 5) {
    changed = false;
    iterations++;

    for (const key of roadCells) {
      const [x, y] = key.split(',').map(Number);
      const dirs = getRoadDirs(map, mapW, mapH, x, y, type);
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
