// @ts-check
import { ApiError } from '../http/client';

// 网易云接口（不登录网易云就能用的部分）。
// 返回的歌曲对象保持网易云原本的格式（id、name、ar 歌手、al 专辑、dt 时长毫秒），
// 和 data/track.js 的快照格式一致。

/** 网易云和各音源给的大多是 http 链接，HTTPS 页面里会被当成混合内容拦截 */
export const toHttps = (/** @type {string} */ url) =>
  url.replace(/^http:\/\//, 'https://');

/**
 * 统一成新格式：有些接口（例如 /personalized/newsong）还在用旧字段
 * artists / album / duration，其他地方都按 ar / al / dt 读
 * @param {Record<string, any>} song
 */
export function normalizeSong(song) {
  return {
    ...song,
    ar: song.ar ?? song.artists ?? [],
    al: song.al ?? song.album ?? null,
    dt: song.dt ?? song.duration ?? 0,
  };
}

/**
 * 翻唱的歌名常常写着原唱是谁（「告白气球 (原唱：周杰伦)」「晴天 [原唱: 周杰伦]」），
 * 从搜索结果里找出最常被写到的原唱，用来找回网易云没版权、搜不到的原曲
 * @param {Array<{ name?: string }>} songs
 * @returns {string | null}
 */
export function originalArtistIn(songs) {
  const counts = new Map();
  for (const song of songs) {
    const m = String(song.name ?? '').match(/原唱\s*[:：]?\s*([^)）\]】/,，]+)/);
    const name = m?.[1]?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best = null;
  for (const [name, n] of counts) if (!best || n > best[1]) best = [name, n];
  return best?.[0] ?? null;
}

/**
 * 歌在网易云已经下架（没有版权）：privilege.st 小于 0，谁去拿都没有音频。
 * VIP 歌曲不算（st 是 0，只是要会员）
 * @param {Record<string, any> | null | undefined} track
 */
export function isUnavailable(track) {
  return (track?.privilege?.st ?? 0) < 0;
}

/**
 * /song/detail、/playlist/track/all 把版权状态放在另一个 privileges 数组，
 * 挂回每首歌的 privilege（其他接口本来就在歌里）
 * @param {Record<string, any>[]} songs
 * @param {Record<string, any>[] | undefined} privileges
 */
function withPrivileges(songs, privileges) {
  if (!privileges?.length) return songs;
  const byId = new Map(privileges.map(p => [p.id, p]));
  return songs.map(song =>
    song.privilege || !byId.has(song.id) ? song : { ...song, privilege: byId.get(song.id) }
  );
}

/**
 * 歌词搜索结果里搜到的那一句，切成一段一段（hit = 搜到的字），界面照着加粗，不用 v-html
 * @param {unknown} lyrics 网易云给的 lyrics（字符串数组）
 * @returns {{ text: string, hit: boolean }[] | null}
 */
