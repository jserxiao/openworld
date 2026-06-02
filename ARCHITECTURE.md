# 项目架构文档

> Pokémon 无限世界地图 — 抽象方式与技术实现总览

---

## 一、项目概览

| 项 | 值 |
|---|---|
| 项目名 | `pokemon-infinite-map` |
| 模块类型 | ESM (`"type": "module"`) |
| 构建工具 | Vite 8 + `@vitejs/plugin-react` |
| 渲染引擎 | PixiJS 7 (WebGL 2D) |
| UI 框架 | React 19 |
| 后台计算 | Web Worker（ES Module 模式） |

核心目标：在浏览器中渲染一张**无限大、程序化生成**的 2D 瓦片地图，支持拖拽平移、滚轮缩放、动态船队，并保证 60fps 流畅交互。

---

## 二、整体架构分层

```
┌─────────────────────────────────────────────────────────┐
│                     React 层                            │
│   App.jsx → MapCanvas.jsx (ref 桥接)                    │
├─────────────────────────────────────────────────────────┤
│                  渲染协调层                              │
│              MapCanvasRenderer                          │
│        (组合子模块，不处理底层细节)                        │
├────────┬────────┬────────┬────────┬────────┬───────────┤
│Viewport│Interac-│Asset   │Ship    │Chunk   │ Tile      │
│        │tion    │Loader  │Fleet   │Manager │ Utils     │
│视口状态 │交互控制 │纹理加载 │船队管理 │区块缓存 │类型判断   │
│坐标转换 │拖拽缩放 │回退纹理 │碰撞检测 │Worker  │统一逻辑   │
├────────┴────────┴────────┴────────┴────────┴───────────┤
│                    数据生成层                            │
│            chunkWorker.js (Web Worker)                   │
│    水域 → 山坡 → 道路 → 森林 → 散落树 → 装饰物           │
├─────────────────────────────────────────────────────────┤
│                    公共基础层                            │
│   constants.js │ utils.js │ tileUtils.js                │
│   枚举/常量      噪声/随机   类型判断                      │
└─────────────────────────────────────────────────────────┘
```

---

## 三、模块职责与抽象方式

### 3.1 公共基础层（主线程 & Worker 共享）

#### `constants.js` — 枚举与配置中心

| 导出 | 类型 | 用途 |
|---|---|---|
| `TILE` | `object` | 62 种瓦片类型枚举（0~62） |
| `TILE_NAMES` | `object` | 瓦片中文名映射 |
| `TILE_COLORS` | `object` | 瓦片回退色（hex），用 `assignRange` / `assignKeys` 批量生成 |
| `TILE_ASSETS` | `object` | 瓦片素材路径映射 |
| `TILE_ROTATION` | `object` | 瓦片渲染旋转角度，用 `assignRange` 批量生成 |
| `DIR / DX / DY` | `array` | 方向枚举和偏移量 |
| `MAP_W / MAP_H` | `number` | 有限地图默认尺寸 |
| `GRASS/TREE/STONE/ROCK/BUSH/FOREST_VARIANTS` | `array` | 各类瓦片的加权变体表 |
| `CHUNK_SIZE` | `number` | 区块边长（瓦片数） |
| `MAX_CACHED_CHUNKS` | `number` | LRU 缓存上限 |
| `CHUNK_PRELOAD_MARGIN` | `number` | 区块预加载边距 |
| `WORLD_SEED` | `number` | 世界种子 |
| `FOREST_CONFIG` | `object` | 森林生成参数 |
| `WATER_CONFIG` | `object` | 水域岸线配置 |

**抽象要点**：使用 `assignRange(obj, from, to, value)` 和 `assignKeys(obj, keys, value)` 两个辅助函数消除同类瓦片的重复赋值。新增瓦片类型只需改 `TILE` 枚举和一处范围即可。

#### `utils.js` — 确定性算法工具箱

| 导出 | 签名 | 用途 |
|---|---|---|
| `createNoise(seed)` | → `{ hash, smooth, fbm }` | 整数哈希噪声（xxHash 变体），替代 `Math.sin` 哈希 |
| `createSeededRandom(seed)` | → `() => number` | LCG 确定性伪随机数生成器 |
| `buildCumWeights(variants)` | → `{ cumWeights, totalWeight }` | 预计算累积权重表 |
| `weightedRandom(cumW, totalW, rng)` | → `tile` | O(n) 加权随机选择 |

**抽象要点**：所有算法均为**纯函数 + 闭包**模式，无全局状态。主线程和 Worker 通过 `import` 共享同一份代码，消除重复实现。

