/**
 * 区块生成 Web Worker
 * 
 * 在后台线程中执行区块生成逻辑，避免阻塞主线程
 * 所有生成逻辑自包含，通过 postMessage 与主线程通信
 * 
 * 消息协议：
 * - 主线程 → Worker: { type: 'generate', chunkX, chunkY }
 * - 主线程 → Worker: { type: 'generateBatch', requests: [{chunkX, chunkY}, ...] }
 * - Worker → 主线程: { type: 'chunk', chunkX, chunkY, mapBuffers, grassBuffers }
 * - Worker → 主线程: { type: 'batch', results: [{chunkX, chunkY, mapBuffers, grassBuffers}, ...] }
 */

import {
  TILE, CHUNK_SIZE, WORLD_SEED, WATER_CONFIG,
  GRASS_VARIANTS, TREE_VARIANTS, STONE_VARIANTS,
  ROCK_VARIANTS, BUSH_VARIANTS, FOREST_VARIANTS,
  FOREST_CONFIG,
} from './constants';

// ── 噪声 ──
function createNoise(seed) {
  function hash(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  }
  function smooth(x, y, scale) {
    const sx = x / scale, sy = y / scale;
    const ix = Math.floor(sx), iy = Math.floor(sy);
    const fx = sx - ix, fy = sy - iy;
    const a = hash(ix, iy), b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  }
  function fbm(x, y, octaves = 5, lacunarity = 2, persistence = 0.5) {
    let val = 0, amp = 1, freq = 1, ampSum = 0;
    for (let i = 0; i < octaves; i++) {
      val += smooth(x * freq, y * freq, 40) * amp;
      ampSum += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return val / ampSum;
  }
  return { hash, smooth, fbm };
}

// ── 确定性随机 ──
function createSeededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

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
  for (const v of variants) { cum += v.weight; cumWeights.push({ tile: v.tile, cum }); }
  return { cumWeights, totalWeight };
}

// ── 瓦片类型判断 ──
function isRoadTile(tile) {
  return (tile >= TILE.ROAD_H && tile <= TILE.ROAD_CROSS)
    || (tile >= TILE.STONE_ROAD_H && tile <= TILE.STONE_ROAD_CROSS)
    || (tile >= TILE.ROAD_END_UP && tile <= TILE.ROAD_END_LEFT);
}
function isHillTile(tile) { return tile >= TILE.HILL_TL && tile <= TILE.HILL_BR; }
function isWaterAreaTile(tile) { return tile === TILE.WATER || (tile >= TILE.CORNER_TL && tile <= TILE.EDGE_L); }
function isTreeTile(tile) { return tile === TILE.TREE_1 || tile === TILE.TREE_2 || tile === TILE.TREE_3 || tile === TILE.TREE_MANY; }

// ── 噪声实例 ──
const roadNoise = createNoise(WORLD_SEED);
const forestNoise = createNoise(WORLD_SEED + 1);
const stoneNoise = createNoise(WORLD_SEED + 3);
const rockNoise = createNoise(WORLD_SEED + 4);
const bushNoise = createNoise(WORLD_SEED + 5);
const hillNoise = createNoise(WORLD_SEED + 8);

const forestConfig = { ...FOREST_CONFIG };

// ══════════════════════════════════════════
// 区块生成（完整逻辑，自包含）
// ══════════════════════════════════════════

function generateChunk(chunkX, chunkY) {
  const S = CHUNK_SIZE;
  const map = [];
  const grassMap = [];

  // 1. 初始化全草地 + 草地变体
  const grassSeed = (chunkX * 73856093 ^ chunkY * 19349669 ^ WORLD_SEED) & 0xffffffff;
  const grassRng = createSeededRandom(grassSeed);
  const { cumWeights: grassCW, totalWeight: grassTW } = buildCumWeights(GRASS_VARIANTS);

  for (let ly = 0; ly < S; ly++) {
    map[ly] = new Uint8Array(S);
    map[ly].fill(TILE.GRASS);
    grassMap[ly] = new Uint8Array(S);
    for (let lx = 0; lx < S; lx++) {
      grassMap[ly][lx] = weightedRandom(grassCW, grassTW, grassRng);
    }
  }

  const chunk = { chunkX, chunkY, map, grassMap };

  // 2. 水域
  generateWaters(chunk);
  // 3. 山坡
  generateHills(chunk);
  // 4. 道路
  generateRoadsForChunk(chunk);
  // 5. 森林
  generateForests(chunk);
  // 6. 散落树木
  generateTreesForChunk(chunk);
  // 7. 装饰物
  generateDecorationsForChunk(chunk);

  return { chunkX, chunkY, map, grassMap };
}

