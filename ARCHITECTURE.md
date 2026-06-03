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
| 状态管理 | Zustand 5 |
| ECS 框架 | bitECS 0.4 |
| 事件总线 | mitt 3 |
| 后台计算 | Web Worker（ES Module 模式） |

核心目标：在浏览器中渲染一张**无限大、程序化生成**的 2D 瓦片地图，支持拖拽平移、滚轮缩放、动态船队，并保证 60fps 流畅交互。

---

## 二、整体架构分层

```
┌───────────────────────────────────────────────────────────────┐
│                     React 层                                  │
│   App.jsx → MapCanvas.jsx (ref 桥接)                          │
│   Zustand store → 事件总线桥接                                 │
├───────────────────────────────────────────────────────────────┤
│                  渲染协调层                                    │
│              MapCanvasRenderer                                │
│        (组合子模块，不处理底层细节)                               │
├────────┬────────┬────────┬────────┬────────┬────────┬────────┤
│Viewport│Interac-│Asset   │Ship    │Chunk   │ Tile   │ LOD    │
│        │tion    │Loader  │Fleet   │Manager │ Utils  │Manager │
│视口状态 │交互控制 │纹理加载 │ECS船队 │区块缓存 │类型判断 │精度管理 │
│坐标转换 │拖拽缩放 │渐进加载 │碰撞检测 │Worker  │统一逻辑 │LOD切换 │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┤
│Atlas   │Object  │Decor   │Spatial │Event   │Game    │        │
│Builder │Pool    │Spatial │Hash    │Bus     │Store   │        │
│图集构建 │对象复用 │Index   │空间哈希 │事件解耦 │全局状态 │        │
│纹理合并 │GC优化   │Y排序优化│碰撞加速 │发布订阅 │Zustand │        │
├────────┴────────┴────────┴────────┴────────┴────────┴────────┤
│                    数据生成层                                   │
│            chunkWorker.js (Web Worker)                         │
│    水域 → 山坡 → 道路 → 森林 → 散落树 → 装饰物                  │
├───────────────────────────────────────────────────────────────┤
│                    公共基础层                                   │
│   constants.js │ utils.js │ tileUtils.js                      │
│   枚举/常量      噪声/随机   类型判断                            │
└───────────────────────────────────────────────────────────────┘
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
  ├── _viewport: Viewport                // 视口状态 & 坐标转换
  ├── _interaction: InteractionController // 拖拽/缩放/触摸
  ├── _shipFleet: ShipFleetECS           // ECS 船队管理
  ├── _lod: LODManager                   // LOD 精度管理
  ├── _decorIndex: DecorSpatialIndex     // 装饰物空间索引
  ├── _spritePool / _containerPool       // 对象池（复用精灵/容器）
  ├── chunkManager: ChunkManager         // 区块缓存 & Worker 通信
  ├── textures: {}                       // (由 AssetLoader 填充)
  ├── _atlasTexture                      // 图集纹理引用
  └── mapContainer: PIXI.Container       // 根渲染容器
```

**核心渲染流程**：

1. `init(containerEl)` → 创建 PixiJS Application、注册交互控制器、注册 Worker 回调
2. `loadAssets()` → 委托 `AssetLoader.load()` 渐进式加载纹理（critical → high → normal → low）
3. `renderInitial()` → 请求视口范围内区块，逐区块调用 `_renderChunkContainer`
4. 视口移动 → `_onViewportMoved()` → 请求新区块 + 更新 LOD + 节流重建装饰层

**区块容器渲染** (`_renderChunkContainer`)：

- 第一步：从对象池获取精灵，遍历区块瓦片创建所有地面精灵（含草地底图、道路、水域等），装饰物精灵单独收集并注册到 `DecorSpatialIndex`
- 第二步：将地面精灵组渲染到 `PIXI.RenderTexture`，然后归还精灵到对象池（**批量烘焙**优化）
- 第三步：用 `RenderTexture` 创建区块容器（从容器池获取），缩放因子 `1/tileW` 使坐标统一为瓦片坐标系

**装饰层重建** (`_rebuildDecorLayer`)：

