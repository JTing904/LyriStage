// 解灰音源：B 站。2026-10 在马来西亚实测，其他音源（GD Studio、酷狗、QQ…）都失效时，
// B 站上大多数歌都有人上传原曲（"Hi-Res 试听"这类），音频是 AAC，链接 2 小时有效。
//
// 不直接用 @unblockneteasemusic/server 的 bilivideo：它不看时长，直接拿搜索结果第一个，
// 常常选到 MV（前面有剧情）、翻唱或伴奏。这里自己挑：时长和网易云差几秒内、
// 标题有歌名、排除翻唱 / 伴奏 / 教学这类，再挑播放量最高的。
//
// B 站接口要 WBI 签名，做法和 bilivideo.js 一样
// （参考 https://github.com/SocialSisterYi/bilibili-API-collect）。
//
// 注意：B 站的音频服务器会拒绝别的网站的 Referer（403），
// 所以 App 的页面设了 <meta name="referrer" content="no-referrer">
const crypto = require('crypto');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const SESSION_TTL_MS = 60 * 60 * 1000;
/** 时长最多差几秒还算同一个版本 */
const MAX_DURATION_DIFF_S = 6;

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

// 标题有这些字眼的多半不是原曲（歌名本身有这个字的不算）
const NOT_ORIGINAL = [
  '翻唱', 'cover', '伴奏', '纯音乐', 'instrumental', 'karaoke', '卡拉', '钢琴',
  'piano', '吉他', 'guitar', '弹唱', '教程', '教学', '扒谱', '鼓谱', '萨克斯',
  '小提琴', '古筝', '二胡', '现场', 'live', '巡演', '演唱会', 'concert', 'reaction',
  '反应', 'remix', 'dj', '混音', '循环', '小时', 'loop', '加速', '降调', '升调',
  'nightcore', '8d', '女声版', '男声版', '改编', '舞蹈', 'dance', '解说', '盆栽',
];

const ENTITIES = { amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>', nbsp: ' ' };
/** 搜索结果的标题带 <em> 高亮和 HTML 转义 */
const cleanTitle = title =>
  String(title)
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (_, e) => ENTITIES[e]);

