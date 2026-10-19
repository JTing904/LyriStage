// 手机 App 自己解灰：网易云拿不到（VIP、版权）时，直接从手机去其他平台找同一首歌。
// Vercel 的服务器连不上这个音源，但手机跟电脑版一样在马来西亚，可以连得上。
// 用 App 原生的网络请求（CapacitorHttp），浏览器的 fetch 会被跨域挡掉，所以网页版用不了。
// 音源：GD Studio 的 API（music.gdstudio.xyz），也就是 @unblockneteasemusic/server 的 pyncmd
import { CapacitorHttp } from '@capacitor/core';

/** 小于这个大小的当成占位音频（跟 server/lib/handler.js 一样） */
const MIN_AUDIO_BYTES = 300 * 1024;

/**
 * @param {number} id 网易云歌曲 ID
 * @returns {Promise<{ url: string, br: number, source: string } | null>}
 */
export async function unblockOnDevice(id) {
  try {
    const res = await CapacitorHttp.get({
      url: `https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${id}&br=320`,
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    if (res.status !== 200 || !data?.url || !(data.br > 0)) return null;
    if (data.size && data.size < MIN_AUDIO_BYTES) return null;
    return {
      url: data.url.replace(/^http:\/\//, 'https://'),
      br: data.br * 1000,
      source: 'pyncmd',
    };
  } catch {
    return null;
  }
}