// ── 水域生成 ──
function generateWaters(chunk) {
  const S = CHUNK_SIZE;
  const cx = chunk.chunkX;
  const shoreX = WATER_CONFIG.shoreX;
  const chunkStartX = cx * S;
  const chunkEndX = cx * S + S - 1;

  if (chunkEndX < shoreX) return;
  if (chunkStartX > shoreX) {
    for (let ly = 0; ly < S; ly++)
      for (let lx = 0; lx < S; lx++)
        chunk.map[ly][lx] = TILE.WATER;
    return;
  }

  for (let ly = 0; ly < S; ly++) {
    for (let lx = 0; lx < S; lx++) {
      const worldX = chunkStartX + lx;
      if (worldX < shoreX) continue;
      if (chunk.map[ly][lx] !== TILE.GRASS) continue;
      if (worldX - 1 < shoreX) {
        chunk.map[ly][lx] = TILE.EDGE_L;
      } else {
        chunk.map[ly][lx] = TILE.WATER;
      }
    }
  }
}

// ── 山坡生成 ──
function generateHills(chunk) {
  const S = CHUNK_SIZE;
  const cx = chunk.chunkX, cy = chunk.chunkY;

  const hillMask = [];
  for (let ly = 0; ly < S; ly++) {
    hillMask[ly] = new Uint8Array(S);
    for (let lx = 0; lx < S; lx++) {
      const worldX = cx * S + lx, worldY = cy * S + ly;
      const hillValue = hillNoise.fbm(worldX * 6.0, worldY * 6.0, 2, 2, 0.5);
      if (hillValue > 0.85 && chunk.map[ly][lx] === TILE.GRASS && !isWaterAreaTile(chunk.map[ly][lx])) {
        hillMask[ly][lx] = 1;
      }
    }
  }

  // 连通分量分析 + 扩展到至少3x3
  const visited = [];
  for (let ly = 0; ly < S; ly++) visited[ly] = new Uint8Array(S);

  const bfs = (startLX, startLY) => {
    const component = [];
    const queue = [{ lx: startLX, ly: startLY }];
    visited[startLY][startLX] = 1;
    while (queue.length > 0) {
      const { lx, ly } = queue.shift();
      component.push({ lx, ly });
      const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const nlx = lx + dx, nly = ly + dy;
        if (nlx >= 0 && nlx < S && nly >= 0 && nly < S && !visited[nly][nlx] && hillMask[nly][nlx] === 1) {
          visited[nly][nlx] = 1;
          queue.push({ lx: nlx, ly: nly });
        }
      }
    }
    return component;
  };

  const components = [];
  for (let ly = 0; ly < S; ly++)
    for (let lx = 0; lx < S; lx++)
      if (hillMask[ly][lx] === 1 && !visited[ly][lx]) components.push(bfs(lx, ly));

  for (const comp of components) {
    let minX = S, maxX = 0, minY = S, maxY = 0;
    for (const { lx, ly } of comp) {
      if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
      if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
    }
    const width = maxX - minX + 1, height = maxY - minY + 1;
    if (width < 3 || height < 3) {
      let newMinX = minX, newMaxX = maxX, newMinY = minY, newMaxY = maxY;
      if (width < 3) {
        const expand = 3 - width;
        newMinX = Math.max(0, minX - Math.floor(expand / 2));
        newMaxX = Math.min(S - 1, maxX + (expand - Math.floor(expand / 2)));
        if (newMinX === 0 && newMaxX - newMinX + 1 < 3) newMaxX = Math.min(S - 1, newMinX + 2);
        if (newMaxX === S - 1 && newMaxX - newMinX + 1 < 3) newMinX = Math.max(0, newMaxX - 2);
      }
      if (height < 3) {
        const expand = 3 - height;
        newMinY = Math.max(0, minY - Math.floor(expand / 2));
        newMaxY = Math.min(S - 1, maxY + (expand - Math.floor(expand / 2)));
        if (newMinY === 0 && newMaxY - newMinY + 1 < 3) newMaxY = Math.min(S - 1, newMinY + 2);
        if (newMaxY === S - 1 && newMaxY - newMinY + 1 < 3) newMinY = Math.max(0, newMaxY - 2);
      }
      for (let ly = newMinY; ly <= newMaxY; ly++)
        for (let lx = newMinX; lx <= newMaxX; lx++)
          if (hillMask[ly][lx] === 0 && chunk.map[ly][lx] === TILE.GRASS) hillMask[ly][lx] = 1;
    }
  }

  // 跨区块邻接
  const _isHill = (worldX, worldY) => {
    const lcx = Math.floor(worldX / S), lcy = Math.floor(worldY / S);
    const localX = ((worldX % S) + S) % S, localY = ((worldY % S) + S) % S;
    if (lcx === cx && lcy === cy) return hillMask[localY][localX] === 1;
    return hillNoise.fbm(worldX * 6.0, worldY * 6.0, 2, 2, 0.5) > 0.85;
  };

  const hillTiles = [
    [TILE.HILL_TL, TILE.HILL_TC, TILE.HILL_TR],
    [TILE.HILL_ML, TILE.HILL_MC, TILE.HILL_MR],
    [TILE.HILL_BL, TILE.HILL_BC, TILE.HILL_BR],
  ];

  for (let ly = 0; ly < S; ly++) {
    for (let lx = 0; lx < S; lx++) {
      if (hillMask[ly][lx] !== 1) continue;
      const worldX = cx * S + lx, worldY = cy * S + ly;
      const up = _isHill(worldX, worldY - 1), down = _isHill(worldX, worldY + 1);
      const left = _isHill(worldX - 1, worldY), right = _isHill(worldX + 1, worldY);
      let row;
      if (!up && down) row = 0; else if (up && down) row = 1; else if (up && !down) row = 2; else row = 1;
      let col;
      if (!left && right) col = 0; else if (left && right) col = 1; else if (left && !right) col = 2; else col = 1;
      chunk.map[ly][lx] = hillTiles[row][col];
    }
  }
}

