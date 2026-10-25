// @ts-check
// 歌单自定义封面（编辑歌单时换照片）。
// 图片放在 Storage 的 playlist-covers 桶，路径 <user id>/<歌单 id>-<时间>.webp
// （见 supabase/migrations/20261028010000_playlist_covers.sql），网址存在 playlists.cover_url
import { requireSupabase, unwrap } from './supabase';

const BUCKET = 'playlist-covers';

async function myId() {
  const { data } = await requireSupabase().auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('请先登录');
  return uid;
}

/**
 * 上传歌单的新封面（已经裁好、缩好的图片），删掉这个歌单旧的封面图，回传新网址
 * @param {string} playlistId
 * @param {Blob} image
 */
export async function uploadPlaylistCover(playlistId, image) {
  const supabase = requireSupabase();
  const uid = await myId();
  const ext = image.type === 'image/png' ? 'png' : image.type === 'image/jpeg' ? 'jpg' : 'webp';
  // 每次用新档名：网址变了，各处的图片缓存（还有共同歌单的朋友那边）才会换成新封面
  const path = `${uid}/${playlistId}-${Date.now()}.${ext}`;
  unwrap(
    await supabase.storage.from(BUCKET).upload(path, image, {
      contentType: image.type,
      cacheControl: '31536000',
    })
  );
  await removePlaylistCovers(playlistId, path);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * 删掉这个歌单上传过的封面（换回歌曲封面、删除歌单时）；删不掉不影响使用
 * @param {string} playlistId
 * @param {string | null} [keep] 要留着的那张
 */
export async function removePlaylistCovers(playlistId, keep = null) {
  try {
    const uid = await myId();
    const bucket = requireSupabase().storage.from(BUCKET);
    const { data } = await bucket.list(uid, { search: playlistId });
    const old = (data ?? [])
      .filter(f => f.name.startsWith(`${playlistId}-`))
      .map(f => `${uid}/${f.name}`)
      .filter(p => p !== keep);
    if (old.length) await bucket.remove(old);
  } catch {
    // 留着旧图也没关系
  }
}

/** 删除账号前：删掉自己所有的歌单封面 @param {string} uid */
export async function removeMyPlaylistCovers(uid) {
  try {
    const bucket = requireSupabase().storage.from(BUCKET);
    const { data } = await bucket.list(uid, { limit: 1000 });
    const all = (data ?? []).map(f => `${uid}/${f.name}`);
    if (all.length) await bucket.remove(all);
  } catch {
    // 还没执行那份 SQL（没有这个桶）时什么都不用删
  }
}
