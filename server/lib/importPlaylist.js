// 导入其他 App 的歌单：/import/playlist?url=（分享出来的整段文字也可以）
//   → { source, name, cover, total, tracks: [{ name, artists, durationMs, query }] }
// App 再拿每首去网易云找对应的歌（src/core/importPlaylist）。
//
// 都只读「公开」歌单，不用登录那些 App（2026-10 在马来西亚实测都拿得到）：
// - QQ 音乐：网页版用的歌单接口（要带 y.qq.com 的 Referer）
// - Spotify：官方 API 2026 年起个人开发者几乎不能用，改读公开歌单的嵌入页（open.spotify.com/embed/…）
//   里面的 __NEXT_DATA__；嵌入页最多给 100 首左右
// - Apple Music：歌单网页里的 serialized-server-data（有歌手；ld+json 只有歌名）
// - YouTube / YouTube Music：歌单网页里的 ytInitialData，一次 100 首；标题是影片标题，要清掉「(Official Video)」这种
// 这些都不是正式接口，人家改网页就要跟着改：各家分开写，一家坏了不影响别家。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10000;
const CACHE_MS = 10 * 60 * 1000;

let toSimplified = null;
/** 繁体转简体（Spotify、Apple 上的中文歌常是繁体，网易云是简体） */
function simplified(text) {
  if (!toSimplified) {
    const OpenCC = require('opencc-js/t2cn');
    toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
  }
  return toSimplified(String(text ?? ''));
}

