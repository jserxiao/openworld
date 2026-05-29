import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { MapData } from '../map/mapData';
import { MapCanvasRenderer } from '../map/renderer';
import { MAP_W, MAP_H } from '../map/constants';

const MapCanvas = forwardRef(function MapCanvas({ onMapGenerated, onViewportChange, onTileHover }, ref) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const mapDataRef = useRef(null);
  const initRef = useRef(false);
  const [loading, setLoading] = useState(true);

  /**
   * 生成地图数据（纯数据层，不涉及渲染）
   * @returns {MapData}
   */
  const generateMapData = useCallback(() => {
    const mapData = new MapData();
    mapData.init(MAP_W, MAP_H);

    // 池塘参数
    const pondX = 3;
    const pondY = 2;
    const pondW = 5;
    const pondH = 4;
    const pondInfo = mapData.addPond({ pondX, pondY, pondW, pondH });

    // 普通道路（十字路，避开池塘区域）
    const roadY = pondInfo.pondTop - 1;
    const roadX = pondInfo.pondLeft - 2;
    mapData.addRoad({
      segments: [
        { start: [0, roadY], end: [MAP_W - 1, roadY] },        // 水平路（池塘上方）
        { start: [roadX, 0], end: [roadX, MAP_H - 1] },        // 垂直路（池塘左侧）
      ],
    });

    // 石板路（池塘右侧区域）
    const stoneRoadX = pondInfo.pondLeft + pondW + 3;
    const stoneRoadY = pondInfo.pondTop + Math.floor(pondH / 2);
    mapData.addRoad({
      type: 'stone',
      segments: [
        { start: [stoneRoadX - 4, stoneRoadY], end: [stoneRoadX + 4, stoneRoadY] },  // 石板水平路
        { start: [stoneRoadX, stoneRoadY - 4], end: [stoneRoadX, stoneRoadY + 4] },  // 石板垂直路（十字）
        { start: [stoneRoadX + 4, stoneRoadY], end: [stoneRoadX + 8, stoneRoadY + 3] }, // 丁字石板路
      ],
    });

    // 树木（随机生成在草地上，池塘和道路之后生成以确保不覆盖）
    mapData.addTrees({ count: 40, bigRatio: 0.4 });

    return mapData;
  }, []);

  // 重新生成地图
  const regenerate = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const mapData = generateMapData();
    mapDataRef.current = mapData;
    renderer.render(mapData);
    renderer.resetView();

    if (onMapGenerated) onMapGenerated(mapData.map);
  }, [generateMapData, onMapGenerated]);

  const resetView = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) renderer.resetView();
  }, []);

  const exportMap = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) renderer.exportPNG();
  }, []);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    resetView, regenerate, exportMap,
  }), [resetView, regenerate, exportMap]);

  // 初始化
  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    const renderer = new MapCanvasRenderer();
    rendererRef.current = renderer;

    const init = async () => {
      // 1. 初始化画布
      await renderer.init(containerRef.current);

      // 2. 加载素材
      await renderer.loadAssets();

      // 3. 生成地图数据（纯数据操作）
      const mapData = generateMapData();
      mapDataRef.current = mapData;

      // 4. 渲染到画布
      renderer.render(mapData);
      renderer.resetView();

      setLoading(false);
      if (onMapGenerated) onMapGenerated(mapData.map);

      // 5. 注册交互事件
      const canvas = renderer.getCanvas();

      // 鼠标悬停
      const handleMouseMove = (e) => {
        if (onTileHover && mapDataRef.current) {
          const { tileX, tileY, valid } = renderer.screenToTile(
            e.clientX, e.clientY, mapData.mapW, mapData.mapH
          );
          if (valid) {
            onTileHover(tileX, tileY, mapDataRef.current.map[tileY][tileX]);
          }
        }
      };
      canvas.addEventListener('mousemove', handleMouseMove);

      // 视口信息上报（每5帧）
      let frameCount = 0;
      const tickerFn = () => {
        frameCount++;
        if (frameCount % 5 !== 0) return;
        if (onViewportChange) {
          const info = renderer.getViewportInfo(mapData.mapW, mapData.mapH);
          if (info) onViewportChange(info);
        }
      };
      const ticker = renderer.getTicker();
      if (ticker) ticker.add(tickerFn);

      // 保存清理函数
      renderer._cleanup = () => {
        canvas.removeEventListener('mousemove', handleMouseMove);
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
          <div>正在生成地图...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 0 }} />
    </>
  );
});

export default MapCanvas;
