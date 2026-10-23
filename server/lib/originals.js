// 搜索补原唱：/search/originals?keywords=晴天 → { songs: [网易云的歌（带 privilege）] }
//
// 网易云没有版权、已经下架的歌（例如周杰伦整个歌单），网易云的搜索会整个藏起来，只搜得到翻唱；
// 但歌还在：「歌手 → 专辑 → 歌」一路找下去拿得到原本的歌曲 ID（晴天是 186016），
// 拿到 ID 以后喜欢、歌单、歌词、解灰播放（B 站）都跟一般的歌一样。
// 怎么知道原唱是谁：问 Apple 的音乐目录（iTunes Search API，免费、不用账号）。
// 台湾区的目录有周杰伦，名字是繁体，比对前转成简体（opencc-js）。
//
// 1. Apple 搜 keywords，拿前几个结果（歌名、歌手、专辑、长度）
// 2. 网易云搜歌手（名字要对得上）→ 歌手的专辑清单里找同名专辑 → 专辑里找同名的歌（长度差 5 秒以内）
// 3. 同一组关键字的结果在服务器记 6 小时（一次要问网易云好几趟）

const ITUNES = 'https://itunes.apple.com/search';
/** Apple 的哪几区目录（台湾区最齐，香港区补漏） */
const STORES = ['TW', 'HK'];
/** 最多找几首原唱 */
const MAX_ORIGINALS = 3;
const CACHE_MS = 6 * 60 * 60 * 1000;

let toSimplified = null;
function simplified(text) {
  if (!toSimplified) {
    const OpenCC = require('opencc-js/t2cn');
    toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
  }
  return toSimplified(String(text ?? ''));
}

/** 比对用：转简体、全形转半形、去掉空白和标点、小写 */
function normalize(text) {
  return simplified(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** Apple 的歌是不是现场版、伴奏这种（关键字没提到就不要，先找录音室原版） */
const isVariant = (name, keywords) =>
  /\b(live|instrumental|karaoke|remix|demo)\b|现场|伴奏|演唱会/i.test(simplified(name)) &&
  !/live|现场|伴奏|演唱会|remix/i.test(simplified(keywords));

/**
 * Apple 搜到的歌 → 要去网易云找的原唱（同一个歌手 + 专辑 + 歌名只留一首）
 * @param {Array<object>} results iTunes Search API 的 results
 * @param {string} keywords
 */
function pickCandidates(results, keywords) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    if (r.wrapperType !== 'track' || r.kind !== 'song' || !r.trackName || !r.artistName || !r.collectionName) continue;
    if (isVariant(r.trackName, keywords) || isVariant(r.collectionName, keywords)) continue;
    const key = `${normalize(r.artistName)}|${normalize(r.collectionName)}|${normalize(r.trackName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ track: r.trackName, artist: r.artistName, album: r.collectionName, durationMs: r.trackTimeMillis ?? 0 });
    if (out.length >= MAX_ORIGINALS) break;
  }
  return out;
}

/**
 * 在网易云找回一首原唱
 * @param {{ track: string, artist: string, album: string, durationMs: number }} wanted
 * @param {{ searchArtists: (name: string) => Promise<object[]>, artistAlbums: (id: number) => Promise<object[]>, albumSongs: (id: number) => Promise<object[]> }} netease
 * @returns {Promise<object | null>} 网易云的歌（带 privilege），找不到就是 null
 */
async function findOnNetease(wanted, netease) {
  const artistName = normalize(wanted.artist);
  const artists = await netease.searchArtists(simplified(wanted.artist));
  const artist = artists.find(a => [a.name, ...(a.alias ?? []), ...(a.alia ?? []), a.trans].filter(Boolean).some(n => normalize(n) === artistName));
  if (!artist) return null;
  const albumName = normalize(wanted.album);
  const albums = await netease.artistAlbums(artist.id);
  // 专辑名常常差在「 - Single」「(Deluxe)」这种尾巴：完全一样的优先，再来是一边包含另一边
  const album =
    albums.find(a => normalize(a.name) === albumName) ??
    albums.find(a => normalize(a.name).includes(albumName) || albumName.includes(normalize(a.name)));
  if (!album) return null;
  const songs = await netease.albumSongs(album.id);
  const trackName = normalize(wanted.track);
  const close = s => !wanted.durationMs || !s.dt || Math.abs(s.dt - wanted.durationMs) <= 5000;
  return songs.find(s => normalize(s.name) === trackName && close(s)) ?? songs.find(s => normalize(s.name) === trackName) ?? null;
}

/**
 * @param {string} keywords
 * @param {{ itunes: (term: string, country: string) => Promise<object[]>, netease: Parameters<typeof findOnNetease>[1] }} deps
 */
async function findOriginals(keywords, { itunes, netease }) {
  let candidates = [];
  for (const country of STORES) {
    candidates = pickCandidates(await itunes(keywords, country).catch(() => []), keywords);
    if (candidates.length) break;
  }
  const found = await Promise.all(candidates.map(c => findOnNetease(c, netease).catch(() => null)));
  const seen = new Set();
  return found.filter(s => s && !seen.has(s.id) && seen.add(s.id));
}

const cache = new Map();

/**
 * /search/originals 的处理
 * @param {URL} url
 * @param {Parameters<typeof findOriginals>[1]} deps
 */
async function handleOriginals(url, deps) {
  const keywords = String(url.searchParams.get('keywords') ?? '').trim().slice(0, 60);
  if (!keywords) return { status: 400, body: { code: 400, msg: 'keywords is required' } };
  const key = keywords.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { status: 200, body: { code: 200, songs: hit.songs } };
  const songs = await findOriginals(keywords, deps);
  if (cache.size > 2000) cache.clear();
  cache.set(key, { songs, at: Date.now() });
  return { status: 200, body: { code: 200, songs } };
}

/** 问 Apple 的目录（台湾、香港区用中文名字） */
async function itunesSearch(term, country) {
  const url = new URL(ITUNES);
  url.search = new URLSearchParams({ term, country, media: 'music', entity: 'song', limit: '15', lang: 'zh_tw' }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  return (await res.json()).results ?? [];
}

module.exports = { handleOriginals, findOriginals, findOnNetease, pickCandidates, normalize, itunesSearch };
