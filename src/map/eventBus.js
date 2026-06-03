/**
 * 全局事件总线
 * 基于 mitt 实现发布/订阅模式，解耦模块间通信
 *
 * 使用方式：
 *   import { gameEvents } from './eventBus';
 *   gameEvents.on('viewport:moved', (state) => { ... });
 *   gameEvents.emit('viewport:moved', { x, y, zoom });
 *
 * 事件清单：
 *   viewport:moved        - 视口位置/缩放变化
 *   viewport:info         - 视口信息定时上报（供 HUD 显示）
 *   chunk:ready           - 区块数据生成完毕
 *   chunk:rendered        - 区块容器渲染完毕
 *   chunk:removed         - 区块容器被移除
 *   decor:rebuild         - 装饰层需要重建
 *   ship:collision        - 船只碰撞事件
 *   ship:attack           - 海盗船发起攻击
 *   ship:hit              - 弹药命中目标
 *   ship:destroyed        - 船只被摧毁
 *   tile:hover            - 瓦片悬停
 *   asset:loaded          - 素材加载完成
 */

import mitt from 'mitt';

/** @type {import('mitt').Emitter<Record<string, any>>} */
export const gameEvents = mitt();

/**
 * 事件类型常量，避免手写事件名拼错
 */
export const GameEvent = {
  VIEWPORT_MOVED: 'viewport:moved',
  VIEWPORT_INFO: 'viewport:info',
  CHUNK_READY: 'chunk:ready',
  CHUNK_RENDERED: 'chunk:rendered',
  CHUNK_REMOVED: 'chunk:removed',
  DECOR_REBUILD: 'decor:rebuild',
  SHIP_COLLISION: 'ship:collision',
  SHIP_ATTACK: 'ship:attack',
  SHIP_HIT: 'ship:hit',
  SHIP_DESTROYED: 'ship:destroyed',
  TILE_HOVER: 'tile:hover',
  ASSET_LOADED: 'asset:loaded',
};