// ── 道路生成 ──
function generateRoadsForChunk(chunk) {
  const S = CHUNK_SIZE;
  const cx = chunk.chunkX, cy = chunk.chunkY;
  const roadCells = new Set();
  const cellDir = new Map();
  const pathEnds = new Set();
  const seedSpacing = 16;

  for (let sy = 0; sy < S; sy += seedSpacing) {
    for (let sx = 0; sx < S; sx += seedSpacing) {
      const worldX = cx * S + sx, worldY = cy * S + sy;
      const pathSeed = roadNoise.hash(worldX * 3 + 1, worldY * 3 + 1);
      if (pathSeed > 0.6) {
        const startLX = sx + Math.floor(roadNoise.hash(worldX * 5, worldY * 5) * seedSpacing);
        const startLY = sy + Math.floor(roadNoise.hash(worldX * 7, worldY * 7) * seedSpacing);
        if (startLX >= 0 && startLX < S && startLY >= 0 && startLY < S) {
          traceRandomPath(chunk, startLX, startLY, roadCells, cellDir, pathEnds);
        }
      }
    }
  }

  if (roadCells.size === 0) return;

  for (const key of roadCells) {
    const [lx, ly] = key.split(',').map(Number);
    chunk.map[ly][lx] = TILE.ROAD_H;
  }

  for (const key of roadCells) {
    const [lx, ly] = key.split(',').map(Number);
    const dirs = getRoadDirs(chunk, lx, ly);
    const dir = cellDir.get(key) || 'h';
    const lastDir = dir === 'v' ? 'down' : 'right';
    chunk.map[ly][lx] = resolveRoadTile(dirs, lastDir);
  }

  for (const endKey of pathEnds) {
    if (!roadCells.has(endKey)) continue;
    const [lx, ly] = endKey.split(',').map(Number);
    const currentTile = chunk.map[ly][lx];
    if (currentTile === TILE.ROAD_V || currentTile === TILE.ROAD_H) {
      const dirs = getRoadDirs(chunk, lx, ly);
      const [up, right, down, left] = dirs;
      const count = (up ? 1 : 0) + (right ? 1 : 0) + (down ? 1 : 0) + (left ? 1 : 0);
      if (count === 1) {
        if (up) chunk.map[ly][lx] = TILE.ROAD_END_UP;
        else if (right) chunk.map[ly][lx] = TILE.ROAD_END_RIGHT;
        else if (down) chunk.map[ly][lx] = TILE.ROAD_END_DOWN;
        else if (left) chunk.map[ly][lx] = TILE.ROAD_END_LEFT;
      }
      if (count === 0) {
        const dirInfo = cellDir.get(endKey);
        if (dirInfo === 'v') chunk.map[ly][lx] = TILE.ROAD_END_DOWN;
        else chunk.map[ly][lx] = TILE.ROAD_END_RIGHT;
      }
    }
  }
}

