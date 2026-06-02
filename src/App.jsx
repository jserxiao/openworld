import { useState, useRef, useCallback } from 'react';
import MapCanvas from './components/MapCanvas';

export default function App() {
  const mapRef = useRef(null);
  const [viewportInfo, setViewportInfo] = useState(null);
  const [hoveredTile, setHoveredTile] = useState(null);

  // 地图生成配置
  const mapOptions = {
    forest: {
      frequency: 5.0,      // 噪声频率：scale=40/freq=8瓦片周期（约1/4屏）
      octaves: 3,          // 噪声八度
      threshold: 0.68,     // 森林阈值：越高森林面积越小（0.5~0.95之间调整）
      densityRange: 0.15,  // 密度过渡范围
      edgeChance: 0.7,     // 边缘放树概率
      coreChance: 1.0,     // 核心放树概率
    },
  };

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
      <div style={{
        position: 'fixed', top: 12, right: 12, zIndex: 100,
        background: 'rgba(0,0,0,0.75)', borderRadius: 8,
        padding: '10px 16px', color: '#fff', fontSize: 13,
        fontFamily: 'monospace', lineHeight: 1.8,
        pointerEvents: 'none', userSelect: 'none',
      }}>
        <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 4, color: '#4a9eff' }}>
          🌍 无限世界
        </div>
        {viewportInfo && (
          <>
            <div>缩放: {viewportInfo.zoom.toFixed(2)}x</div>
            <div>视口: ({viewportInfo.tileStartX}, {viewportInfo.tileStartY}) → ({viewportInfo.tileEndX}, {viewportInfo.tileEndY})</div>
            <div>缓存区块: {viewportInfo.cachedChunks}/{viewportInfo.maxChunks}</div>
          </>
        )}
        {hoveredTile && (
          <div style={{ color: '#aaa', marginTop: 4 }}>
            瓦片: ({hoveredTile.tileX}, {hoveredTile.tileY}) 类型: {hoveredTile.tileType}
          </div>
        )}
      </div>

      {/* 操作提示 */}
      <div style={{
        position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 100, background: 'rgba(0,0,0,0.6)', borderRadius: 20,
        padding: '6px 20px', color: '#aaa', fontSize: 12,
        pointerEvents: 'none', userSelect: 'none',
      }}>
        🖱️ 拖拽移动 | 🔄 滚轮缩放
      </div>
    </>
  );
}
