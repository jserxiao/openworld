/**
 * 地图常量定义
 * 地块类型、名称、颜色、素材路径、旋转角度
 */

// ────────────────────────────────────────────
// 地块类型
// ────────────────────────────────────────────
export const TILE = {
  GRASS: 0,       // 草地
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
  TREE_BIG: 32,               // 大树
  TREE_SMALL: 33,             // 小树
};

// ────────────────────────────────────────────
// 地块名称
// ────────────────────────────────────────────
export const TILE_NAMES = {
  [TILE.GRASS]: '草地',
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
  [TILE.TREE_BIG]: '大树',
  [TILE.TREE_SMALL]: '小树',
};

// ────────────────────────────────────────────
// 地块颜色（用于小地图和加载失败时的回退）
// ────────────────────────────────────────────
export const TILE_COLORS = {
  [TILE.GRASS]: 0x27ae60,
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
  [TILE.TREE_BIG]: 0x228b22,
  [TILE.TREE_SMALL]: 0x32cd32,
};

// ────────────────────────────────────────────
// 素材路径映射
// ────────────────────────────────────────────
export const TILE_ASSETS = {
  [TILE.GRASS]: 'assets/草地.png',
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
  [TILE.TREE_BIG]: 'assets/大树.png',
  [TILE.TREE_SMALL]: 'assets/小树.png',
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
  [TILE.TREE_BIG]: 0,
  [TILE.TREE_SMALL]: 0,
};

// ────────────────────────────────────────────
// 方向常量（用于道路邻接判断）
// ────────────────────────────────────────────
export const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
export const DX = [0, 1, 0, -1]; // col offset: UP=0, RIGHT=+1, DOWN=0, LEFT=-1
export const DY = [-1, 0, 1, 0]; // row offset: UP=-1, RIGHT=0, DOWN=+1, LEFT=0

// ────────────────────────────────────────────
// 地图画布大小（瓦片数）
// ────────────────────────────────────────────
export const MAP_W = 40;
export const MAP_H = 30;
