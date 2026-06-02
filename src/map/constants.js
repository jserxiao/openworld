/**
 * 地图常量定义
 * 地块类型、名称、颜色、素材路径、旋转角度
 *
 * 优化：TILE_COLORS / TILE_ROTATION 使用范围辅助函数自动生成，
 * 消除同类瓦片重复赋值，新增瓦片类型时只需改一处
 */

// ────────────────────────────────────────────
// 辅助函数：按范围批量赋值
// ────────────────────────────────────────────

/**
 * 为 [from, to] 范围内的每个 key 赋同一个值
 * @param {object} obj - 目标对象
 * @param {number} from - 起始 key（含）
 * @param {number} to - 结束 key（含）
 * @param {*} value - 赋的值
 */
function assignRange(obj, from, to, value) {
  for (let k = from; k <= to; k++) obj[k] = value;
}

/**
 * 为一组 key 赋同一个值
 * @param {object} obj - 目标对象
 * @param {number[]} keys
 * @param {*} value
 */
function assignKeys(obj, keys, value) {
  for (const k of keys) obj[k] = value;
}

// ────────────────────────────────────────────
// 地块类型
// ────────────────────────────────────────────

export const TILE = {
  GRASS: 0,       // 草地（占位符，实际渲染由 grassMap 决定用哪个变体）
  GRASS_1: 36,    // 草1
  GRASS_2: 37,    // 草2
  WATER: 1,       // 池塘内部（深水）
  CORNER_TL: 2,   // 圆角-左上 (top-left)
  CORNER_TR: 3,   // 圆角-右上 (top-right)
  CORNER_BR: 4,   // 圆角-右下 (bottom-right)
  CORNER_BL: 5,   // 圆角-左下 (bottom-left)
  EDGE_T: 6,      // 边缘中段-上 (top)
  EDGE_R: 7,      // 边缘中段-右 (right)
  EDGE_B: 8,      // 边缘中段-下 (bottom)
  EDGE_L: 9,      // 边缘中段-左 (left)

  // 道路
  ROAD_H: 10,         // 直路-水平
  ROAD_V: 11,         // 直路-垂直
  ROAD_CORNER_TL: 12, // 路拐角-左上开口
  ROAD_CORNER_TR: 13, // 路拐角-右上开口
  ROAD_CORNER_BL: 14, // 路拐角-左下开口
  ROAD_CORNER_BR: 15, // 路拐角-右下开口
  ROAD_T_DOWN: 16,    // 丁字-下开口
  ROAD_T_LEFT: 17,    // 丁字-左开口
  ROAD_T_UP: 18,      // 丁字-上开口
  ROAD_T_RIGHT: 19,   // 丁字-右开口
  ROAD_CROSS: 20,     // 十字路口
  ROAD_END_UP: 38,    // 路尽头-朝上
  ROAD_END_RIGHT: 39, // 路尽头-朝右
  ROAD_END_DOWN: 40,  // 路尽头-朝下
  ROAD_END_LEFT: 41,  // 路尽头-朝左

  // 石板路
  STONE_ROAD_H: 21,           // 石板直路-水平
  STONE_ROAD_V: 22,           // 石板直路-垂直
  STONE_ROAD_CORNER_TL: 23,   // 石板路拐角-左上开口
  STONE_ROAD_CORNER_TR: 24,   // 石板路拐角-右上开口
  STONE_ROAD_CORNER_BL: 25,   // 石板路拐角-左下开口
  STONE_ROAD_CORNER_BR: 26,   // 石板路拐角-右下开口
  STONE_ROAD_T_DOWN: 27,      // 石板丁字-下开口
  STONE_ROAD_T_LEFT: 28,      // 石板丁字-左开口
  STONE_ROAD_T_UP: 29,        // 石板丁字-上开口
  STONE_ROAD_T_RIGHT: 30,     // 石板丁字-右开口
  STONE_ROAD_CROSS: 31,       // 石板十字路口

  // 树木
  TREE_1: 32,               // 一棵树
  TREE_2: 33,               // 两棵树
  TREE_3: 34,               // 三棵树
  TREE_MANY: 35,            // 大量树

  // 石块
  STONE_SMALL: 42,          // 小石块
  STONE_BIG: 43,            // 大石块
  STONE_2: 44,              // 两个石块
  STONE_3: 45,              // 三个石块

  // 岩块
  ROCK_SMALL: 46,           // 小岩块
  ROCK_PILE: 47,            // 矿岩堆
  ROCK_2: 48,               // 两个岩块
  ROCK_3: 49,               // 三个岩块

  // 草丛
  BUSH: 50,                 // 草丛

  // 浆果丛
  BERRY: 51,                // 浆果丛

  // 山坡（3x3瓦片集）
  HILL_TL: 52,
  HILL_TC: 53,
  HILL_TR: 54,
  HILL_ML: 55,
  HILL_MC: 56,
  HILL_MR: 57,
  HILL_BL: 58,
  HILL_BC: 59,
  HILL_BR: 60,

  // 船（动态精灵，不属于区块系统）
  SHIP: 61,
  PIRATE_SHIP: 62,
};

