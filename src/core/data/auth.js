// LyriStage 自己的账号（邮箱 + 密码），和网易云账号无关
import { requireSupabase, getSupabase, unwrap } from './supabase';

export async function signUp(email, password) {
  return unwrap(await requireSupabase().auth.signUp({ email, password }));
}

export async function signIn(email, password) {
  return unwrap(
    await requireSupabase().auth.signInWithPassword({ email, password })
  );
}

export async function signOut() {
  unwrap(await requireSupabase().auth.signOut());
}

/** 当前登录的用户，未登录或未配置 Supabase 时返回 null */
export async function getCurrentUser() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/**
 * 监听登录状态变化（登录、退出、token 刷新）
 * @param {(user: import('@supabase/supabase-js').User | null) => void} callback
 * @returns {() => void} 取消监听
 */
export function onAuthChange(callback) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
