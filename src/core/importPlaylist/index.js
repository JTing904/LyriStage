// 导入其他 App 的歌单：每首去网易云找对应的歌
//
// 歌单内容由 LyriStage 服务器读（server/lib/importPlaylist.js，回传歌名、歌手、长度、搜索用的字）；
// 这里一首一首搜网易云、打分，分成三种：
// - ok：歌名、歌手都对得上，长度差不多
// - version：找到了但可能是别的版本（Live、翻唱、伴奏、混音…）、长度差很多、或歌手不一样 → 让用户确认
// - none：找不到
// 参考 TuneMyMusic / Soundiiz：它们只列出「找不到」，配到 Live 版、翻唱不会说，用户常抱怨；所以把可疑的也标出来。

/**
 * @typedef {{ name: string, artists: string[], durationMs?: number, query?: string,
 *   match?: { name: string, artists: string[] }, loose?: boolean }} SourceTrack
 *   loose：从贴上的文字来的，不知道「A - B」哪个是歌名、哪个是歌手，两种都试
 * @typedef {'live' | 'cover' | 'instrumental' | 'remix' | 'other-version' | 'duration' | 'artist'} Reason
 * @typedef {{ status: 'ok' | 'version' | 'none', pick: object | null, reason: Reason | null, diffSec: number,
 *   candidates: object[] }} MatchResult
 */

/** 比对用：全形转半形、去掉重音符号（Arcángel = Arcangel）、小写、去掉空白和标点 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 歌名本体：拿掉括号里的（「(Live)」「（钢琴版）」「- Remastered 2011」） */
export function baseTitle(name) {
  return normalize(
    String(name ?? '')
      .replace(/[(（[【][^)）\]】]*[)）\]】]/g, ' ')
      .replace(/\s+-\s+.*(remaster|version|edit|mix|live|ver\.).*$/i, ' ')
  );
}

/** 是哪一种版本（歌名、别名里有这些字） */
const VARIANTS = /** @type {const} */ ([
  ['live', /\blive\b|现场|演唱会|live版|live ver/i],
  ['cover', /翻唱|翻自|\bcover\b/i],
  ['instrumental', /伴奏|\binst\b|instrumental|karaoke|纯音乐|off vocal/i],
  ['remix', /\bremix\b|\bdj\b|加速|降速|sped ?up|slowed|reverb|0\.\d+x|\b8d\b|混音/i],
  // 括号里写「…版」「… ver.」的都算（治愈版、DJ版、女版、0.9x 版…），原本那首也是同样写法才不算
  ['other-version', /钢琴版|吉他版|女声版|男声版|acoustic|\bdemo\b|铃声|童声版|抖音版|[(（[【][^)）\]】]*(版|\bver\b|version)[^)）\]】]*[)）\]】]/i],
]);

/** 这首歌是哪一种特别版本（一般的录音室版回传 null） */
export function variantOf(text) {
  for (const [kind, pattern] of VARIANTS) if (pattern.test(String(text ?? ''))) return kind;
  return null;
}

/** 网易云的歌：歌名 + 别名 + 翻译名（「翻自 xxx」「电视剧插曲」常写在别名里） */
const neteaseText = song => [song.name, ...(song.alia ?? []), ...(song.tns ?? [])].join(' ');
const neteaseNames = song => [song.name, ...(song.tns ?? [])].map(baseTitle).filter(Boolean);
const artistsOf = song => song.ar ?? song.artists ?? [];
const neteaseArtistNames = song => artistsOf(song).map(a => normalize(a.name)).filter(Boolean);
const neteaseArtistAliases = song =>
  artistsOf(song).flatMap(a => [...(a.alias ?? a.alia ?? []), ...(a.tns ?? [])]).map(normalize).filter(Boolean);

function titleScore(sourceName, song) {
  const want = baseTitle(sourceName);
  if (!want) return 0;
  let best = 0;
  for (const have of neteaseNames(song)) {
    if (have === want) return 1;
    if (Math.min(have.length, want.length) >= 2 && (have.includes(want) || want.includes(have))) best = 0.7;
  }
  return best;
}

/**
 * 歌手对不对得上：2 名字对上；1 只有别名对上；0 对不上。
 * 别名不能全信：网易云有人乱上传，「歌手」叫 Jay、别名填「周杰伦、林俊杰…」，搜晴天会先出来他的（1 分多钟）
 */
function artistLevel(sourceArtists, song) {
  const wants = sourceArtists.map(normalize).filter(Boolean);
  const hit = have => wants.some(want => have.some(h => h === want || (Math.min(h.length, want.length) >= 2 && (h.includes(want) || want.includes(h)))));
  if (hit(neteaseArtistNames(song))) return 2;
  return hit(neteaseArtistAliases(song)) ? 1 : 0;
}

/**
 * 这首网易云的歌跟原本那首有多像
 * @param {SourceTrack} source
 * @param {object} song 网易云的歌
 */
