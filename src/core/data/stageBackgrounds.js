// @ts-check
// 歌词舞台自定义背景（supabase/migrations/20261029000000_stage_backgrounds.sql）
// - '*'：全部歌用的那张（enabled 关掉 = 换回封面，照片留着）
// - 'netease:<id>'：这首歌专属，比 '*' 优先
// 照片在私人的 stage-backgrounds 桶，只有自己读得到
import { requireSupabase, unwrap } from './supabase';
import { DEFAULT_SOURCE } from './track';

const BUCKET = 'stage-backgrounds';
export const ALL_SONGS = '*';

/** 这首歌在表里的键 @param {{ id: number | string }} track */
export const trackKey = (track, source = DEFAULT_SOURCE) => `${source}:${track.id}`;

async function myId() {
  const { data } = await requireSupabase().auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('请先登录');
  return uid;
}

/**
 * 自己设过的背景；还没执行那份 SQL 时回传 null（界面就不显示这个功能）
 * @returns {Promise<Array<{ key: string, path: string, enabled: boolean }> | null>}
 */
export async function listStageBackgrounds() {
  const { data, error } = await requireSupabase().from('stage_backgrounds').select('track_key, path, enabled');
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw error;
  }
  return data.map(r => ({ key: r.track_key, path: r.path, enabled: r.enabled }));
}

/**
 * 上传一张背景给全部歌（ALL_SONGS）或某首歌，换掉那个位置原本的照片
 * @param {string} key
 * @param {Blob} image 已经缩好的图片
 */
export async function setStageBackground(key, image) {
  const db = requireSupabase();
  const uid = await myId();
  const ext = image.type === 'image/png' ? 'png' : image.type === 'image/jpeg' ? 'jpg' : 'webp';
  const name = key === ALL_SONGS ? 'all' : key.replace(':', '-');
  const path = `${uid}/${name}-${Date.now()}.${ext}`;
  unwrap(await db.storage.from(BUCKET).upload(path, image, { contentType: image.type }));
  const { data: old } = await db.from('stage_backgrounds').select('path').eq('track_key', key).maybeSingle();
  unwrap(
    await db
      .from('stage_backgrounds')
      .upsert({ user_id: uid, track_key: key, path, enabled: true, updated_at: new Date().toISOString() })
  );
  if (old?.path) await db.storage.from(BUCKET).remove([old.path]).catch(() => {});
  return path;
}

/** 全部歌那张：开（用照片）/ 关（用封面） @param {boolean} enabled */
export async function setAllSongsBackgroundEnabled(enabled) {
  unwrap(
    await requireSupabase()
      .from('stage_backgrounds')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('track_key', ALL_SONGS)
  );
}

/** 拿掉某个位置的背景（照片一起删） @param {string} key */
export async function removeStageBackground(key) {
  const db = requireSupabase();
  const { data } = await db.from('stage_backgrounds').select('path').eq('track_key', key).maybeSingle();
  unwrap(await db.from('stage_backgrounds').delete().eq('track_key', key));
  if (data?.path) await db.storage.from(BUCKET).remove([data.path]).catch(() => {});
}

/** 下载照片（私人桶，要登录） @param {string} path */
export async function downloadStageBackground(path) {
  return /** @type {Blob} */ (unwrap(await requireSupabase().storage.from(BUCKET).download(path)));
}

/** 删除账号前：删掉自己所有的背景照片 @param {string} uid */
export async function removeMyStageBackgrounds(uid) {
  try {
    const bucket = requireSupabase().storage.from(BUCKET);
    const { data } = await bucket.list(uid, { limit: 1000 });
    const all = (data ?? []).map(f => `${uid}/${f.name}`);
    if (all.length) await bucket.remove(all);
  } catch {
    // 还没执行那份 SQL（没有这个桶）时什么都不用删
  }
}
