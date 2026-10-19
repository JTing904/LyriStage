// LyriStage 自己的账号（邮箱 + 密码 / GitHub），和网易云账号无关。
// 邀请制：登录之后还要兑换邀请码成为"成员"才能使用（见 supabase/migrations/20261020000000_invites.sql）
import { requireSupabase, getSupabase, getSupabaseConfig, unwrap } from './supabase';

export async function signUp(email, password) {
  return unwrap(await requireSupabase().auth.signUp({ email, password }));
}

export async function signIn(email, password) {
  return unwrap(
    await requireSupabase().auth.signInWithPassword({ email, password })
  );
}

/**
 * 第三方登录（GitHub / Google）第一步：拿到授权页网址，由调用方决定怎么打开
 * （网页版直接跳转；电脑版用系统浏览器打开）。
 * 授权完成后浏览器会回到 redirectTo，网址里带 ?code=…，再交给 exchangeAuthCode()。
 * @param {'github' | 'google'} provider
 * @param {string} redirectTo
 * @returns {Promise<string>} 授权页网址
 */
export async function getOAuthUrl(provider, redirectTo) {
  const data = unwrap(
    await requireSupabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    })
  );
  return data.url;
}

/**
 * Supabase 上已经开启的第三方登录（例如 ['github', 'google']）。
 * 登录页按这个显示按钮：在 Supabase 后台开了 Google，按钮就自己出现
 * @returns {Promise<string[]>}
 */
export async function listOAuthProviders() {
  const config = getSupabaseConfig();
  if (!config) return [];
  const res = await fetch(`${config.url}/auth/v1/settings`, {
    headers: { apikey: config.anonKey },
  });
  const { external = {} } = await res.json();
  return Object.entries(external)
    .filter(([name, on]) => on && name !== 'email' && name !== 'phone' && name !== 'anonymous_users')
    .map(([name]) => name);
}

/** 第三方登录第二步：用回调网址里的 code 换成登录状态 */
export async function exchangeAuthCode(code) {
  return unwrap(await requireSupabase().auth.exchangeCodeForSession(code));
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

/** 当前的 access token（请求 Vercel 上的 API 时要带），未登录时返回 null */
export async function getAccessToken() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** 当前登录的用户是不是成员（兑换过邀请码） */
export async function isMember() {
  return Boolean(unwrap(await requireSupabase().rpc('is_member')));
}

/**
 * 当前用户的成员身份：是不是成员、是不是管理员（可以生成邀请码）
 * @returns {Promise<{ member: boolean, admin: boolean }>}
 */
export async function getMembership() {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return { member: false, admin: false };
  const row = unwrap(
    await supabase
      .from('members')
      .select('is_admin')
      .eq('user_id', userId)
      .maybeSingle()
  );
  return { member: Boolean(row), admin: Boolean(row?.is_admin) };
}

/**
 * 兑换邀请码，成功后就是成员了。邀请码无效 / 过期 / 用完会抛出错误
 * @param {string} code
 */
export async function redeemInvite(code) {
  return unwrap(await requireSupabase().rpc('redeem_invite', { invite: code }));
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
