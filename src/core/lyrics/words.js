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

// 一行后面常有停顿或拉长的尾音，不能把这些时间也平均分给每个字，
// 否则越后面的字出现得越晚（实测《有你爱就明媚》最后一个字慢了约 0.5 秒）。
// 按一般流行歌的速度估：每个字约 0.32 秒，最多用到两行间隔的 85%
const MS_PER_WEIGHT = 320;
const MAX_GAP_RATIO = 0.85;
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

  // 实际唱的时间：按字数估算，但不超过到下一行间隔的 85%
  const span = Math.min(
    gap * MAX_GAP_RATIO,
    Math.max(MIN_LINE_MS, total * MS_PER_WEIGHT)
  );
  // 用累计比例算每个字的开始时间再取整，避免每个字各自取整后误差越积越多
  let before = 0;
  return tokens.map((token, i) => {
    const wordStart = start + Math.round((span * before) / total);
    before += weights[i];
    const wordEnd = start + Math.round((span * before) / total);
    return { text: token, start: wordStart, duration: wordEnd - wordStart };
  });
}
