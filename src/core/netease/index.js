// @ts-check
// 网易云接口（阶段 1：只有调试页需要的搜索、播放、歌词；阶段 2 再从 v1 的 src/api 补齐）

/** 网易云和各音源给的大多是 http 链接，HTTPS 页面里会被当成混合内容拦截 */
export const toHttps = (/** @type {string} */ url) =>
  url.replace(/^http:\/\//, 'https://');

/**
 * @param {import('../http/client').Http} http
 */
export function createNetease(http) {
  return {
    /** 搜索单曲 */
    async searchSongs(keywords, { limit = 30, offset = 0 } = {}) {
      const data = await http.get('/cloudsearch', {
        keywords,
        type: 1,
        limit,
        offset,
      });
      return data.result?.songs ?? [];
    },

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
      } catch {
        return null;
      }
    },

    /** 歌词：lrc 普通歌词、yrc 逐字歌词、tlyric 翻译、romalrc 罗马音 */
    async lyric(id) {
      const data = await http.get('/lyric/new', { id });
      return {
        lrc: data.lrc?.lyric ?? '',
        yrc: data.yrc?.lyric ?? '',
        translation: data.tlyric?.lyric ?? '',
        romaji: data.romalrc?.lyric ?? '',
      };
    },
  };
}
