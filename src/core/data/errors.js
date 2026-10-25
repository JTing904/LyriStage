// @ts-check
// 错误自动回报（supabase/migrations/20261029010000_app_errors.sql）
// 成员遇到播不了、歌词载不出来、App 出错时记一笔；只有管理员看得到
import { requireSupabase, unwrap } from './supabase';

/**
 * 记一笔（失败就算了：回报错误本身不能再造成错误）
 * @param {{ kind: 'crash' | 'playback' | 'unplayable' | 'lyrics', message: string, detail?: string | null,
 *   platform: 'windows' | 'android' | 'web' | 'iphone', appVersion?: string, context?: object | null }} error
 */
export async function reportError(error) {
  try {
    await requireSupabase().from('app_errors').insert({
      kind: error.kind,
      message: String(error.message || '（没有错误信息）').slice(0, 500),
      detail: error.detail ? String(error.detail).slice(0, 4000) : null,
      platform: error.platform,
      app_version: error.appVersion?.slice(0, 20) ?? null,
      context: error.context ?? null,
    });
  } catch {
    // 不管
  }
}

/**
 * 管理员：最近几天的错误，同一种合并成一行；数据库还没执行那份 SQL 时回传 null
 * @param {number} [days]
 */
export async function adminErrorSummary(days = 7) {
  const { data, error } = await requireSupabase().rpc('admin_error_summary', { days });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return null;
    throw error;
  }
  return data.map(r => ({
    kind: r.kind,
    message: r.message,
    times: Number(r.times),
    people: Number(r.people),
    lastAt: r.last_at,
    platforms: r.platforms ?? [],
    versions: r.versions ?? [],
    names: r.names ?? [],
    example: r.example,
    detail: r.detail,
  }));
}

/** 管理员：全部清掉 */
export async function adminClearErrors() {
  unwrap(await requireSupabase().rpc('admin_clear_errors'));
}
