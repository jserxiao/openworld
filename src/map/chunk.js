/**
 * 区块(Chunk)系统 - 无限地图核心
 * 
 * 设计思路：
 * - 整个世界被划分为固定大小的区块(CHUNK_SIZE x CHUNK_SIZE瓦片)
 * - 每个区块通过(chunkX, chunkY)坐标唯一标识
 * - 使用确定性种子噪声生成地形，同一坐标永远生成相同内容
 * - 道路由全局噪声驱动，自动穿越区块边界
 * - 装饰物(树/石/草)由区块本地噪声驱动
 * - LRU缓存管理区块数据，远离视口的区块会被回收
 */

import { TILE, CHUNK_SIZE, WORLD_SEED, GRASS_VARIANTS, TREE_VARIANTS, STONE_VARIANTS, ROCK_VARIANTS, BUSH_VARIANTS, FOREST_VARIANTS, MAX_CACHED_CHUNKS, FOREST_CONFIG } from './constants';
import { createNoise } from './noise';
import { generateRoad, isRoadTile } from './road';
import { isHillTile } from './decorations';

// ────────────────────────────────────────────
// 确定性随机数生成器（用于装饰物等非连续内容）
// ────────────────────────────────────────────
function createSeededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ────────────────────────────────────────────
// 加权随机选择
// ────────────────────────────────────────────
function weightedRandom(cumWeights, totalWeight, random) {
  const r = random() * totalWeight;
  for (const { tile, cum } of cumWeights) {
    if (r < cum) return tile;
  }
  return cumWeights[cumWeights.length - 1].tile;
}

function buildCumWeights(variants) {
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  const cumWeights = [];
  let cum = 0;
  for (const v of variants) {
    cum += v.weight;
    cumWeights.push({ tile: v.tile, cum });
  }
  return { cumWeights, totalWeight };
}

// ────────────────────────────────────────────
// 单个区块数据结构
// ────────────────────────────────────────────
export class Chunk {
  /**
   * @param {number} chunkX - 区块在世界中的列索引
   * @param {number} chunkY - 区块在世界中的行索引
   */
  constructor(chunkX, chunkY) {
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    /** @type {Uint8Array[]} 瓦片数据 [localY][localX] */
    this.map = [];
    /** @type {Uint8Array[]} 草地变体数据 [localY][localX] */
    this.grassMap = [];
    /** 最后访问时间戳（用于LRU） */
    this.lastAccess = 0;
  }
}

// ────────────────────────────────────────────
// 区块管理器
// ────────────────────────────────────────────
export class ChunkManager {
  /**
   * @param {object} [options] - 可选配置
   * @param {object} [options.forest] - 森林生成配置，覆盖 FOREST_CONFIG 默认值
   */
  constructor(options = {}) {
    /** @type {Map<string, Chunk>} 区块缓存 key=`${chunkX},${chunkY}` */
    this.chunks = new Map();
    /** LRU 访问顺序（最新在末尾） */
    this.accessOrder = [];
    /** 全局噪声实例 */
    this.roadNoise = createNoise(WORLD_SEED);
    this.forestNoise = createNoise(WORLD_SEED + 1);
    this.treeNoise = createNoise(WORLD_SEED + 2);
    this.stoneNoise = createNoise(WORLD_SEED + 3);
    this.rockNoise = createNoise(WORLD_SEED + 4);
    this.bushNoise = createNoise(WORLD_SEED + 5);
    this.grassNoise = createNoise(WORLD_SEED + 6);
    /** 全局道路段缓存（避免重复计算） */
    this._roadSegmentsCache = new Map();
    /** 山坡噪声实例 */
    this.hillNoise = createNoise(WORLD_SEED + 8);
    /** 森林配置（合并默认值和用户传入值） */
    this.forestConfig = { ...FOREST_CONFIG, ...options.forest };
  }

  /**
   * 获取区块缓存key
   */
  _key(cx, cy) {
    return `${cx},${cy}`;
  }

  /**
   * 获取指定区块，如果不存在则生成
   * @param {number} chunkX
   * @param {number} chunkY
   * @returns {Chunk}
   */
  getChunk(chunkX, chunkY) {
    const key = this._key(chunkX, chunkY);
    let chunk = this.chunks.get(key);

    if (chunk) {
      chunk.lastAccess = Date.now();
      // 更新LRU顺序
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
        this.accessOrder.push(key);
      }
      return chunk;
    }

