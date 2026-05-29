/**
 * 噪声工具 - 用于地图地形生成
 */

export function createNoise(seed) {
  function hash(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  }

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

    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  }

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
