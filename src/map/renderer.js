/**
 * MapCanvasRenderer - 画布渲染层
 * 封装 PixiJS 操作，负责将 MapData 渲染到画布上
 * 不关心数据怎么生成，只负责根据数据绘制
 */

import * as PIXI from 'pixi.js';
import { TILE, TILE_COLORS, TILE_ASSETS, TILE_ROTATION } from './constants';
import { isRoadTile } from './road';
import { isTreeTile } from './tree';
export class MapCanvasRenderer {
  constructor() {
    /** @type {PIXI.Application|null} */
    this.app = null;
    /** @type {PIXI.Container|null} 地图容器 */
    this.mapContainer = null;
    /** @type {Object<number, PIXI.Texture>} 瓦片纹理 */
    this.textures = {};
    /** @type {{ w: number, h: number }} 瓦片像素尺寸 */
    this.tileSize = { w: 64, h: 64 };
    /** @type {HTMLDivElement|null} */
    this.containerEl = null;
  }

  /**
   * 初始化 PixiJS 应用
   * @param {HTMLDivElement} containerEl - 挂载容器
   * @returns {Promise<void>}
   */
  async init(containerEl) {
    this.containerEl = containerEl;

    this.app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x0d1117,
      antialias: false,
      resolution: 1,
      autoDensity: false,
    });

    const canvas = this.app.view;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '0';

    containerEl.appendChild(canvas);

    this.mapContainer = new PIXI.Container();
    this.app.stage.addChild(this.mapContainer);

    // 窗口大小变化时自动调整画布
    this._onResize = () => {
      if (this.app) {
        this.app.renderer.resize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', this._onResize);
  }

  /**
   * 加载素材纹理
   * @returns {Promise<void>}
   */
  async loadAssets() {
    const rawTextures = {};
    let tileW = 64;
    let tileH = 64;

    for (const [key, path] of Object.entries(TILE_ASSETS)) {
      try {
        const texture = await PIXI.Assets.load(path);
        rawTextures[parseInt(key)] = texture;
        if (parseInt(key) === TILE.GRASS) {
          tileW = texture.width;
          tileH = texture.height;
        }
      } catch {
        const tileType = parseInt(key);
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        const hex = TILE_COLORS[tileType] || 0x555555;
        const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, 64, 64);
        rawTextures[tileType] = PIXI.Texture.from(c);
      }
    }

    this.textures = rawTextures;
    this.tileSize = { w: tileW, h: tileH };
  }

  /**
   * 将地图数据渲染到画布
   * 渲染分两层：地面层（草地、池塘、道路）和装饰层（树木等）
   * 树木按 y 坐标排序，确保正确的前后遮挡关系
   * @param {import('./mapData').MapData} mapData - 地图数据
   */
  render(mapData) {
    if (!this.mapContainer) return;

    this.mapContainer.removeChildren();
    this.mapContainer.x = 0;
    this.mapContainer.y = 0;
    this.mapContainer.scale.set(1);

    const { mapW, mapH, map } = mapData;
    const { w: tileW, h: tileH } = this.tileSize;
    const textures = this.textures;

    // 地面层：草地、池塘、道路
    const groundGroup = new PIXI.Container();
    this.mapContainer.addChild(groundGroup);

    // 装饰层：树木等（按 y 排序实现遮挡）
    const decorGroup = new PIXI.Container();
    this.mapContainer.addChild(decorGroup);

    // 收集树木信息用于装饰层渲染
    const treeSprites = [];

    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const tile = map[y][x];

        // 树木：在地面层铺草地底图，精灵放到装饰层
        if (isTreeTile(tile)) {
          // 地面层：铺草地底图
          const bgSprite = new PIXI.Sprite(textures[TILE.GRASS]);
          bgSprite.x = x * tileW;
          bgSprite.y = y * tileH;
          bgSprite.width = tileW;
          bgSprite.height = tileH;
          groundGroup.addChild(bgSprite);

          // 装饰层：稍后统一按 y 排序添加
          const treeSprite = new PIXI.Sprite(textures[tile] || textures[TILE.GRASS]);
          // 树木锚点设在底部中央，让树干底部对齐瓦片底部
          treeSprite.anchor.set(0.5, 1);
          treeSprite.x = x * tileW + tileW / 2;
          treeSprite.y = (y + 1) * tileH;
          // 保持原始宽高比，高度为瓦片的 1.5 倍让树更突出
          const aspect = treeSprite.texture.width / treeSprite.texture.height;
          const treeH = tileH * 1.5;
          const treeW = treeH * aspect;
          treeSprite.width = treeW;
          treeSprite.height = treeH;
          treeSprites.push({ sprite: treeSprite, y });
          continue;
        }

        // 非草地格子需要先铺底图，防止透明区域露出黑色背景
        if (isRoadTile(tile)) {
          // 道路铺草地底图
          const bgSprite = new PIXI.Sprite(textures[TILE.GRASS]);
          bgSprite.x = x * tileW;
          bgSprite.y = y * tileH;
          bgSprite.width = tileW;
          bgSprite.height = tileH;
          groundGroup.addChild(bgSprite);
        } else if (tile !== TILE.GRASS) {
          // 池塘相关铺水面底图
          const bgSprite = new PIXI.Sprite(textures[TILE.WATER]);
          bgSprite.x = x * tileW;
          bgSprite.y = y * tileH;
          bgSprite.width = tileW;
          bgSprite.height = tileH;
          groundGroup.addChild(bgSprite);
        }

        // 纯水面不需要再叠加
        if (tile === TILE.WATER) continue;

        const sprite = new PIXI.Sprite(textures[tile] || textures[TILE.GRASS]);
        const rotation = TILE_ROTATION[tile] || 0;
        if (rotation !== 0) {
          sprite.anchor.set(0.5);
          sprite.x = x * tileW + tileW / 2;
          sprite.y = y * tileH + tileH / 2;
          sprite.rotation = rotation;
        } else {
          sprite.x = x * tileW;
          sprite.y = y * tileH;
        }
        sprite.width = tileW;
        sprite.height = tileH;
        groundGroup.addChild(sprite);
      }
    }

    // 按 y 坐标排序树木，y 小的先画（在后面），y 大的后画（在前面）
    treeSprites.sort((a, b) => a.y - b.y);
    for (const { sprite } of treeSprites) {
      decorGroup.addChild(sprite);
    }
  }

  /**
   * 重置视图到左上角
   */
  resetView() {
    if (this.mapContainer) {
      this.mapContainer.scale.set(1);
      this.mapContainer.x = 0;
      this.mapContainer.y = 0;
    }
  }

  /**
   * 导出当前画布为 PNG
   */
  exportPNG() {
    if (!this.app) return;
    try {
      const url = this.app.renderer.extract.base64(this.app.stage);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'map.png';
      a.click();
    } catch (e) {
      console.error('导出失败:', e);
    }
  }

  /**
   * 将屏幕坐标转换为瓦片坐标
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} mapW
   * @param {number} mapH
   * @returns {{ tileX: number, tileY: number, valid: boolean }}
   */
  screenToTile(clientX, clientY, mapW, mapH) {
    if (!this.mapContainer) return { tileX: -1, tileY: -1, valid: false };
    const { w: tileW, h: tileH } = this.tileSize;
    const c = this.mapContainer;
    const worldX = clientX - c.x;
    const worldY = clientY - c.y;
    const tileX = Math.floor(worldX / tileW);
    const tileY = Math.floor(worldY / tileH);
    return {
      tileX,
      tileY,
      valid: tileX >= 0 && tileX < mapW && tileY >= 0 && tileY < mapH,
    };
  }

  /**
   * 获取当前视口信息
   * @param {number} mapW
   * @param {number} mapH
   * @returns {object}
   */
  getViewportInfo(mapW, mapH) {
    if (!this.mapContainer) return null;
    const c = this.mapContainer;
    const { w: tileW } = this.tileSize;
    return {
      x: -c.x,
      y: -c.y,
      zoom: 1,
      mapW,
      mapH,
      tileSize: tileW,
      screenW: window.innerWidth,
      screenH: window.innerHeight,
    };
  }

  /**
   * 获取画布 DOM 元素
   * @returns {HTMLCanvasElement|null}
   */
  getCanvas() {
    return this.app ? this.app.view : null;
  }

  /**
   * 获取 PIXI ticker（用于注册帧回调）
   * @returns {PIXI.Ticker|null}
   */
  getTicker() {
    return this.app ? this.app.ticker : null;
  }

  /**
   * 销毁渲染器，释放资源
   */
  destroy() {
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
    this.mapContainer = null;
    this.textures = {};
    this.containerEl = null;
  }
}