// ────────────────────────────────────────────
// 地块名称（保持手工定义，因为每个名称不同）
// ────────────────────────────────────────────

export const TILE_NAMES = {
  [TILE.GRASS]: '草地',
  [TILE.GRASS_1]: '草1',
  [TILE.GRASS_2]: '草2',
  [TILE.WATER]: '深水',
  [TILE.CORNER_TL]: '圆角(左上)',
  [TILE.CORNER_TR]: '圆角(右上)',
  [TILE.CORNER_BR]: '圆角(右下)',
  [TILE.CORNER_BL]: '圆角(左下)',
  [TILE.EDGE_T]: '边缘(上)',
  [TILE.EDGE_R]: '边缘(右)',
  [TILE.EDGE_B]: '边缘(下)',
  [TILE.EDGE_L]: '边缘(左)',
  [TILE.ROAD_H]: '直路(水平)',
  [TILE.ROAD_V]: '直路(垂直)',
  [TILE.ROAD_CORNER_TL]: '路拐角(左上开口)',
  [TILE.ROAD_CORNER_TR]: '路拐角(右上开口)',
  [TILE.ROAD_CORNER_BL]: '路拐角(左下开口)',
  [TILE.ROAD_CORNER_BR]: '路拐角(右下开口)',
  [TILE.ROAD_T_DOWN]: '丁字(下开口)',
  [TILE.ROAD_T_LEFT]: '丁字(左开口)',
  [TILE.ROAD_T_UP]: '丁字(上开口)',
  [TILE.ROAD_T_RIGHT]: '丁字(右开口)',
  [TILE.ROAD_CROSS]: '十字路口',
  [TILE.ROAD_END_UP]: '路尽头(朝上)',
  [TILE.ROAD_END_RIGHT]: '路尽头(朝右)',
  [TILE.ROAD_END_DOWN]: '路尽头(朝下)',
  [TILE.ROAD_END_LEFT]: '路尽头(朝左)',
  [TILE.STONE_ROAD_H]: '石板直路(水平)',
  [TILE.STONE_ROAD_V]: '石板直路(垂直)',
  [TILE.STONE_ROAD_CORNER_TL]: '石板路拐角(左上开口)',
  [TILE.STONE_ROAD_CORNER_TR]: '石板路拐角(右上开口)',
  [TILE.STONE_ROAD_CORNER_BL]: '石板路拐角(左下开口)',
  [TILE.STONE_ROAD_CORNER_BR]: '石板路拐角(右下开口)',
  [TILE.STONE_ROAD_T_DOWN]: '石板丁字(下开口)',
  [TILE.STONE_ROAD_T_LEFT]: '石板丁字(左开口)',
  [TILE.STONE_ROAD_T_UP]: '石板丁字(上开口)',
  [TILE.STONE_ROAD_T_RIGHT]: '石板丁字(右开口)',
  [TILE.STONE_ROAD_CROSS]: '石板十字路口',
  [TILE.TREE_1]: '一棵树',
  [TILE.TREE_2]: '两棵树',
  [TILE.TREE_3]: '三棵树',
  [TILE.TREE_MANY]: '大量树',
  [TILE.STONE_SMALL]: '小石块',
  [TILE.STONE_BIG]: '大石块',
  [TILE.STONE_2]: '两个石块',
  [TILE.STONE_3]: '三个石块',
  [TILE.ROCK_SMALL]: '小岩块',
  [TILE.ROCK_PILE]: '矿岩堆',
  [TILE.ROCK_2]: '两个岩块',
  [TILE.ROCK_3]: '三个岩块',
  [TILE.BUSH]: '草丛',
  [TILE.BERRY]: '浆果丛',
  [TILE.HILL_TL]: '山坡(左上)',
  [TILE.HILL_TC]: '山坡(中上)',
  [TILE.HILL_TR]: '山坡(右上)',
  [TILE.HILL_ML]: '山坡(左中)',
  [TILE.HILL_MC]: '山坡(中中)',
  [TILE.HILL_MR]: '山坡(右中)',
  [TILE.HILL_BL]: '山坡(左下)',
  [TILE.HILL_BC]: '山坡(中下)',
  [TILE.HILL_BR]: '山坡(右下)',
  [TILE.SHIP]: '船',
  [TILE.PIRATE_SHIP]: '海盗船',
};