/** 去掉空白和标点，方便比较 */
const normalize = s => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** "4:24" / "1:02:03" → 秒；格式不对返回 NaN */
function parseDuration(text) {
  const parts = String(text).split(':');
  if (!parts.length || parts.some(p => !/^\d+$/.test(p))) return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/**
 * 从搜索结果挑出像原曲的视频，最像的排前面；都不像就是空数组（宁可不播也不要播错歌）
 * @param {Array<{ bvid: string, title: string, author?: string, duration: string, play?: number }>} results
 * @param {{ name: string, artists: string[], durationMs?: number }} song
 */
function rankVideos(results, song) {
  // "晴天(深情版)" 这类：括号里的不一定出现在 B 站标题，只比括号前面的
  const name = normalize(song.name.replace(/[(（[【].*?[)）\]】]/g, '')) || normalize(song.name);
  const target = song.durationMs ? song.durationMs / 1000 : null;
  const songText = normalize(song.name);
  const blocked = NOT_ORIGINAL.filter(word => !songText.includes(normalize(word)));
  const artists = song.artists.map(normalize).filter(Boolean);

  const candidates = results
    .map(video => {
      const title = cleanTitle(video.title);
      return { ...video, title, text: normalize(title), seconds: parseDuration(video.duration) };
    })
    .filter(v => v.bvid && v.text.includes(name))
    .filter(v =>
      target ? Math.abs(v.seconds - target) <= MAX_DURATION_DIFF_S : v.seconds >= 60 && v.seconds <= 600
    )
    .filter(v => !blocked.some(word => v.text.includes(normalize(word))))
    .map(v => ({
      ...v,
      hasArtist: artists.some(a => v.text.includes(a) || normalize(v.author || '').includes(a)),
    }));

  return candidates.sort((a, b) => b.hasArtist - a.hasArtist || (b.play || 0) - (a.play || 0));
}

/** 最像原曲的那个，没有就是 null */
const pickVideo = (results, song) => rankVideos(results, song)[0] ?? null;

// B 站接口 ------------------------------------------------------------------------

/** @type {{ cookie: string, mixinKey: string, at: number } | null} */
let session = null;

async function getSession() {
  if (session && Date.now() - session.at < SESSION_TTL_MS) return session;
  // 搜索要带首页给的 cookie（buvid3 等），不然会被风控
  const home = await fetch('https://www.bilibili.com/', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const cookie = home.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ');
  // 没登录也会给签名用的 img_key / sub_key
  const nav = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).then(r => r.json());
  const fileName = url => url.slice(url.lastIndexOf('/') + 1, url.lastIndexOf('.'));
  const { img_url, sub_url } = nav.data.wbi_img;
  const raw = fileName(img_url) + fileName(sub_url);
  const mixinKey = MIXIN_KEY_ENC_TAB.map(n => raw[n]).join('').slice(0, 32);
  session = { cookie, mixinKey, at: Date.now() };
  return session;
}

/** WBI 签名：参数加上时间戳、按 key 排序，和 mixinKey 一起算 MD5 */
function signParams(params, mixinKey) {
  const all = { ...params, wts: Math.round(Date.now() / 1000) };
  const query = Object.keys(all)
    .sort()
    .map(key => {
      const value = String(all[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

async function callApi(path, params) {
  const { cookie, mixinKey } = await getSession();
  const res = await fetch(`https://api.bilibili.com${path}?${signParams(params, mixinKey)}`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json();
  if (json.code !== 0) {
    if (json.code === -412 || json.code === -352) session = null; // 被风控：下次换新 cookie
    throw new Error(`bilibili ${path}: ${json.code} ${json.message}`);
  }
  return json.data;
}

/**
 * 在 B 站找这首歌，返回音频链接；找不到返回 null
 * @param {{ name: string, artists: string[], durationMs?: number }} song
 * @param {{ needsNoReferer?: boolean }} [options]
 *   needsNoReferer：只要不带 Referer 也能拿到的链接（手机、网页版的 <audio> 带不了 B 站的 Referer）
 * @returns {Promise<{ url: string, br: number, source: 'bilibili' } | null>}
 */
async function findOnBilibili(song, { needsNoReferer = true } = {}) {
  const keyword = [song.name, song.artists[0]].filter(Boolean).join(' ');
  const search = () => callApi('/x/web-interface/wbi/search/type', { search_type: 'video', keyword });
  let data = await search();
  if (!data.result?.length) {
    // 短时间搜太多次，B 站会回空结果：换新的 cookie 再搜一次
    session = null;
    data = await search();
  }
  // 视频可能被删了或有地区限制（view 回 -404），就试下一个
  const errors = [];
  for (const video of rankVideos(data.result || [], song).slice(0, 4)) {
    try {
      const found = await audioOf(video.bvid, needsNoReferer);
      if (found) return found;
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length) throw errors[0];
  return null;
}

/**
 * 不带 Referer 能不能拿到音频。有的视频（看上传的人怎么设）不带 B 站的 Referer 一律 403，
 * App 的 <audio> 带不了这个 Referer，这种链接给了也播不了
 */
async function playableWithoutReferer(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/** 视频里音质最高、App 播得了的音频 */
async function audioOf(bvid, needsNoReferer) {
  const view = await callApi('/x/web-interface/wbi/view', { bvid });
  const play = await callApi('/x/player/wbi/playurl', {
    bvid,
    cid: view.cid,
    fnval: 16, // DASH：音频和画面分开，只拿音频
    platform: 'pc',
  });
  const best = [...(play.dash?.audio || [])].sort((a, b) => b.bandwidth - a.bandwidth)[0];
  if (!best) return null;
  // 同一个音频有几条线路（主线路 + 备用），有的线路会挡没有 Referer 的请求
  const urls = [best.baseUrl || best.base_url, ...(best.backupUrl || best.backup_url || [])]
    .filter(Boolean)
    .map(url => url.replace(/^http:\/\//, 'https://'));
  if (!needsNoReferer) return urls.length ? { url: urls[0], br: best.bandwidth, source: 'bilibili' } : null;
  for (const url of urls) {
    if (await playableWithoutReferer(url)) return { url, br: best.bandwidth, source: 'bilibili' };
  }
  return null;
}

module.exports = { findOnBilibili, pickVideo, parseDuration };