#### `tileUtils.js` — 瓦片类型判断统一入口

| 导出 | 用途 |
|---|---|
| `isRoadTile(tile)` | 道路（普通路 + 石板路 + 路尽头） |
| `isStoneRoadTile(tile)` | 石板路 |
| `isWaterTile(tile)` | 深水 |
| `isBeachTile(tile)` | 沙滩边缘（圆角 + 边） |
| `isWaterAreaTile(tile)` | 水域区域（深水 + 沙滩） |
| `isHillTile(tile)` | 山坡（3×3 瓦片集） |
| `isTreeTile(tile)` | 树木 |
| `isDecorationTile(tile)` | 装饰物（石块 + 岩块 + 草丛 + 浆果） |
| `isStoneTile / isRockTile / isBushTile(tile)` | 子分类判断 |
| `needsGrassBackground(tile)` | 是否需要草地底图 |
| `isDecorSprite(tile)` | 是否为装饰性精灵（需 Y 排序） |

**抽象要点**：之前 renderer.js 和 chunkWorker.js 各自重复定义判断逻辑，导致不一致风险。抽离后统一维护，Worker 通过 `import` 直接使用。

---

### 3.2 数据生成层

#### `chunkWorker.js` — Web Worker 区块生成器

**通信协议**：

```
主线程 → Worker:
  { type: 'generate', chunkX, chunkY }
  { type: 'generateBatch', requests: [{chunkX, chunkY}, ...] }

Worker → 主线程:
  { type: 'chunk', chunkX, chunkY, mapBuffers, grassBuffers }
  { type: 'batch', results: [{chunkX, chunkY, mapBuffers, grassBuffers}, ...] }
```

**生成流水线**（按优先级从低到高覆盖）：

1. **草地变体** — `GRASS_VARIANTS` 加权随机填充 `grassMap`
2. **水域** — 基于 `WATER_CONFIG.shoreX` 生成岸线和深水
3. **山坡** — FBM 噪声掩码 → BFS 连通分量分析 → 3×3 邻接分类
4. **道路** — 分种子点 → 随机游走路径 → 邻接方向解析为正确瓦片
5. **森林** — FBM 噪声阈值 + 密度梯度 → `FOREST_VARIANTS` 加权选择
6. **散落树木** — 确定性种子 + 聚集效应
7. **装饰物** — 石块 / 岩块 / 草丛分类型放置

**跨区块邻接**：道路和山坡的邻接判断通过"即时重算"策略（`quickRoadCheck` / `_isHill`），在 Worker 内部对相邻区块的边界瓦片做快速推算，而非等待相邻区块数据。

**数据传输**：使用 `Uint8Array.buffer` 的 **Transferable Objects** 零拷贝传输，避免序列化开销。

#### `chunk.js` — 区块系统（主线程侧）

| 类 | 职责 |
|---|---|
| `Chunk` | 数据结构：`{ chunkX, chunkY, map: Uint8Array[], grassMap: Uint8Array[] }` |
| `ChunkManager` | 缓存管理 + Worker 通信 + LRU 淘汰 |

`ChunkManager` 关键设计：

- **LRU 缓存**：利用 `Map` 的插入顺序特性（`delete + set` 将键移到末尾），实现 O(1) 的 LRU 更新和淘汰，替代了原来的 `Array + indexOf/splice` O(n) 实现
- **请求去重**：`_inflight` Set 防止同一区块重复请求 Worker
- **Promise 链式回调**：多个请求者等待同一区块时，`_pendingRequests` 中的 resolve 会被链式替换，所有等待者共享同一生成结果
- **批量请求**：`getChunksBatchAsync` 将多个区块生成请求合并为一次 `postMessage`，减少通信次数

#### `mapData.js` — 有限地图数据层（遗留兼容）

`MapData` 类为原始有限地图模式的数据层，封装了 `init / resize / addRoad / addTrees / addDecorations` 等操作。内部委托 `road.js`、`tree.js`、`decorations.js` 执行具体生成逻辑。在无限地图模式中不使用此类，但保留以兼容旧代码路径。

#### `road.js` / `tree.js` / `decorations.js` — 有限地图生成器

这三个模块为有限地图模式提供道路、树木、装饰物的生成功能，支持曼哈顿路径、Fisher-Yates 洗牌、聚集效应等。它们同时重新导出 `tileUtils.js` 中的判断函数，保持向后兼容。

#### `noise.js` — 桥接文件

仅做 `export { createNoise } from './utils'`，保持旧导入路径兼容。

---

### 3.3 渲染协调层