function traceRandomPath(chunk, startX, startY, roadCells, cellDir, pathEnds) {
  const S = CHUNK_SIZE;
  const cx = chunk.chunkX, cy = chunk.chunkY;
  const pathSeed = (cx * S + startX) * 73856093 ^ (cy * S + startY) * 19349669 ^ WORLD_SEED;
  const pathRng = createSeededRandom(pathSeed & 0xffffffff);
  const pathLen = 12 + Math.floor(pathRng() * 14);
  let dir = Math.floor(pathRng() * 4);
  const dirDX = [1, 0, -1, 0], dirDY = [0, 1, 0, -1];
  let lx = startX, ly = startY;
  let lastStepKey = null;

  for (let step = 0; step < pathLen; step++) {
    if (lx < 0 || lx >= S || ly < 0 || ly >= S) break;
    const tile = chunk.map[ly][lx];
    if (isRoadTile(tile) || isHillTile(tile) || isWaterAreaTile(tile)) break;
    const key = `${lx},${ly}`;
    roadCells.add(key);
    cellDir.set(key, (dir === 0 || dir === 2) ? 'h' : 'v');
    lastStepKey = key;
    const turnNoise = pathRng();
    if (turnNoise < 0.15) dir = (dir + 3) % 4;
    else if (turnNoise < 0.30) dir = (dir + 1) % 4;
    lx += dirDX[dir]; ly += dirDY[dir];
  }

  pathEnds.add(`${startX},${startY}`);
  if (lastStepKey && lastStepKey !== `${startX},${startY}`) pathEnds.add(lastStepKey);
}

function getRoadDirs(chunk, lx, ly) {
  const S = CHUNK_SIZE;
  const cx = chunk.chunkX, cy = chunk.chunkY;
  const dirs = [false, false, false, false];
  const dx = [0, 1, 0, -1], dy = [-1, 0, 1, 0];

  for (let d = 0; d < 4; d++) {
    const nlx = lx + dx[d], nly = ly + dy[d];
    if (nlx >= 0 && nlx < S && nly >= 0 && nly < S) {
      if (isRoadTile(chunk.map[nly][nlx])) dirs[d] = true;
    } else {
      const worldX = cx * S + nlx, worldY = cy * S + nly;
      if (isRoadTile(quickRoadCheck(worldX, worldY))) dirs[d] = true;
    }
  }
  return dirs;
}

