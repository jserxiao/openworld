import { useMemo, useRef, useCallback } from 'react';
import MapCanvas from './components/MapCanvas';
import { useGameStore } from './map/gameStore';

// 森林默认配置（模块级常量，避免每次渲染重新创建对象）
const DEFAULT_MAP_OPTIONS = {
  forest: {
    frequency: 5.0,      // 噪声频率：scale=40/freq=8瓦片周期（约1/4屏）
    octaves: 3,          // 噪声八度
    threshold: 0.68,     // 森林阈值：越高森林面积越小（0.5~0.95之间调整）
    densityRange: 0.15,  // 密度过渡范围
    edgeChance: 0.7,     // 边缘放树概率
    coreChance: 1.0,     // 核心放树概率
  },
};

export default function App() {
  const mapRef = useRef(null);

  // 使用 useMemo 避免 mapOptions 每次渲染重新创建
  const mapOptions = useMemo(() => DEFAULT_MAP_OPTIONS, []);

  // ── Zustand 状态：用 selector 精确订阅，避免不必要的 re-render ──
  const viewportInfo = useGameStore((s) => s.viewportInfo);
  const hoveredTile = useGameStore((s) => s.hoveredTile);

  // MapCanvas 不再需要回调 props，状态通过事件总线 + Zustand 自动同步
  // 但保留 ref 方法接口供外部使用

  return (
    <>
      <MapCanvas
        ref={mapRef}
        mapOptions={mapOptions}
      />

      {/* HUD 信息面板 */}
      <div className="hud-panel">
        <div className="hud-title">🌍 无限世界</div>
        {viewportInfo && (
          <>
            <div>缩放: {viewportInfo.zoom.toFixed(2)}x</div>
            <div>视口: ({viewportInfo.tileStartX}, {viewportInfo.tileStartY}) → ({viewportInfo.tileEndX}, {viewportInfo.tileEndY})</div>
            <div>缓存区块: {viewportInfo.cachedChunks}/{viewportInfo.maxChunks}</div>
          </>
        )}
        {hoveredTile && (
          <div className="hud-tile-info">
            瓦片: ({hoveredTile.tileX}, {hoveredTile.tileY}) 类型: {hoveredTile.tileType}
          </div>
        )}
      </div>
    </>
  );
}
