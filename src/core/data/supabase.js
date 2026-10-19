import { createClient } from '@supabase/supabase-js';

const url = process.env.VUE_APP_SUPABASE_URL;
const anonKey = process.env.VUE_APP_SUPABASE_ANON_KEY;

/**
 * 没有在 .env 里配置 Supabase 时为 null，LyriStage 的用户数据功能会整体关闭，
 * 其余（搜索、播放、歌词）照常使用。
 * @type {import('@supabase/supabase-js').SupabaseClient | null}
 */
export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Electron 和手机网页都不走 OAuth 回调，不需要从网址里解析登录信息
          detectSessionInUrl: false,
        },
      })
    : null;

export function isSupabaseConfigured() {
  return supabase !== null;
}

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      '未配置 Supabase：请在 .env 中设置 VUE_APP_SUPABASE_URL 和 VUE_APP_SUPABASE_ANON_KEY'
    );
  }
  return supabase;
}

/** supabase-js 出错时不抛异常而是返回 { error }，这里统一转成异常 */
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
