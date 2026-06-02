/**
 * Zustand 游戏状态管理
 * 统一管理视口信息、悬停瓦片、加载状态等全局状态
 * 替代 App.jsx 中的 useState + useRef 闭包模式
 *
 * 优势：
 * - 统一状态源，避免 React 回调闭包过时问题
 * - 组件外可直接读写状态（事件总线回调中无需 useRef hack）
 * - Zustand 自动 selector 优化，减少不必要的 re-render
 */

import { create } from 'zustand';
import { gameEvents, GameEvent } from './eventBus';

/**
 * @typedef {object} GameState
 * @property {object|null} viewportInfo - 视口信息
 * @property {object|null} hoveredTile - 悬停瓦片 { tileX, tileY, tileType }
 * @property {boolean} loading - 是否正在加载
 * @property {Function} setViewportInfo - 设置视口信息
 * @property {Function} setHoveredTile - 设置悬停瓦片
 * @property {Function} setLoading - 设置加载状态
 */

/**
 * 游戏全局状态 Store
 */
export const useGameStore = create((set) => ({
  // ── 状态 ──
  viewportInfo: null,
  hoveredTile: null,
  loading: true,

  // ── Actions ──
  setViewportInfo: (info) => set({ viewportInfo: info }),
  setHoveredTile: (tile) => set({ hoveredTile: tile }),
  setLoading: (loading) => set({ loading }),
}));

// ────────────────────────────────────────────
// 事件总线 → Zustand 桥接
// 初始化后自动将事件数据同步到 store
// ────────────────────────────────────────────

let _bridgeUnsubs = [];

/**
 * 启动事件总线 → Zustand 桥接
 * 在 MapCanvas 初始化时调用一次
 */
export function startEventBridge() {
  _bridgeUnsubs = [
    gameEvents.on(GameEvent.VIEWPORT_INFO, (info) => {
      useGameStore.getState().setViewportInfo(info);
    }),
    gameEvents.on(GameEvent.TILE_HOVER, (data) => {
      useGameStore.getState().setHoveredTile(data);
    }),
  ];
}

/**
 * 停止事件总线 → Zustand 桥接
 * 在 MapCanvas 销毁时调用
 */
export function stopEventBridge() {
  for (const unsub of _bridgeUnsubs) {
    if (typeof unsub === 'function') unsub();
  }
  _bridgeUnsubs = [];
}