- 空间索引查询：通过 `DecorSpatialIndex.queryRange()` 只查询视口可见范围内的装饰物
- 可见性控制：精灵只在首次创建时 `addChild`，通过 `sprite.visible` 控制显隐，避免每帧 `removeChildren + addChild`
- Y 排序：通过 `zIndex` 属性 + `sortableChildren` 实现正确的前后遮挡
- LOD 联动：低精度级别时隐藏小装饰物或整个装饰层
- 节流：通过 `requestAnimationFrame` 去重，避免一帧内多次重建

**LOD 管理联动**：

- 每次视口移动时调用 `_lod.update(zoom)` 检测 LOD 级别变化
- LOD 级别变化时调用 `_rerenderAllChunks()` 以新的 RenderTexture 分辨率重新渲染所有区块
- LOD 2（Low）时隐藏整个装饰层

**渐进式纹理加载**：

- `loadAssets()` 返回后，后续纹理批次通过 `_onTexturesBatchReady()` 回调处理
- `high` 批次就绪时刷新可见区块；`normal` 批次就绪时重建装饰层
- `low` 批次就绪时更新船精灵纹理；`complete` 时全量重渲染并重建图集

**坐标体系**：

- 视口 `(viewport.x, viewport.y)` 使用**瓦片坐标**
- `mapContainer.scale = viewport.zoom * tileW`
- 区块容器位置 = `(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE)`（瓦片坐标）
- 所有精灵位置也使用瓦片坐标

**事件总线集成**：

- 视口移动、瓦片悬停等事件通过 `gameEvents.emit()` 广播
- React 层通过 `eventBus → Zustand` 桥接自动同步状态

#### `viewport.js` — Viewport

| 方法 | 职责 |
|---|---|
| `screenToWorldTile(sx, sy)` | 屏幕像素 → 世界瓦片坐标 |
| `getVisibleTileRange()` | 计算视口在瓦片坐标下的可见范围 |
| `applyTransform(container)` | 将视口变换应用到 PixiJS 容器 |
| `centerOn(x, y)` | 居中到指定世界瓦片坐标 |
| `reset()` | 重置到原点 |
| `getInfo(stats)` | 获取视口信息对象（供 UI 显示） |
| `updateTileSize(tileSize)` | 更新瓦片像素尺寸（纹理加载后可能变化） |

**抽象要点**：视口状态 (`{ x, y, zoom }`) 与变换计算完全封装，渲染器只需调用 `applyTransform` 即可同步容器变换。

#### `interaction.js` — InteractionController

| 交互 | 实现 |
|---|---|
| 鼠标拖拽 | `mousedown → mousemove → mouseup`，像素偏移转瓦片偏移 |
| 滚轮缩放 | 缩放时保持鼠标指向的世界坐标不变（锚点缩放） |
| 触摸拖拽 | `touchstart → touchmove → touchend`，单指拖拽 |
| 瓦片悬停 | `mousemove` 时非拖拽状态触发 `onTileHover` 回调 |

**抽象要点**：通过构造函数注入 `getViewport / setViewport / onViewportMoved / screenToWorldTile` 回调，实现与渲染器的松耦合。控制器不持有 PIXI 引用，只操作原生 DOM 事件。

#### `assetLoader.js` — AssetLoader（渐进式加载版）

| 方法 | 职责 |
|---|---|
| `static load(options)` | 分优先级加载纹理，支持渐进式模式和图集构建 |
| `static addPreloadHints()` | 为 critical 纹理添加 `<link rel="preload">` 提示 |
| `static removePreloadHints(links)` | 清除 preload 提示 |
| `static _createFallbackTexture(tileType)` | 加载失败时生成 64×64 纯色回退纹理 |
| `static _loadBatch(entries, target)` | 并行加载一批纹理 |
| `static _loadRemainingBatches(...)` | 后台加载后续优先级批次 |
| `static _buildAtlas(rawTextures, useAtlas, renderer)` | 调用 AtlasBuilder 构建精灵图集 |

**加载优先级分组**：

| 优先级 | 包含瓦片 | 说明 |
|---|---|---|
| `critical` | 草地、水 | 必须加载完才开始渲染 |
| `high` | 道路、沙滩、石板路 | 结构纹理，第二批加载 |
| `normal` | 树、石块、岩块、草丛、浆果 | 装饰物纹理，第三批加载 |
| `low` | 山坡、船 | 使用频率低，最后加载 |

**渐进式加载流程**：