// ────────────────────────────────────────────
// 地块颜色（使用范围辅助函数，消除重复）
// ────────────────────────────────────────────

const _TILE_COLORS = {};
assignKeys(_TILE_COLORS, [TILE.GRASS, TILE.GRASS_1], 0x27ae60);
_TILE_COLORS[TILE.GRASS_2] = 0x2ecc71;
assignKeys(_TILE_COLORS, [TILE.WATER], 0x1a5276);
assignRange(_TILE_COLORS, TILE.CORNER_TL, TILE.EDGE_L, 0x2e86c1);
assignRange(_TILE_COLORS, TILE.ROAD_H, TILE.ROAD_CROSS, 0xc9a96e);
assignKeys(_TILE_COLORS, [TILE.ROAD_END_UP, TILE.ROAD_END_RIGHT, TILE.ROAD_END_DOWN, TILE.ROAD_END_LEFT], 0xc9a96e);
assignRange(_TILE_COLORS, TILE.STONE_ROAD_H, TILE.STONE_ROAD_CROSS, 0x8e8e8e);
_TILE_COLORS[TILE.TREE_1] = 0x228b22;
_TILE_COLORS[TILE.TREE_2] = 0x1e7a1e;
_TILE_COLORS[TILE.TREE_3] = 0x166616;
_TILE_COLORS[TILE.TREE_MANY] = 0x0f4f0f;
_TILE_COLORS[TILE.STONE_SMALL] = 0x999999;
_TILE_COLORS[TILE.STONE_BIG] = 0x777777;
_TILE_COLORS[TILE.STONE_2] = 0x888888;
_TILE_COLORS[TILE.STONE_3] = 0xaaaaaa;
_TILE_COLORS[TILE.ROCK_SMALL] = 0x8b7355;
_TILE_COLORS[TILE.ROCK_PILE] = 0x6b5344;
_TILE_COLORS[TILE.ROCK_2] = 0x7a6248;
_TILE_COLORS[TILE.ROCK_3] = 0x9a8268;
_TILE_COLORS[TILE.BUSH] = 0x4a7c2a;
_TILE_COLORS[TILE.BERRY] = 0x8b0000;
assignKeys(_TILE_COLORS, [TILE.HILL_TL, TILE.HILL_TC, TILE.HILL_TR], 0x8B7355);
assignKeys(_TILE_COLORS, [TILE.HILL_ML, TILE.HILL_MC, TILE.HILL_MR], 0x7A6248);
assignKeys(_TILE_COLORS, [TILE.HILL_BL, TILE.HILL_BC, TILE.HILL_BR], 0x6B5344);
_TILE_COLORS[TILE.SHIP] = 0x8B6914;
_TILE_COLORS[TILE.PIRATE_SHIP] = 0x4A3728;
export const TILE_COLORS = _TILE_COLORS;

