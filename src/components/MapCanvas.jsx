import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { MapCanvasRenderer } from '../map/renderer';

const MapCanvas = forwardRef(function MapCanvas({ onViewportChange, onTileHover, mapOptions }, ref) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const initRef = useRef(false);
  const [loading, setLoading] = useState(true);

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

      // 3. 注册回调
      if (onViewportChange) {
        renderer.setOnViewportChange(onViewportChange);
      }
      if (onTileHover) {
        renderer.setOnTileHover(onTileHover);
      }

      // 4. 首次渲染
      renderer.centerOn(0, 0);
      renderer.renderInitial();

      setLoading(false);

      // 5. 视口信息定时上报（每10帧）
      const ticker = renderer.getTicker();
      let frameCount = 0;
      const tickerFn = () => {
        frameCount++;
        if (frameCount % 10 !== 0) return;
        if (onViewportChange) {
          const info = renderer.getViewportInfo();
          if (info) onViewportChange(info);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {loading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.9)', zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', color: '#fff', fontSize: 18,
        }}>
          <div style={{
            width: 48, height: 48, border: '4px solid #333',
            borderTop: '4px solid #4a9eff', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite', marginBottom: 16,
          }} />
          <div>正在生成无限世界...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }} />
    </>
  );
});

export default MapCanvas;
