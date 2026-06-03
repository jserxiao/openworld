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

      // 2. 加载素材（非渐进式，等待所有纹理就绪）
      await renderer.loadAssets();

      // 3. 首次渲染：等待所有区块渲染完成后，画布淡入显示
      //    然后才关闭加载画面，确保用户看到的是完整地图而非色块
      renderer.centerOnShoreline();
      await renderer.renderInitial();

      // 4. 画布已淡入，延迟关闭加载画面让过渡更平滑
      setTimeout(() => setLoading(false), 100);

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
      {!loading ? null : (
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
