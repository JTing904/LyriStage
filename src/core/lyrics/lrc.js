// @ts-check
// LRC 歌词解析：[mm:ss.xx]歌词
// 和 v1 的 parseLyric 相比：
// - 毫秒按实际位数换算（v1 把 [00:01.5] 当成 1.05 秒）
// - 保留空行：空行代表间奏，用来判断上一行在哪里结束
// - 时间统一用毫秒整数

/**
 * @typedef {{ time: number, text: string }} LrcLine time 单位毫秒；text 为空字符串表示间奏
 */

const LINE = /^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/;
const TIMESTAMP = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;

/** "5" → 500，"50" → 500，"500" → 500，"5000" → 500 */
function fractionToMs(fraction = '') {
  if (!fraction) return 0;
  return Math.round(Number(`0.${fraction}`) * 1000);
}

/**
 * @param {string} text
 * @returns {LrcLine[]} 按时间排序；一行有多个时间戳时会展开成多行
 */
export function parseLrc(text) {
  /** @type {LrcLine[]} */
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(LINE);
    if (!match) continue; // [ti:] [by:] 这类信息标签、JSON 信息行
    const [, stamps, content] = match;
    for (const [, min, sec, fraction] of stamps.matchAll(TIMESTAMP)) {
      const time =
        Number(min) * 60_000 + Number(sec) * 1000 + fractionToMs(fraction);
      lines.push({ time, text: content.trim() });
    }
  }
  // sort 是稳定排序：同一时间的多行保持原来的先后顺序
  return lines.sort((a, b) => a.time - b.time);
}
