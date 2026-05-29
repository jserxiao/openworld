/**
 * MapData - 地图数据层
 * 负责地图瓦片数据的生成和管理，不涉及任何渲染逻辑
 */

import { TILE, MAP_W, MAP_H } from './constants';
import { generatePond } from './pond';
import { generateRoad } from './road';
import { generateTrees } from './tree';

export class MapData {
  constructor() {
    /** @type {Uint8Array[]} 瓦片数据 map[y][x] */
    this.map = [];
    /** @type {number} 地图列数 */
    this.mapW = MAP_W;
    /** @type {number} 地图行数 */
    this.mapH = MAP_H;
  }

  /**
   * 初始化空地图（全草地）
   * @param {number} [mapW] 列数
   * @param {number} [mapH] 行数
   */
  init(mapW = MAP_W, mapH = MAP_H) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.map = [];
    for (let y = 0; y < mapH; y++) {
      this.map[y] = new Uint8Array(mapW);
      this.map[y].fill(TILE.GRASS);
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
    }
    // 扩展列
    for (let y = 0; y < this.map.length; y++) {
      if (this.map[y].length < mapW) {
        const newRow = new Uint8Array(mapW);
        newRow.fill(TILE.GRASS);
        newRow.set(this.map[y]);
        this.map[y] = newRow;
      }
    }
    return this;
  }

  /**
   * 生成池塘
   * @param {object} options
   * @param {number} options.pondX - 池塘左上角列坐标
   * @param {number} options.pondY - 池塘左上角行坐标
   * @param {number} options.pondW - 池塘宽度（瓦片数）
   * @param {number} options.pondH - 池塘高度（瓦片数）
   * @returns {{ pondLeft: number, pondTop: number, pondRight: number, pondBottom: number }}
   */
  addPond(options) {
    const result = generatePond(options);
    this.map = result.map;
    // 扩展到固定画布大小
    this.resize(this.mapW, this.mapH);
    return {
      pondLeft: result.pondLeft,
      pondTop: result.pondTop,
      pondRight: result.pondRight,
      pondBottom: result.pondBottom,
    };
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
