/**
 * 公共工具函数
 * 统一噪声、随机数、加权随机等工具，供主线程和 Worker 共同使用
 */

// ────────────────────────────────────────────
// 噪声生成器
// ────────────────────────────────────────────

/**
 * 创建噪声生成器
 * 使用整数哈希替代 Math.sin，性能更好、分布更均匀
 * @param {number} seed - 随机种子
 * @returns {{ hash: Function, smooth: Function, fbm: Function }}
 */
export function createNoise(seed) {
  /**
   * 整数哈希函数（基于 xxHash 变体）
   * 比 Math.sin 哈希更快、分布更均匀
   */
  function hash(x, y) {
    let h = seed;
    h ^= x * 374761393;
    h = (h + 0x100000000) & 0xffffffff; // 保持32位无符号
    h ^= y * 668265263;
    h = (h + 0x100000000) & 0xffffffff;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h + 0x100000000) & 0xffffffff;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 0xffffffff;
  }

  /**
   * 平滑插值噪声
   */
  function smooth(x, y, scale) {
    const sx = x / scale;
    const sy = y / scale;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const fx = sx - ix;
    const fy = sy - iy;

    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    // Hermite 平滑插值
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  }

  /**
   * 分形布朗运动（FBM）
   */
  function fbm(x, y, octaves = 5, lacunarity = 2, persistence = 0.5) {
    let val = 0;
    let amp = 1;
    let freq = 1;
    let ampSum = 0;
    for (let i = 0; i < octaves; i++) {
      val += smooth(x * freq, y * freq, 40) * amp;
      ampSum += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return val / ampSum;
  }

  return { hash, smooth, fbm };
}

// ────────────────────────────────────────────
// 确定性随机数生成器
// ────────────────────────────────────────────

/**
 * 创建确定性伪随机数生成器
 * 使用线性同余法（LCG），保证相同种子产生相同序列
 * @param {number} seed - 随机种子
 * @returns {Function} 返回 0~1 之间的随机数函数
 */
export function createSeededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ────────────────────────────────────────────
// 加权随机选择
// ────────────────────────────────────────────

/**
 * 构建累积权重表（用于加权随机选择）
 * @param {Array<{tile: number, weight: number}>} variants - 变体权重数组
 * @returns {{ cumWeights: Array<{tile: number, cum: number}>, totalWeight: number }}
 */
export function buildCumWeights(variants) {
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  const cumWeights = [];
  let cum = 0;
  for (const v of variants) {
    cum += v.weight;
    cumWeights.push({ tile: v.tile, cum });
  }
  return { cumWeights, totalWeight };
}

/**
 * 加权随机选择
 * @param {Array<{tile: number, cum: number}>} cumWeights - 累积权重表
 * @param {number} totalWeight - 总权重
 * @param {Function} random - 随机数函数（0~1）
 * @returns {number} 选中的 TILE 枚举值
 */
export function weightedRandom(cumWeights, totalWeight, random) {
  const r = random() * totalWeight;
  for (const { tile, cum } of cumWeights) {
    if (r < cum) return tile;
  }
  return cumWeights[cumWeights.length - 1].tile;
}