1. 为所有瓦片类型生成回退色块纹理
2. 并行加载 `critical` 纹理 → 替换回退色块 → 构建初始图集 → **立即返回**
3. 后台依次加载 `high → normal → low` 批次，每批就绪后通过 `onBatchReady` 回调通知
4. 所有批次完成后，重新构建包含全部纹理的完整图集，通过 `complete` 回调通知

**抽象要点**：渐进式模式下 critical 纹理就绪后立即返回，后续批次在 `requestAnimationFrame` 调度中加载，不阻塞渲染。图集构建集成在加载流程中，加载完成自动合并。

#### `atlasBuilder.js` — AtlasBuilder（精灵图集构建器）

| 方法 | 职责 |
|---|---|
| `static build(rawTextures)` | 从原始纹理映射构建精灵图集（Canvas 方式） |
| `static buildWithRenderer(rawTextures, renderer)` | 使用 PIXI RenderTexture 构建图集（更可靠） |

**工作原理**：

1. 接收 `{ tileType → Texture }` 映射
2. 使用 `RowPacker`（行优先矩形装箱算法）将所有纹理排列到一张大 Canvas 上
3. 按高度降序排列，减少碎片
4. 估算图集宽度（面积平方根 × 1.5，对齐到 2 的幂）
5. 从 Canvas 或 RenderTexture 生成单一 `PIXI.Texture`，再为每个 tileType 创建子帧纹理
6. 图集超出 `MAX_ATLAS_SIZE`（4096）时自动回退到独立纹理

**性能收益**：

- WebGL 纹理绑定从 N 次降低到 1 次（同一图集内的精灵共享纹理）
- 渲染批次合并：PixiJS 可将同图集精灵批量提交
- 纹理间 2px 间距防止渗透/bleeding

#### `ecs.js` — ECS 架构层（基于 bitECS）

将船实体从 OOP 的 `Ship` 类拆分为**数据组件 + 逻辑系统**模式。

**组件清单**：

| 组件 | 字段 | 用途 |
|---|---|---|
| `Position` | `x, y` (f32) | 世界坐标 |
| `Velocity` | `vx, vy` (f32) | 速度向量 |
| `PatrolBounds` | `minX, maxX, minY, maxY` (f32) | 巡逻范围 |
| `ShipSprite` | `spriteIndex` (i32), `tileType` (ui8) | 渲染相关 |
| `Navigating` | `heading, speed, turnTimer, turnInterval, driftPhase` (f32) | 航行行为 |

**系统清单**：

| 系统 | 职责 |
|---|---|
| `navigationSystem` | 航行更新：定期转向、波浪漂移、边界反弹 |
| `collisionSystem` | 碰撞检测与推离（使用 SpatialHash 加速） |
| `spriteSyncSystem` | 将 ECS 数据同步到 PIXI 精灵位置/旋转 |

**ShipFleetECS 类**：

- 基于 bitECS 的 `createWorld` 创建 ECS 世界
- `_spriteRefs` 数组维护精灵引用，与 ECS 的 `ShipSprite.spriteIndex` 对应
- `attachTicker(ticker)` 注册 PIXI.Ticker 驱动 ECS 系统循环
- `updateTextures(textures)` 支持渐进式纹理替换
- `destroy()` 时清理所有精灵和 ECS 实体

**抽象要点**：bitECS 的 SoA（Structure of Arrays）内存布局对缓存友好，大量实体时性能远超 OOP。查询（Query）自动维护匹配实体集，无需手动管理列表。碰撞检测使用 `SpatialHash` 替代 O(n²) 暴力检测。

#### `ship.js` — Ship + ShipFleet（OOP 版本，兼容保留）

| 类 | 职责 |
|---|---|
| `Ship` | 单艘船精灵：航向移动、波浪漂移、边界反弹、碰撞检测 |
| `ShipFleet` | 船队管理器：批量生成、Ticker 驱动更新 |

> **注意**：当前 `renderer.js` 已切换使用 `ShipFleetECS`（从 `ecs.js` 导入），`ship.js` 中的 OOP 版本保留用于兼容和参考。

#### `lodManager.js` — LODManager（精度管理器）

| LOD 级别 | 缩放范围 | RenderTexture 分辨率 | 装饰物 | 小装饰物 | 裁剪余量 |
|---|---|---|---|---|---|
| 0 (Full) | zoom ≥ 0.7 | 1.0 | 显示 | 显示 | 3 |
| 1 (Medium) | zoom ≥ 0.4 | 0.75 | 显示 | 隐藏 | 2 |
| 2 (Low) | zoom < 0.4 | 0.5 | 隐藏 | 隐藏 | 0 |

