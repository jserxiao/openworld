/**
 * MapData - 地图数据层
 * 负责地图瓦片数据的生成和管理，不涉及任何渲染逻辑
 */

import { TILE, MAP_W, MAP_H, GRASS_VARIANTS, STONE_VARIANTS, ROCK_VARIANTS, BUSH_VARIANTS } from './constants';
import { generateRoad } from './road';
import { generateTrees } from './tree';
import { generateDecorations } from './decorations';
import { createSeededRandom, buildCumWeights, weightedRandom } from './utils';

export class MapData {
  constructor() {
    /** @type {Uint8Array[]} 瓦片数据 map[y][x] */
    this.map = [];
    /** @type {Uint8Array[]} 草地变体数据 grassMap[y][x]，记录每个草地格子使用的变体TILE值 */
    this.grassMap = [];
    /** @type {number} 地图列数 */
    this.mapW = MAP_W;
    /** @type {number} 地图行数 */
    this.mapH = MAP_H;
  }

  /**
   * 初始化空地图（全草地）
   * 同时生成草地变体分布（草1、草2 为主，草金、草石 少量）
   * @param {number} [mapW] 列数
   * @param {number} [mapH] 行数
   */
  init(mapW = MAP_W, mapH = MAP_H) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.map = [];
    this.grassMap = [];

    // 预计算权重累积表
    const { cumWeights, totalWeight } = buildCumWeights(GRASS_VARIANTS);
    const rng = createSeededRandom(Date.now());

    for (let y = 0; y < mapH; y++) {
      this.map[y] = new Uint8Array(mapW);
      this.map[y].fill(TILE.GRASS);
      this.grassMap[y] = new Uint8Array(mapW);
      for (let x = 0; x < mapW; x++) {
        this.grassMap[y][x] = weightedRandom(cumWeights, totalWeight, rng);
      }
    }
    return this;
  }

  /**
   * 扩展地图数组到指定大小（已有数据保留，新增区域填充草地）
   * @param {number} mapW 目标列数
   * @param {number} mapH 目标行数
   */
  resize(mapW, mapH) {
    this.mapW = mapW;
    this.mapH = mapH;

    // 扩展行
    while (this.map.length < mapH) {
      this.map.push(new Uint8Array(mapW));
      this.map[this.map.length - 1].fill(TILE.GRASS);
      this.grassMap.push(new Uint8Array(mapW));
      this.grassMap[this.map.length - 1].fill(TILE.GRASS_1);
    }
    // 扩展列
    for (let y = 0; y < this.map.length; y++) {
      if (this.map[y].length < mapW) {
        const newRow = new Uint8Array(mapW);
        newRow.fill(TILE.GRASS);
        newRow.set(this.map[y]);
        this.map[y] = newRow;
        const newGrass = new Uint8Array(mapW);
        newGrass.fill(TILE.GRASS_1);
        newGrass.set(this.grassMap[y]);
        this.grassMap[y] = newGrass;
      }
    }
    return this;
  }

  /**
   * 生成道路
   * @param {object} options
   * @param {Array<{start:[number,number], end:[number,number]}>} options.segments - 道路段
   * @param {'road'|'stone'} [options.type='road'] - 道路类型
   */
  addRoad(options) {
    generateRoad({
      map: this.map,
      mapW: this.mapW,
      mapH: this.mapH,
      ...options,
    });
    return this;
  }

  /**
   * 随机生成树木（只会放在草地上）
   * @param {object} options
   * @param {number} [options.count=30] - 生成树木数量
   * @param {number} [options.bigRatio=0.4] - 大树占比
   * @param {number} [options.seed] - 随机种子
   * @returns {{ trees: Array<{x: number, y: number, type: number}> }}
   */
  addTrees(options = {}) {
    const result = generateTrees({
      map: this.map,
      mapW: this.mapW,
      mapH: this.mapH,
      ...options,
    });
    // 保存树木列表到实例，方便渲染层获取
    this.trees = result.trees;
    return result;
  }

  /**
   * 随机生成装饰物（石块、岩块、草丛、浆果丛，只会放在草地上）
   * @param {object} options
   * @param {Array<{tile: number, weight: number}>} [options.variants] - 自定义变体权重表
   * @param {number} [options.count=20] - 生成装饰物数量
   * @param {number} [options.seed] - 随机种子
   * @param {number} [options.clusterChance=0.2] - 聚集概率
   * @param {number} [options.clusterRadius=2] - 聚集半径
   * @returns {{ decorations: Array<{x: number, y: number, type: number}> }}
   */
  addDecorations(options = {}) {
    const result = generateDecorations({
      map: this.map,
      mapW: this.mapW,
      mapH: this.mapH,
      ...options,
    });
    this.decorations = result.decorations;
    return result;
  }

  /**
   * 快捷方法：生成石块
   * @param {object} [options]
   * @returns {{ decorations: Array<{x: number, y: number, type: number}> }}
   */
  addStones(options = {}) {
    return this.addDecorations({
      variants: STONE_VARIANTS,
      count: options.count ?? 15,
      ...options,
    });
  }

  /**
   * 快捷方法：生成岩块
   * @param {object} [options]
   * @returns {{ decorations: Array<{x: number, y: number, type: number}> }}
   */
  addRocks(options = {}) {
    return this.addDecorations({
      variants: ROCK_VARIANTS,
      count: options.count ?? 15,
      ...options,
    });
  }

  /**
   * 快捷方法：生成草丛和浆果丛
   * @param {object} [options]
   * @returns {{ decorations: Array<{x: number, y: number, type: number}> }}
   */
  addBushes(options = {}) {
    return this.addDecorations({
      variants: BUSH_VARIANTS,
      count: options.count ?? 20,
      ...options,
    });
  }

  /**
   * 获取指定位置的瓦片类型
   * @param {number} x 列
   * @param {number} y 行
   * @returns {number} TILE 枚举值
   */
  getTile(x, y) {
    if (x < 0 || x >= this.mapW || y < 0 || y >= this.mapH) return TILE.GRASS;
    return this.map[y][x];
  }

  /**
   * 获取地图数据的快照（深拷贝）
   * @returns {Uint8Array[]}
   */
  getSnapshot() {
    return this.map.map(row => new Uint8Array(row));
  }
}
