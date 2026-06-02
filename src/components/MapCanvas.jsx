import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { MapCanvasRenderer } from '../map/renderer';

const MapCanvas = forwardRef(function MapCanvas({ onViewportChange, onTileHover, mapOptions }, ref) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const initRef = useRef(false);
  const [loading, setLoading] = useState(true);

  // 使用 useRef 保存回调引用，避免闭包过时问题
  const onViewportChangeRef = useRef(onViewportChange);
  const onTileHoverRef = useRef(onTileHover);

  // 每次渲染更新 ref
  onViewportChangeRef.current = onViewportChange;
  onTileHoverRef.current = onTileHover;

  // 重置视图
  const resetView = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) renderer.resetView();
  }, []);

  // 居中到原点
  const centerToOrigin = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) renderer.centerOn(0, 0);
  }, []);

  // 导出PNG
  const exportMap = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) renderer.exportPNG();
  }, []);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    resetView, centerToOrigin, exportMap,
  }), [resetView, centerToOrigin, exportMap]);

  // 初始化
  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    const renderer = new MapCanvasRenderer(mapOptions);
    rendererRef.current = renderer;

    const init = async () => {
      // 1. 初始化画布
      await renderer.init(containerRef.current);

      // 2. 加载素材
      await renderer.loadAssets();

      // 3. 注册回调（使用 ref.current 确保始终获取最新回调）
      renderer.setOnViewportChange((info) => {
        if (onViewportChangeRef.current) onViewportChangeRef.current(info);
      });
      renderer.setOnTileHover((tileX, tileY, tileType) => {
        if (onTileHoverRef.current) onTileHoverRef.current(tileX, tileY, tileType);
      });

      // 4. 首次渲染（异步加载区块，Worker 生成完后自动渲染）
      // 将初始视口定位到岸线附近，让草地/沙滩/水域同时可见
      renderer.centerOnShoreline();
      renderer.renderInitial(); // 异步，不等所有区块完成

      setLoading(false);

      // 5. 视口信息定时上报（每10帧）
      const ticker = renderer.getTicker();
      let frameCount = 0;
      const tickerFn = () => {
        frameCount++;
        if (frameCount % 10 !== 0) return;
        if (onViewportChangeRef.current) {
          const info = renderer.getViewportInfo();
          if (info) onViewportChangeRef.current(info);
        }
      };
      if (ticker) ticker.add(tickerFn);

      // 保存清理函数
      renderer._cleanup = () => {
        if (ticker) ticker.remove(tickerFn);
      };
    };

    init();

    return () => {
      if (renderer._cleanup) renderer._cleanup();
      renderer.destroy();
      initRef.current = false;
    };
  }, [mapOptions]);

  return (
    <>
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">正在生成无限世界...</div>
        </div>
      )}
      <div ref={containerRef} className="map-container" />
    </>
  );
});

export default MapCanvas;
