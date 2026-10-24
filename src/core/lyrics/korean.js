// 韩文罗马字（国语罗马字 Revised Romanization）：歌词下面显示的读音
// 网易云给的韩文罗马音写法很怪（"dang xi nui"），韩文是拼音文字、规则固定，自己转比较准，也不用联网。
// 处理常见的连音（받침 + 이 → 移到下一字）和鼻音化、流音化；其他非韩文的字原样保留。

const BASE = 0xac00;
const LAST = 0xd7a3;

// 初声（19 个）
const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
// 中声（21 个）
const VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// 终声（28 个，0 = 没有）：[后面接辅音或句尾时的音, 后面接 ㅇ（连音）时留下的音, 移到下一字的音]
const FINAL = [
  ['', '', ''],
  ['k', '', 'g'], // ㄱ
  ['k', '', 'kk'], // ㄲ
  ['k', 'k', 's'], // ㄳ
  ['n', '', 'n'], // ㄴ
  ['n', 'n', 'j'], // ㄵ
  ['n', '', 'n'], // ㄶ（ㅎ 不发音）
  ['t', '', 'd'], // ㄷ
  ['l', '', 'r'], // ㄹ
  ['k', 'l', 'g'], // ㄺ
  ['m', 'l', 'm'], // ㄻ
  ['l', 'l', 'b'], // ㄼ
  ['l', 'l', 's'], // ㄽ
  ['l', 'l', 't'], // ㄾ
  ['p', 'l', 'p'], // ㄿ
  ['l', '', 'r'], // ㅀ
  ['m', '', 'm'], // ㅁ
  ['p', '', 'b'], // ㅂ
  ['p', 'p', 's'], // ㅄ
  ['t', '', 's'], // ㅅ
  ['t', '', 'ss'], // ㅆ
  ['ng', 'ng', ''], // ㅇ
  ['t', '', 'j'], // ㅈ
  ['t', '', 'ch'], // ㅊ
  ['k', '', 'k'], // ㅋ
  ['t', '', 't'], // ㅌ
  ['p', '', 'p'], // ㅍ
  ['t', '', ''], // ㅎ
];

const SILENT = 11; // 初声 ㅇ
const NIEUN = 2;
const RIEUL = 5;
const MIEUM = 6;

/** 一个字拆成 [初声, 中声, 终声]；不是韩文字回传 null */
function split(ch) {
  const code = ch.codePointAt(0);
  if (code < BASE || code > LAST) return null;
  const offset = code - BASE;
  return [Math.floor(offset / 588), Math.floor((offset % 588) / 28), offset % 28];
}

/**
 * @param {string} text
 * @returns {string} 罗马字；没有韩文就回传空字符串
 */
export function romanizeKorean(text) {
  if (!/[가-힣]/.test(text)) return '';
  const chars = [...text];
  const parts = chars.map(split);
  let out = '';
  // 上一个字留给这个字的开头（连音、鼻音化、流音化会改）
  let carried = null;
  for (let i = 0; i < chars.length; i++) {
    const jamo = parts[i];
    if (!jamo) {
      out += chars[i];
      carried = null;
      continue;
    }
    const [l, v, t] = jamo;
    const next = parts[i + 1];
    let initial = carried ?? INITIAL[l];
    // 句子开头、空格后的 ㄹ 念 r
    if (carried === null && l === RIEUL && (i === 0 || !parts[i - 1])) initial = 'r';
    carried = null;

    let final = FINAL[t][0];
    if (t && next) {
      const [nl] = next;
      const [, keep, move] = FINAL[t];
      if (nl === SILENT && move !== '') {
        // 连音：밤에 → ba-me
        final = keep;
        carried = move;
      } else if (nl === NIEUN || nl === MIEUM) {
        // 鼻音化：국물 → gungmul，믿는 → minneun，입니다 → imnida
        if (final === 'k') final = 'ng';
        else if (final === 't') final = 'n';
        else if (final === 'p') final = 'm';
        else if (final === 'l' && nl === NIEUN) carried = 'l'; // 설날 → seollal
      } else if (nl === RIEUL) {
        // 流音化：신라 → silla；ㄹㄹ → ll
        if (final === 'n' || final === 'l') {
          final = 'l';
          carried = 'l';
        } else if (final === 'ng' || final === 'm') carried = 'n'; // 종로 → jongno
        else if (final === 'k') {
          final = 'ng';
          carried = 'n';
        }
      } else if (t === 27 && (nl === 0 || nl === 3 || nl === 12)) {
        // ㅎ + ㄱ/ㄷ/ㅈ → 送气：좋고 → joko
        final = '';
        carried = { 0: 'k', 3: 't', 12: 'ch' }[nl];
      }
    }
    out += initial + VOWEL[v] + final;
  }
  return out.replace(/\s+/g, ' ').trim();
}
