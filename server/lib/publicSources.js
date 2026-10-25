// 解灰音源：公开的"网易云歌曲 ID → 播放链接"接口。
// 清单来自 NeteaseCloudMusicApiEnhanced/UnblockNeteaseMusic-utils（MIT）的 modules/，
// 2026-10 在马来西亚实测这 5 个都能拿到 VIP 歌（网易云自己服务器上的完整文件，约 320k）。
// 网易云完全没有版权的歌（例如周杰伦）这些都拿不到，交给 B 站（bilibili.js）。
//
// 这些是别人免费提供的服务，随时可能关掉或改规则：一个一个试，失败就换下一个，
// 不会同时打全部（不给人家添负担）。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT_MS = 6000;

/** 按实测速度排：快的先试 */
const SOURCES = [
  { name: 'qijieya', url: id => `https://api.qijieya.cn/meting/?type=url&id=${id}` },
  { name: 'msls', url: id => `https://api.msls1441.com/?type=url&id=${id}` },
  { name: 'byfuns', url: id => `https://api.byfuns.top/1/?id=${id}&level=exhigh` },
  { name: 'ddyr', url: id => `https://yy.zddyr.top/lx/api/?source=netease&songmid=${id}&quality=320k` },
  { name: 'oi', url: id => `https://oiapi.net/api/Music_163?id=${id}` },
];

/**
 * 各家回的格式不一样：302 跳转、JSON 的 url / data.url / data[0].url、或者直接一行网址
 * @param {Response} res
 */
async function audioUrlFrom(res) {
  const location = res.headers.get('location');
  if (location) return location;
  const text = await res.text();
  if (/^https?:\/\/\S+$/.test(text.trim())) return text.trim();
  try {
    const json = JSON.parse(text);
    const data = Array.isArray(json.data) ? json.data[0] : json.data;
    return json.url || data?.url || null;
  } catch {
    return null;
  }
}

/**
 * 链接拿得到、而且是整首歌（不是 30 秒试听片段，也不是占位音频）：
 * 用文件大小估计，至少要有大约 64kbps × 歌曲长度
 */
async function looksLikeFullSong(url, durationMs) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    res.body?.cancel();
    if (!res.ok) return false;
    const size = Number(res.headers.get('content-range')?.split('/')[1] ?? res.headers.get('content-length'));
    if (!size) return true; // 不知道大小就相信它
    const minBytes = durationMs ? (durationMs / 1000) * 8 * 1024 : 300 * 1024; // 64kbps = 8KB/s
    return size >= minBytes;
  } catch {
    return false;
  }
}

/**
 * 问一个音源要这首歌，拿到整首歌就回传网址
 * @returns {Promise<string | null>}
 */
async function askSource(source, id, durationMs) {
  const res = await fetch(source.url(id), {
    redirect: 'manual',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await audioUrlFrom(res);
  if (!raw || !/^https?:\/\//.test(raw)) return null;
  // 音源给的常常是 http 链接，HTTPS 网页里会被当成混合内容拦截
  const url = raw.replace(/^http:\/\//, 'https://');
  return (await looksLikeFullSong(url, durationMs)) ? url : null;
}

/**
 * 依次问每个公开音源，第一个拿到整首歌的就用
 * @param {number | string} id 网易云歌曲 ID
 * @param {{ durationMs?: number }} [song]
 * @returns {Promise<{ url: string, br: number | null, source: string } | null>}
 */
async function findOnPublicSources(id, { durationMs } = {}) {
  for (const source of byHealth()) {
    try {
      const url = await askSource(source, id, durationMs);
      if (url) {
        lastFailedAt.delete(source.name);
        return { url, br: null, source: source.name };
      }
    } catch {
      // 这个音源挂了或太慢（出错、超时），试下一个
      lastFailedAt.set(source.name, Date.now());
    }
  }
  return null;
}

// 最近出错或超时的音源排到最后：不然排第一个的挂了，每首歌都要先白等它超时（6 秒）。
// 注意"没有这首歌"不算出错（那是歌的问题，不是音源的问题）
const FAILED_RECENTLY_MS = 10 * 60 * 1000;
/** @type {Map<string, number>} */
const lastFailedAt = new Map();
function byHealth() {
  const failedRecently = source => Date.now() - (lastFailedAt.get(source.name) ?? 0) < FAILED_RECENTLY_MS;
  return [...SOURCES.filter(s => !failedRecently(s)), ...SOURCES.filter(failedRecently)];
}

/**
 * 音源状态（管理员在设置页看）：每个音源都问一次同一首 VIP 歌，一起问
 * @returns {Promise<Array<{ name: string, ok: boolean, ms: number }>>}
 */
function checkPublicSources(id, durationMs) {
  return Promise.all(
    SOURCES.map(async source => {
      const started = Date.now();
      const ok = await askSource(source, id, durationMs).then(Boolean, () => false);
      // 顺便更新排序：测出来不能用的先排到后面
      if (ok) lastFailedAt.delete(source.name);
      else lastFailedAt.set(source.name, Date.now());
      return { name: source.name, ok, ms: Date.now() - started };
    })
  );
}

module.exports = { findOnPublicSources, checkPublicSources, audioUrlFrom };