| 方法 / 属性 | 职责 |
|---|---|
| `update(zoom)` | 根据缩放值更新 LOD 级别，返回是否发生变化 |
| `shouldRenderTile(tileType, isTreeTile, isDecorationTile)` | 判断指定瓦片是否应在当前 LOD 下渲染 |
| `level / config / levelChanged / showDecorations / showSmallDecor / resolution / decorMargin` | 当前 LOD 状态属性 |

**抽象要点**：LOD 级别变化时由渲染器触发全量区块重渲染，以调整 RenderTexture 分辨率。低精度时装饰物精灵数量减少 50-80%，Draw Call 大幅下降。

#### `objectPool.js` — ObjectPool（通用对象池）

| 导出 | 类型 | 用途 |
|---|---|---|
| `ObjectPool` | 类 | 通用对象池，复用任意对象避免 GC 压力 |
| `createSpritePool(options)` | 工厂函数 | 创建 `PIXI.Sprite` 对象池（maxSize: 2048） |
| `createContainerPool(options)` | 工厂函数 | 创建 `PIXI.Container` 对象池（maxSize: 256） |

**ObjectPool 关键设计**：

- `acquire()` — 从池中获取对象，池空则创建新对象
- `release(obj)` — 归还对象到池中（先调用 `reset` 回调重置状态），池满则调用 `destroy` 销毁
- `acquireBatch(count)` / `releaseBatch(objects)` — 批量获取/归还
- `warmup(count)` — 预热池，提前创建对象
- `prealloc` 选项 — 构造时预分配指定数量

**使用场景**：

- 区块渲染时大量临时精灵创建（地面精灵组烘焙到 RenderTexture 后归还）
- 区块容器创建/销毁时的容器复用
- 装饰物精灵从空间索引移除时归还池

#### `decorSpatialIndex.js` — DecorSpatialIndex（装饰层空间索引）

| 方法 | 职责 |
|---|---|
| `insert(chunkKey, entry)` | 插入装饰物条目，按行分组存储 |
| `removeChunk(chunkKey)` | 移除指定区块的所有装饰物，返回被移除条目 |
| `queryRange(minX, maxX, minY, maxY, options)` | 查询可见范围内装饰物，支持 LOD 过滤 |
| `clear()` | 清空所有索引数据 |

**数据结构**：

- `_rows: Map<rowY, DecorEntry[]>` — 按行分组，行内按 worldX 有序
- `_chunkRows: Map<chunkKey, Set<rowY>>` — 区块到行映射，用于区块移除时快速清理

**优化效果**：

- 替代 `_rebuildDecorLayer` 中的 O(all_decors) 全量遍历 + O(n log n) 排序
- 优化为 O(visible_rows × avg_per_row) 的范围查询 + O(visible) 排序
- 行间已大致有序，insertion sort 在部分有序数据上接近 O(n)

**LOD 过滤**：`queryRange` 的 `options.hideSmallDecor` 参数支持在 LOD 1+ 时过滤掉非树木装饰物。

#### `spatialHash.js` — SpatialHash（空间哈希表）

| 方法 | 职责 |
|---|---|
| `insert(entity, x, y)` | 插入实体到空间哈希 |
| `query(x, y, radius)` | 查询指定位置附近的所有实体 |
| `queryCollisionPairs(collisionRadius)` | 查询所有碰撞对（每对只返回一次） |
| `clear()` | 清空所有数据（每帧重建前调用） |

**设计要点**：

- 将空间划分为固定大小网格单元格（默认 4 瓦片）
- 碰撞检测从 O(n²) 降为 O(n) 平均
- 碰撞对查询先检查单元格内部，再检查 4 个方向的相邻单元格
- 每帧清空重建，避免过期数据

**使用场景**：ECS `collisionSystem` 中用于船只碰撞检测，每帧重建哈希表。

#### `eventBus.js` — 全局事件总线（基于 mitt）

| 导出 | 用途 |
|---|---|
| `gameEvents` | mitt 事件发射器实例 |
| `GameEvent` | 事件类型常量对象 |

**事件清单**：

