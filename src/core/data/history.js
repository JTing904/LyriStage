// 听歌记录 + 不喜欢（FM 垃圾桶）
import { requireSupabase, unwrap } from './supabase';
import { DEFAULT_SOURCE, fromRow, toRow } from './track';

/**
 * 听了不到 30 秒、而且不到一半就切走，算"跳过"。
 * 推荐算法会把跳过当成负面信号。
 */
export function isSkip(listenedSeconds, durationSeconds) {
  if (!durationSeconds) return listenedSeconds < 30;
  return listenedSeconds < 30 && listenedSeconds < durationSeconds / 2;
}

/**
 * 记录一次播放（切歌或播完时调用）
 * @param {Record<string, any>} track 网易云歌曲对象
 * @param {{ listenedSeconds: number, context?: string, source?: string }} options
 */
export async function recordPlay(
  track,
  { listenedSeconds, context = null, source = DEFAULT_SOURCE }
) {
  const durationSeconds = Math.round((track.dt ?? 0) / 1000) || null;
  const listened = Math.max(0, Math.round(listenedSeconds));
  unwrap(
    await requireSupabase()
      .from('play_history')
      .insert({
        ...toRow(track, source),
        listened_seconds: listened,
        duration_seconds: durationSeconds,
        skipped: isSkip(listened, durationSeconds),
        context,
      })
  );
}

/**
 * 最近的播放记录（推荐算法用）
 * @param {{ days?: number, limit?: number }} options
 */
export async function listRecentHistory({ days = 30, limit = 1000 } = {}) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  return unwrap(
    await requireSupabase()
      .from('play_history')
      .select(
        'source, track_id, track, played_at, listened_seconds, duration_seconds, skipped, context'
      )
      .gte('played_at', since)
      .order('played_at', { ascending: false })
      .limit(limit)
  );
}

/**
 * 听歌排行：'week' 最近一周，'all' 所有时间
 * 返回带 playCount 的歌曲对象，和网易云 /user/record 的格式一致
 */
export async function playRanking(range = 'week', maxRows = 100) {
  const since =
    range === 'week'
      ? new Date(Date.now() - 7 * 86400 * 1000).toISOString()
      : null;
  const rows = unwrap(
    await requireSupabase().rpc('play_ranking', { since, max_rows: maxRows })
  );
  return rows.map(row => ({ ...fromRow(row), playCount: row.play_count }));
}

export async function clearHistory() {
  unwrap(
    await requireSupabase()
      .from('play_history')
      .delete()
      .gte('played_at', '1970-01-01')
  );
}

// 不喜欢 --------------------------------------------------------------------------

export async function dislikeTrack(trackId, source = DEFAULT_SOURCE) {
  unwrap(
    await requireSupabase()
      .from('disliked_tracks')
      .upsert(
        { source, track_id: String(trackId) },
        { onConflict: 'user_id,source,track_id', ignoreDuplicates: true }
      )
  );
}

export async function listDislikedTrackIds(source = DEFAULT_SOURCE) {
  const rows = unwrap(
    await requireSupabase()
      .from('disliked_tracks')
      .select('track_id')
      .eq('source', source)
  );
  return rows.map(r => r.track_id);
}
