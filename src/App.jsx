import { useMemo, useRef, useState, useCallback } from 'react';
import MapCanvas from './components/MapCanvas';

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
  const [viewportInfo, setViewportInfo] = useState(null);
  const [hoveredTile, setHoveredTile] = useState(null);

  // 使用 useMemo 避免 mapOptions 每次渲染重新创建
  const mapOptions = useMemo(() => DEFAULT_MAP_OPTIONS, []);

  const handleViewportChange = useCallback((info) => {
    setViewportInfo(info);
  }, []);

  const handleTileHover = useCallback((tileX, tileY, tileType) => {
    setHoveredTile({ tileX, tileY, tileType });
  }, []);

  return (
    <>
      <MapCanvas
        ref={mapRef}
        onViewportChange={handleViewportChange}
        onTileHover={handleTileHover}
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

      {/* 操作提示 */}
      <div className="hud-hint">
        🖱️ 拖拽移动 | 🔄 滚轮缩放
      </div>
    </>
  );
}