| 事件常量 | 事件名 | 触发时机 |
|---|---|---|
| `VIEWPORT_MOVED` | `viewport:moved` | 视口位置/缩放变化 |
| `VIEWPORT_INFO` | `viewport:info` | 视口信息定时上报（供 HUD 显示） |
| `CHUNK_READY` | `chunk:ready` | 区块数据生成完毕 |
| `CHUNK_RENDERED` | `chunk:rendered` | 区块容器渲染完毕 |
| `CHUNK_REMOVED` | `chunk:removed` | 区块容器被移除 |
| `DECOR_REBUILD` | `decor:rebuild` | 装饰层需要重建 |
| `SHIP_COLLISION` | `ship:collision` | 船只碰撞事件 |
| `TILE_HOVER` | `tile:hover` | 瓦片悬停 |
| `ASSET_LOADED` | `asset:loaded` | 素材加载完成 |

**抽象要点**：通过事件总线解耦渲染器和 UI 层。渲染器只负责 `emit`，React 组件通过 `gameStore` 的事件桥接自动接收状态更新，无需手动注册/清理回调。

#### `gameStore.js` — Zustand 游戏状态管理

| 导出 | 用途 |
|---|---|
| `useGameStore` | Zustand store hook |
| `startEventBridge()` | 启动事件总线 → Zustand 桥接 |
| `stopEventBridge()` | 停止事件总线 → Zustand 桥接 |

**状态定义**：

| 状态 | 类型 | 说明 |
|---|---|---|
| `viewportInfo` | `object \| null` | 视口信息（坐标、缩放、缓存区块数） |
| `hoveredTile` | `object \| null` | 悬停瓦片 `{ tileX, tileY, tileType }` |
| `loading` | `boolean` | 是否正在加载 |

**事件桥接**：

- `VIEWPORT_INFO` 事件 → `setViewportInfo`
- `TILE_HOVER` 事件 → `setHoveredTile`
- MapCanvas 初始化时调用 `startEventBridge()`，销毁时调用 `stopEventBridge()`

**抽象要点**：统一状态源，避免 React 回调闭包过时问题。组件外可直接读写状态（事件总线回调中无需 useRef hack）。Zustand 自动 selector 优化，减少不必要的 re-render。

---

### 3.4 React 层

#### `App.jsx` — 顶层组件

- 使用 Zustand `useGameStore` 的 selector 精确订阅 `viewportInfo` 和 `hoveredTile`
- MapCanvas 不再需要回调 props，状态通过事件总线 + Zustand 自动同步
- 管理 HUD 信息面板（视口坐标、缩放、缓存区块数、悬停瓦片信息）
- 使用 `useMemo` 避免配置对象每次渲染重新创建

#### `MapCanvas.jsx` — 画布容器组件

- `forwardRef` + `useImperativeHandle` 暴露 `resetView / centerToOrigin / exportMap` 方法
- 初始化时调用 `startEventBridge()` 启动事件→Zustand桥接
- 使用 Zustand `loading` 状态控制加载动画显示
- 生命周期：`useEffect` 中初始化渲染器，cleanup 中 `stopEventBridge()` + 销毁渲染器
- 视口信息通过 Ticker 每 10 帧上报到事件总线，由桥接自动同步到 Zustand
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

每个区块的地面瓦片先渲染到临时 `PIXI.Container`，再通过 `app.renderer.render()` 烘焙到 `PIXI.RenderTexture`，最后归还临时精灵到对象池。好处：

- **减少 Draw Call**：一个区块只需 1 个 Sprite，而非 CHUNK_SIZE² 个
- **视口裁剪高效**：PixiJS 可直接跳过不可见的 Sprite
- **内存可控**：远离视口的区块容器被销毁时，RenderTexture 也一并释放
- **LOD 联动**：RenderTexture 分辨率可随 LOD 级别调整，低精度时降低 GPU 开销

### 4.3 装饰物 Y 排序（空间索引优化）

树木、石块等装饰物需要正确的遮挡关系（南面的物体挡住北面的）。实现方式：

- 装饰物精灵不烘焙到 RenderTexture，而是放在独立的 `_decorContainer` 中
- 使用 `DecorSpatialIndex` 按行分组索引，视口变化时通过 `queryRange()` 只查询可见范围
- 查询结果按 `worldY` 排序后，通过 `zIndex` 属性控制绘制顺序
- 精灵只在首次创建时 `addChild`，通过 `sprite.visible` 控制显隐，避免频繁 DOM 操作
- LOD 联动：低精度时自动过滤小装饰物

