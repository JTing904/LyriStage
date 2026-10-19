// @ts-check
// 作词、作曲等信息，以及版权声明：从歌词正文里分出来，单独显示

/**
 * @typedef {{ role: string, names: string }} Credit
 */

/**
 * 网易云把信息放成 JSON 行：{"t":0,"c":[{"tx":"作词: "},{"tx":"唐恬"}]}
 * @param {string} text lrc 或 yrc 原文
 * @returns {Credit[]}
 */
export function parseJsonCredits(text) {
  /** @type {Credit[]} */
  const credits = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      const { c } = JSON.parse(line);
      const joined = c
        .map((/** @type {{tx: string}} */ part) => part.tx)
        .join('');
      const credit = splitCredit(joined);
      if (credit) credits.push(credit);
    } catch {
      // 不是合法 JSON，跳过
    }
  }
  return credits;
}

// 歌词正文里也会混进信息行，例如：
//   词版权管理方：北京梦织音传媒有限公司
//   录音作品及MV版权：EAS MUSIC LTD
//   联合出品：拳头游戏/腾讯游戏
// 判断方法：冒号前面的"标签"很短，而且包含下面任何一个关键词
const CJK_KEYWORDS = [
  '作词',
  '作曲',
  '编曲',
  '作詞',
  '編曲',
  '填词',
  '词曲',
  '制作',
  '监制',
  '出品',
  '发行',
  '版权',
  '企划',
  '策划',
  '统筹',
  '营销',
  '推广',
  '宣传',
  '后期',
  '录音',
  '混音',
  '母带',
  '缩混',
  '和声',
  '和音',
  '配唱',
  '伴唱',
  '人声',
  '原唱',
  '翻唱',
  '演唱',
  '主唱',
  '吉他',
  '贝斯',
  '键盘',
  '钢琴',
  '弦乐',
  '鼓手',
  '打击乐',
  '配器',
  '乐队',
  '演奏',
  '视觉',
  '设计',
  '封面',
  '摄影',
  '导演',
  '剪辑',
  '艺人统筹',
];
// 英文关键词要整个词匹配（"Speak: hello" 不能因为含 "SP" 就当成信息）
const EN_KEYWORDS =
  /\b(lyrics|lyricist|composer|composed|written|arranger|arranged|producer|produced|mixed|mixing|mastered|mastering|recorded|recording|vocals?|guitar|bass|drums|keyboards?|strings|op|sp|isrc|label|publisher)\b/i;

const MAX_LABEL_LENGTH = 16;

/** 版权声明，例如 "未经著作权人书面许可，严禁以任何方式…" */
const NOTICE =
  /未经.{0,8}许可|版权所有|禁止.{0,6}(翻唱|翻录|使用)|All rights reserved/i;

/** 冒号前面的标签是不是职位 / 版权方 */
function isCreditLabel(label) {
  if (label.length > MAX_LABEL_LENGTH) return false;
  return CJK_KEYWORDS.some(k => label.includes(k)) || EN_KEYWORDS.test(label);
}

/**
 * "作词 : 唐恬" → { role: '作词', names: '唐恬' }
 * @param {string} text
 * @returns {Credit | null}
 */
export function splitCredit(text) {
  const match = text.match(/^\s*([^:：]{1,20}?)\s*[:：]\s*(.+?)\s*$/);
  if (!match) return null;
  return { role: match[1], names: match[2] };
}

/**
 * 判断一行歌词其实是信息或声明
 * @param {string} text
 * @returns {'credit' | 'notice' | null}
 */
export function classifyInfoLine(text) {
  if (NOTICE.test(text)) return 'notice';
  const credit = splitCredit(text);
  if (credit && isCreditLabel(credit.role)) return 'credit';
  return null;
}