#### `renderer.js` — MapCanvasRenderer（协调者）

重构后的 `MapCanvasRenderer` 从原来 1100+ 行的"上帝类"瘦身为**纯协调层**，不再直接处理交互、坐标转换、纹理加载、船只逻辑，而是组合各子模块：

```
MapCanvasRenderer
  ├── _viewport: Viewport          // 视口状态 & 坐标转换
  ├── _interaction: InteractionController  // 拖拽/缩放/触摸
  ├── _shipFleet: ShipFleet        // 船队精灵管理
  ├── chunkManager: ChunkManager   // 区块缓存 & Worker 通信
  ├── textures: {}                 // (由 AssetLoader 填充)
  └── mapContainer: PIXI.Container // 根渲染容器
```

**核心渲染流程**：

1. `init(containerEl)` → 创建 PixiJS Application、注册交互控制器、注册 Worker 回调
2. `loadAssets()` → 委托 `AssetLoader.load()` 并行加载纹理
3. `renderInitial()` → 请求视口范围内区块，逐区块调用 `_renderChunkContainer`
4. 视口移动 → `_onViewportMoved()` → 请求新区块 + 节流重建装饰层

**区块容器渲染** (`_renderChunkContainer`)：

- 第一步：遍历区块瓦片，创建所有地面精灵（含草地底图、道路、水域等），装饰物精灵单独收集
- 第二步：将地面精灵组渲染到 `PIXI.RenderTexture`，然后销毁临时容器（**批量烘焙**优化）
- 第三步：用 `RenderTexture` 创建区块容器，缩放因子 `1/tileW` 使坐标统一为瓦片坐标系

**装饰层重建** (`_rebuildDecorLayer`)：

- 视口裁剪：只收集可见范围内的装饰物精灵
- Y 排序：按 `worldY` 排序实现正确的前后遮挡
- 节流：通过 `requestAnimationFrame` 去重，避免一帧内多次重建

**坐标体系**：

- 视口 `(viewport.x, viewport.y)` 使用**瓦片坐标**
- `mapContainer.scale = viewport.zoom * tileW`
- 区块容器位置 = `(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE)`（瓦片坐标）
- 所有精灵位置也使用瓦片坐标

#### `viewport.js` — Viewport

| 方法 | 职责 |
|---|---|
| `screenToWorldTile(sx, sy)` | 屏幕像素 → 世界瓦片坐标 |
| `getVisibleTileRange()` | 计算视口在瓦片坐标下的可见范围 |
| `applyTransform(container)` | 将视口变换应用到 PixiJS 容器 |
| `centerOn(x, y)` | 居中到指定世界瓦片坐标 |
| `reset()` | 重置到原点 |
| `getInfo(stats)` | 获取视口信息对象（供 UI 显示） |

**抽象要点**：视口状态 (`{ x, y, zoom }`) 与变换计算完全封装，渲染器只需调用 `applyTransform` 即可同步容器变换。

#### `interaction.js` — InteractionController

| 交互 | 实现 |
|---|---|
| 鼠标拖拽 | `mousedown → mousemove → mouseup`，像素偏移转瓦片偏移 |
| 滚轮缩放 | 缩放时保持鼠标指向的世界坐标不变（锚点缩放） |
| 触摸拖拽 | `touchstart → touchmove → touchend`，单指拖拽 |
| 瓦片悬停 | `mousemove` 时非拖拽状态触发 `onTileHover` 回调 |

**抽象要点**：通过构造函数注入 `getViewport / setViewport / onViewportMoved / screenToWorldTile` 回调，实现与渲染器的松耦合。控制器不持有 PIXI 引用，只操作原生 DOM 事件。

#### `assetLoader.js` — AssetLoader

| 方法 | 职责 |
|---|---|
| `static load()` | 并行加载所有 `TILE_ASSETS` 纹理，返回 `{ textures, tileSize }` |
| `static _createFallbackTexture(tileType)` | 加载失败时生成 64×64 纯色回退纹理 |

**抽象要点**：静态方法模式，无实例状态。失败自动降级，不阻塞渲染流程。

#### `ship.js` — Ship + ShipFleet

| 类 | 职责 |
|---|---|
| `Ship` | 单艘船精灵：航向移动、波浪漂移、边界反弹、碰撞检测 |
| `ShipFleet` | 船队管理器：批量生成、Ticker 驱动更新、碰撞检测 |

**Ship 行为模型**：