### 4.4 ECS 架构（Ship → ShipFleetECS）

船只管理从 OOP 模式迁移到 ECS 架构：

| 特性 | OOP (Ship + ShipFleet) | ECS (ShipFleetECS) |
|---|---|---|
| 数据存储 | 实例属性 | SoA 连续内存（bitECS TypedArray） |
| 逻辑组织 | 方法内联 | 独立系统函数 |
| 碰撞检测 | O(n²) 暴力遍历 | SpatialHash O(n) 平均 |
| 扩展性 | 需修改类 | 新增组件 + 系统 |
| 内存效率 | 分散堆分配 | 缓存友好的连续数组 |

**ECS 系统执行顺序**：`navigationSystem → collisionSystem → spriteSyncSystem`，在 PIXI.Ticker 回调中每帧执行。

### 4.5 渐进式纹理加载

素材加载分为 4 个优先级批次（critical → high → normal → low），critical 就绪后立即开始渲染：

1. 所有瓦片先使用回退色块纹理占位
2. Critical 纹理（草地、水）加载后构建初始图集，立即返回
3. 后续批次在 `requestAnimationFrame` 间异步加载
4. 每批就绪后通知渲染器替换对应精灵的纹理
5. 全部完成后重建完整图集，一次性替换所有纹理引用

### 4.6 精灵图集合并

`AtlasBuilder` 将所有独立瓦片纹理动态合并为一张大图集（Spritesheet）：

- **矩形装箱**：`RowPacker` 行优先排列，按高度降序减少碎片
- **2 的幂对齐**：图集宽高对齐到 2 的幂，有利于 GPU 效率
- **防渗透**：纹理间 2px 间距防止 bleeding
- **安全上限**：超过 `MAX_ATLAS_SIZE`（4096）时自动回退到独立纹理
- **双重构建**：`build()` 使用 Canvas，`buildWithRenderer()` 使用 PIXI RenderTexture

### 4.7 事件总线 + Zustand 状态管理

渲染器与 UI 层通过事件总线解耦：

```
渲染器 (emit)  →  事件总线 (mitt)  →  Zustand 桥接  →  React 组件 (selector)
```

- 渲染器只负责 `gameEvents.emit()`，不持有 React 引用
- `gameStore.js` 中的 `startEventBridge()` 将事件自动同步到 Zustand
- React 组件使用 `useGameStore(selector)` 精确订阅，避免不必要的 re-render
- 桥接在 MapCanvas 生命周期中自动启停

### 4.8 确定性生成

整个世界的生成完全确定性：

- `WORLD_SEED` 作为全局种子
- 每个区块、每条道路、每棵树的位置都由种子派生的子种子决定
- 使用 `createSeededRandom` 和 `createNoise` 代替 `Math.random`
- 相同种子 → 相同世界，支持未来存档/多人同步

