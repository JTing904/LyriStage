// 解灰：每首歌在 B 站挑好的视频，全部会员共用（supabase/migrations/20261024000000_bilibili_picks.sql）。
// 同一首歌只要有一个人搜过，其他人就不用再搜（B 站搜太多次会要求人机验证）。
// 这里查不到、存不了都不影响听歌，所以出错一律当成没有
import { getSupabase } from './supabase';

/** @returns {Promise<string | null>} 以前挑过的视频编号（bvid） */
export async function getBilibiliPick(songId) {
  try {
    const { data } = await getSupabase()
      .from('bilibili_picks')
      .select('bvid')
      .eq('song_id', songId)
      .maybeSingle();
    return data?.bvid ?? null;
  } catch {
    return null;
  }
}

/** 记下这首歌用的视频（服务器检查过、真的播得了才会回传） */
export async function saveBilibiliPick(songId, bvid) {
  try {
    await getSupabase()
      .from('bilibili_picks')
      .upsert({ song_id: songId, bvid, updated_at: new Date().toISOString() });
  } catch {
    // 存不了就算了，下次再搜
  }
}
