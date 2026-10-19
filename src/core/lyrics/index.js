// @ts-check
// 歌词：把网易云的 lrc / yrc / 翻译 / 罗马音整合成界面直接能用的格式
import { parseLrc } from './lrc';
import { parseYrc } from './yrc';
import { parseJsonCredits, classifyInfoLine, splitCredit } from './credits';
import { estimateWords } from './words';

export { parseLrc, parseYrc, estimateWords };
export { splitWords } from './words';

/**
 * @typedef {import('./yrc').Word} Word
 * @typedef {import('./credits').Credit} Credit
 * @typedef {object} LyricLine
 * @property {number} start 毫秒
 * @property {number} end 毫秒（下一行开始或这一行唱完）
 * @property {string} text
 * @property {Word[]} words 逐字时间
 * @property {'word' | 'estimated'} timing word：网易云的逐字歌词；estimated：按字数估算
 * @property {string | null} translation
 * @property {string | null} romaji
 *
 * @typedef {object} Lyrics
 * @property {LyricLine[]} lines
 * @property {Credit[]} credits 作词、作曲等
 * @property {string[]} notices 版权声明
 * @property {boolean} hasWordTiming
 * @property {boolean} hasTranslation
 * @property {boolean} hasRomaji
 * @property {boolean} instrumental 纯音乐
 */

// 翻译和原文的时间允许差多少（逐字歌词的行开始时间和 lrc 的时间常常差几百毫秒）
const ALIGN_TOLERANCE_MS = 1000;
// 最后一行不知道什么时候结束时，默认给多久
const LAST_LINE_MS = 6000;

/**
 * @param {{ lrc?: string, yrc?: string, translation?: string, romaji?: string }} raw
 *   网易云 /lyric/new 的内容（netease.lyric() 的返回值）
 * @param {{ durationMs?: number }} [options] 歌曲时长，用来估算最后一行的结束时间
 * @returns {Lyrics}
 */
export function buildLyrics(raw, { durationMs } = {}) {
  const { lrc = '', yrc = '', translation = '', romaji = '' } = raw;
  const credits = parseJsonCredits(lrc || yrc);
  /** @type {string[]} */
  const notices = [];
  const lrcLines = parseLrc(lrc);

  const instrumental = /纯音乐.{0,4}请欣赏/.test(lrc);

  const yrcLines = parseYrc(yrc);
  /** @type {LyricLine[]} */
  let lines =
    yrcLines.length > 0
      ? yrcLines.map(l => ({
          start: l.start,
          end: l.start + l.duration,
          text: l.words.map(w => w.text).join(''),
          words: l.words,
          timing: /** @type {const} */ ('word'),
          translation: null,
          romaji: null,
        }))
      : fromLrc(lrcLines, durationMs);

  // 把混在正文里的作词作曲、版权声明分出去
  lines = lines.filter(line => {
    const kind = classifyInfoLine(line.text);
    if (kind === 'notice') notices.push(line.text);
    if (kind === 'credit') {
      const credit = splitCredit(line.text);
      const exists = credits.some(
        c => c.role === credit?.role && c.names === credit?.names
      );
      if (credit && !exists) credits.push(credit);
    }
    return kind === null;
  });

  attach(lines, parseLrc(translation), 'translation');
  attach(lines, parseLrc(romaji), 'romaji');

  return {
    lines,
    credits,
    notices,
    hasWordTiming: lines.some(l => l.timing === 'word'),
    hasTranslation: lines.some(l => l.translation),
    hasRomaji: lines.some(l => l.romaji),
    instrumental: instrumental && lines.length <= 1,
  };
}

/**
 * 普通歌词 → 行，逐字时间按字数估算
 * @param {import('./lrc').LrcLine[]} lrcLines
 * @param {number | undefined} durationMs
 * @returns {LyricLine[]}
 */
function fromLrc(lrcLines, durationMs) {
  /** @type {LyricLine[]} */
  const lines = [];
  lrcLines.forEach((line, i) => {
    if (!line.text) return; // 空行只用来标记上一行的结束
    const next = lrcLines.slice(i + 1).find(l => l.time > line.time);
    const end =
      next?.time ?? Math.max(durationMs ?? 0, line.time + LAST_LINE_MS);
    lines.push({
      start: line.time,
      end,
      text: line.text,
      words: estimateWords(line.text, line.time, end),
      timing: 'estimated',
      translation: null,
      romaji: null,
    });
  });
  return lines;
}

/**
 * 按时间把翻译 / 罗马音挂到最接近的原文行上
 * @param {LyricLine[]} lines
 * @param {import('./lrc').LrcLine[]} extra
 * @param {'translation' | 'romaji'} key
 */
function attach(lines, extra, key) {
  const candidates = extra.filter(l => l.text);
  let from = 0;
  for (const line of lines) {
    let best = -1;
    for (let i = from; i < candidates.length; i++) {
      const diff = candidates[i].time - line.start;
      if (diff > ALIGN_TOLERANCE_MS) break;
      if (Math.abs(diff) <= ALIGN_TOLERANCE_MS) {
        if (
          best === -1 ||
          Math.abs(diff) < Math.abs(candidates[best].time - line.start)
        ) {
          best = i;
        }
      }
    }
    if (best === -1) continue;
    const text = candidates[best].text;
    // 有的歌"翻译"和原文一模一样，没有意义
    if (text !== line.text) line[key] = text;
    from = best + 1;
  }
}

/**
 * 当前应该高亮哪一行：最后一个 start <= timeMs 的行（二分查找）
 * 一定要传界面上实际显示的那个数组（v1 用了过滤前的数组，导致高亮错位）
 * @param {{ start: number }[]} lines
 * @param {number} timeMs
 * @returns {number} 还没到第一行时返回 -1
 */
export function findLineIndex(lines, timeMs) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].start <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * 一个字唱到哪里了：0 还没开始，1 已经唱完
 * @param {Word} word
 * @param {number} timeMs
 */
export function wordProgress(word, timeMs) {
  if (word.duration <= 0) return timeMs >= word.start ? 1 : 0;
  return Math.min(1, Math.max(0, (timeMs - word.start) / word.duration));
}