- **航向**：`heading` 角度 + 定期随机微调
- **波浪漂移**：`sin(driftPhase)` 产生 ±0.02 的微偏移
- **碰撞检测**：船与船之间的圆形碰撞，碰撞后反弹 + 随机偏转
- **边界反弹**：超出巡逻范围后朝中心方向随机偏转

**ShipFleet 管理**：

- 初始生成 15~25 艘船（35% 概率为海盗船）
- 分布策略：50% 靠近岸线、30% 中距离、20% 远洋
- `attachTicker / detachTicker` 管理 PIXI.Ticker 回调生命周期

---

### 3.4 React 层

#### `App.jsx` — 顶层组件

- 创建 `MapCanvasRenderer` 实例（通过 `useRef` 持有）
- 管理 HUD 信息面板（视口坐标、缩放、缓存区块数、悬停瓦片信息）
- 使用 `useMemo` / `useCallback` 避免不必要的重渲染

#### `MapCanvas.jsx` — 画布容器组件

- `forwardRef` + `useImperativeHandle` 暴露 `resetView / centerToOrigin / exportMap` 方法
- `useRef` 保存回调引用，避免闭包过时问题
- 生命周期：`useEffect` 中初始化渲染器，cleanup 中销毁
- 初始定位到岸线附近 (`centerOnShoreline`)，确保首次可见草地/沙滩/水域

#### `vite.config.js` — 构建配置

- **代码分割**：`manualChunks` 将 `pixi.js` 和 `react` 拆分为独立 chunk，利用浏览器缓存
- **Worker 模式**：`worker.format: 'es'` 确保 Worker 使用 ES Module

---

## 四、关键设计决策

### 4.1 无限地图 vs 有限地图

项目同时保留两套地图系统：

| 特性 | 无限地图（Chunk 系统） | 有限地图（MapData 系统） |
|---|---|---|
| 数据生成 | Web Worker 异步 | 主线程同步 |
| 地图大小 | 无限（按需生成） | 固定 MAP_W × MAP_H |
| 缓存策略 | LRU，自动淘汰 | 无（全量持有） |
| 渲染方式 | 区块 RenderTexture 烘焙 | 逐精灵渲染 |
| 入口 | `MapCanvasRenderer` + `ChunkManager` | `MapData` + `road/tree/decorations` |

### 4.2 RenderTexture 烘焙策略

每个区块的地面瓦片先渲染到临时 `PIXI.Container`，再通过 `app.renderer.render()` 烘焙到 `PIXI.RenderTexture`，最后销毁临时容器。好处：

- **减少 Draw Call**：一个区块只需 1 个 Sprite，而非 CHUNK_SIZE² 个
- **视口裁剪高效**：PixiJS 可直接跳过不可见的 Sprite
- **内存可控**：远离视口的区块容器被销毁时，RenderTexture 也一并释放

### 4.3 装饰物 Y 排序

树木、石块等装饰物需要正确的遮挡关系（南面的物体挡住北面的）。实现方式：

- 装饰物精灵不烘焙到 RenderTexture，而是放在独立的 `_decorContainer` 中
- 每次视口变化时，收集可见范围内的装饰物，按 `worldY` 排序后重新添加
- 通过 `requestAnimationFrame` 节流，避免频繁排序

### 4.4 确定性生成

整个世界的生成完全确定性：

- `WORLD_SEED` 作为全局种子
- 每个区块、每条道路、每棵树的位置都由种子派生的子种子决定
- 使用 `createSeededRandom` 和 `createNoise` 代替 `Math.random`
- 相同种子 → 相同世界，支持未来存档/多人同步

### 4.5 Worker 代码复用

Worker 通过 ESM `import` 直接引用主线程的公共模块：

```js
// chunkWorker.js
import { TILE, CHUNK_SIZE, ... } from './constants';
import { createNoise, createSeededRandom, ... } from './utils';
import { isRoadTile, isHillTile, ... } from './tileUtils';
```

Vite 的 `new URL('./chunkWorker.js', import.meta.url)` 语法支持 Worker 中使用 ESM import，构建时自动打包为独立文件。

---

## 五、文件索引

```
src/
├── main.jsx                    # React 入口
├── App.jsx                     # 顶层组件 + HUD
├── index.css                   # 全局样式
├── components/
│   └── MapCanvas.jsx           # 画布容器组件
└── map/
    ├── index.js                # 统一导出入口
    ├── constants.js            # 枚举/常量/配置
    ├── utils.js                # 噪声/随机/加权选择
    ├── tileUtils.js            # 瓦片类型判断
    ├── chunk.js                # Chunk + ChunkManager
    ├── chunkWorker.js          # Worker 区块生成器
    ├── mapData.js              # 有限地图数据层
    ├── road.js                 # 有限地图道路生成
    ├── tree.js                 # 有限地图树木生成
    ├── decorations.js          # 有限地图装饰物生成
    ├── noise.js                # 桥接文件（兼容旧路径）
    ├── viewport.js             # 视口管理
    ├── interaction.js          # 交互控制
    ├── assetLoader.js          # 素材加载
    ├── ship.js                 # Ship + ShipFleet
    └── renderer.js             # MapCanvasRenderer 协调层
```

