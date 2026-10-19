// @ts-check
// 没有逐字歌词（yrc）时的退路：把一行的时长按字估算分配，
// 让只有普通歌词的歌也能有逐字高亮的效果（例如《有你爱就明媚》）

/** @typedef {import('./yrc').Word} Word */

// 中文、日文假名、韩文：一个字就是一个单位
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯ㄱ-ㆎ]/u;
// 字母、数字（含带重音的拉丁字母）：连续的算一个词
const WORD_CHAR = /[\p{L}\p{N}'’]/u;
// 一个高亮单位：一个中日韩字，或者一串连续的非中日韩字母数字
const UNIT = new RegExp(
  `${CJK.source}|(?:(?!${CJK.source})[\\p{L}\\p{N}'’])+`,
  'gu'
);

/**
 * 拆成高亮单位。标点和空格附在前一个单位后面，保证拼回去和原文完全一样。
 * "Hello, 世界!" → ["Hello, ", "世", "界!"]
 * @param {string} text
 * @returns {string[]}
 */
export function splitWords(text) {
  /** @type {string[]} */
  const tokens = [];
  let last = 0;
  for (const match of text.matchAll(UNIT)) {
    const index = match.index ?? 0;
    const between = text.slice(last, index); // 两个单位之间的标点、空格
    if (tokens.length > 0) tokens[tokens.length - 1] += between;
    // 行首的标点（例如「）没有前一个单位，并到第一个单位前面
    tokens.push(tokens.length === 0 ? between + match[0] : match[0]);
    last = index + match[0].length;
  }
  if (tokens.length === 0) return text ? [text] : [];
  tokens[tokens.length - 1] += text.slice(last);
  return tokens;
}

const hasContent = (/** @type {string} */ token) =>
  [...token].some(ch => CJK.test(ch) || WORD_CHAR.test(ch));

/** 唱一个单位大概要多久：汉字 1 份；英文词按长度估音节，至少 1 份 */
function weightOf(token) {
  if (!hasContent(token)) return 0;
  if ([...token].some(ch => CJK.test(ch))) return 1;
  const letters = [...token].filter(ch => WORD_CHAR.test(ch)).length;
  return Math.max(1, letters / 3);
}

// 每份最多唱多久：一行后面常有很长的停顿，不能把停顿也平均分进去
const MAX_MS_PER_WEIGHT = 600;
const MIN_LINE_MS = 800;

/**
 * 估算逐字时间
 * @param {string} text
 * @param {number} start 行开始（毫秒）
 * @param {number} end 下一行开始（毫秒）
 * @returns {Word[]}
 */
export function estimateWords(text, start, end) {
  const tokens = splitWords(text);
  const weights = tokens.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  const gap = Math.max(0, end - start);
  if (tokens.length === 0) return [];
  if (total === 0) return [{ text, start, duration: gap }];

  // 实际唱的时间：不超过到下一行的间隔，也不超过按字数估的上限
  const span = Math.min(gap, Math.max(MIN_LINE_MS, total * MAX_MS_PER_WEIGHT));
  let cursor = start;
  return tokens.map((token, i) => {
    const duration = Math.round((span * weights[i]) / total);
    const word = { text: token, start: cursor, duration };
    cursor += duration;
    return word;
  });
}
