/**
 * 瓦片类型判断工具
 * 统一所有瓦片类型判断逻辑，供主线程和 Worker 共同使用
 * 消除 renderer.js / chunkWorker.js / decorations.js 中的重复定义
 */

import { TILE } from './constants';

// ────────────────────────────────────────────
// 道路类型判断
// ────────────────────────────────────────────

/**
 * 判断是否是道路类型（包括普通路、石板路、路尽头）
 */
export function isRoadTile(tile) {
  return (tile >= TILE.ROAD_H && tile <= TILE.ROAD_CROSS)
    || (tile >= TILE.STONE_ROAD_H && tile <= TILE.STONE_ROAD_CROSS)
    || (tile >= TILE.ROAD_END_UP && tile <= TILE.ROAD_END_LEFT);
}

/**
 * 判断是否是石板路类型
 */
export function isStoneRoadTile(tile) {
  return tile >= TILE.STONE_ROAD_H && tile <= TILE.STONE_ROAD_CROSS;
}

// ────────────────────────────────────────────
// 水域类型判断
// ────────────────────────────────────────────

/**
 * 判断是否是深水类型
 */
export function isWaterTile(tile) {
  return tile === TILE.WATER;
}

/**
 * 判断是否是沙滩边缘类型（圆角 + 边）
 */
export function isBeachTile(tile) {
  return tile >= TILE.CORNER_TL && tile <= TILE.EDGE_L;
}

/**
 * 判断是否属于水域区域（深水或沙滩边缘）
 */
export function isWaterAreaTile(tile) {
  return tile === TILE.WATER || (tile >= TILE.CORNER_TL && tile <= TILE.EDGE_L);
}

// ────────────────────────────────────────────
// 山坡类型判断
// ────────────────────────────────────────────

/**
 * 判断是否是山坡类型
 */
export function isHillTile(tile) {
  return tile >= TILE.HILL_TL && tile <= TILE.HILL_BR;
}

// ────────────────────────────────────────────
// 树木类型判断
// ────────────────────────────────────────────

/**
 * 判断是否是树木类型
 */
export function isTreeTile(tile) {
  return tile === TILE.TREE_1 || tile === TILE.TREE_2
    || tile === TILE.TREE_3 || tile === TILE.TREE_MANY;
}

// ────────────────────────────────────────────
// 装饰物类型判断
// ────────────────────────────────────────────

/**
 * 判断是否是装饰物类型（石块、岩块、草丛、浆果丛）
 */
export function isDecorationTile(tile) {
  return (tile >= TILE.STONE_SMALL && tile <= TILE.STONE_3)
    || (tile >= TILE.ROCK_SMALL && tile <= TILE.ROCK_3)
    || tile === TILE.BUSH
    || tile === TILE.BERRY;
}

/**
 * 判断是否是石块类型
 */
export function isStoneTile(tile) {
  return tile >= TILE.STONE_SMALL && tile <= TILE.STONE_3;
}

/**
 * 判断是否是岩块类型
 */
export function isRockTile(tile) {
  return tile >= TILE.ROCK_SMALL && tile <= TILE.ROCK_3;
}

/**
 * 判断是否是草丛/浆果丛类型
 */
export function isBushTile(tile) {
  return tile === TILE.BUSH || tile === TILE.BERRY;
}

// ────────────────────────────────────────────
// 复合判断
// ────────────────────────────────────────────

/**
 * 判断瓦片是否需要草地底图（装饰物、道路、山坡等覆盖在草地上的瓦片）
 */
export function needsGrassBackground(tile) {
  return isTreeTile(tile) || isDecorationTile(tile) || isRoadTile(tile) || isHillTile(tile);
}

/**
 * 判断瓦片是否是装饰性精灵（需要独立渲染并参与全局Y排序）
 */
export function isDecorSprite(tile) {
  return isTreeTile(tile) || isDecorationTile(tile);
}