### 4.9 Worker 代码复用

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
├── App.jsx                     # 顶层组件 + HUD（Zustand 订阅）
├── index.css                   # 全局样式
├── components/
│   └── MapCanvas.jsx           # 画布容器组件（事件桥接）
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
    ├── assetLoader.js          # 渐进式素材加载
    ├── atlasBuilder.js         # 精灵图集构建器
    ├── ecs.js                  # ECS 架构层（bitECS）
    ├── ship.js                 # Ship + ShipFleet（OOP 版本，兼容保留）
    ├── spatialHash.js          # 空间哈希（碰撞检测加速）
    ├── lodManager.js           # LOD 精度管理
    ├── objectPool.js           # 通用对象池
    ├── decorSpatialIndex.js    # 装饰物空间索引
    ├── eventBus.js             # 全局事件总线（mitt）
    ├── gameStore.js            # Zustand 全局状态 + 事件桥接
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
      ├─→ Viewport.applyTransform(mapContainer)       ← 视觉更新
      ├─→ LODManager.update(zoom)                     ← LOD 级别检测
      │       │ (LOD 变化)
      │       ▼
      │    _rerenderAllChunks()                        ← 调整 RenderTexture 分辨率
      ├─→ ChunkManager.loadVisibleChunks()             ← 请求新区块
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
      │         ├─→ _renderChunkContainer()            ← 创建 PIXI 容器（对象池）
      │         │    ├─→ DecorSpatialIndex.insert()    ← 注册装饰物到空间索引
      │         │    └─→ ObjectPool.acquire/release    ← 精灵复用
      │         │
      │         └─→ _rebuildDecorLayer()               ← Y 排序装饰物
      │              ├─→ DecorSpatialIndex.queryRange() ← 空间查询
      │              └─→ sprite.visible / zIndex        ← 可见性+排序
      │
      ├─→ ShipFleetECS (ECS Ticker)                   ← 船只更新
      │    ├─→ navigationSystem                        ← 航行逻辑
      │    ├─→ collisionSystem (SpatialHash)           ← 碰撞检测
      │    └─→ spriteSyncSystem                        ← 精灵同步
      │
      └─→ gameEvents.emit(VIEWPORT_MOVED/INFO)        ← 通知 UI 层
               │
               ▼
          eventBus (mitt)
               │
               ▼
          gameStore (Zustand 桥接)
               │
               ▼
          React 组件 (selector 订阅)
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
| 装饰物空间索引 | `DecorSpatialIndex` 替代全量遍历+排序 | `renderer.js` `_rebuildDecorLayer` |
| 装饰物可见性控制 | `sprite.visible` 替代 `removeChildren+addChild` | `renderer.js` `_rebuildDecorLayer` |
| LOD 精度管理 | 缩放级别自适应 RenderTexture 分辨率和装饰物显示 | `lodManager.js` + `renderer.js` |
| 对象池复用 | `ObjectPool` 复用精灵/容器，减少 GC 压力 | `renderer.js` + `objectPool.js` |
| 精灵图集合并 | `AtlasBuilder` 将独立纹理合并为一张大图集 | `assetLoader.js` + `atlasBuilder.js` |
| 渐进式加载 | 按优先级分批加载纹理，critical 就绪后立即渲染 | `assetLoader.js` |
| preload 提示 | `<link rel="preload">` 加速 critical 纹理下载 | `assetLoader.js` `addPreloadHints` |
| ECS SoA 内存布局 | bitECS 连续数组缓存友好 | `ecs.js` |
| 空间哈希碰撞检测 | `SpatialHash` 替代 O(n²) 暴力检测 | `ecs.js` `collisionSystem` |
| 确定性噪声 | xxHash 整数哈希替代 `Math.sin` | `utils.js` `createNoise` |
| 代码分割 | Vite manualChunks 拆分 pixi/react | `vite.config.js` |
| React 重渲染优化 | Zustand selector + useMemo / useCallback | `App.jsx / MapCanvas.jsx` |
| 事件总线解耦 | mitt 发布/订阅，避免直接回调闭包问题 | `eventBus.js` + `gameStore.js` |

---

## 八、扩展指南

### 新增瓦片类型

1. 在 `constants.js` 的 `TILE` 枚举中添加新类型
2. 在 `TILE_NAMES` / `TILE_COLORS` / `TILE_ASSETS` / `TILE_ROTATION` 中添加对应映射（优先用 `assignRange`）
3. 在 `tileUtils.js` 中添加类型判断函数
4. 在 `chunkWorker.js` 的生成流水线中添加生成逻辑
5. 在 `renderer.js` 的 `_renderChunkContainer` 中添加渲染分支
6. 在 `assetLoader.js` 的 `LOAD_PRIORITY` 中分配加载优先级

### 新增动态精灵（ECS 模式）

1. 在 `ecs.js` 中定义新组件（`defineComponent`）和新查询（`defineQuery`）
2. 实现新系统函数（含 `update(dt)` 逻辑）
3. 在 `ShipFleetECS` 或新建管理器类中组合组件和系统
4. 在 `renderer.js` 中组合新模块：构造时创建、Ticker 中更新、`destroy` 时清理
5. 在 `index.js` 中添加导出

### 新增 LOD 级别

1. 在 `lodManager.js` 的 `LOD_TABLE` 中添加新级别配置
2. 在 `LOD_THRESHOLDS` 中添加对应的 zoom 阈值
3. 在 `renderer.js` 的 `_onViewportMoved` 中处理新级别的特殊逻辑（如需要）

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
| `zustand` | ^5.0.14 | 轻量状态管理 |
| `bitecs` | ^0.4.0 | ECS 架构框架（SoA 内存布局） |
| `mitt` | ^3.0.1 | 事件总线（发布/订阅） |
| `eslint` | ^10.3.0 | 代码检查 |
