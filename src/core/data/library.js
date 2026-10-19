// 我喜欢的音乐 + 自己的歌单
import { requireSupabase, unwrap } from './supabase';
import { DEFAULT_SOURCE, fromRow, toRow } from './track';

// 我喜欢的音乐 -------------------------------------------------------------------

/** 所有喜欢的歌曲 ID（用来显示红心），按喜欢时间倒序 */
export async function listLikedTrackIds(source = DEFAULT_SOURCE) {
  const rows = unwrap(
    await requireSupabase()
      .from('liked_tracks')
      .select('track_id')
      .eq('source', source)
      .order('liked_at', { ascending: false })
  );
  return rows.map(r => Number(r.track_id));
}

export async function listLikedTracks({ limit = 1000, offset = 0 } = {}) {
  const rows = unwrap(
    await requireSupabase()
      .from('liked_tracks')
      .select('track')
      .order('liked_at', { ascending: false })
      .range(offset, offset + limit - 1)
  );
  return rows.map(fromRow);
}

export async function likeTrack(track, source = DEFAULT_SOURCE) {
  unwrap(
    await requireSupabase().from('liked_tracks').upsert(toRow(track, source), {
      onConflict: 'user_id,source,track_id',
      ignoreDuplicates: true,
    })
  );
}

export async function unlikeTrack(trackId, source = DEFAULT_SOURCE) {
  unwrap(
    await requireSupabase()
      .from('liked_tracks')
      .delete()
      .eq('source', source)
      .eq('track_id', String(trackId))
  );
}

// 歌单 ---------------------------------------------------------------------------

/**
 * 所有歌单；covers 是前 4 首歌的封面（没有自己封面的歌单用来拼一张）
 */
export async function listPlaylists() {
  return unwrap(
    await requireSupabase()
      .from('playlists')
      .select(
        'id, name, description, cover_url, created_at, updated_at, playlist_tracks(count), preview:playlist_tracks(cover:track->al->>picUrl, position)'
      )
      .order('created_at', { ascending: false })
      .order('position', { referencedTable: 'preview' })
      .limit(4, { referencedTable: 'preview' })
  ).map(({ playlist_tracks, preview, ...p }) => ({
    ...p,
    trackCount: playlist_tracks[0]?.count ?? 0,
    covers: (preview ?? []).map(t => t.cover).filter(Boolean),
  }));
}

/** 歌单详情 + 歌曲（按 position 排序） */
export async function getPlaylist(id) {
  const playlist = unwrap(
    await requireSupabase()
      .from('playlists')
      .select('id, name, description, cover_url, created_at, updated_at')
      .eq('id', id)
      .single()
  );
  const rows = unwrap(
    await requireSupabase()
      .from('playlist_tracks')
      .select('track, position')
      .eq('playlist_id', id)
      .order('position')
  );
  return { ...playlist, tracks: rows.map(fromRow) };
}

export async function createPlaylist({ name, description = null }) {
  return unwrap(
    await requireSupabase()
      .from('playlists')
      .insert({ name, description })
      .select()
      .single()
  );
}

export async function updatePlaylist(id, fields) {
  const { name, description, cover_url } = fields;
  unwrap(
    await requireSupabase()
      .from('playlists')
      .update({
        name,
        description,
        cover_url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
  );
}

export async function deletePlaylist(id) {
  unwrap(await requireSupabase().from('playlists').delete().eq('id', id));
}

/** 把歌加到歌单末尾，已经在歌单里的会跳过 */
export async function addTracksToPlaylist(
  playlistId,
  tracks,
  source = DEFAULT_SOURCE
) {
  const last = unwrap(
    await requireSupabase()
      .from('playlist_tracks')
      .select('position')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: false })
      .limit(1)
  );
  const start = (last[0]?.position ?? 0) + 1;
  const rows = tracks.map((track, i) => ({
    playlist_id: playlistId,
    position: start + i,
    ...toRow(track, source),
  }));
  unwrap(
    await requireSupabase().from('playlist_tracks').upsert(rows, {
      onConflict: 'playlist_id,source,track_id',
      ignoreDuplicates: true,
    })
  );
}

export async function removeTracksFromPlaylist(
  playlistId,
  trackIds,
  source = DEFAULT_SOURCE
) {
  unwrap(
    await requireSupabase()
      .from('playlist_tracks')
      .delete()
      .eq('playlist_id', playlistId)
      .eq('source', source)
      .in('track_id', trackIds.map(String))
  );
}

/**
 * 拖动排序：把歌移到 before 和 after 两首歌之间
 * 只改这一行的 position（取前后两首的中间值）
 * @param {number|null} beforePosition 移动后上一首的 position，移到最前面时为 null
 * @param {number|null} afterPosition  移动后下一首的 position，移到最后面时为 null
 */
export async function moveTrackInPlaylist(
  playlistId,
  trackId,
  beforePosition,
  afterPosition,
  source = DEFAULT_SOURCE
) {
  let position;
  if (beforePosition == null && afterPosition == null) position = 1;
  else if (beforePosition == null) position = afterPosition - 1;
  else if (afterPosition == null) position = beforePosition + 1;
  else position = (beforePosition + afterPosition) / 2;

  unwrap(
    await requireSupabase()
      .from('playlist_tracks')
      .update({ position })
      .eq('playlist_id', playlistId)
      .eq('source', source)
      .eq('track_id', String(trackId))
  );
}
