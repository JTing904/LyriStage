// 推荐算法需要的网易云接口（都不需要登录网易云账号）
import request from '@/utils/request';

/** 歌手热门 50 首 */
export async function artistTopSongs(artistId) {
  const data = await request({
    url: '/artist/top/song',
    method: 'get',
    params: { id: artistId },
  });
  return data.songs ?? [];
}

/** 包含这首歌的相似歌单 */
export async function similarPlaylists(trackId) {
  const data = await request({
    url: '/simi/playlist',
    method: 'get',
    params: { id: trackId },
  });
  return data.playlists ?? [];
}

/** 歌单里的前 limit 首歌 */
export async function playlistTracks(playlistId, limit = 50) {
  const data = await request({
    url: '/playlist/track/all',
    method: 'get',
    params: { id: playlistId, limit },
  });
  return data.songs ?? [];
}

/** 网易云的匿名推荐（不登录时是通用推荐），新用户没有记录时用来冷启动 */
export async function genericRecommendations() {
  const data = await request({
    url: '/recommend/songs',
    method: 'get',
    params: { timestamp: Date.now() },
  });
  return data.data?.dailySongs ?? [];
}