    // 生成新区块
    chunk = this._generateChunk(chunkX, chunkY);
    this._addChunk(key, chunk);
    return chunk;
  }

  /**
   * 确保指定区块已加载（不返回数据，仅预加载用）
   */
  ensureChunk(chunkX, chunkY) {
    const key = this._key(chunkX, chunkY);
    if (!this.chunks.has(key)) {
      const chunk = this._generateChunk(chunkX, chunkY);
      this._addChunk(key, chunk);
    }
  }

  /**
   * 添加区块到缓存，并执行LRU淘汰
   */
  _addChunk(key, chunk) {
    this.chunks.set(key, chunk);
    this.accessOrder.push(key);

    // LRU淘汰
    while (this.chunks.size > MAX_CACHED_CHUNKS) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey && this.chunks.has(oldestKey)) {
        this.chunks.delete(oldestKey);
      }
    }
  }

  /**
   * 获取视口可见范围内的所有区块
   * @param {number} viewX - 视口左上角的世界瓦片X
   * @param {number} viewY - 视口左上角的世界瓦片Y
   * @param {number} viewW - 视口宽度（瓦片数）
   * @param {number} viewH - 视口高度（瓦片数）
   * @param {number} margin - 额外加载的区块边距
   * @returns {Chunk[]}
   */
  getVisibleChunks(viewX, viewY, viewW, viewH, margin = 0) {
    const startCX = Math.floor(viewX / CHUNK_SIZE) - margin;
    const startCY = Math.floor(viewY / CHUNK_SIZE) - margin;
    const endCX = Math.floor((viewX + viewW) / CHUNK_SIZE) + margin;
    const endCY = Math.floor((viewY + viewH) / CHUNK_SIZE) + margin;

    const result = [];
    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        result.push(this.getChunk(cx, cy));
      }
    }
    return result;
  }

  /**
   * 获取指定世界坐标的瓦片类型
   * @param {number} worldX - 世界瓦片X
   * @param {number} worldY - 世界瓦片Y
   * @returns {number} TILE枚举值
   */
  getTile(worldX, worldY) {
    const cx = Math.floor(worldX / CHUNK_SIZE);
    const cy = Math.floor(worldY / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cy);
    const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.map[ly][lx];
  }

  /**
   * 获取指定世界坐标的草地变体
   */
  getGrassTile(worldX, worldY) {
    const cx = Math.floor(worldX / CHUNK_SIZE);
    const cy = Math.floor(worldY / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cy);
    const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.grassMap[ly][lx];
  }

  // ────────────────────────────────────────────
  // 区块生成核心逻辑
  // ────────────────────────────────────────────

  /**
   * 生成一个区块的全部数据
   * @private
   */
  _generateChunk(chunkX, chunkY) {
    const chunk = new Chunk(chunkX, chunkY);
    const S = CHUNK_SIZE;

    // 1. 初始化全草地 + 草地变体
    const grassSeed = (chunkX * 73856093 ^ chunkY * 19349669 ^ WORLD_SEED) & 0xffffffff;
    const grassRng = createSeededRandom(grassSeed);
    const { cumWeights: grassCW, totalWeight: grassTW } = buildCumWeights(GRASS_VARIANTS);

    for (let ly = 0; ly < S; ly++) {
      chunk.map[ly] = new Uint8Array(S);
      chunk.map[ly].fill(TILE.GRASS);
      chunk.grassMap[ly] = new Uint8Array(S);
      for (let lx = 0; lx < S; lx++) {
        chunk.grassMap[ly][lx] = weightedRandom(grassCW, grassTW, grassRng);
      }
    }

    // 2. 生成山坡（噪声驱动，地形特征）
    this._generateHills(chunk);

    // 3. 生成道路（在山坡之后，不覆盖山坡）
    this._generateRoadsForChunk(chunk);

    // 4. 生成森林区域（噪声驱动，密集树木，不覆盖道路和山坡）
    this._generateForests(chunk);

    // 5. 生成散落树木（非森林区域的零星树木，不覆盖道路和山坡）
    this._generateTreesForChunk(chunk);

    // 6. 生成装饰物（石块、岩块、草丛/浆果丛，不覆盖道路和山坡）
    this._generateDecorationsForChunk(chunk);

    chunk.lastAccess = Date.now();
    return chunk;
  }

  /**
   * 在区块中生成山坡区域
   * 使用噪声确定山坡区域，然后根据邻接关系自动选择正确的3×3子瓦片
   * 山坡瓦片类型：上排(顶缘)、中排(坡面)、下排(坡脚)
   * 每排又分左、中、右三种
   * @private
   */
  _generateHills(chunk) {
    const S = CHUNK_SIZE;
    const cx = chunk.chunkX;
    const cy = chunk.chunkY;

    // 第一步：用噪声标记哪些瓦片是山坡
    const hillMask = [];
    for (let ly = 0; ly < S; ly++) {
      hillMask[ly] = new Uint8Array(S);
      for (let lx = 0; lx < S; lx++) {
        const worldX = cx * S + lx;
        const worldY = cy * S + ly;
        const hillValue = this.hillNoise.fbm(worldX * 6.0, worldY * 6.0, 2, 2, 0.5);
        if (hillValue > 0.85 && chunk.map[ly][lx] === TILE.GRASS) {
          hillMask[ly][lx] = 1;
        }
      }
    }

    // 第二步：连通分量分析，确保每个连通区域至少3x3（保证9种素材都能出现）
    // 找到所有连通分量，对小分量进行扩展
    const visited = [];
    for (let ly = 0; ly < S; ly++) {
      visited[ly] = new Uint8Array(S);
    }

    const bfs = (startLX, startLY) => {
      const component = [];
      const queue = [{ lx: startLX, ly: startLY }];
      visited[startLY][startLX] = 1;

      while (queue.length > 0) {
        const { lx, ly } = queue.shift();
        component.push({ lx, ly });

        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        for (const [dx, dy] of dirs) {
          const nlx = lx + dx;
          const nly = ly + dy;
          if (nlx >= 0 && nlx < S && nly >= 0 && nly < S
            && !visited[nly][nlx] && hillMask[nly][nlx] === 1) {
            visited[nly][nlx] = 1;
            queue.push({ lx: nlx, ly: nly });
          }
        }
      }
      return component;
    };

    // 找出所有连通分量
    const components = [];
    for (let ly = 0; ly < S; ly++) {
      for (let lx = 0; lx < S; lx++) {
        if (hillMask[ly][lx] === 1 && !visited[ly][lx]) {
          components.push(bfs(lx, ly));
        }
      }
    }

    // 对每个连通分量，计算其边界框，如果不足3x3则扩展
    for (const comp of components) {
      let minX = S, maxX = 0, minY = S, maxY = 0;
      for (const { lx, ly } of comp) {
        if (lx < minX) minX = lx;
        if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly;
        if (ly > maxY) maxY = ly;
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;

      // 如果边界框不足3x3，扩展到3x3
      if (width < 3 || height < 3) {
        // 计算扩展后的边界框
        let newMinX = minX, newMaxX = maxX, newMinY = minY, newMaxY = maxY;

        if (width < 3) {
          const expand = 3 - width;
          const expandLeft = Math.floor(expand / 2);
          const expandRight = expand - expandLeft;
          newMinX = Math.max(0, minX - expandLeft);
          newMaxX = Math.min(S - 1, maxX + expandRight);
          // 如果碰到边界，从另一侧补齐
          if (newMinX === 0 && newMaxX - newMinX + 1 < 3) {
            newMaxX = Math.min(S - 1, newMinX + 2);
          }
          if (newMaxX === S - 1 && newMaxX - newMinX + 1 < 3) {
            newMinX = Math.max(0, newMaxX - 2);
          }
        }

        if (height < 3) {
          const expand = 3 - height;
          const expandUp = Math.floor(expand / 2);
          const expandDown = expand - expandUp;
          newMinY = Math.max(0, minY - expandUp);
          newMaxY = Math.min(S - 1, maxY + expandDown);
          if (newMinY === 0 && newMaxY - newMinY + 1 < 3) {
            newMaxY = Math.min(S - 1, newMinY + 2);
          }
          if (newMaxY === S - 1 && newMaxY - newMinY + 1 < 3) {
            newMinY = Math.max(0, newMaxY - 2);
          }
        }

        // 将扩展区域内的草地瓦片也标记为山坡
        for (let ly = newMinY; ly <= newMaxY; ly++) {
          for (let lx = newMinX; lx <= newMaxX; lx++) {
            if (hillMask[ly][lx] === 0 && chunk.map[ly][lx] === TILE.GRASS) {
              hillMask[ly][lx] = 1;
            }
          }
        }
      }
    }

    // 第三步：跨区块检查邻接
    const _isHill = (worldX, worldY) => {
      const lcx = Math.floor(worldX / S);
      const lcy = Math.floor(worldY / S);
      const localX = ((worldX % S) + S) % S;
      const localY = ((worldY % S) + S) % S;

      if (lcx === cx && lcy === cy) {
        return hillMask[localY][localX] === 1;
      }

      const hillValue = this.hillNoise.fbm(worldX * 6.0, worldY * 6.0, 2, 2, 0.5);
      return hillValue > 0.85;
    };

    // 第四步：对每个山坡瓦片，根据邻接确定正确的子瓦片
    const hillTiles = [
      [TILE.HILL_TL, TILE.HILL_TC, TILE.HILL_TR],
      [TILE.HILL_ML, TILE.HILL_MC, TILE.HILL_MR],
      [TILE.HILL_BL, TILE.HILL_BC, TILE.HILL_BR],
    ];

    for (let ly = 0; ly < S; ly++) {
      for (let lx = 0; lx < S; lx++) {
        if (hillMask[ly][lx] !== 1) continue;

        const worldX = cx * S + lx;
        const worldY = cy * S + ly;

        // 检查四邻接是否也是山坡
        const up = _isHill(worldX, worldY - 1);
        const down = _isHill(worldX, worldY + 1);
        const left = _isHill(worldX - 1, worldY);
        const right = _isHill(worldX + 1, worldY);

        // 确定行位置：上/中/下排
        let row;
        if (!up && down) row = 0;
        else if (up && down) row = 1;
        else if (up && !down) row = 2;
        else row = 1; // 孤立行 → 当作中排

        // 确定列位置：左/中/右
        let col;
        if (!left && right) col = 0;
        else if (left && right) col = 1;
        else if (left && !right) col = 2;
        else col = 1; // 孤立列 → 当作中

        chunk.map[ly][lx] = hillTiles[row][col];
      }
    }
  }

  /**
   * 在区块中生成森林区域
   * 使用噪声确定森林区域，森林内的瓦片按权重随机填充树木
   * 森林边界有密度过渡，避免硬边
   * @private
   */
  _generateForests(chunk) {
    const S = CHUNK_SIZE;
    const cx = chunk.chunkX;
    const cy = chunk.chunkY;

    const { cumWeights, totalWeight } = buildCumWeights(FOREST_VARIANTS);
    const { frequency, octaves, threshold, densityRange, edgeChance, coreChance } = this.forestConfig;

    for (let ly = 0; ly < S; ly++) {
      for (let lx = 0; lx < S; lx++) {
        const worldX = cx * S + lx;
        const worldY = cy * S + ly;

        // 森林噪声：频率和八度由配置控制
        const forestValue = this.forestNoise.fbm(worldX * frequency, worldY * frequency, octaves, 2, 0.5);

        // 森林阈值：由配置控制，越高森林面积越小
        if (forestValue > threshold) {
          // 密度过渡：越深入森林，树木越密集
          // forestDensity 从 0（边缘）到 1（核心）
          const forestDensity = Math.min(1, (forestValue - threshold) / densityRange);

          // 使用确定性随机决定是否放置树木
          const cellSeed = (worldX * 73856093 ^ worldY * 19349669 ^ (WORLD_SEED + 777)) & 0xffffffff;
          const cellRng = createSeededRandom(cellSeed);

          // 概率：边缘 → edgeChance，核心 → coreChance
          const treeChance = edgeChance + forestDensity * (coreChance - edgeChance);

          if (cellRng() < treeChance && chunk.map[ly][lx] === TILE.GRASS) {
            chunk.map[ly][lx] = weightedRandom(cumWeights, totalWeight, cellRng);
          }
        }
      }
    }
  }

  /**
   * 为区块生成随机道路
   * 道路由噪声驱动的随机行走路径生成，自然弯曲
   * 路径种子点由噪声确定，从种子点出发随机行走
   * 每条路径两端一定有路尽头
   * @private
   */
  _generateRoadsForChunk(chunk) {
    const S = CHUNK_SIZE;
    const cx = chunk.chunkX;
    const cy = chunk.chunkY;

    const roadCells = new Set();
    const cellDir = new Map();
    // 记录每条路径的端点，确保端点有路尽头
    // pathEnds: Set of "lx,ly" 瓦片坐标
    const pathEnds = new Set();

    // ── 随机行走路径 ──
    // 用噪声确定路径种子点（约每16x16区域一个种子点）
    // 从种子点出发，用噪声驱动的随机行走生成弯曲路径
    const seedSpacing = 16;
    for (let sy = 0; sy < S; sy += seedSpacing) {
      for (let sx = 0; sx < S; sx += seedSpacing) {
        const worldX = cx * S + sx;
        const worldY = cy * S + sy;

        // 噪声判断是否在此区域生成一条路径
        const pathSeed = this.roadNoise.hash(worldX * 3 + 1, worldY * 3 + 1);
        if (pathSeed > 0.6) {
          // 路径起点（在种子区域内随机偏移）
          const startLX = sx + Math.floor(this.roadNoise.hash(worldX * 5, worldY * 5) * seedSpacing);
          const startLY = sy + Math.floor(this.roadNoise.hash(worldX * 7, worldY * 7) * seedSpacing);

          if (startLX >= 0 && startLX < S && startLY >= 0 && startLY < S) {
            this._traceRandomPath(chunk, startLX, startLY, roadCells, cellDir, pathEnds);
          }
        }
      }
    }

    if (roadCells.size === 0) return;

    // 先标记为默认道路（覆盖树木/装饰物）
    for (const key of roadCells) {
      const [lx, ly] = key.split(',').map(Number);
      chunk.map[ly][lx] = TILE.ROAD_H;
    }

    // 解析道路瓦片类型 - 需要查看邻接（包括跨区块）
    for (const key of roadCells) {
      const [lx, ly] = key.split(',').map(Number);
      const dirs = this._getRoadDirsForChunk(chunk, lx, ly);
      const dir = cellDir.get(key) || 'h';
      const lastDir = dir === 'v' ? 'down' : 'right';
      const newTile = this._resolveRoadTile(dirs, 'road', lastDir);
      chunk.map[ly][lx] = newTile;
    }

    // 确保路径端点一定是路尽头
    // 对每个端点：如果它不是连接其他道路的交汇点，强制设为路尽头
    for (const endKey of pathEnds) {
      if (!roadCells.has(endKey)) continue;
      const [lx, ly] = endKey.split(',').map(Number);
      const currentTile = chunk.map[ly][lx];
      // 如果端点已经是直路/拐角/丁字/十字，说明它连上了其他路，不需要路尽头
      if (currentTile === TILE.ROAD_V || currentTile === TILE.ROAD_H) {
        // 孤立或端头直路 → 强制检查是否需要改成路尽头
        const dirs = this._getRoadDirsForChunk(chunk, lx, ly);
        const [up, right, down, left] = dirs;
        const count = (up ? 1 : 0) + (right ? 1 : 0) + (down ? 1 : 0) + (left ? 1 : 0);
        if (count === 1) {
          // 只有一个方向有路 → 这就是路尽头
          if (up) chunk.map[ly][lx] = TILE.ROAD_END_UP;
          else if (right) chunk.map[ly][lx] = TILE.ROAD_END_RIGHT;
          else if (down) chunk.map[ly][lx] = TILE.ROAD_END_DOWN;
          else if (left) chunk.map[ly][lx] = TILE.ROAD_END_LEFT;
        }
        // count === 0: 完全孤立的点也强制设为路尽头
        if (count === 0) {
          // 使用路径方向判断尽头朝向
          const dirInfo = cellDir.get(endKey);
          if (dirInfo === 'v') chunk.map[ly][lx] = TILE.ROAD_END_DOWN;
          else chunk.map[ly][lx] = TILE.ROAD_END_RIGHT;
        }
        // count >= 2: 连接了其他路，保持当前瓦片类型
      }
    }
  }

  /**
   * 从指定点出发进行随机行走，生成一条弯曲路径
   * 路径方向由噪声驱动，不是纯随机，保证确定性
   * 道路可以覆盖树木和装饰物（它们会变成草地+道路）
   * @private
   */
  _traceRandomPath(chunk, startX, startY, roadCells, cellDir, pathEnds) {
    const S = CHUNK_SIZE;
    const cx = chunk.chunkX;
    const cy = chunk.chunkY;

    // 路径长度 12~25 步
    const pathSeed = (cx * S + startX) * 73856093 ^ (cy * S + startY) * 19349669 ^ WORLD_SEED;
    const pathRng = createSeededRandom(pathSeed & 0xffffffff);
    const pathLen = 12 + Math.floor(pathRng() * 14);

    // 初始方向：0=右, 1=下, 2=左, 3=上
    let dir = Math.floor(pathRng() * 4);
    const dirDX = [1, 0, -1, 0]; // 右, 下, 左, 上
    const dirDY = [0, 1, 0, -1];
    let lx = startX;
    let ly = startY;
    let lastStepKey = null;

    for (let step = 0; step < pathLen; step++) {
      if (lx < 0 || lx >= S || ly < 0 || ly >= S) break;

      const tile = chunk.map[ly][lx];
      // 道路不能覆盖已有的道路和山坡
      if (isRoadTile(tile) || isHillTile(tile)) break;

      const key = `${lx},${ly}`;
      roadCells.add(key);
      cellDir.set(key, (dir === 0 || dir === 2) ? 'h' : 'v');
      lastStepKey = key;

      // 方向变化：噪声驱动的随机转弯
      const turnNoise = pathRng();
      if (turnNoise < 0.15) {
        // 左转
        dir = (dir + 3) % 4;
      } else if (turnNoise < 0.30) {
        // 右转
        dir = (dir + 1) % 4;
      }
      // 70% 概率保持当前方向

      lx += dirDX[dir];
      ly += dirDY[dir];
    }

    // 记录路径端点（起点和终点都是端点）
    // 起点
    pathEnds.add(`${startX},${startY}`);
    // 终点（最后一个成功放置的格子）
    if (lastStepKey && lastStepKey !== `${startX},${startY}`) {
      pathEnds.add(lastStepKey);
    }
  }

  /**
   * 获取区块内某个位置的道路邻接情况
   * 需要查看相邻区块的数据来确保道路连通
   * @private
   */
  _getRoadDirsForChunk(chunk, lx, ly) {
    const S = CHUNK_SIZE;
    const dirs = [false, false, false, false]; // up, right, down, left
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];

    for (let d = 0; d < 4; d++) {
      const nlx = lx + dx[d];
      const nly = ly + dy[d];

      if (nlx >= 0 && nlx < S && nly >= 0 && nly < S) {
        // 区块内部
        if (isRoadTile(chunk.map[nly][nlx])) {
          dirs[d] = true;
        }
      } else {
        // 跨区块查找
        let worldX = chunk.chunkX * S + nlx;
        let worldY = chunk.chunkY * S + nly;
        const tile = this._getTileFromNeighborChunk(worldX, worldY);
        if (isRoadTile(tile)) {
          dirs[d] = true;
        }
      }
    }

    return dirs;
  }

  /**
   * 从相邻区块获取瓦片类型（仅用于道路连通性判断）
   * @private
   */
  _getTileFromNeighborChunk(worldX, worldY) {
    const ncx = Math.floor(worldX / CHUNK_SIZE);
    const ncy = Math.floor(worldY / CHUNK_SIZE);
    const key = this._key(ncx, ncy);
    
    const existing = this.chunks.get(key);
    if (existing) {
      const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const ly = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      return existing.map[ly][lx];
    }

    // 对于未加载的相邻区块，用噪声快速判断该位置是否是道路
    // 这确保了跨区块道路连通性的确定性
    return this._quickRoadCheck(worldX, worldY);
  }

  /**
   * 快速判断某个世界坐标是否是道路（不生成区块）
   * 重放目标点附近所有可能种子区域的路径
   * @private
   */
  _quickRoadCheck(worldX, worldY) {
    const S = CHUNK_SIZE;
    const cx = Math.floor(worldX / S);
    const cy = Math.floor(worldY / S);
    const localX = ((worldX % S) + S) % S;
    const localY = ((worldY % S) + S) % S;
    const seedSpacing = 16;

    // 检查包含目标点的所有可能的种子区域
    // 目标点可能被当前区域或相邻区域的路径覆盖
    const baseRegionX = Math.floor(localX / seedSpacing);
    const baseRegionY = Math.floor(localY / seedSpacing);

    for (let ry = Math.max(0, baseRegionY - 1); ry <= baseRegionY + 1; ry++) {
      for (let rx = Math.max(0, baseRegionX - 1); rx <= baseRegionX + 1; rx++) {
        const seedLX = rx * seedSpacing;
        const seedLY = ry * seedSpacing;

        if (seedLX < 0 || seedLX >= S || seedLY < 0 || seedLY >= S) continue;

        const seedWorldX = cx * S + seedLX;
        const seedWorldY = cy * S + seedLY;

        // 与 _generateRoadsForChunk 中相同的种子点判断
        const pathSeed = this.roadNoise.hash(seedWorldX * 3 + 1, seedWorldY * 3 + 1);
        if (pathSeed <= 0.6) continue;

        // 路径起点
        const startLX = seedLX + Math.floor(this.roadNoise.hash(seedWorldX * 5, seedWorldY * 5) * seedSpacing);
        const startLY = seedLY + Math.floor(this.roadNoise.hash(seedWorldX * 7, seedWorldY * 7) * seedSpacing);

        if (startLX < 0 || startLX >= S || startLY < 0 || startLY >= S) continue;

        // 重放路径，检查是否经过目标点
        const pathSeedVal = (cx * S + startLX) * 73856093 ^ (cy * S + startLY) * 19349669 ^ WORLD_SEED;
        const pathRng = createSeededRandom(pathSeedVal & 0xffffffff);
        const pathLen = 12 + Math.floor(pathRng() * 14);

        let dir = Math.floor(pathRng() * 4);
        const dirDX = [1, 0, -1, 0];
        const dirDY = [0, 1, 0, -1];

        let lx = startLX;
        let ly = startLY;

        for (let step = 0; step < pathLen; step++) {
          if (lx < 0 || lx >= S || ly < 0 || ly >= S) break;

          if (lx === localX && ly === localY) {
            return TILE.ROAD_H;
          }

          const turnNoise = pathRng();
          if (turnNoise < 0.15) {
            dir = (dir + 3) % 4;
          } else if (turnNoise < 0.30) {
            dir = (dir + 1) % 4;
          }

          lx += dirDX[dir];
          ly += dirDY[dir];
        }
      }
    }

    return TILE.GRASS;
  }

  /**
   * 解析道路瓦片类型（同road.js中的resolveRoadTile逻辑）
   * @private
   */
  _resolveRoadTile(dirs, type = 'road', lastDir = null) {
    const [up, right, down, left] = dirs;
    const count = (up ? 1 : 0) + (right ? 1 : 0) + (down ? 1 : 0) + (left ? 1 : 0);

    if (count === 0) {
      if (lastDir === 'up' || lastDir === 'down') return TILE.ROAD_V;
      return TILE.ROAD_H;
    }
    if (count === 4) return TILE.ROAD_CROSS;

    if (count === 3) {
      if (!up) return TILE.ROAD_T_DOWN;
      if (!right) return TILE.ROAD_T_LEFT;
      if (!down) return TILE.ROAD_T_UP;
      if (!left) return TILE.ROAD_T_RIGHT;
    }

    if (count === 2) {
      if (up && down) return TILE.ROAD_V;
      if (left && right) return TILE.ROAD_H;
      if (down && right) return TILE.ROAD_CORNER_BR;
      if (left && down) return TILE.ROAD_CORNER_BL;
      if (up && left) return TILE.ROAD_CORNER_TL;
      if (right && up) return TILE.ROAD_CORNER_TR;
    }

    if (count === 1) {
      if (up) return TILE.ROAD_END_UP;
      if (right) return TILE.ROAD_END_RIGHT;
      if (down) return TILE.ROAD_END_DOWN;
      if (left) return TILE.ROAD_END_LEFT;
    }

    return TILE.ROAD_H;
  }

  /**
   * 为区块生成树木
   * @private
   */
  _generateTreesForChunk(chunk) {
    const S = CHUNK_SIZE;
    const cx = chunk.chunkX;
    const cy = chunk.chunkY;

    const treeSeed = (cx * 23456789 ^ cy * 98765432 ^ WORLD_SEED) & 0xffffffff;
    const rng = createSeededRandom(treeSeed);
    const { cumWeights, totalWeight } = buildCumWeights(TREE_VARIANTS);

    // 每个区块大约生成1~3棵散落树
    const treeCount = 1 + Math.floor(rng() * 3);

    const usedPositions = new Set();

    for (let i = 0; i < treeCount; i++) {
      // 尝试找一个草地格子
      let attempts = 0;
      while (attempts < 20) {
        const lx = Math.floor(rng() * S);
        const ly = Math.floor(rng() * S);
        const key = `${lx},${ly}`;

        if (chunk.map[ly][lx] === TILE.GRASS && !usedPositions.has(key)) {
          chunk.map[ly][lx] = weightedRandom(cumWeights, totalWeight, rng);
          usedPositions.add(key);
          break;
        }
        attempts++;
      }
    }

    // 聚集效应：小概率在已有散落树附近继续生成
    const clusterChance = 0.2;
    const clusterRadius = 1;
    const treePositions = [];
    for (let ly = 0; ly < S; ly++) {
      for (let lx = 0; lx < S; lx++) {
        if (chunk.map[ly][lx] >= TILE.TREE_1 && chunk.map[ly][lx] <= TILE.TREE_MANY) {
          treePositions.push({ lx, ly });
        }
      }
    }

    if (treePositions.length > 0) {
      const extraCount = Math.floor(rng() * 3);
      for (let i = 0; i < extraCount; i++) {
        if (rng() < clusterChance) {
          const center = treePositions[Math.floor(rng() * treePositions.length)];
          const dlx = Math.floor(rng() * (clusterRadius * 2 + 1)) - clusterRadius;
          const dly = Math.floor(rng() * (clusterRadius * 2 + 1)) - clusterRadius;
          const nlx = center.lx + dlx;
          const nly = center.ly + dly;
          const key = `${nlx},${nly}`;

          if (nlx >= 0 && nlx < S && nly >= 0 && nly < S
            && chunk.map[nly][nlx] === TILE.GRASS
            && !usedPositions.has(key)) {
            chunk.map[nly][nlx] = weightedRandom(cumWeights, totalWeight, rng);
            usedPositions.add(key);
          }
        }
      }
    }
  }

  /**
   * 为区块生成装饰物（石块、岩块、草丛/浆果丛）
   * @private
   */
  _generateDecorationsForChunk(chunk) {
    const S = CHUNK_SIZE;
    const cx = chunk.chunkX;
    const cy = chunk.chunkY;

    // 石块
    this._placeDecorationType(chunk, cx, cy, STONE_VARIANTS, 2 + Math.floor(this.stoneNoise.hash(cx * 11, cy * 13) * 3), this.stoneNoise);

    // 岩块
    this._placeDecorationType(chunk, cx, cy, ROCK_VARIANTS, 1 + Math.floor(this.rockNoise.hash(cx * 17, cy * 19) * 3), this.rockNoise);

    // 草丛/浆果丛
    this._placeDecorationType(chunk, cx, cy, BUSH_VARIANTS, 2 + Math.floor(this.bushNoise.hash(cx * 23, cy * 29) * 4), this.bushNoise);
  }

  /**
   * 在区块中放置一种装饰物
   * @private
   */
  _placeDecorationType(chunk, cx, cy, variants, count, noise) {
    const S = CHUNK_SIZE;
    const seed = (cx * 34567890 ^ cy * 12345678 ^ WORLD_SEED) & 0xffffffff;
    const rng = createSeededRandom(seed + variants[0].tile);
    const { cumWeights, totalWeight } = buildCumWeights(variants);

    for (let i = 0; i < count; i++) {
      let attempts = 0;
      while (attempts < 15) {
        const lx = Math.floor(rng() * S);
        const ly = Math.floor(rng() * S);

        if (chunk.map[ly][lx] === TILE.GRASS) {
          chunk.map[ly][lx] = weightedRandom(cumWeights, totalWeight, rng);
          break;
        }
        attempts++;
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      cachedChunks: this.chunks.size,
      maxChunks: MAX_CACHED_CHUNKS,
    };
  }

  /**
   * 清空所有缓存
   */
  clearCache() {
    this.chunks.clear();
    this.accessOrder = [];
  }
}
