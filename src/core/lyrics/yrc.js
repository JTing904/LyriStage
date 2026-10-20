// @ts-check
// 网易云逐字歌词（yrc）解析
// 格式：[行开始ms,行时长ms](字开始ms,字时长ms,0)字(字开始ms,字时长ms,0)字…
// 字的开始时间是整首歌的绝对时间，不是相对于行。

/**
 * @typedef {{ text: string, start: number, duration: number }} Word
 * @typedef {{ start: number, duration: number, words: Word[] }} YrcLine
 */

const LINE = /^\[(\d+),(\d+)\](.*)$/;
// 字的内容一直到下一个时间标记为止（字本身可能带括号，例如 "(Oh)"，不能遇到 ( 就停）
const WORD = /\((\d+),(\d+),\d+\)((?:(?!\(\d+,\d+,\d+\)).)*)/g;

/**
 * @param {string} text
 * @returns {YrcLine[]} 按时间排序
 */
export function parseYrc(text) {
  /** @type {YrcLine[]} */
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(LINE);
    if (!match) continue; // JSON 信息行等
    const [, start, duration, body] = match;
    const words = [...body.matchAll(WORD)]
      .map(([, wStart, wDuration, wText]) => ({
        text: wText,
        start: Number(wStart),
        duration: Number(wDuration),
      }))
      .filter(w => w.text !== '');
    if (words.length === 0) continue;
    lines.push({ start: Number(start), duration: Number(duration), words });
  }
  return lines.sort((a, b) => a.start - b.start);
}
