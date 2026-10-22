// @ts-check
// 搬去 File storage 的旧听歌记录（两年以前的每月小结，每人每年一个 <user id>/<年>.json.gz）。
// 搬是 Edge Function 每月自动做的（supabase/functions/archive-history）；App 这边只需要：
// 导出资料时一起带走、清除听歌记录和删账号时一起删。
import { requireSupabase, unwrap } from './supabase';

const BUCKET = 'history-archive';

/** @param {string} uid */
async function listFiles(uid) {
  const { data, error } = await requireSupabase().storage.from(BUCKET).list(uid, { limit: 1000 });
  // 还没执行 2026-10-28 那份 SQL（没有这个桶）：当作没有
  if (error) return [];
  return (data ?? []).filter(f => f.name.endsWith('.json.gz')).map(f => `${uid}/${f.name}`);
}

/**
 * 下载自己所有搬走的旧记录（导出资料用），按年份排好
 * @param {string} uid
 * @returns {Promise<Array<{ year: number, months: object[], hours: object[] }>>}
 */
export async function downloadMyArchives(uid) {
  const bucket = requireSupabase().storage.from(BUCKET);
  const archives = [];
  for (const path of await listFiles(uid)) {
    const blob = unwrap(await bucket.download(path));
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    archives.push(JSON.parse(await new Response(stream).text()));
  }
  return archives.sort((a, b) => a.year - b.year);
}

/**
 * 删掉自己所有搬走的旧记录（清除听歌记录、删账号时）
 * @param {string} uid
 */
export async function removeMyArchives(uid) {
  const paths = await listFiles(uid);
  if (paths.length) unwrap(await requireSupabase().storage.from(BUCKET).remove(paths));
}
