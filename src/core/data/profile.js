// @ts-check
// 自定义名字和头像（设置页"编辑资料"）。
// 名字、头像网址存在账号的 user_metadata.custom_name / custom_avatar：
// GitHub、Google 每次登录会更新 name、avatar_url 这些键，但不会动我们自己的键。
// 头像图片放在 Storage 的 avatars 桶，路径 <user id>/<时间>.webp（见 supabase/migrations/20261020020000_avatars.sql）
import { requireSupabase, unwrap } from './supabase';

const BUCKET = 'avatars';
export const NAME_MAX = 30;

/**
 * 改名字；空字符串 = 不用自定义名字（回到 GitHub / Google / 邮箱的名字）
 * @param {string} name
 */
export async function updateDisplayName(name) {
  const value = name.trim().slice(0, NAME_MAX) || null;
  const { user } = unwrap(
    await requireSupabase().auth.updateUser({ data: { custom_name: value } })
  );
  return user;
}

/**
 * 上传新头像（已经缩好的图片），换掉旧的，返回更新后的用户
 * @param {Blob} image
 */
export async function uploadAvatar(image) {
  const supabase = requireSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('请先登录');
  const ext = image.type === 'image/png' ? 'png' : image.type === 'image/jpeg' ? 'jpg' : 'webp';
  // 每次用新档名：网址变了，各处的图片缓存（还有一起听的朋友那边）才会换成新头像
  const path = `${uid}/${Date.now()}.${ext}`;
  unwrap(
    await supabase.storage.from(BUCKET).upload(path, image, {
      contentType: image.type,
      cacheControl: '31536000',
    })
  );
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { user } = unwrap(await supabase.auth.updateUser({ data: { custom_avatar: url } }));
  await removeOldAvatars(uid, path);
  return user;
}

/** 不用自定义头像（回到 GitHub / Google 的头像），顺便删掉上传过的图 */
export async function resetAvatar() {
  const supabase = requireSupabase();
  const { user } = unwrap(await supabase.auth.updateUser({ data: { custom_avatar: null } }));
  if (user) await removeOldAvatars(user.id, null);
  return user;
}

/**
 * 删掉自己资料夹里除了 keep 以外的头像（删不掉不影响使用）
 * @param {string} uid
 * @param {string | null} keep
 */
async function removeOldAvatars(uid, keep) {
  const bucket = requireSupabase().storage.from(BUCKET);
  try {
    const { data } = await bucket.list(uid);
    const old = (data ?? []).map(f => `${uid}/${f.name}`).filter(p => p !== keep);
    if (old.length) await bucket.remove(old);
  } catch {
    // 留着旧图也没关系
  }
}
