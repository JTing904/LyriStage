// @ts-check
// 均衡器的资料：10 个频段、预设、防爆音的前级衰减。真正处理声音的在 renderer/src/audioEffects.js

/** 10 个频段的中心频率（Hz），和大部分播放器、Folia 一样 */
export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** 每个频段最多加减多少 dB */
export const MAX_DB = 12;

/** 预设：每个频段加减多少 dB（顺序同 BANDS） */
export const PRESETS = [
  { id: 'flat', name: '原声', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'pop', name: '流行', gains: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1] },
  { id: 'rock', name: '摇滚', gains: [5, 4, 2, -1, -2, -1, 1, 3, 4, 5] },
  { id: 'bass', name: '低音增强', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', name: '人声', gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'classical', name: '古典', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { id: 'electronic', name: '电子', gains: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  { id: 'night', name: '深夜', gains: [1, 1, 0, 0, 0, -1, -2, -3, -4, -5] },
];

/**
 * 现在的调法是哪个预设；自己调过、对不上任何预设时返回 null（显示「自定义」）
 * @param {number[]} gains
 */
export function matchPreset(gains) {
  return PRESETS.find(p => p.gains.every((g, i) => g === gains[i]))?.id ?? null;
}

/**
 * 前级衰减（dB）：有频段加大时整体先调小，加起来才不会超过最大音量而破音
 * @param {number[]} gains
 */
export function headroomDb(gains) {
  return 0 - Math.max(0, ...gains);
}

/**
 * 读进来的设定（localStorage，可能是旧版或被改坏的）整理成正确的样子
 * @param {unknown} raw
 * @returns {{ enabled: boolean, gains: number[], leveler: boolean }}
 */
export function normalizeEqSettings(raw) {
  const value = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
  const gains = Array.isArray(value.gains) ? value.gains : [];
  return {
    enabled: value.enabled === true,
    gains: BANDS.map((_, i) => {
      const g = Number(gains[i]);
      return Number.isFinite(g) ? Math.max(-MAX_DB, Math.min(MAX_DB, Math.round(g))) : 0;
    }),
    leveler: value.leveler === true,
  };
}
