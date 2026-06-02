/**
 * LOD (Level of Detail) 管理器
 *
 * 根据视口缩放级别自动调整渲染精度，在低缩放（看远处）时减少渲染细节，
 * 高缩放（看近处）时恢复完整细节，平衡性能和视觉质量。
 *
 * LOD 级别定义：
 * - LOD 0 (Full):    zoom >= 0.7  — 完整渲染（所有装饰物 + 全分辨率 RenderTexture）
 * - LOD 1 (Medium):  zoom >= 0.4  — 中等渲染（隐藏小装饰物 + 中分辨率 RenderTexture）
 * - LOD 2 (Low):     zoom < 0.4   — 低渲染（仅地面 + 低分辨率 RenderTexture + 无装饰层）
 *
 * 性能收益：
 * - 低缩放时装饰物精灵数量减少 50-80%，Draw Call 大幅下降
 * - RenderTexture 分辨率降低，GPU 渲染和带宽开销减少
 * - 远景浏览时帧率更稳定
 */

/**
 * @typedef {object} LODLevel
 * @property {number} level - LOD 级别 (0=最高, 范围越大越低)
 * @property {number} resolution - RenderTexture 分辨率倍数 (0~1)
 * @property {boolean} showDecorations - 是否显示装饰物精灵
 * @property {boolean} showSmallDecor - 是否显示小装饰物（石块/草丛）
 * @property {number} decorMargin - 装饰物视口裁剪余量
 */

/** LOD 配置表 */
const LOD_TABLE = [
  { level: 0, resolution: 1.0, showDecorations: true,  showSmallDecor: true,  decorMargin: 3 },  // Full
  { level: 1, resolution: 0.75, showDecorations: true,  showSmallDecor: false, decorMargin: 2 },  // Medium
  { level: 2, resolution: 0.5,  showDecorations: false, showSmallDecor: false, decorMargin: 0 },  // Low
];

/** zoom → LOD 级别阈值 */
const LOD_THRESHOLDS = [0.7, 0.4, 0];

/**
 * LOD 管理器
 */
export class LODManager {
  constructor() {
    /** @type {number} 当前 LOD 级别 */
    this._currentLevel = 0;
    /** @type {LODLevel} 当前 LOD 配置 */
    this._currentConfig = LOD_TABLE[0];
    /** @type {boolean} LOD 级别是否发生变化 */
    this._levelChanged = false;
  }

  /**
   * 根据缩放值更新 LOD 级别
   * @param {number} zoom - 当前视口缩放值
   * @returns {boolean} LOD 级别是否发生变化
   */
  update(zoom) {
    this._levelChanged = false;

    let newLevel = 0;
    for (let i = 0; i < LOD_THRESHOLDS.length; i++) {
      if (zoom < LOD_THRESHOLDS[i]) {
        newLevel = i + 1;
      }
    }
    // 限制在有效范围内
    newLevel = Math.min(newLevel, LOD_TABLE.length - 1);

    if (newLevel !== this._currentLevel) {
      this._currentLevel = newLevel;
      this._currentConfig = LOD_TABLE[newLevel];
      this._levelChanged = true;
    }

    return this._levelChanged;
  }

  /**
   * 获取当前 LOD 级别
   * @returns {number}
   */
  get level() {
    return this._currentLevel;
  }

  /**
   * 获取当前 LOD 配置
   * @returns {LODLevel}
   */
  get config() {
    return this._currentConfig;
  }

  /**
   * LOD 级别是否在上一帧发生了变化
   * @returns {boolean}
   */
  get levelChanged() {
    return this._levelChanged;
  }

  /**
   * 是否应该显示装饰物
   * @returns {boolean}
   */
  get showDecorations() {
    return this._currentConfig.showDecorations;
  }

  /**
   * 是否应该显示小装饰物（石块/草丛/浆果）
   * @returns {boolean}
   */
  get showSmallDecor() {
    return this._currentConfig.showSmallDecor;
  }

  /**
   * 获取当前 RenderTexture 分辨率
   * @returns {number}
   */
  get resolution() {
    return this._currentConfig.resolution;
  }

  /**
   * 获取装饰物视口裁剪余量
   * @returns {number}
   */
  get decorMargin() {
    return this._currentConfig.decorMargin;
  }

  /**
   * 判断指定瓦片类型是否应该在当前 LOD 级别下渲染
   * @param {number} tileType - TILE 枚举值
   * @param {Function} isTreeTile - 判断是否是树木
   * @param {Function} isDecorationTile - 判断是否是装饰物
   * @returns {boolean}
   */
  shouldRenderTile(tileType, isTreeTile, isDecorationTile) {
    // LOD 0: 渲染所有
    if (this._currentLevel === 0) return true;
    // LOD 2: 不渲染任何装饰物
    if (!this._currentConfig.showDecorations) return false;
    // LOD 1: 渲染树木，但不渲染小装饰物
    if (!this._currentConfig.showSmallDecor && isDecorationTile(tileType) && !isTreeTile(tileType)) {
      return false;
    }
    return true;
  }
}
