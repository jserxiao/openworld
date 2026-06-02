/**
 * 地图常量定义
 * 地块类型、名称、颜色、素材路径、旋转角度
 */

// ────────────────────────────────────────────
// 地块类型
// ────────────────────────────────────────────
export const TILE = {
  GRASS: 0,       // 草地（占位符，实际渲染由 grassMap 决定用哪个变体）
  // 草1、草2
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
  ROAD_H: 10,         // 直路-水平（原图直路.png就是左右方向，不旋转）
  ROAD_V: 11,         // 直路-垂直（直路.png旋转90°）
  ROAD_CORNER_TL: 12, // 路拐角-左上开口（上+左连通，原图旋转180°）
  ROAD_CORNER_TR: 13, // 路拐角-右上开口（右+上连通，原图旋转270°）
  ROAD_CORNER_BL: 14, // 路拐角-左下开口（左+下连通，原图旋转90°）
  ROAD_CORNER_BR: 15, // 路拐角-右下开口（下+右连通，原图不旋转）
  ROAD_T_DOWN: 16,    // 丁字-下开口（原图丁字路.png，不旋转）
  ROAD_T_LEFT: 17,    // 丁字-左开口（旋转90°）
  ROAD_T_UP: 18,      // 丁字-上开口（旋转180°）
  ROAD_T_RIGHT: 19,   // 丁字-右开口（旋转270°）
  ROAD_CROSS: 20,     // 十字路口
  ROAD_END_UP: 38,    // 路尽头-朝上（路尽头.png原图朝右，旋转270°）
  ROAD_END_RIGHT: 39, // 路尽头-朝右（原图朝右，不旋转）
  ROAD_END_DOWN: 40,  // 路尽头-朝下（旋转90°）
  ROAD_END_LEFT: 41,  // 路尽头-朝左（旋转180°）

  // 石板路
  STONE_ROAD_H: 21,           // 石板直路-水平（石板直路.png是上下方向，需逆时针90°变水平，即旋转270°）
  STONE_ROAD_V: 22,           // 石板直路-垂直（石板直路.png原图就是上下方向，不旋转）
  STONE_ROAD_CORNER_TL: 23,   // 石板路拐角-左上开口（上+左连通，原图旋转180°）
  STONE_ROAD_CORNER_TR: 24,   // 石板路拐角-右上开口（右+上连通，原图旋转270°）
  STONE_ROAD_CORNER_BL: 25,   // 石板路拐角-左下开口（左+下连通，原图旋转90°）
  STONE_ROAD_CORNER_BR: 26,   // 石板路拐角-右下开口（下+右连通，原图不旋转）
  STONE_ROAD_T_DOWN: 27,      // 石板丁字-下开口（原图右开口，旋转90°）
  STONE_ROAD_T_LEFT: 28,      // 石板丁字-左开口（原图右开口，旋转180°）
  STONE_ROAD_T_UP: 29,        // 石板丁字-上开口（原图右开口，旋转270°）
  STONE_ROAD_T_RIGHT: 30,     // 石板丁字-右开口（原图就是右开口，不旋转）
  STONE_ROAD_CROSS: 31,       // 石板十字路口

  // 树木（装饰物，不占地面层）
  TREE_1: 32,               // 一棵树
  TREE_2: 33,               // 两棵树
  TREE_3: 34,               // 三棵树
  TREE_MANY: 35,            // 大量树

  // 山坡（3x3瓦片集，自上而下地形）
  HILL_TL: 52,            // 山坡-左上
  HILL_TC: 53,            // 山坡-中上
  HILL_TR: 54,            // 山坡-右上
  HILL_ML: 55,            // 山坡-左中
  HILL_MC: 56,            // 山坡-中中
  HILL_MR: 57,            // 山坡-右中
  HILL_BL: 58,            // 山坡-左下
  HILL_BC: 59,            // 山坡-中下
  HILL_BR: 60,            // 山坡-右下

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
};

// ────────────────────────────────────────────
// 地块名称
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
};

