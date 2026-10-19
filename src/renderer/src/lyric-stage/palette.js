// 从封面取色：把封面缩到 48px 画到 canvas，统计颜色，挑出主色和亮色。
// 网易云的封面图允许跨域（Access-Control-Allow-Origin: *），canvas 才读得到像素。

/**
 * @typedef {[number, number, number]} RGB
 * @typedef {object} Palette
 * @property {RGB} dominant 出现最多的颜色
 * @property {RGB} vibrant 饱和度高、比较亮的颜色（强调色）
 * @property {RGB} dark 主色压暗，适合当背景配白字
 * @property {boolean} isDark 主色是不是深色
 */

const SIZE = 48;
/** @type {Map<string, Promise<Palette>>} */
const cache = new Map();

/** @type {Palette} */
export const FALLBACK_PALETTE = {
  dominant: [40, 44, 52],
  vibrant: [255, 90, 118],
  dark: [24, 26, 32],
  isDark: true,
};

export const rgb = ([r, g, b], alpha = 1) =>
  alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;

function toHsl([r, g, b]) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** 把颜色压暗到亮度不超过 maxL（配白字时对比度够） */
function darken(color, maxL = 0.22) {
  const { l } = toHsl(color);
  if (l <= maxL) return color;
  const k = maxL / l;
  return /** @type {RGB} */ (color.map(c => Math.round(c * k)));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('封面加载失败'));
    img.src = url;
  });
}

/**
 * 统计颜色：每个通道量化成 16 级分桶，数量多的桶是主色；
 * 饱和度 × 数量最高、亮度适中的桶当强调色
 * @param {Uint8ClampedArray} data
 * @returns {Palette}
 */
export function paletteFromPixels(data) {
  /** @type {Map<number, { count: number, sum: RGB }>} */
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bucket.count += 1;
    bucket.sum[0] += r;
    bucket.sum[1] += g;
    bucket.sum[2] += b;
    buckets.set(key, bucket);
  }
  if (buckets.size === 0) return FALLBACK_PALETTE;

  const colors = [...buckets.values()].map(({ count, sum }) => ({
    count,
    color: /** @type {RGB} */ (sum.map(v => Math.round(v / count))),
  }));
  colors.sort((a, b) => b.count - a.count);
  const dominant = colors[0].color;

  let vibrant = dominant;
  let best = -1;
  for (const { count, color } of colors) {
    const { s, l } = toHsl(color);
    if (l < 0.25 || l > 0.8) continue;
    const score = s * s * Math.sqrt(count);
    if (score > best) {
      best = score;
      vibrant = color;
    }
  }

  return {
    dominant,
    vibrant,
    dark: darken(dominant),
    isDark: toHsl(dominant).l < 0.5,
  };
}

/**
 * @param {string | undefined} coverUrl 网易云封面网址
 * @returns {Promise<Palette>}
 */
export function getPalette(coverUrl) {
  if (!coverUrl) return Promise.resolve(FALLBACK_PALETTE);
  const url = `${coverUrl.replace(/^http:/, 'https:')}?param=${SIZE}y${SIZE}`;
  if (!cache.has(url)) {
    const task = loadImage(url)
      .then(img => {
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        return paletteFromPixels(ctx.getImageData(0, 0, SIZE, SIZE).data);
      })
      .catch(() => FALLBACK_PALETTE);
    cache.set(url, task);
  }
  return cache.get(url);
}
