// 常量
export { TILE, TILE_NAMES, TILE_COLORS, TILE_ASSETS, TILE_ROTATION, DIR, DX, DY, MAP_W, MAP_H, GRASS_VARIANTS, TREE_VARIANTS, STONE_VARIANTS, ROCK_VARIANTS, BUSH_VARIANTS, FOREST_VARIANTS, DIRT_VARIANTS, PURPLE_TREE_VARIANTS, MALACHITE_VARIANTS, PURPLE_FOREST_VARIANTS, CHUNK_SIZE, MAX_CACHED_CHUNKS, CHUNK_PRELOAD_MARGIN, WORLD_SEED, FOREST_CONFIG, WATER_CONFIG, DIRT_CONFIG } from './constants';

// 公共工具
export { createNoise, createSeededRandom, buildCumWeights, weightedRandom } from './utils';

// 瓦片类型判断（统一入口）
export {
  isRoadTile, isStoneRoadTile, isDirtRoadTile,
  isWaterTile, isBeachTile, isWaterAreaTile,
  isHillTile,
  isTreeTile, isPurpleTreeTile,
  isDecorationTile, isStoneTile, isRockTile, isBushTile, isMalachiteTile,
  isDirtTile,
  needsGrassBackground, isDecorSprite,
} from './tileUtils';

// 道路（兼容旧导入路径）
export { generateRoad } from './road';

// 树木（兼容旧导入路径）
export { generateTrees } from './tree';

// 装饰物（兼容旧导入路径）
export { generateDecorations } from './decorations';

// 噪声已合并到 utils.js，createNoise 在上方已导出
// noise.js 保留为空桥接文件，不再重复导出以避免 Duplicate export

// 数据层
export { MapData } from './mapData';

// 区块系统（无限地图）
export { Chunk, ChunkManager } from './chunk';

// 视口管理
export { Viewport } from './viewport';

// 交互控制
export { InteractionController } from './interaction';

// 素材加载
export { AssetLoader } from './assetLoader';

// 精灵图集
export { AtlasBuilder } from './atlasBuilder';

// 对象池
export { ObjectPool, createSpritePool, createContainerPool } from './objectPool';

// 空间哈希
export { SpatialHash } from './spatialHash';

// 船精灵
export { Ship, ShipFleet } from './ship';

// ECS 架构层（含战斗系统）
export { ShipFleetECS, Combat, combatSystem, targetQuery } from './ecs';

// 弹道管理
export { ProjectileManager } from './projectileManager';

// 特效管理
export { VfxManager } from './vfxManager';

// 渲染层
export { MapCanvasRenderer } from './renderer';
