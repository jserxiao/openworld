import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { MapCanvasRenderer } from '../map/renderer';
import { startEventBridge, stopEventBridge } from '../map/gameStore';
import { useGameStore } from '../map/gameStore';
import { gameEvents, GameEvent } from '../map/eventBus';

const MapCanvas = forwardRef(function MapCanvas({ mapOptions }, ref) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const initRef = useRef(false);

  // Zustand
  const loading = useGameStore((s) => s.loading);
  const setLoading = useGameStore((s) => s.setLoading);

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

    // 启动事件总线 → Zustand 桥接
    startEventBridge();

    const init = async () => {
      // 1. 初始化画布
      await renderer.init(containerRef.current);

      // 2. 加载素材
      await renderer.loadAssets();

      // 3. 回调已通过事件总线自动桥接到 Zustand，无需手动注册

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
        // 直接获取视口信息通过事件总线同步到 Zustand
        const info = renderer.getViewportInfo();
        if (info) {
          gameEvents.emit(GameEvent.VIEWPORT_INFO, info);
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
      stopEventBridge();
      if (renderer._cleanup) renderer._cleanup();
      renderer.destroy();
      initRef.current = false;
    };
  }, [mapOptions, setLoading]);

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
