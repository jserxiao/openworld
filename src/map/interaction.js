/**
 * 交互控制模块
 * 封装鼠标拖拽、滚轮缩放、触摸拖拽等交互逻辑
 * 从 renderer.js 中抽离，使渲染器不必关心输入处理细节
 */

/**
 * 交互控制器
 * 管理画布上的所有用户输入交互
 */
export class InteractionController {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas - PixiJS 画布元素
   * @param {Function} options.getViewport - 获取当前视口状态的函数 () => { x, y, zoom }
   * @param {Function} options.setViewport - 设置视口状态的函数 (viewport) => void
   * @param {{ w: number, h: number }} options.tileSize - 瓦片像素尺寸
   * @param {Function} options.onViewportMoved - 视口移动后的回调
   * @param {Function} [options.onTileHover] - 瓦片悬停回调 (tileX, tileY, tileType) => void
   * @param {Function} [options.screenToWorldTile] - 屏幕坐标转瓦片坐标 (screenX, screenY) => { tileX, tileY }
   */
  constructor(options) {
    this._canvas = options.canvas;
    this._getViewport = options.getViewport;
    this._setViewport = options.setViewport;
    this._tileSize = options.tileSize;
    this._onViewportMoved = options.onViewportMoved;
    this._onTileHover = options.onTileHover;
    this._screenToWorldTile = options.screenToWorldTile;

    /** @type {boolean} 是否正在拖拽 */
    this._dragging = false;
    this._dragStart = { x: 0, y: 0 };
    this._viewportStart = { x: 0, y: 0 };

    // 触摸拖拽状态
    this._touchStart = null;

    // 绑定事件处理函数（保存引用以便卸载）
    this._boundMouseDown = this._onMouseDown.bind(this);
    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundMouseUp = this._onMouseUp.bind(this);
    this._boundWheel = this._onWheel.bind(this);
    this._boundTouchStart = this._onTouchStart.bind(this);
    this._boundTouchMove = this._onTouchMove.bind(this);
    this._boundTouchEnd = this._onTouchEnd.bind(this);

    this._attach();
  }

  /**
   * 更新瓦片尺寸（纹理加载后可能变化）
   * @param {{ w: number, h: number }} tileSize
   */
  updateTileSize(tileSize) {
    this._tileSize = tileSize;
  }

  /**
   * 更新瓦片悬停回调
   * @param {Function} cb
   */
  setOnTileHover(cb) {
    this._onTileHover = cb;
  }

  // ────────────────────────────────────────────
  // 事件绑定/解绑
  // ────────────────────────────────────────────

  _attach() {
    const canvas = this._canvas;

    canvas.addEventListener('mousedown', this._boundMouseDown);
    window.addEventListener('mousemove', this._boundMouseMove);
    window.addEventListener('mouseup', this._boundMouseUp);
    canvas.addEventListener('wheel', this._boundWheel, { passive: false });

    // 触摸
    canvas.addEventListener('touchstart', this._boundTouchStart, { passive: true });
    canvas.addEventListener('touchmove', this._boundTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._boundTouchEnd);

    canvas.style.cursor = 'grab';
  }

  /**
   * 销毁交互控制器，移除所有事件监听
   */
  destroy() {
    const canvas = this._canvas;
    if (!canvas) return;

    canvas.removeEventListener('mousedown', this._boundMouseDown);
    window.removeEventListener('mousemove', this._boundMouseMove);
    window.removeEventListener('mouseup', this._boundMouseUp);
    canvas.removeEventListener('wheel', this._boundWheel);
    canvas.removeEventListener('touchstart', this._boundTouchStart);
    canvas.removeEventListener('touchmove', this._boundTouchMove);
    canvas.removeEventListener('touchend', this._boundTouchEnd);
  }

  // ────────────────────────────────────────────
  // 鼠标事件处理
  // ────────────────────────────────────────────

  _onMouseDown(e) {
    this._dragging = true;
    this._dragStart = { x: e.clientX, y: e.clientY };
    const vp = this._getViewport();
    this._viewportStart = { x: vp.x, y: vp.y };
    this._canvas.style.cursor = 'grabbing';
  }

  _onMouseMove(e) {
    if (this._dragging) {
      const dx = e.clientX - this._dragStart.x;
      const dy = e.clientY - this._dragStart.y;
      const tileW = this._tileSize.w;
      const vp = this._getViewport();

      this._setViewport({
        x: this._viewportStart.x - dx / (vp.zoom * tileW),
        y: this._viewportStart.y - dy / (vp.zoom * tileW),
        zoom: vp.zoom,
      });
      this._onViewportMoved();
    }

    // 悬停信息
    if (this._onTileHover && !this._dragging && this._screenToWorldTile) {
      const { tileX, tileY } = this._screenToWorldTile(e.clientX, e.clientY);
      this._onTileHover(tileX, tileY);
    }
  }

  _onMouseUp() {
    if (this._dragging) {
      this._dragging = false;
      this._canvas.style.cursor = 'grab';
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const { tileX, tileY } = this._screenToWorldTile(e.clientX, e.clientY);

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const vp = this._getViewport();
    const newZoom = Math.max(0.25, Math.min(3, vp.zoom * zoomFactor));
    const tileW = this._tileSize.w;

    // 缩放时保持鼠标指向的世界瓦片坐标不变
    this._setViewport({
      x: tileX - e.clientX / (newZoom * tileW),
      y: tileY - e.clientY / (newZoom * tileW),
      zoom: newZoom,
    });
    this._onViewportMoved();
  }

  // ────────────────────────────────────────────
  // 触摸事件处理
  // ────────────────────────────────────────────

  _onTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._touchStart = { x: t.clientX, y: t.clientY };
      const vp = this._getViewport();
      this._viewportStart = { x: vp.x, y: vp.y };
    }
  }

  _onTouchMove(e) {
    if (e.touches.length === 1 && this._touchStart) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - this._touchStart.x;
      const dy = t.clientY - this._touchStart.y;
      const tileW = this._tileSize.w;
      const vp = this._getViewport();

      this._setViewport({
        x: this._viewportStart.x - dx / (vp.zoom * tileW),
        y: this._viewportStart.y - dy / (vp.zoom * tileW),
        zoom: vp.zoom,
      });
      this._onViewportMoved();
    }
  }

  _onTouchEnd() {
    this._touchStart = null;
  }
}
