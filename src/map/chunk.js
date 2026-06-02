/**
 * 区块(Chunk)系统 - 无限地图核心
 * 
 * 设计思路：
 * - 整个世界被划分为固定大小的区块(CHUNK_SIZE x CHUNK_SIZE瓦片)
 * - 区块生成逻辑在 Web Worker 中执行，避免阻塞主线程
 * - 主线程通过 ChunkManager 管理区块缓存和异步加载
 * - LRU缓存管理区块数据，远离视口的区块会被回收
 */

import { CHUNK_SIZE, MAX_CACHED_CHUNKS } from './constants';

// ────────────────────────────────────────────
// 单个区块数据结构
// ────────────────────────────────────────────
export class Chunk {
  /**
   * @param {number} chunkX - 区块在世界中的列索引
   * @param {number} chunkY - 区块在世界中的行索引
   */
  constructor(chunkX, chunkY) {
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    /** @type {Uint8Array[]} 瓦片数据 [localY][localX] */
    this.map = [];
    /** @type {Uint8Array[]} 草地变体数据 [localY][localX] */
    this.grassMap = [];
    /** 最后访问时间戳（用于LRU） */
    this.lastAccess = 0;
  }
}

// ────────────────────────────────────────────
// 区块管理器
// ────────────────────────────────────────────
export class ChunkManager {
  /**
   * @param {object} [options] - 可选配置
   */
  constructor(options = {}) {
    /** @type {Map<string, Chunk>} 区块缓存 key=`${chunkX},${chunkY}` */
    this.chunks = new Map();
    /** LRU 访问顺序（最新在末尾） */
    this.accessOrder = [];

    // ── Worker 相关 ──
    /** @type {Worker|null} */
    this._worker = null;
    /** @type {Map<string, Function>} 等待区块生成的回调 key -> resolve */
    this._pendingRequests = new Map();
    /** @type {Set<string>} 正在请求中的区块key集合（避免重复请求） */
    this._inflight = new Set();
    /** Worker 是否就绪 */
    this._workerReady = false;
    /** 区块就绪回调（Worker 返回区块数据后通知渲染器） */
    this._onChunkReady = null;

    // 初始化 Worker
    this._initWorker();
  }

  /**
   * 初始化 Web Worker
   * @private
   */
  _initWorker() {
    try {
      // Vite 支持的 Worker 导入方式
      this._worker = new Worker(
        new URL('./chunkWorker.js', import.meta.url),
        { type: 'module' }
      );

      this._worker.onmessage = (e) => {
        this._onWorkerMessage(e.data);
      };

      this._worker.onerror = (err) => {
        console.warn('[ChunkManager] Worker error, falling back to sync mode:', err);
        this._workerReady = false;
      };

      this._workerReady = true;
    } catch (err) {
      console.warn('[ChunkManager] Worker init failed, using sync mode:', err);
      this._workerReady = false;
    }
  }

  /**
   * 处理 Worker 返回的消息
   * @private
   */
  _onWorkerMessage(data) {
    if (data.type === 'chunk') {
      const { chunkX, chunkY, mapBuffers, grassBuffers } = data;
      const key = this._key(chunkX, chunkY);

      // 从 ArrayBuffer 重建 Chunk
      const chunk = new Chunk(chunkX, chunkY);
      for (let i = 0; i < mapBuffers.length; i++) {
        chunk.map[i] = new Uint8Array(mapBuffers[i]);
        chunk.grassMap[i] = new Uint8Array(grassBuffers[i]);
      }
      chunk.lastAccess = Date.now();

      this._addChunk(key, chunk);
      this._inflight.delete(key);

      // 通知等待中的回调
      const resolve = this._pendingRequests.get(key);
      if (resolve) {
        this._pendingRequests.delete(key);
        resolve(chunk);
      }

      // 通知渲染器有新区块就绪
      if (this._onChunkReady) {
        this._onChunkReady(chunk);
      }
    }

    if (data.type === 'batch') {
      for (const { chunkX, chunkY, mapBuffers, grassBuffers } of data.results) {
        const key = this._key(chunkX, chunkY);
        const chunk = new Chunk(chunkX, chunkY);
        for (let i = 0; i < mapBuffers.length; i++) {
          chunk.map[i] = new Uint8Array(mapBuffers[i]);
          chunk.grassMap[i] = new Uint8Array(grassBuffers[i]);
        }
        chunk.lastAccess = Date.now();

        this._addChunk(key, chunk);
        this._inflight.delete(key);

        const resolve = this._pendingRequests.get(key);
        if (resolve) {
          this._pendingRequests.delete(key);
          resolve(chunk);
        }

        // 通知渲染器有新区块就绪
        if (this._onChunkReady) {
          this._onChunkReady(chunk);
        }
      }
    }
  }