export function score(source, song) {
  const name = source.match?.name ?? source.name;
  const artists = source.match?.artists ?? source.artists;
  const title = titleScore(name, song);
  const level = artistLevel(artists, song);
  const srcVariant = variantOf(name);
  // originCoverType 2：网易云自己标的翻唱
  const variant = variantOf(neteaseText(song)) ?? (song.originCoverType === 2 ? 'cover' : null);
  const wrongVersion = variant && variant !== srcVariant ? variant : null;
  // 两边都有长度才比（贴上的歌名清单、YouTube 没有）
  const timed = Boolean(source.durationMs && song.dt);
  const diffSec = timed ? Math.round(Math.abs(source.durationMs - song.dt) / 1000) : 0;
  const sameLength = timed && diffSec <= 4;
  const value = title * 4 + level + (sameLength ? 1 : diffSec > 15 ? -1.5 : 0) - (wrongVersion ? 2 : 0);
  // 只有别名对上：长度也对得上才算（英文名「Jay Chou」对网易云「周杰伦」的别名，Spotify、Apple 有给长度）
  const artist = level === 2 || (level === 1 && sameLength);
  return { value, title, artist, wrongVersion, diffSec, sameLength };
}

/** 从几首候选里挑最像的，判断是 ok / version / none */
export function judge(source, songs) {
  const seen = new Set();
  const tries = source.loose && source.artists.length ? [source, { ...source, name: source.artists[0], artists: [source.name], match: undefined }] : [source];
  const ranked = songs
    .filter(song => song?.id && !seen.has(song.id) && seen.add(song.id))
    .map(song => ({ song, s: tries.map(t => score(t, song)).sort((a, b) => b.value - a.value)[0] }))
    .sort((a, b) => b.s.value - a.s.value);
  const candidates = ranked.slice(0, 5).map(r => r.song);
  const best = ranked[0];
  if (!best || best.s.title === 0) return { status: 'none', pick: null, reason: null, diffSec: 0, candidates };
  const { s } = best;
  // 没给歌手（贴上的文字只有歌名）：只看歌名和版本
  const needArtist = source.artists.length > 0;
  const ok = !s.wrongVersion && s.diffSec <= 15 && (!needArtist || s.artist) && (s.title === 1 || s.sameLength);
  if (ok) return { status: 'ok', pick: best.song, reason: null, diffSec: s.diffSec, candidates };
  const reason = s.wrongVersion ?? (s.diffSec > 15 ? 'duration' : needArtist && !s.artist ? 'artist' : 'other-version');
  return { status: 'version', pick: best.song, reason, diffSec: s.diffSec, candidates };
}

/**
 * 在网易云找这首：先搜「歌名 歌手」。
 * - 一首同名的都没有：只搜歌名再试一次（歌手名字两边写法不同，例如英文名 / 中文名）
 * - 有同名的但版本、歌手不对（多半只搜到翻唱）：问「被藏起来的原唱」（没版权的歌，例如周杰伦，网易云搜索只给翻唱）
 * 每一步都比较慢（原唱要 2 秒左右），一张歌单几十首，只在可能有用的时候问
 * @param {SourceTrack} source
 * @param {{ searchSongs: Function, hiddenSongs: Function }} netease
 * @returns {Promise<MatchResult>}
 */
export async function matchTrack(source, netease) {
  const query = source.query || [source.name, source.artists[0]].filter(Boolean).join(' ');
  let songs = await netease.searchSongs(query, { limit: 8 }).catch(() => []);
  let result = judge(source, songs);
  if (result.status === 'ok') return result;
  const nameOnly = source.match?.name ?? source.name;
  if (result.status === 'none' && source.artists.length && nameOnly && nameOnly !== query) {
    songs = [...songs, ...(await netease.searchSongs(nameOnly, { limit: 10 }).catch(() => []))];
    result = judge(source, songs);
    if (result.status === 'ok') return result;
  }
  if (result.status === 'version') {
    const hidden = await netease.hiddenSongs(query, { limit: 5, fallback: false }).catch(() => []);
    if (hidden.length) result = judge(source, [...hidden, ...songs]);
  }
  return result;
}

/**
 * 贴上的歌名清单：一行一首，「歌名 - 歌手」或「歌手 - 歌名」都可以（两种都试），只有歌名也可以
 * @returns {SourceTrack[]}
 */
export function parseTextList(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(\d+[.、)\]]|[-*•·])\s*/, '').trim())
    .filter(line => line && !/^https?:\/\//.test(line))
    .slice(0, 500)
    .map(line => {
      const [a, ...rest] = line.split(/\s+[-–—]\s+|\t/);
      const b = rest.join(' ').trim();
      return { name: a.trim(), artists: b ? [b] : [], loose: Boolean(b), query: [a, b].filter(Boolean).join(' ') };
    });
}

/**
 * 一次找好几首（同时最多 concurrency 首：浏览器对同一个服务器最多 6 条连线，不要全占满）
 * @param {SourceTrack[]} tracks
 * @param {(index: number, result: MatchResult) => void} onResult
 * @param {{ concurrency?: number, isCancelled?: () => boolean }} [options]
 */
export async function matchAll(tracks, netease, onResult, { concurrency = 4, isCancelled = () => false } = {}) {
  let next = 0;
  async function worker() {
    while (next < tracks.length && !isCancelled()) {
      const i = next++;
      let result;
      try {
        result = await matchTrack(tracks[i], netease);
      } catch {
        result = { status: 'none', pick: null, reason: null, diffSec: 0, candidates: [] };
      }
      if (!isCancelled()) onResult(i, result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, worker));
}