// ────────────────────────────────────────────
// 地块颜色（用于小地图和加载失败时的回退）
// ────────────────────────────────────────────
export const TILE_COLORS = {
  [TILE.GRASS]: 0x27ae60,
  [TILE.GRASS_1]: 0x27ae60,
  [TILE.GRASS_2]: 0x2ecc71,
  [TILE.WATER]: 0x1a5276,
  [TILE.CORNER_TL]: 0x2e86c1,
  [TILE.CORNER_TR]: 0x2e86c1,
  [TILE.CORNER_BR]: 0x2e86c1,
  [TILE.CORNER_BL]: 0x2e86c1,
  [TILE.EDGE_T]: 0x2e86c1,
  [TILE.EDGE_R]: 0x2e86c1,
  [TILE.EDGE_B]: 0x2e86c1,
  [TILE.EDGE_L]: 0x2e86c1,
  [TILE.ROAD_H]: 0xc9a96e,
  [TILE.ROAD_V]: 0xc9a96e,
  [TILE.ROAD_CORNER_TL]: 0xc9a96e,
  [TILE.ROAD_CORNER_TR]: 0xc9a96e,
  [TILE.ROAD_CORNER_BL]: 0xc9a96e,
  [TILE.ROAD_CORNER_BR]: 0xc9a96e,
  [TILE.ROAD_T_DOWN]: 0xc9a96e,
  [TILE.ROAD_T_LEFT]: 0xc9a96e,
  [TILE.ROAD_T_UP]: 0xc9a96e,
  [TILE.ROAD_T_RIGHT]: 0xc9a96e,
  [TILE.ROAD_CROSS]: 0xc9a96e,
  [TILE.ROAD_END_UP]: 0xc9a96e,
  [TILE.ROAD_END_RIGHT]: 0xc9a96e,
  [TILE.ROAD_END_DOWN]: 0xc9a96e,
  [TILE.ROAD_END_LEFT]: 0xc9a96e,
  [TILE.STONE_ROAD_H]: 0x8e8e8e,
  [TILE.STONE_ROAD_V]: 0x8e8e8e,
  [TILE.STONE_ROAD_CORNER_TL]: 0x8e8e8e,
  [TILE.STONE_ROAD_CORNER_TR]: 0x8e8e8e,
  [TILE.STONE_ROAD_CORNER_BL]: 0x8e8e8e,
  [TILE.STONE_ROAD_CORNER_BR]: 0x8e8e8e,
  [TILE.STONE_ROAD_T_DOWN]: 0x8e8e8e,
  [TILE.STONE_ROAD_T_LEFT]: 0x8e8e8e,
  [TILE.STONE_ROAD_T_UP]: 0x8e8e8e,
  [TILE.STONE_ROAD_T_RIGHT]: 0x8e8e8e,
  [TILE.STONE_ROAD_CROSS]: 0x8e8e8e,
  [TILE.TREE_1]: 0x228b22,
  [TILE.TREE_2]: 0x1e7a1e,
  [TILE.TREE_3]: 0x166616,
  [TILE.TREE_MANY]: 0x0f4f0f,
  [TILE.STONE_SMALL]: 0x999999,
  [TILE.STONE_BIG]: 0x777777,
  [TILE.STONE_2]: 0x888888,
  [TILE.STONE_3]: 0xaaaaaa,
  [TILE.ROCK_SMALL]: 0x8b7355,
  [TILE.ROCK_PILE]: 0x6b5344,
  [TILE.ROCK_2]: 0x7a6248,
  [TILE.ROCK_3]: 0x9a8268,
  [TILE.BUSH]: 0x4a7c2a,
  [TILE.BERRY]: 0x8b0000,
  [TILE.HILL_TL]: 0x8B7355,
  [TILE.HILL_TC]: 0x8B7355,
  [TILE.HILL_TR]: 0x8B7355,
  [TILE.HILL_ML]: 0x7A6248,
  [TILE.HILL_MC]: 0x7A6248,
  [TILE.HILL_MR]: 0x7A6248,
  [TILE.HILL_BL]: 0x6B5344,
  [TILE.HILL_BC]: 0x6B5344,
  [TILE.HILL_BR]: 0x6B5344,
};

// ────────────────────────────────────────────
// 素材路径映射
// ────────────────────────────────────────────
export const TILE_ASSETS = {
  [TILE.GRASS]: 'assets/草地.png',
  [TILE.GRASS_1]: 'assets/草1.png',
  [TILE.GRASS_2]: 'assets/草2.png',
  [TILE.WATER]: 'assets/水.png',
  [TILE.CORNER_TL]: 'assets/池塘圆角.png',
  [TILE.CORNER_TR]: 'assets/池塘圆角.png',
  [TILE.CORNER_BR]: 'assets/池塘圆角.png',
  [TILE.CORNER_BL]: 'assets/池塘圆角.png',
  [TILE.EDGE_T]: 'assets/池塘边缘中段.png',
  [TILE.EDGE_R]: 'assets/池塘边缘中段.png',
  [TILE.EDGE_B]: 'assets/池塘边缘中段.png',
  [TILE.EDGE_L]: 'assets/池塘边缘中段.png',
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
};

