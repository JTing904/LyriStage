// @ts-check
// 账号：导出自己的资料、删除账号（设置页"隐私"）
import { requireSupabase, unwrap } from './supabase';
import { listLikedTracks, listPlaylists, getPlaylist } from './library';
import { listDislikedTrackIds, listHistoryBetween, listMonthlyHistory } from './history';
import { removeMyAvatars } from './profile';
import { removeMyPlaylistCovers } from './playlistCovers';
import { downloadMyArchives, removeMyArchives } from './archive';

const PAGE = 1000;

/** 我喜欢的音乐（全部，分页拿） */
async function allLikedTracks() {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await listLikedTracks({ limit: PAGE, offset });
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/**
 * 导出自己在 LyriStage 的全部资料（JSON）：账号、我喜欢、歌单、听歌记录、不喜欢
 */
export async function exportMyData() {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error('请先登录');
  const meta = user.user_metadata ?? {};
  const [liked, playlists, disliked, history] = await Promise.all([
    allLikedTracks(),
    listPlaylists(),
    listDislikedTrackIds(),
    listHistoryBetween(new Date(0), new Date(Date.now() + 86400 * 1000), { maxRows: 200000 }),
  ]);
  // 一年多以前的听歌记录已经整理成每月小结
  const monthlyHistory = await listMonthlyHistory(new Date(0), new Date(Date.now() + 86400 * 1000));
  // 两年以前的已经搬去 File storage（每人每年一个文件）
  const archivedHistory = await downloadMyArchives(user.id);
  const fullPlaylists = [];
  for (const p of playlists) fullPlaylists.push(await getPlaylist(p.id));
  return {
    app: 'LyriStage',
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at,
      name: meta.custom_name || meta.full_name || meta.name || meta.user_name || null,
      signInWith: user.app_metadata?.provider ?? null,
    },
    likedTracks: liked,
    playlists: fullPlaylists,
    dislikedTrackIds: disliked,
    playHistory: history,
    playHistoryMonthly: monthlyHistory,
    playHistoryArchived: archivedHistory,
  };
}

/**
 * 永久删除自己的账号和所有资料（不能复原）。
 * 先删头像图片，再由数据库函数删掉账号（其他资料跟着删），最后在这台装置上登出
 */
export async function deleteMyAccount() {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('请先登录');
  await removeMyAvatars(uid);
  await removeMyPlaylistCovers(uid);
  await removeMyArchives(uid).catch(() => {});
  unwrap(await supabase.rpc('delete_my_account'));
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}