  /**
   * 获取区块缓存key
   */
  _key(cx, cy) {
    return `${cx},${cy}`;
  }

  /**
   * 获取指定区块（同步，可能返回 null 如果区块尚未生成）
   * @param {number} chunkX
   * @param {number} chunkY
   * @returns {Chunk|null}
   */
  getChunkIfLoaded(chunkX, chunkY) {
    const key = this._key(chunkX, chunkY);
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.lastAccess = Date.now();
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
        this.accessOrder.push(key);
      }
    }
    return chunk || null;
  }

  /**
   * 异步获取指定区块，如果不存在则通过 Worker 生成
   * @param {number} chunkX
   * @param {number} chunkY
   * @returns {Promise<Chunk>}
   */
  getChunkAsync(chunkX, chunkY) {
    const key = this._key(chunkX, chunkY);
    const cached = this.chunks.get(key);
    if (cached) {
      cached.lastAccess = Date.now();
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
        this.accessOrder.push(key);
      }
      return Promise.resolve(cached);
    }

    // 如果已在请求中，复用同一个 Promise
    if (this._inflight.has(key)) {
      return new Promise((resolve) => {
        // 链式回调：多个请求者共享同一个生成结果
        const prevResolve = this._pendingRequests.get(key);
        if (prevResolve) {
          this._pendingRequests.set(key, (chunk) => {
            prevResolve(chunk);
            resolve(chunk);
          });
        } else {
          this._pendingRequests.set(key, resolve);
        }
      });
    }

    // 发送生成请求给 Worker
    this._inflight.add(key);

    return new Promise((resolve) => {
      this._pendingRequests.set(key, resolve);

      if (this._workerReady && this._worker) {
        this._worker.postMessage({
          type: 'generate',
          chunkX,
          chunkY,
        });
      } else {
        // Worker 不可用时的回退：主线程同步生成（不应该发生，但作为安全网）
        console.warn('[ChunkManager] Worker not available, sync generation');
        // 这种情况下无法同步返回，标记为不可用
        this._inflight.delete(key);
        this._pendingRequests.delete(key);
        resolve(null);
      }
    });
  }

  /**
   * 批量请求生成区块（减少 Worker 通信次数）
   * @param {Array<{chunkX: number, chunkY: number}>} requests
   * @returns {Promise<Chunk[]>}
   */
  getChunksBatchAsync(requests) {
    const results = [];
    const needGenerate = [];

    for (const { chunkX, chunkY } of requests) {
      const key = this._key(chunkX, chunkY);
      const cached = this.chunks.get(key);
      if (cached) {
        cached.lastAccess = Date.now();
        results.push(cached);
      } else if (this._inflight.has(key)) {
        // 已在请求中，等待结果
        results.push(this._waitForChunk(key));
      } else {
        needGenerate.push({ chunkX, chunkY });
        results.push(this._waitForChunk(key));
        this._inflight.add(key);
      }
    }

    if (needGenerate.length > 0 && this._workerReady && this._worker) {
      this._worker.postMessage({
        type: 'generateBatch',
        requests: needGenerate,
      });
    }

    return Promise.all(results);
  }

  /**
   * 等待指定区块生成完成
   * @private
   */
  _waitForChunk(key) {
    return new Promise((resolve) => {
      const prevResolve = this._pendingRequests.get(key);
      if (prevResolve) {
        this._pendingRequests.set(key, (chunk) => {
          prevResolve(chunk);
          resolve(chunk);
        });
      } else {
        this._pendingRequests.set(key, resolve);
      }
    });
  }

  /**
   * 预加载指定区块（不等待结果）
   */
  ensureChunkAsync(chunkX, chunkY) {
    const key = this._key(chunkX, chunkY);
    if (this.chunks.has(key) || this._inflight.has(key)) return;

    this._inflight.add(key);
    this._pendingRequests.set(key, () => {}); // 空 resolve，不需要等待

    if (this._workerReady && this._worker) {
      this._worker.postMessage({
        type: 'generate',
        chunkX,
        chunkY,
      });
    }
  }

  /**
   * 获取视口可见范围内的所有区块（只返回已加载的）
   * @param {number} viewX
   * @param {number} viewY
   * @param {number} viewW
   * @param {number} viewH
   * @param {number} margin
   * @returns {Chunk[]}
   */
  getVisibleChunksLoaded(viewX, viewY, viewW, viewH, margin = 0) {
    const startCX = Math.floor(viewX / CHUNK_SIZE) - margin;
    const startCY = Math.floor(viewY / CHUNK_SIZE) - margin;
    const endCX = Math.floor((viewX + viewW) / CHUNK_SIZE) + margin;
    const endCY = Math.floor((viewY + viewH) / CHUNK_SIZE) + margin;

    const result = [];
    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const chunk = this.getChunkIfLoaded(cx, cy);
        if (chunk) result.push(chunk);
      }
    }
    return result;
  }

  /**
   * 请求加载视口范围内尚未加载的区块
   * @param {number} viewX
   * @param {number} viewY
   * @param {number} viewW
   * @param {number} viewH
   * @param {number} margin
   * @returns {Promise<Chunk[]>} 所有可见区块（包括已有和新生成的）
   */
  async loadVisibleChunks(viewX, viewY, viewW, viewH, margin = 0) {
    const startCX = Math.floor(viewX / CHUNK_SIZE) - margin;
    const startCY = Math.floor(viewY / CHUNK_SIZE) - margin;
    const endCX = Math.floor((viewX + viewW) / CHUNK_SIZE) + margin;
    const endCY = Math.floor((viewY + viewH) / CHUNK_SIZE) + margin;

    const requests = [];
    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const key = this._key(cx, cy);
        if (!this.chunks.has(key) && !this._inflight.has(key)) {
          requests.push({ chunkX: cx, chunkY: cy });
        }
      }
    }

    if (requests.length > 0) {
      await this.getChunksBatchAsync(requests);
    }

    // 返回所有可见区块
    return this.getVisibleChunksLoaded(viewX, viewY, viewW, viewH, margin);
  }

  /**
   * 获取指定世界坐标的瓦片类型
   */
  getTile(worldX, worldY) {
    const cx = Math.floor(worldX / CHUNK_SIZE);
    const cy = Math.floor(worldY / CHUNK_SIZE);
    const chunk = this.getChunkIfLoaded(cx, cy);
    if (!chunk) return 0; // 未加载时返回 GRASS
    const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.map[ly][lx];
  }

  /**
   * 获取指定世界坐标的草地变体
   */
  getGrassTile(worldX, worldY) {
    const cx = Math.floor(worldX / CHUNK_SIZE);
    const cy = Math.floor(worldY / CHUNK_SIZE);
    const chunk = this.getChunkIfLoaded(cx, cy);
    if (!chunk) return 0;
    const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.grassMap[ly][lx];
  }

  /**
   * 添加区块到缓存，并执行LRU淘汰
   */
  _addChunk(key, chunk) {
    // 如果已存在（可能是重复请求），更新数据
    if (this.chunks.has(key)) {
      this.chunks.set(key, chunk);
      return;
    }

    this.chunks.set(key, chunk);
    this.accessOrder.push(key);

    // LRU淘汰
    while (this.chunks.size > MAX_CACHED_CHUNKS) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey && this.chunks.has(oldestKey)) {
        this.chunks.delete(oldestKey);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      cachedChunks: this.chunks.size,
      maxChunks: MAX_CACHED_CHUNKS,
      pendingRequests: this._pendingRequests.size,
      inflightRequests: this._inflight.size,
      workerReady: this._workerReady,
    };
  }

  /**
   * 清空所有缓存
   */
  clearCache() {
    this.chunks.clear();
    this.accessOrder = [];
  }

  /**
   * 注册区块就绪回调（Worker 生成完区块后通知渲染器）
   */
  setOnChunkReady(cb) {
    this._onChunkReady = cb;
  }

  /**
   * 销毁 Worker
   */
  destroy() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
      this._workerReady = false;
    }
    this._pendingRequests.clear();
    this._inflight.clear();
  }
}
