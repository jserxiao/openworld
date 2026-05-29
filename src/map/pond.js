/**
 * 池塘生成器
 * 在地图上生成居中或指定位置的池塘，带圆角和边缘
 */

import { TILE } from './constants';

/**
 * 在指定区域生成一个池塘
 * 池塘四周草地，边缘用圆角和中段素材
 * 地图大小自动根据池塘位置和尺寸推导（池塘四周各留1格草地边距）
 *
 * @param {object} options
 * @param {number} options.pondX - 池塘左上角列坐标（瓦片）
 * @param {number} options.pondY - 池塘左上角行坐标（瓦片）
 * @param {number} options.pondW - 池塘宽度（瓦片数），含圆角和边缘，最小 4
 * @param {number} options.pondH - 池塘高度（瓦片数），含圆角和边缘，最小 4
 * @returns {{ map: Uint8Array[], mapW: number, mapH: number, pondLeft: number, pondTop: number, pondRight: number, pondBottom: number }}
 */
export function generatePond(options) {
  const {
    pondX = 0,
    pondY = 0,
    pondW = 20,
    pondH = 10,
  } = options;

  const cols = Math.max(4, pondW);
  const rows = Math.max(4, pondH);

  // 地图大小：根据池塘位置和尺寸推导，四周各留1格草地边距
  const mapW = pondX + cols + 1;
  const mapH = pondY + rows + 1;

  // 初始化全草地
  const map = [];
  for (let y = 0; y < mapH; y++) {
    map[y] = new Uint8Array(mapW);
    map[y].fill(TILE.GRASS);
  }

  // 池塘位置
  const pondLeft = pondX;
  const pondTop = pondY;
  const pondRight = pondLeft + cols - 1;
  const pondBottom = pondTop + rows - 1;

  // 填充池塘内部为深水
  for (let y = pondTop; y <= pondBottom; y++) {
    for (let x = pondLeft; x <= pondRight; x++) {
      map[y][x] = TILE.WATER;
    }
  }

  // 四个圆角
  map[pondTop][pondLeft] = TILE.CORNER_TL;
  map[pondTop][pondRight] = TILE.CORNER_TR;
  map[pondBottom][pondRight] = TILE.CORNER_BR;
  map[pondBottom][pondLeft] = TILE.CORNER_BL;

  // 上/下边缘中段
  for (let x = pondLeft + 1; x < pondRight; x++) {
    map[pondTop][x] = TILE.EDGE_T;
    map[pondBottom][x] = TILE.EDGE_B;
  }

  // 左/右边缘中段
  for (let y = pondTop + 1; y < pondBottom; y++) {
    map[y][pondLeft] = TILE.EDGE_L;
    map[y][pondRight] = TILE.EDGE_R;
  }

  return { map, mapW, mapH, pondLeft, pondTop, pondRight, pondBottom };
}

/**
 * 生成自适应全屏的池塘地图（兼容旧接口）
 * 池塘大小自动按屏幕比例计算
 */
export function generateMap(tileW, tileH, screenW, screenH) {
  const mapW = Math.ceil(screenW / tileW);
  const mapH = Math.ceil(screenH / tileH);

  const pondW = Math.max(4, Math.floor(mapW * 0.7));
  const pondH = Math.max(4, Math.floor(mapH * 0.6));
  const pondX = Math.floor((mapW - pondW) / 2);
  const pondY = Math.floor((mapH - pondH) / 2);

  return generatePond({ pondX, pondY, pondW, pondH });
}