// ────────────────────────────────────────────
// 素材路径映射
// ────────────────────────────────────────────

export const TILE_ASSETS = {
  [TILE.GRASS]: 'assets/草地.png',
  [TILE.GRASS_1]: 'assets/草1.png',
  [TILE.GRASS_2]: 'assets/草2.png',
  [TILE.WATER]: 'assets/水.png',
  [TILE.CORNER_TL]: 'assets/沙滩西北圆角.png',
  [TILE.CORNER_TR]: 'assets/沙滩东北圆角.png',
  [TILE.CORNER_BR]: 'assets/沙滩西北圆角.png',
  [TILE.CORNER_BL]: 'assets/沙滩东北圆角.png',
  [TILE.EDGE_T]: 'assets/沙滩北边.png',
  [TILE.EDGE_R]: 'assets/沙滩北边.png',
  [TILE.EDGE_B]: 'assets/沙滩北边.png',
  [TILE.EDGE_L]: 'assets/沙滩北边.png',
  [TILE.ROAD_H]: 'assets/直路.png',
  [TILE.ROAD_V]: 'assets/直路.png',
  [TILE.ROAD_CORNER_TL]: 'assets/路拐角.png',
  [TILE.ROAD_CORNER_TR]: 'assets/路拐角.png',
  [TILE.ROAD_CORNER_BL]: 'assets/路拐角.png',
  [TILE.ROAD_CORNER_BR]: 'assets/路拐角.png',
  [TILE.ROAD_T_DOWN]: 'assets/丁字路连接.png',
  [TILE.ROAD_T_LEFT]: 'assets/丁字路连接.png',
  [TILE.ROAD_T_UP]: 'assets/丁字路连接.png',
  [TILE.ROAD_T_RIGHT]: 'assets/丁字路连接.png',
  [TILE.ROAD_CROSS]: 'assets/十字路连接.png',
  [TILE.ROAD_END_UP]: 'assets/路尽头.png',
  [TILE.ROAD_END_RIGHT]: 'assets/路尽头.png',
  [TILE.ROAD_END_DOWN]: 'assets/路尽头.png',
  [TILE.ROAD_END_LEFT]: 'assets/路尽头.png',
  [TILE.STONE_ROAD_H]: 'assets/石板直路.png',
  [TILE.STONE_ROAD_V]: 'assets/石板直路.png',
  [TILE.STONE_ROAD_CORNER_TL]: 'assets/石板路拐角.png',
  [TILE.STONE_ROAD_CORNER_TR]: 'assets/石板路拐角.png',
  [TILE.STONE_ROAD_CORNER_BL]: 'assets/石板路拐角.png',
  [TILE.STONE_ROAD_CORNER_BR]: 'assets/石板路拐角.png',
  [TILE.STONE_ROAD_T_DOWN]: 'assets/石板丁字路连接.png',
  [TILE.STONE_ROAD_T_LEFT]: 'assets/石板丁字路连接.png',
  [TILE.STONE_ROAD_T_UP]: 'assets/石板丁字路连接.png',
  [TILE.STONE_ROAD_T_RIGHT]: 'assets/石板丁字路连接.png',
  [TILE.STONE_ROAD_CROSS]: 'assets/石板十字路连接.png',
  [TILE.TREE_1]: 'assets/一棵树.png',
  [TILE.TREE_2]: 'assets/两棵树.png',
  [TILE.TREE_3]: 'assets/三棵树.png',
  [TILE.TREE_MANY]: 'assets/大量树.png',
  [TILE.STONE_SMALL]: 'assets/小石块.png',
  [TILE.STONE_BIG]: 'assets/大石块.png',
  [TILE.STONE_2]: 'assets/两个石块.png',
  [TILE.STONE_3]: 'assets/三个石块.png',
  [TILE.ROCK_SMALL]: 'assets/小岩块.png',
  [TILE.ROCK_PILE]: 'assets/矿岩堆.png',
  [TILE.ROCK_2]: 'assets/两个岩块.png',
  [TILE.ROCK_3]: 'assets/三个岩块.png',
  [TILE.BUSH]: 'assets/草丛.png',
  [TILE.BERRY]: 'assets/浆果丛.png',
  [TILE.HILL_TL]: 'assets/山坡左上.png',
  [TILE.HILL_TC]: 'assets/山坡中上.png',
  [TILE.HILL_TR]: 'assets/山坡右上.png',
  [TILE.HILL_ML]: 'assets/山坡左中.png',
  [TILE.HILL_MC]: 'assets/山坡中中.png',
  [TILE.HILL_MR]: 'assets/山坡右中.png',
  [TILE.HILL_BL]: 'assets/山坡左下.png',
  [TILE.HILL_BC]: 'assets/山坡中下.png',
  [TILE.HILL_BR]: 'assets/山坡右下.png',
  [TILE.SHIP]: 'assets/船.png',
  [TILE.PIRATE_SHIP]: 'assets/海盗船.png',
};

