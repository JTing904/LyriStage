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

    /** 解灰：去其他平台找同一首歌（server/lib/handler.js）；找不到返回 null */
    async unblockUrl(id) {
      try {
        const data = await http.get('/song/url/match', { id });
        return {
          url: data.data.url,
          br: data.data.br,
          source: data.data.source,
        };
      } catch (err) {
        // 网络断了要让播放器知道（不要当成"这首没有音源"而跳歌）
        if (err instanceof ApiError && err.status === undefined) throw err;
        return null;
      }
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
