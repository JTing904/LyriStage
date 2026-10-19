import { createClient } from '@supabase/supabase-js';

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;

/**
 * 设定 Supabase（界面启动时调用一次，配置来自 .env 的 VITE_SUPABASE_*）。
 * 没有 url / anonKey 时用户数据功能整体关闭，其余（搜索、播放、歌词）照常使用。
 * @param {{ url?: string, anonKey?: string, storage?: any }} options
 *   storage：保存登录状态的地方，默认用浏览器的 localStorage（Node 测试里用内存）
 */
export function configureSupabase({ url, anonKey, storage } = {}) {
  client =
    url && anonKey
      ? createClient(url, anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // 第三方登录（GitHub / Google）回调由我们自己处理（auth.js 的 exchangeAuthCode）。
            // PKCE：回调网址里只带一次性的 code，不会把 token 直接放在网址里
            detectSessionInUrl: false,
            flowType: 'pkce',
            ...(storage ? { storage } : {}),
          },
        })
      : null;
  return client;
}

/** @returns {import('@supabase/supabase-js').SupabaseClient | null} */
export function getSupabase() {
  return client;
}

export function isSupabaseConfigured() {
  return client !== null;
}

export function requireSupabase() {
  if (!client) {
    throw new Error(
      '未配置 Supabase：请在 .env 中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY'
    );
  }
  return client;
}

/** supabase-js 出错时不抛异常而是返回 { error }，这里统一转成异常 */
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
