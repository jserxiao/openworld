// 常量
export { TILE, TILE_NAMES, TILE_COLORS, TILE_ASSETS, TILE_ROTATION, DIR, DX, DY, MAP_W, MAP_H, GRASS_VARIANTS, TREE_VARIANTS, STONE_VARIANTS, ROCK_VARIANTS, BUSH_VARIANTS, FOREST_VARIANTS, CHUNK_SIZE, MAX_CACHED_CHUNKS, CHUNK_PRELOAD_MARGIN, WORLD_SEED, FOREST_CONFIG } from './constants';

// 道路
export { isRoadTile, isStoneRoadTile, generateRoad } from './road';

// 树木
export { isTreeTile, generateTrees } from './tree';

// 装饰物（石块、岩块、草丛、浆果丛、山坡）
export { isDecorationTile, isStoneTile, isRockTile, isBushTile, isHillTile, generateDecorations } from './decorations';

// 噪声
export { createNoise } from './noise';

// 池塘
export { generatePond, generateMap } from './pond';

// 数据层
export { MapData } from './mapData';

// 区块系统（无限地图）
export { Chunk, ChunkManager } from './chunk';

// 渲染层
export { MapCanvasRenderer } from './renderer';