// ────────────────────────────────────────────
// 地块旋转角度映射（弧度，顺时针）
// ────────────────────────────────────────────
// 直路.png 原图是左右方向 → 水平不旋转，垂直旋转90°
// 路拐角.png 原图是下+右方向连通（路从下方来、往右方去）→ ROAD_CORNER_BR 不旋转
//   左上开口(上+左): 旋转180°
//   右上开口(右+上): 旋转270°
//   左下开口(左+下): 旋转90°
//   右下开口(下+右): 旋转0°（原图就是）
// 丁字路连接.png 原图朝下开口 → ROAD_T_DOWN 不旋转
//   左开口: 旋转90°
//   上开口: 旋转180°
//   右开口: 旋转270°
// 十字路连接.png 不旋转
// ── 石板路 ──
// 石板直路.png 原图是上下方向（比普通路逆时针90°）→ STONE_ROAD_H 旋转270°，STONE_ROAD_V 不旋转
// 石板路拐角.png 也比普通路拐角逆时针90°（原图朝上+右方向连通）→ 各方向比普通路拐角多顺时针90°
//   左上开口(上+左): 旋转270°
//   右上开口(右+上): 旋转0°
//   左下开口(左+下): 旋转180°
//   右下开口(下+右): 旋转90°
// 石板丁字路连接.png 原图朝右开口（比普通路逆时针90°）
//   右开口: 不旋转（0°）
//   下开口: 旋转90°
//   左开口: 旋转180°
//   上开口: 旋转270°
// 石板十字路连接.png 不旋转
export const TILE_ROTATION = {
  [TILE.GRASS]: 0,
  [TILE.GRASS_1]: 0,
  [TILE.GRASS_2]: 0,
  [TILE.WATER]: 0,
  [TILE.CORNER_TL]: 0,
  [TILE.CORNER_TR]: Math.PI / 2,
  [TILE.CORNER_BR]: Math.PI,
  [TILE.CORNER_BL]: Math.PI * 3 / 2,
  [TILE.EDGE_T]: 0,
  [TILE.EDGE_R]: Math.PI / 2,
  [TILE.EDGE_B]: Math.PI,
  [TILE.EDGE_L]: Math.PI * 3 / 2,
  [TILE.ROAD_H]: 0,
  [TILE.ROAD_V]: Math.PI / 2,
  [TILE.ROAD_CORNER_TL]: Math.PI,
  [TILE.ROAD_CORNER_TR]: Math.PI * 3 / 2,
  [TILE.ROAD_CORNER_BL]: Math.PI / 2,
  [TILE.ROAD_CORNER_BR]: 0,
  [TILE.ROAD_T_DOWN]: 0,
  [TILE.ROAD_T_LEFT]: Math.PI / 2,
  [TILE.ROAD_T_UP]: Math.PI,
  [TILE.ROAD_T_RIGHT]: Math.PI * 3 / 2,
  [TILE.ROAD_CROSS]: 0,
  // 路尽头.png 原图朝右延伸 → ROAD_END_RIGHT 不旋转，其他方向旋转
  [TILE.ROAD_END_UP]: Math.PI * 3 / 2,
  [TILE.ROAD_END_RIGHT]: 0,
  [TILE.ROAD_END_DOWN]: Math.PI / 2,
  [TILE.ROAD_END_LEFT]: Math.PI,
  [TILE.STONE_ROAD_H]: Math.PI * 3 / 2,
  [TILE.STONE_ROAD_V]: 0,
  [TILE.STONE_ROAD_CORNER_TL]: Math.PI * 3 / 2,
  [TILE.STONE_ROAD_CORNER_TR]: 0,
  [TILE.STONE_ROAD_CORNER_BL]: Math.PI,
  [TILE.STONE_ROAD_CORNER_BR]: Math.PI / 2,
  [TILE.STONE_ROAD_T_DOWN]: Math.PI / 2,
  [TILE.STONE_ROAD_T_LEFT]: Math.PI,
  [TILE.STONE_ROAD_T_UP]: Math.PI * 3 / 2,
  [TILE.STONE_ROAD_T_RIGHT]: 0,
  [TILE.STONE_ROAD_CROSS]: 0,
  // 树木不需要旋转
  [TILE.TREE_1]: 0,
  [TILE.TREE_2]: 0,
  [TILE.TREE_3]: 0,
  [TILE.TREE_MANY]: 0,
  // 石块、岩块、草丛、浆果丛不需要旋转
  [TILE.STONE_SMALL]: 0,
  [TILE.STONE_BIG]: 0,
  [TILE.STONE_2]: 0,
  [TILE.STONE_3]: 0,
  [TILE.ROCK_SMALL]: 0,
  [TILE.ROCK_PILE]: 0,
  [TILE.ROCK_2]: 0,
  [TILE.ROCK_3]: 0,
  [TILE.BUSH]: 0,
  [TILE.BERRY]: 0,
  // 山坡不需要旋转（素材已按方向命名）
  [TILE.HILL_TL]: 0,
  [TILE.HILL_TC]: 0,
  [TILE.HILL_TR]: 0,
  [TILE.HILL_ML]: 0,
  [TILE.HILL_MC]: 0,
  [TILE.HILL_MR]: 0,
  [TILE.HILL_BL]: 0,
  [TILE.HILL_BC]: 0,
  [TILE.HILL_BR]: 0,
};