// ────────────────────────────────────────────
// 地块旋转角度映射（使用范围辅助函数，消除重复）
// ────────────────────────────────────────────

const PI = Math.PI;
const _TILE_ROTATION = {};

// 草地/水/船：不旋转
assignKeys(_TILE_ROTATION, [TILE.GRASS, TILE.GRASS_1, TILE.GRASS_2, TILE.WATER], 0);

// 沙滩圆角
_TILE_ROTATION[TILE.CORNER_TL] = PI;       // 沙滩西北圆角.png 旋转180°
_TILE_ROTATION[TILE.CORNER_TR] = PI;       // 沙滩东北圆角.png 旋转180°
_TILE_ROTATION[TILE.CORNER_BR] = 0;        // 沙滩西北圆角.png 不旋转
_TILE_ROTATION[TILE.CORNER_BL] = 0;        // 沙滩东北圆角.png 不旋转

// 沙滩边缘
_TILE_ROTATION[TILE.EDGE_T] = PI;          // 水在下 → 旋转180°
_TILE_ROTATION[TILE.EDGE_R] = PI * 3 / 2;  // 水在左 → 旋转270°
_TILE_ROTATION[TILE.EDGE_B] = 0;           // 水在上 → 不旋转
_TILE_ROTATION[TILE.EDGE_L] = PI / 2;     // 水在右 → 旋转90°

// 普通道路
_TILE_ROTATION[TILE.ROAD_H] = 0;
_TILE_ROTATION[TILE.ROAD_V] = PI / 2;
_TILE_ROTATION[TILE.ROAD_CORNER_TL] = PI;
_TILE_ROTATION[TILE.ROAD_CORNER_TR] = PI * 3 / 2;
_TILE_ROTATION[TILE.ROAD_CORNER_BL] = PI / 2;
_TILE_ROTATION[TILE.ROAD_CORNER_BR] = 0;
_TILE_ROTATION[TILE.ROAD_T_DOWN] = 0;
_TILE_ROTATION[TILE.ROAD_T_LEFT] = PI / 2;
_TILE_ROTATION[TILE.ROAD_T_UP] = PI;
_TILE_ROTATION[TILE.ROAD_T_RIGHT] = PI * 3 / 2;
_TILE_ROTATION[TILE.ROAD_CROSS] = 0;

// 路尽头
_TILE_ROTATION[TILE.ROAD_END_UP] = PI * 3 / 2;
_TILE_ROTATION[TILE.ROAD_END_RIGHT] = 0;
_TILE_ROTATION[TILE.ROAD_END_DOWN] = PI / 2;
_TILE_ROTATION[TILE.ROAD_END_LEFT] = PI;