---

## 六、数据流图

```
用户拖拽/缩放
      │
      ▼
InteractionController
      │ setViewport + onViewportMoved
      ▼
MapCanvasRenderer._onViewportMoved()
      │
      ├─→ Viewport.applyTransform(mapContainer)   ← 视觉更新
      ├─→ ChunkManager.loadVisibleChunks()         ← 请求新区块
      │         │
      │         ▼ (postMessage)
      │    chunkWorker.js
      │         │ (onmessage → Transferable)
      │         ▼
      │    ChunkManager._onWorkerMessage()
      │         │
      │         ▼
      │    MapCanvasRenderer._onChunkReady()
      │         │
      │         ▼
      │    _renderChunkContainer()  ← 创建 PIXI 容器
      │    _rebuildDecorLayer()     ← Y 排序装饰物
      │
      ├─→ ShipFleet.updateViewport()               ← 更新船队视口
      └─→ onViewportChange callback                ← 通知 React 层
```

---

## 七、性能优化清单

| 优化项 | 技术手段 | 位置 |
|---|---|---|
| 区块地面烘焙 | RenderTexture 批量渲染，减少 Draw Call | `renderer.js` `_renderChunkContainer` |
| 区块缓存 | Map 插入顺序实现 O(1) LRU 淘汰 | `chunk.js` `_touch / _addChunk` |
| Worker 通信零拷贝 | Transferable ArrayBuffer 传输 | `chunkWorker.js` `postMessage` |
| 批量区块请求 | `generateBatch` 减少通信次数 | `chunk.js` `getChunksBatchAsync` |
| 装饰层重建节流 | `requestAnimationFrame` 去重 | `renderer.js` `_onViewportMoved` |
| 视口裁剪 | 只渲染可见范围内的装饰物 | `renderer.js` `_rebuildDecorLayer` |
| 确定性噪声 | xxHash 整数哈希替代 `Math.sin` | `utils.js` `createNoise` |
| 素材并行加载 | `Promise.all` 并行 + 回退纹理 | `assetLoader.js` `load` |
| 代码分割 | Vite manualChunks 拆分 pixi/react | `vite.config.js` |
| React 重渲染优化 | `useMemo / useCallback / useRef` | `App.jsx / MapCanvas.jsx` |

---

## 八、扩展指南

### 新增瓦片类型

1. 在 `constants.js` 的 `TILE` 枚举中添加新类型
2. 在 `TILE_NAMES` / `TILE_COLORS` / `TILE_ASSETS` / `TILE_ROTATION` 中添加对应映射（优先用 `assignRange`）
3. 在 `tileUtils.js` 中添加类型判断函数
4. 在 `chunkWorker.js` 的生成流水线中添加生成逻辑
5. 在 `renderer.js` 的 `_renderChunkContainer` 中添加渲染分支

### 新增动态精灵（类似船）

1. 在 `ship.js` 同级创建新模块（如 `animal.js`）
2. 实现精灵类（含 `update(dt)` 方法）和管理器类（含 `container` + `attachTicker/detachTicker`）
3. 在 `renderer.js` 中组合新模块：构造时创建、`loadAssets` 后初始化、`destroy` 时清理
4. 在 `index.js` 中添加导出

### 切换到有限地图模式

1. 使用 `MapData` 类替代 `ChunkManager`
2. 调用 `mapData.init().addRoad().addTrees().addDecorations()` 生成数据
3. 在渲染器中直接遍历 `mapData.map` 创建精灵（无需区块/Worker）

---

## 九、技术栈版本

| 依赖 | 版本 | 用途 |
|---|---|---|
| `pixi.js` | ^7.4.3 | WebGL 2D 渲染引擎 |
| `react` | ^19.2.6 | UI 组件框架 |
| `react-dom` | ^19.2.6 | React DOM 渲染器 |
| `vite` | ^8.0.12 | 构建工具 + 开发服务器 |
| `@vitejs/plugin-react` | ^6.0.1 | Vite React 插件 |
| `eslint` | ^10.3.0 | 代码检查 |