function quickRoadCheck(worldX, worldY) {
  const S = CHUNK_SIZE;
  const cx = Math.floor(worldX / S), cy = Math.floor(worldY / S);
  const localX = ((worldX % S) + S) % S, localY = ((worldY % S) + S) % S;
  const seedSpacing = 16;
  const baseRegionX = Math.floor(localX / seedSpacing), baseRegionY = Math.floor(localY / seedSpacing);

  for (let ry = Math.max(0, baseRegionY - 1); ry <= baseRegionY + 1; ry++) {
    for (let rx = Math.max(0, baseRegionX - 1); rx <= baseRegionX + 1; rx++) {
      const seedLX = rx * seedSpacing, seedLY = ry * seedSpacing;
      if (seedLX < 0 || seedLX >= S || seedLY < 0 || seedLY >= S) continue;
      const seedWorldX = cx * S + seedLX, seedWorldY = cy * S + seedLY;
      const pathSeed = roadNoise.hash(seedWorldX * 3 + 1, seedWorldY * 3 + 1);
      if (pathSeed <= 0.6) continue;
      const startLX = seedLX + Math.floor(roadNoise.hash(seedWorldX * 5, seedWorldY * 5) * seedSpacing);
      const startLY = seedLY + Math.floor(roadNoise.hash(seedWorldX * 7, seedWorldY * 7) * seedSpacing);
      if (startLX < 0 || startLX >= S || startLY < 0 || startLY >= S) continue;

      const pathSeedVal = (cx * S + startLX) * 73856093 ^ (cy * S + startLY) * 19349669 ^ WORLD_SEED;
      const pathRng = createSeededRandom(pathSeedVal & 0xffffffff);
      const pathLen = 12 + Math.floor(pathRng() * 14);
      let dir = Math.floor(pathRng() * 4);
      const dirDX = [1, 0, -1, 0], dirDY = [0, 1, 0, -1];
      let plx = startLX, ply = startLY;

      for (let step = 0; step < pathLen; step++) {
        if (plx < 0 || plx >= S || ply < 0 || ply >= S) break;
        if (plx === localX && ply === localY) return TILE.ROAD_H;
        const turnNoise = pathRng();
        if (turnNoise < 0.15) dir = (dir + 3) % 4;
        else if (turnNoise < 0.30) dir = (dir + 1) % 4;
        plx += dirDX[dir]; ply += dirDY[dir];
      }
    }
  }
  return TILE.GRASS;
}

function resolveRoadTile(dirs, lastDir) {
  const [up, right, down, left] = dirs;
  const count = (up ? 1 : 0) + (right ? 1 : 0) + (down ? 1 : 0) + (left ? 1 : 0);
  if (count === 0) return (lastDir === 'up' || lastDir === 'down') ? TILE.ROAD_V : TILE.ROAD_H;
  if (count === 4) return TILE.ROAD_CROSS;
  if (count === 3) {
    if (!up) return TILE.ROAD_T_DOWN; if (!right) return TILE.ROAD_T_LEFT;
    if (!down) return TILE.ROAD_T_UP; if (!left) return TILE.ROAD_T_RIGHT;
  }
  if (count === 2) {
    if (up && down) return TILE.ROAD_V; if (left && right) return TILE.ROAD_H;
    if (down && right) return TILE.ROAD_CORNER_BR; if (left && down) return TILE.ROAD_CORNER_BL;
    if (up && left) return TILE.ROAD_CORNER_TL; if (right && up) return TILE.ROAD_CORNER_TR;
  }
  if (count === 1) {
    if (up) return TILE.ROAD_END_UP; if (right) return TILE.ROAD_END_RIGHT;
    if (down) return TILE.ROAD_END_DOWN; if (left) return TILE.ROAD_END_LEFT;
  }
  return TILE.ROAD_H;
}

// ── 森林生成 ──
function generateForests(chunk) {
  const S = CHUNK_SIZE;
  const cx = chunk.chunkX, cy = chunk.chunkY;
  const { cumWeights, totalWeight } = buildCumWeights(FOREST_VARIANTS);
  const { frequency, octaves, threshold, densityRange, edgeChance, coreChance } = forestConfig;

  for (let ly = 0; ly < S; ly++) {
    for (let lx = 0; lx < S; lx++) {
      const worldX = cx * S + lx, worldY = cy * S + ly;
      const forestValue = forestNoise.fbm(worldX * frequency, worldY * frequency, octaves, 2, 0.5);
      if (forestValue > threshold) {
        const forestDensity = Math.min(1, (forestValue - threshold) / densityRange);
        const cellSeed = (worldX * 73856093 ^ worldY * 19349669 ^ (WORLD_SEED + 777)) & 0xffffffff;
        const cellRng = createSeededRandom(cellSeed);
        const treeChance = edgeChance + forestDensity * (coreChance - edgeChance);
        if (cellRng() < treeChance && chunk.map[ly][lx] === TILE.GRASS) {
          chunk.map[ly][lx] = weightedRandom(cumWeights, totalWeight, cellRng);
        }
      }
    }
  }
}