// ────────────────────────────────────────────
// 方向常量（用于道路邻接判断）
// ────────────────────────────────────────────
export const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
export const DX = [0, 1, 0, -1]; // col offset: UP=0, RIGHT=+1, DOWN=0, LEFT=-1
export const DY = [-1, 0, 1, 0]; // row offset: UP=-1, RIGHT=0, DOWN=+1, LEFT=0

// ────────────────────────────────────────────
// 地图画布大小（瓦片数）- 仅用于有限地图兼容
// ────────────────────────────────────────────
export const MAP_W = 40;
export const MAP_H = 30;

// ────────────────────────────────────────────
// 区块(Chunk)系统常量 - 用于无限地图
// ────────────────────────────────────────────
/** 每个区块的瓦片边长（正方形） */
export const CHUNK_SIZE = 16;
/** 缓存最大区块数量（超出后移除最久未访问的区块） */
export const MAX_CACHED_CHUNKS = 256;
/** 视口外的预加载边距（区块数），使滚动更平滑 */
export const CHUNK_PRELOAD_MARGIN = 2;
/** 全局世界种子 */
export const WORLD_SEED = 42;

// ────────────────────────────────────────────
// 森林生成配置（可通过 ChunkManager options 覆盖）
// ────────────────────────────────────────────
export const FOREST_CONFIG = {
  /** 噪声频率：考虑内部scale=40，5.0对应周期约8瓦片（1/4屏） */
  frequency: 5.0,
  /** 噪声八度数：越多细节越丰富，3~5 之间 */
  octaves: 3,
  /** 森林阈值：噪声值超过此值才生成森林，越高森林面积越小 */
  threshold: 0.62,
  /** 密度过渡范围：阈值到阈值+range为核心区，range越小边缘越窄 */
  densityRange: 0.2,
  /** 边缘树木概率（forestDensity=0时） */
  edgeChance: 0.7,
  /** 核心树木概率（forestDensity=1时） */
  coreChance: 1.0,
};

// ────────────────────────────────────────────
// 草地变体随机权重
// ────────────────────────────────────────────
export const GRASS_VARIANTS = [
  { tile: TILE.GRASS_1, weight: 50 },
  { tile: TILE.GRASS_2, weight: 50 },
];

// ────────────────────────────────────────────
// 树木类型随机权重（一棵树最多，大量树最少）
// ────────────────────────────────────────────
export const TREE_VARIANTS = [
  { tile: TILE.TREE_1, weight: 40 },
  { tile: TILE.TREE_2, weight: 30 },
  { tile: TILE.TREE_3, weight: 20 },
  { tile: TILE.TREE_MANY, weight: 10 },
];

// ────────────────────────────────────────────
// 石块类型随机权重
// ────────────────────────────────────────────
export const STONE_VARIANTS = [
  { tile: TILE.STONE_SMALL, weight: 35 },
  { tile: TILE.STONE_BIG, weight: 25 },
  { tile: TILE.STONE_2, weight: 25 },
  { tile: TILE.STONE_3, weight: 15 },
];

// ────────────────────────────────────────────
// 岩块类型随机权重
// ────────────────────────────────────────────
export const ROCK_VARIANTS = [
  { tile: TILE.ROCK_SMALL, weight: 35 },
  { tile: TILE.ROCK_PILE, weight: 25 },
  { tile: TILE.ROCK_2, weight: 25 },
  { tile: TILE.ROCK_3, weight: 15 },
];

// ────────────────────────────────────────────
// 草丛、浆果丛类型随机权重
// ────────────────────────────────────────────
export const BUSH_VARIANTS = [
  { tile: TILE.BUSH, weight: 70 },
  { tile: TILE.BERRY, weight: 30 },
];

// ────────────────────────────────────────────
// 森林区域树木类型随机权重（偏向极密集树木）
// ────────────────────────────────────────────
export const FOREST_VARIANTS = [
  { tile: TILE.TREE_1, weight: 5 },
  { tile: TILE.TREE_2, weight: 15 },
  { tile: TILE.TREE_3, weight: 35 },
  { tile: TILE.TREE_MANY, weight: 45 },
];