/** 分享出来的文字里的第一个网址（「分享歌单：xxx https://… (@QQ音乐)」） */
function firstUrl(text) {
  return String(text ?? '').match(/https?:\/\/[^\s"'<>，。）)】]+/)?.[0] ?? null;
}

/**
 * 认出是哪家的歌单
 * @returns {{ source: 'qq' | 'spotify' | 'apple' | 'youtube' | 'netease', id: string, url: string } | { source: 'short', url: string } | null}
 *   short：短链接，要先跟着跳转才知道是哪一张
 */
function parseLink(text) {
  const url = firstUrl(text);
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname + u.hash.replace(/^#/, '');
  const param = name => u.searchParams.get(name) ?? new URLSearchParams(u.hash.split('?')[1] ?? '').get(name);
  if (/(^|\.)y\.qq\.com$/.test(host)) {
    const id = path.match(/playlist\/(\d+)/)?.[1] ?? (/taoge|playlist|details/.test(path) ? param('id') : null);
    if (id && /^\d+$/.test(id)) return { source: 'qq', id, url };
    if (/^c\d*\.y\.qq\.com$/.test(host) && path.includes('/u')) return { source: 'short', url };
    return null;
  }
  if (host === 'open.spotify.com') {
    const id = path.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
    return id ? { source: 'spotify', id, url } : null;
  }
  if (host === 'spotify.link') return { source: 'short', url };
  if (host === 'music.apple.com') {
    const id = path.match(/\/playlist\/(?:[^/]+\/)?(pl\.[A-Za-z0-9-]+)/)?.[1];
    return id ? { source: 'apple', id, url: url.split('?')[0] } : null;
  }
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    const id = param('list');
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? { source: 'youtube', id, url } : null;
  }
  if (/(^|\.)music\.163\.com$/.test(host)) {
    const id = path.match(/playlist\/(\d+)/)?.[1] ?? (path.includes('playlist') ? param('id') : null);
    return id && /^\d+$/.test(id) ? { source: 'netease', id, url } : null;
  }
  if (host === '163cn.tv') return { source: 'short', url };
  return null;
}

async function get(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res;
}

/** 短链接跟着跳转，看最后到哪里 */
async function resolveShort(url) {
  const res = await get(url);
  res.body?.cancel();
  return parseLink(res.url);
}

/** 网页里某个 <script> 的 JSON */
function scriptJson(html, pattern) {
  const text = html.match(pattern)?.[1];
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 把整个物件走一遍，把 test 成立的都收起来 */
function collect(root, test) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (!Array.isArray(node) && test(node)) out.push(node);
    const children = Array.isArray(node) ? node : Object.values(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

const decode = text =>
  String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const meta = (html, property) => decode(html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1] ?? '');

// ---- 各家 ----------------------------------------------------------------------------

async function fromQQ(id) {
  const res = await get(
    `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?disstid=${id}&type=1&json=1&utf8=1&onlysong=0&format=json`,
    { Referer: 'https://y.qq.com/' }
  );
  const list = (await res.json())?.cdlist?.[0];
  if (!list) return null;
  return {
    name: list.dissname ?? '',
    cover: String(list.logo ?? '').replace(/^http:/, 'https:'),
    total: Number(list.songnum) || list.songlist?.length || 0,
    tracks: (list.songlist ?? []).map(song => ({
      name: song.songname ?? song.name ?? '',
      artists: (song.singer ?? []).map(s => s.name).filter(Boolean),
      durationMs: (Number(song.interval) || 0) * 1000,
    })),
  };
}

async function fromSpotify(id) {
  const html = await (await get(`https://open.spotify.com/embed/playlist/${id}`)).text();
  const data = scriptJson(html, /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  const entity = data?.props?.pageProps?.state?.data?.entity;
  if (!entity?.trackList) return null;
  return {
    name: entity.name ?? entity.title ?? '',
    cover: entity.coverArt?.sources?.[0]?.url ?? '',
    total: entity.trackList.length,
    tracks: entity.trackList.map(t => ({
      name: t.title ?? '',
      // subtitle 是「歌手, 歌手」（逗号后面有空白；歌手名字里的逗号没有空白）
      artists: String(t.subtitle ?? '').split(/,\s+/).filter(Boolean),
      durationMs: Number(t.duration) || 0,
    })),
  };
}

async function fromApple(url) {
  const html = await (await get(url)).text();
  const data = scriptJson(html, /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/);
  const items = collect(data, node => typeof node.artistName === 'string' && typeof node.title === 'string' && 'duration' in node);
  if (!items.length) return null;
  const ld = scriptJson(html, /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  return {
    name: ld?.name ?? meta(html, 'og:title').replace(/ (on|- )?Apple Music$/i, ''),
    cover: meta(html, 'og:image'),
    total: Number(ld?.numTracks) || items.length,
    tracks: items.map(t => ({
      name: t.title,
      artists: t.artistName.split(/\s*(?:,|&| x | feat\. )\s*/i).filter(Boolean),
      durationMs: Number(t.duration) || 0,
    })),
  };
}

/** YouTube 的影片标题清成歌名：拿掉「(Official Music Video)」「[MV]」「| 歌词」这种 */
function cleanVideoTitle(title) {
  return String(title ?? '')
    .replace(/[(（[【「][^)）\]】」]*(official|video|audio|lyric|lyrics|visuali[sz]er|mv|m\/v|hd|4k|官方|歌词|動態|动态|完整版|高音质|高音質)[^)）\]】」]*[)）\]】」]/gi, '')
    .replace(/\s*[|｜].*$/, '')
    .replace(/\s+@\S+/g, '')
    .replace(/\s*\b(official\s+)?(music\s+video|mv|m\/v|lyric\s+video)$/i, '')
    .replace(/\s*\bofficial\s+(video|audio)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 「歌手 - 歌名」拆开；频道是「歌手 - Topic」（YouTube Music 自动产生的）就用频道当歌手
 * @returns {{ name: string, artists: string[] }}
 */
function splitVideo(title, channel) {
  const cleaned = cleanVideoTitle(title);
  const topic = String(channel ?? '').match(/^(.*) - Topic$/)?.[1];
  // 中文影片常见「歌手【歌名】」「歌手《歌名》」；韩文、英文的「ITZY "BORN TO BE" M/V」「지민 (Jimin) 'Closer Than This'」
  const quoted = cleaned.match(/^(.+?)\s*[【《](.+?)[】》]/) ?? cleaned.match(/^(.+?)\s+["“'‘](.+?)["”'’](?=\s|$)/);
  if (quoted) {
    // 「지민 (Jimin)」：两个名字都留着（网易云可能用英文名）
    const [, main, alias] = quoted[1].match(/^(.*?)\s*[(（](.+?)[)）]\s*$/) ?? [null, quoted[1]];
    return { name: quoted[2].trim(), artists: [main.trim(), alias?.trim()].filter(Boolean) };
  }
  const artist = topic ?? String(channel ?? '').replace(/VEVO$|官方频道$|官方頻道$|\s*Official$/i, '').trim();
  const dash = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && !topic) {
    // 一般是「歌手 - 歌名」；也有「歌名 - 歌手」：哪一边跟频道名对得上，哪一边就是歌手
    const squash = text => text.toLowerCase().replace(/[\s\p{P}]/gu, '');
    const ch = squash(artist);
    const firstArtist = second => ch && (ch.includes(squash(second.split(/,|&/)[0])) || squash(second).includes(ch));
    const [name, singer] = firstArtist(dash[2]) && !firstArtist(dash[1]) ? [dash[1], dash[2]] : [dash[2], dash[1]];
    return {
      name: name.replace(/\s+(ft|feat)\.?\s.*$/i, '').trim(),
      artists: singer.split(/\s*,\s*|\s+&\s+|\s+x\s+/i).map(s => s.trim()).filter(Boolean),
    };
  }
  return { name: cleaned.replace(/\s+(ft|feat)\.?\s.*$/i, '').trim(), artists: artist ? [artist] : [] };
}

async function fromYouTube(id) {
  const html = await (await get(`https://www.youtube.com/playlist?list=${id}`, { 'Accept-Language': 'en' })).text();
  const data = scriptJson(html, /var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!data) return null;
  const tracks = collect(data, node => node.lockupViewModel || node.playlistVideoRenderer).map(node => {
    if (node.playlistVideoRenderer) {
      const r = node.playlistVideoRenderer;
      return {
        title: r.title?.runs?.[0]?.text,
        channel: r.shortBylineText?.runs?.[0]?.text,
        seconds: Number(r.lengthSeconds) || 0,
      };
    }
    const l = node.lockupViewModel;
    const md = l.metadata?.lockupMetadataViewModel;
    const parts = (md?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap(r => r.metadataParts ?? []);
    const time = JSON.stringify(l.contentImage ?? {}).match(/"text":"(\d+):(\d\d)"/);
    return {
      title: md?.title?.content,
      channel: parts[0]?.text?.content,
      seconds: time ? Number(time[1]) * 60 + Number(time[2]) : 0,
    };
  });
  if (!tracks.length) return null;
  return {
    name: meta(html, 'og:title'),
    cover: meta(html, 'og:image'),
    total: tracks.length,
    tracks: tracks
      .filter(t => t.title)
      // 不给长度：MV 常有片头片尾，比歌长很多，拿来比对反而会把对的歌标成「时长差很多」
      .map(t => ({ ...splitVideo(t.title, t.channel), durationMs: 0 })),
  };
}

const READERS = { qq: l => fromQQ(l.id), spotify: l => fromSpotify(l.id), apple: l => fromApple(l.url), youtube: l => fromYouTube(l.id) };

/**
 * 每首加上去网易云搜索用的字（简体、只留第一位歌手），和比对用的简体歌名、歌手
 * （Spotify、Apple 上的中文歌常是繁体，网易云是简体；App 那边没有繁简转换）
 */
const withQuery = track => ({
  ...track,
  query: simplified([track.name, track.artists[0]].filter(Boolean).join(' ')).trim(),
  match: { name: simplified(track.name), artists: track.artists.map(simplified) },
});

const cache = new Map();

/**
 * @param {URL} url ?url=歌单链接（或分享出来的整段文字）
 * @returns {Promise<{ status: number, body: object }>}
 */
async function handleImport(url, { readers = READERS } = {}) {
  let link = parseLink(url.searchParams.get('url'));
  try {
    if (link?.source === 'short') link = await resolveShort(link.url);
  } catch {
    link = null;
  }
  if (!link) return { status: 400, body: { code: 400, reason: 'unsupported', msg: '认不出这个链接' } };
  // 网易云的歌单 App 自己就能打开
  if (link.source === 'netease') return { status: 200, body: { code: 200, source: 'netease', id: link.id } };
  const key = `${link.source}:${link.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { status: 200, body: hit.body };
  let playlist;
  try {
    playlist = await readers[link.source](link);
  } catch (err) {
    const notFound = err.status === 404 || err.status === 400;
    return {
      status: notFound ? 404 : 502,
      body: { code: notFound ? 404 : 502, reason: notFound ? 'not-found' : 'failed', msg: notFound ? '找不到这张歌单' : '读不到这张歌单' },
    };
  }
  if (!playlist?.tracks?.length) {
    return { status: 404, body: { code: 404, reason: 'empty', msg: '读不到歌（歌单可能是私人的，或是空的）' } };
  }
  const body = {
    code: 200,
    source: link.source,
    name: decode(playlist.name).trim(),
    cover: playlist.cover,
    total: Math.max(playlist.total, playlist.tracks.length),
    tracks: playlist.tracks.filter(t => t.name).map(t => withQuery({ ...t, name: decode(t.name).trim(), artists: t.artists.map(decode) })),
  };
  cache.set(key, { at: Date.now(), body });
  return { status: 200, body };
}

module.exports = { handleImport, parseLink, cleanVideoTitle, splitVideo, firstUrl };