// ── 散落树木 ──
function generateTreesForChunk(chunk) {
  const S = CHUNK_SIZE;
  const cx = chunk.chunkX, cy = chunk.chunkY;
  const treeSeed = (cx * 23456789 ^ cy * 98765432 ^ WORLD_SEED) & 0xffffffff;
  const rng = createSeededRandom(treeSeed);
  const { cumWeights, totalWeight } = buildCumWeights(TREE_VARIANTS);
  const treeCount = 1 + Math.floor(rng() * 3);
  const usedPositions = new Set();

  for (let i = 0; i < treeCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const lx = Math.floor(rng() * S), ly = Math.floor(rng() * S);
      const key = `${lx},${ly}`;
      if (chunk.map[ly][lx] === TILE.GRASS && !usedPositions.has(key)) {
        chunk.map[ly][lx] = weightedRandom(cumWeights, totalWeight, rng);
        usedPositions.add(key);
        break;
      }
      attempts++;
    }
  }

  const clusterChance = 0.2, clusterRadius = 1;
  const treePositions = [];
  for (let ly = 0; ly < S; ly++)
    for (let lx = 0; lx < S; lx++)
      if (isTreeTile(chunk.map[ly][lx])) treePositions.push({ lx, ly });

  if (treePositions.length > 0) {
    const extraCount = Math.floor(rng() * 3);
    for (let i = 0; i < extraCount; i++) {
      if (rng() < clusterChance) {
        const center = treePositions[Math.floor(rng() * treePositions.length)];
        const dlx = Math.floor(rng() * (clusterRadius * 2 + 1)) - clusterRadius;
        const dly = Math.floor(rng() * (clusterRadius * 2 + 1)) - clusterRadius;
        const nlx = center.lx + dlx, nly = center.ly + dly;
        const key = `${nlx},${nly}`;
        if (nlx >= 0 && nlx < S && nly >= 0 && nly < S && chunk.map[nly][nlx] === TILE.GRASS && !usedPositions.has(key)) {
          chunk.map[nly][nlx] = weightedRandom(cumWeights, totalWeight, rng);
          usedPositions.add(key);
        }
      }
    }
  }
}

// ── 装饰物 ──
function generateDecorationsForChunk(chunk) {
  const cx = chunk.chunkX, cy = chunk.chunkY;
  placeDecorationType(chunk, cx, cy, STONE_VARIANTS, 2 + Math.floor(stoneNoise.hash(cx * 11, cy * 13) * 3));
  placeDecorationType(chunk, cx, cy, ROCK_VARIANTS, 1 + Math.floor(rockNoise.hash(cx * 17, cy * 19) * 3));
  placeDecorationType(chunk, cx, cy, BUSH_VARIANTS, 2 + Math.floor(bushNoise.hash(cx * 23, cy * 29) * 4));
}

function placeDecorationType(chunk, cx, cy, variants, count) {
  const S = CHUNK_SIZE;
  const seed = (cx * 34567890 ^ cy * 12345678 ^ WORLD_SEED) & 0xffffffff;
  const rng = createSeededRandom(seed + variants[0].tile);
  const { cumWeights, totalWeight } = buildCumWeights(variants);
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    while (attempts < 15) {
      const lx = Math.floor(rng() * S), ly = Math.floor(rng() * S);
      if (chunk.map[ly][lx] === TILE.GRASS) {
        chunk.map[ly][lx] = weightedRandom(cumWeights, totalWeight, rng);
        break;
      }
      attempts++;
    }
  }
}

// ══════════════════════════════════════════
// Worker 消息处理
// ══════════════════════════════════════════

self.onmessage = function(e) {
  const { type } = e.data;

  if (type === 'generate') {
    const { chunkX, chunkY } = e.data;
    const result = generateChunk(chunkX, chunkY);
    const mapBuffers = result.map.map(arr => arr.buffer);
    const grassBuffers = result.grassMap.map(arr => arr.buffer);
    self.postMessage({
      type: 'chunk',
      chunkX,
      chunkY,
      mapBuffers,
      grassBuffers,
    }, [...mapBuffers, ...grassBuffers]);
  }

  if (type === 'generateBatch') {
    const { requests } = e.data;
    const results = [];
    for (const { chunkX, chunkY } of requests) {
      const result = generateChunk(chunkX, chunkY);
      results.push({
        chunkX,
        chunkY,
        mapBuffers: result.map.map(arr => arr.buffer),
        grassBuffers: result.grassMap.map(arr => arr.buffer),
      });
    }
    const transferables = [];
    for (const r of results) {
      transferables.push(...r.mapBuffers, ...r.grassBuffers);
    }
    self.postMessage({ type: 'batch', results }, transferables);
  }
};