// 石板路
_TILE_ROTATION[TILE.STONE_ROAD_H] = PI * 3 / 2;
_TILE_ROTATION[TILE.STONE_ROAD_V] = 0;
_TILE_ROTATION[TILE.STONE_ROAD_CORNER_TL] = PI * 3 / 2;
_TILE_ROTATION[TILE.STONE_ROAD_CORNER_TR] = 0;
_TILE_ROTATION[TILE.STONE_ROAD_CORNER_BL] = PI;
_TILE_ROTATION[TILE.STONE_ROAD_CORNER_BR] = PI / 2;
_TILE_ROTATION[TILE.STONE_ROAD_T_DOWN] = PI / 2;
_TILE_ROTATION[TILE.STONE_ROAD_T_LEFT] = PI;
_TILE_ROTATION[TILE.STONE_ROAD_T_UP] = PI * 3 / 2;
_TILE_ROTATION[TILE.STONE_ROAD_T_RIGHT] = 0;
_TILE_ROTATION[TILE.STONE_ROAD_CROSS] = 0;

// 树木/石块/岩块/草丛/浆果丛/山坡：不需要旋转
assignRange(_TILE_ROTATION, TILE.TREE_1, TILE.TREE_MANY, 0);
assignRange(_TILE_ROTATION, TILE.STONE_SMALL, TILE.STONE_3, 0);
assignRange(_TILE_ROTATION, TILE.ROCK_SMALL, TILE.ROCK_3, 0);
assignKeys(_TILE_ROTATION, [TILE.BUSH, TILE.BERRY], 0);
assignRange(_TILE_ROTATION, TILE.HILL_TL, TILE.HILL_BR, 0);

// 船旋转由 Ship 动态控制
assignKeys(_TILE_ROTATION, [TILE.SHIP, TILE.PIRATE_SHIP], 0);

export const TILE_ROTATION = _TILE_ROTATION;

// ────────────────────────────────────────────
// 方向常量
// ────────────────────────────────────────────

export const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

// ────────────────────────────────────────────
// 地图画布大小（瓦片数）- 仅用于有限地图兼容
// ────────────────────────────────────────────

export const MAP_W = 40;
export const MAP_H = 30;

// ────────────────────────────────────────────
// 区块(Chunk)系统常量
// ────────────────────────────────────────────

/** 每个区块的瓦片边长（正方形） */
export const CHUNK_SIZE = 16;
/** 缓存最大区块数量 */
export const MAX_CACHED_CHUNKS = 256;
/** 视口外的预加载边距（区块数） */
export const CHUNK_PRELOAD_MARGIN = 2;
/** 全局世界种子 */
export const WORLD_SEED = 42;

// ────────────────────────────────────────────
// 生成配置
// ────────────────────────────────────────────

export const FOREST_CONFIG = {
  frequency: 5.0,
  octaves: 3,
  threshold: 0.62,
  densityRange: 0.2,
  edgeChance: 0.7,
  coreChance: 1.0,
};

export const WATER_CONFIG = {
  shoreX: 80,
};

// ────────────────────────────────────────────
// 变体随机权重
// ────────────────────────────────────────────

export const GRASS_VARIANTS = [
  { tile: TILE.GRASS_1, weight: 50 },
  { tile: TILE.GRASS_2, weight: 50 },
];

export const TREE_VARIANTS = [
  { tile: TILE.TREE_1, weight: 40 },
  { tile: TILE.TREE_2, weight: 30 },
  { tile: TILE.TREE_3, weight: 20 },
  { tile: TILE.TREE_MANY, weight: 10 },
];

export const STONE_VARIANTS = [
  { tile: TILE.STONE_SMALL, weight: 35 },
  { tile: TILE.STONE_BIG, weight: 25 },
  { tile: TILE.STONE_2, weight: 25 },
  { tile: TILE.STONE_3, weight: 15 },
];

export const ROCK_VARIANTS = [
  { tile: TILE.ROCK_SMALL, weight: 35 },
  { tile: TILE.ROCK_PILE, weight: 25 },
  { tile: TILE.ROCK_2, weight: 25 },
  { tile: TILE.ROCK_3, weight: 15 },
];

export const BUSH_VARIANTS = [
  { tile: TILE.BUSH, weight: 70 },
  { tile: TILE.BERRY, weight: 30 },
];

export const FOREST_VARIANTS = [
  { tile: TILE.TREE_1, weight: 5 },
  { tile: TILE.TREE_2, weight: 15 },
  { tile: TILE.TREE_3, weight: 35 },
  { tile: TILE.TREE_MANY, weight: 45 },
];