export function lyricMatch(lyrics) {
  if (!Array.isArray(lyrics)) return null;
  const line = lyrics.find(l => typeof l === 'string' && l.includes('<b>'));
  if (!line) return null;
  const clean = text => text.replace(/<[^>]*>/g, '');
  const segments = [];
  let last = 0;
  for (const m of line.matchAll(/<b>(.*?)<\/b>/g)) {
    if (m.index > last) segments.push({ text: clean(line.slice(last, m.index)), hit: false });
    segments.push({ text: clean(m[1]), hit: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) segments.push({ text: clean(line.slice(last)), hit: false });
  return segments.filter(s => s.text);
}

/** 搜索类型（网易云 cloudsearch 的 type 参数） */
/** 解灰时 B 站暂时限制搜索（要人机验证）：过一会儿再试就好，不是这首歌没有 */
export const isUnblockRateLimited = err =>
  err instanceof ApiError && err.status === 503 && err.body?.reason === 'rate-limited';

export const SEARCH_TYPE = /** @type {const} */ ({
  song: 1,
  /** 用一句歌词找歌：结果的 lyrics 里，搜到的字用 <b> 标出来 */
  lyric: 1006,
  album: 10,
  artist: 100,
  playlist: 1000,
});

/**
 * @param {import('../http/client').Http} http
 */
export function createNetease(http) {
  /**
   * 搜索
   * @param {string} keywords
   * @param {{ type?: keyof typeof SEARCH_TYPE, limit?: number, offset?: number }} [options]
   */
  async function search(
    keywords,
    { type = 'song', limit = 30, offset = 0 } = {}
  ) {
    const data = await http.get('/cloudsearch', {
      keywords,
      type: SEARCH_TYPE[type],
      limit,
      offset,
    });
    const result = data.result ?? {};
    return {
      song: result.songs ?? [],
      lyric: (result.songs ?? []).map(s => ({ ...s, lyricMatch: lyricMatch(s.lyrics) })),
      album: result.albums ?? [],
      artist: result.artists ?? [],
      playlist: result.playlists ?? [],
    }[type];
  }

  /**
   * 歌单里的歌（前 limit 首）
   * @param {number} id
   */
  async function playlistTracks(id, limit = 1000, offset = 0) {
    const data = await http.get('/playlist/track/all', { id, limit, offset });
    return withPrivileges(data.songs ?? [], data.privileges);
  }

  return {
    // 搜索 ------------------------------------------------------------------
    search,
    /** 搜索单曲 */
    searchSongs: (keywords, options = {}) =>
      search(keywords, { ...options, type: 'song' }),

    // 播放 ------------------------------------------------------------------
    /**
     * 网易云自己的播放链接；拿不到（VIP、版权、地区限制）时返回 null
     * @param {number} id
     * @param {'standard' | 'higher' | 'exhigh' | 'lossless'} level
     */
    async songUrl(id, level = 'exhigh') {
      const data = await http.get('/song/url/v1', { id, level });
      const item = data.data?.[0];
      // freeTrialInfo 不为空表示只能试听 30 秒，当作拿不到
      if (!item?.url || item.freeTrialInfo) return null;
      return { url: toHttps(item.url), br: item.br, source: 'netease' };
    },

    /**
     * 解灰：去其他平台找同一首歌（server/lib/handler.js）；找不到返回 null
     * @param {{ bvid?: string | null }} [hint] 以前在 B 站挑过的视频（大家共用的记录），服务器会再检查
     */
    async unblockUrl(id, { bvid } = {}) {
      try {
        const data = await http.get('/song/url/match', { id, bvid });
        return {
          url: data.data.url,
          br: data.data.br,
          source: data.data.source,
          bvid: data.data.bvid ?? null,
        };
      } catch (err) {
        // 网络断了、B 站暂时限制搜索：要让播放器知道（不要当成"这首没有音源"而跳歌）
        if (err instanceof ApiError && (err.status === undefined || isUnblockRateLimited(err))) throw err;
        return null;
      }
    },

    /**
     * 解灰的每个音源现在能不能用（管理员在设置页看）
     * @returns {Promise<{ sources: Array<{ name: string, ok: boolean, ms: number, rateLimitedAt?: number | null }>, checkedAt: number }>}
     */
    async unblockStatus() {
      const data = await http.get('/unblock/status');
      return data.data;
    },

    /** 歌词原文：lrc 普通歌词、yrc 逐字歌词、translation 翻译、romaji 罗马音（交给 core/lyrics 的 buildLyrics） */
    async lyric(id) {
      const data = await http.get('/lyric/new', { id });
      return {
        lrc: data.lrc?.lyric ?? '',
        yrc: data.yrc?.lyric ?? '',
        translation: data.tlyric?.lyric ?? '',
        romaji: data.romalrc?.lyric ?? '',
      };
    },

    // 歌曲、歌单、专辑、歌手 ------------------------------------------------------
    /** @param {number[]} ids */
    async songDetails(ids) {
      if (ids.length === 0) return [];
      const data = await http.get('/song/detail', { ids: ids.join(',') });
      return withPrivileges(data.songs ?? [], data.privileges);
    },

    /** 歌单信息（歌曲用 playlistTracks 另外拿，歌单很大时 detail 里的歌不全） */
    async playlist(id) {
      const data = await http.get('/playlist/detail', { id });
      return data.playlist;
    },
    playlistTracks,

    async album(id) {
      const data = await http.get('/album', { id });
      return { album: data.album, songs: data.songs ?? [] };
    },

    /** 歌手信息 + 热门 50 首 */
    async artist(id) {
      const data = await http.get('/artists', { id });
      return { artist: data.artist, hotSongs: data.hotSongs ?? [] };
    },

    /**
     * 歌手的所有歌曲（按热度）。和「热门 50 首」不同：网易云没有版权的歌（例如周杰伦自己的歌）
     * 在这里还查得到（只是标成没版权），播放时会改用其他音源
     */
    async artistSongs(id, { limit = 100, offset = 0 } = {}) {
      const data = await http.get('/artist/songs', { id, limit, offset, order: 'hot' });
      return withPrivileges((data.songs ?? []).map(normalizeSong), data.privileges);
    },

    /**
     * 被搜索藏起来的歌：网易云没有版权的歌不会出现在搜索结果里（搜「晴天 周杰伦」只找得到翻唱）。
     * 关键词里有歌手名时，去他的所有歌曲里找名字对得上的、没版权的，补回搜索结果。
     * 只搜歌名（「告白气球」）时，用搜索结果里翻唱写的「原唱：xxx」认出歌手（originalArtist）
     * @param {string} keyword
     * @param {{ limit?: number, originalArtist?: string | null }} [options]
     * @returns {Promise<object[]>}
     */
    async hiddenSongs(keyword, { limit = 10, originalArtist = null } = {}) {
      const norm = text => String(text).toLowerCase().replace(/[\s\p{P}]/gu, '');
      const k = norm(keyword);
      if (!k) return [];
      // 先问 LyriStage 服务器：用 Apple 的目录找出原唱，再去网易云「歌手 → 专辑」找回那首歌
      // （网易云连歌手的歌曲清单都会藏起下架的歌，专辑里还在）。服务器没有这个功能（旧版）或找不到，才用下面的老方法
      try {
        const songs = (await http.get('/search/originals', { keywords: keyword })).songs ?? [];
        if (songs.length) return songs.slice(0, limit);
      } catch {
        // 用老方法
      }
      const lookup = async name =>
        (await http.get('/cloudsearch', { keywords: name, type: 100, limit: 3 })).result?.artists ?? [];
      // 要试的歌手：关键词里的歌手（「晴天 周杰伦」），再来是翻唱写的原唱（「稻香」→ 周杰伦）。
      // 两个都要试：搜「稻香」时网易云可能刚好有歌手名字里有这两个字
      const candidates = [];
      const fromKeyword = (await lookup(keyword)).find(a => a.name && k.includes(norm(a.name)));
      if (fromKeyword) candidates.push({ artist: fromKeyword, rest: k.replace(norm(fromKeyword.name), '') });
      if (originalArtist && norm(originalArtist) !== norm(fromKeyword?.name ?? '')) {
        const artist = (await lookup(originalArtist)).find(a => norm(a.name) === norm(originalArtist));
        if (artist) candidates.push({ artist, rest: k.replace(norm(artist.name), '') });
      }
      for (const { artist, rest } of candidates) {
        const songs = await this.artistSongs(artist.id, { limit: rest ? 300 : 50 });
        const found = songs
          .filter(song => isUnavailable(song))
          .filter(song => !rest || norm(song.name).includes(rest) || rest.includes(norm(song.name)))
          .slice(0, limit);
        if (found.length) return found;
      }
      return [];
    },

    async artistAlbums(id, { limit = 30, offset = 0 } = {}) {
      const data = await http.get('/artist/album', { id, limit, offset });
      return data.hotAlbums ?? [];
    },

    // 发现 ------------------------------------------------------------------
    /** 排行榜列表 */
    async toplists() {
      const data = await http.get('/toplist');
      return data.list ?? [];
    },

    /** 推荐歌单（不登录时是通用推荐） */
    async recommendedPlaylists(limit = 12) {
      const data = await http.get('/personalized', { limit });
      return data.result ?? [];
    },

    /** 新歌（返回的是 { id, name, song } 包装，取出 song；song 是旧格式，要统一） */
    async newSongs(limit = 10) {
      const data = await http.get('/personalized/newsong', { limit });
      return (data.result ?? []).map(item => normalizeSong(item.song ?? item));
    },

    /**
     * 网易云的私人 FM（不登录时是匿名推荐），一次给几首；也是旧格式。
     * 登录 LyriStage 后改用 core/recommend 的 PersonalFM（按自己的听歌记录推荐）
     */
    async personalFm() {
      const data = await http.get('/personal_fm', { timestamp: Date.now() });
      return (data.data ?? []).map(normalizeSong);
    },

    // 推荐算法用（core/recommend） ----------------------------------------------
    /** 歌手热门 50 首 */
    async artistTopSongs(artistId) {
      const data = await http.get('/artist/top/song', { id: artistId });
      return data.songs ?? [];
    },

    /** 相似歌曲（网易云算的，大约 50 首；旧格式，要统一） */
    async similarSongs(trackId) {
      const data = await http.get('/simi/song', { id: trackId });
      return (data.songs ?? []).map(normalizeSong);
    },

    /** 包含这首歌的相似歌单 */
    async similarPlaylists(trackId) {
      const data = await http.get('/simi/playlist', { id: trackId });
      return data.playlists ?? [];
    },

    /** 网易云的匿名推荐（不登录时是通用推荐），新用户没有听歌记录时用来冷启动 */
    async genericRecommendations() {
      const data = await http.get('/recommend/songs', {
        timestamp: Date.now(),
      });
      return data.data?.dailySongs ?? [];
    },
  };
}
