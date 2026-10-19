// LyriStage 账号（Supabase）的登录状态。
// 邀请制：登录了还不够，要兑换过邀请码（成为成员）才能使用 App，见 router.js 的路由守卫
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  exchangeAuthCode,
  getCurrentUser,
  getMembership,
  getOAuthUrl,
  isSupabaseConfigured,
  onAuthChange,
  redeemInvite,
  signIn,
  signOut,
  signUp,
} from '@core/data';
import { isElectron, isNativeApp, onAuthCallback, openAuthPage } from '../platform';

const PROVIDER_LABEL = { github: 'GitHub', google: 'Google', email: '邮箱' };

/** 第三方登录授权完回到哪里：电脑版 / 手机 App 回到 App（自定义协议），网页版回到当前网址 */
const oauthRedirect = () =>
  isElectron || isNativeApp
    ? 'lyristage://auth/callback'
    : `${location.origin}${location.pathname}`;

/** 回调网址里的 code（或出错信息）换成登录状态 */
async function finishOAuth(url) {
  const params = new URL(url).searchParams;
  const error = params.get('error_description') || params.get('error');
  if (error) throw new Error(error);
  const code = params.get('code');
  if (code) await exchangeAuthCode(code);
}

export const useAuthStore = defineStore('auth', () => {
  /** @type {import('vue').Ref<import('@supabase/supabase-js').User | null>} */
  const user = ref(null);
  /** 是不是成员：null = 还不知道（还没查完） */
  const member = ref(null);
  /** 管理员：设置页可以一键生成邀请码 */
  const admin = ref(false);
  /** 第一次读完登录状态和成员身份之前是 false（避免先闪一下登录页） */
  const ready = ref(false);
  /** 第三方登录回来时出的错，登录页显示 */
  const oauthError = ref('');
  const enabled = isSupabaseConfigured();

  async function checkMember() {
    if (!user.value) {
      member.value = null;
      admin.value = false;
      return;
    }
    try {
      const result = await getMembership();
      member.value = result.member;
      admin.value = result.admin;
    } catch (err) {
      console.warn('[LyriStage] 查询成员身份失败', err);
      member.value = false;
      admin.value = false;
    }
  }

  // 换了账号（登录、退出）才重新查；token 刷新时用户不变，不用查
  watch(
    () => user.value?.id,
    () => checkMember()
  );

  const readyPromise = (async () => {
    try {
      // 网页版：GitHub 授权完跳回来，网址里带着 ?code=…
      if (!isElectron && !isNativeApp && new URLSearchParams(location.search).has('code')) {
        try {
          await finishOAuth(location.href);
        } catch (err) {
          oauthError.value = err.message || String(err);
        }
        history.replaceState(null, '', location.pathname + location.hash);
      }
      user.value = await getCurrentUser();
      await checkMember();
    } finally {
      ready.value = true;
    }
  })();
  onAuthChange(u => (user.value = u));

  // 电脑版 / 手机 App：系统浏览器授权完，通过 lyristage://auth/callback?code=… 回到 App
  onAuthCallback(url => {
    oauthError.value = '';
    finishOAuth(url).catch(err => {
      oauthError.value = err.message || String(err);
    });
  });

  /** 等第一次读完登录状态（路由守卫用） */
  const whenReady = () => readyPromise;

  const loggedIn = computed(() => Boolean(user.value));
  /** 可以使用 App：登录了而且是成员 */
  const allowed = computed(() => loggedIn.value && member.value === true);

  const displayName = computed(() => {
    const meta = user.value?.user_metadata ?? {};
    return (
      meta.user_name ||
      meta.full_name ||
      meta.name ||
      user.value?.email?.split('@')[0] ||
      ''
    );
  });
  const avatarUrl = computed(() => user.value?.user_metadata?.avatar_url ?? null);
  const providerLabel = computed(
    () => PROVIDER_LABEL[user.value?.app_metadata?.provider] ?? '已登录'
  );

  // ---- 操作（登录页、设置页用）----

  async function loginWithEmail(email, password) {
    await signIn(email, password);
    user.value = await getCurrentUser();
    await checkMember();
  }

  /** 注册并马上兑换邀请码；邀请码不对时账号已经建好，会停在"输入邀请码"那一步 */
  async function registerWithEmail(email, password, invite) {
    const { session } = await signUp(email, password);
    if (!session) {
      throw new Error('注册成功，但需要先去邮箱点确认链接再登录');
    }
    user.value = session.user;
    await redeem(invite);
  }

  async function loginWithProvider(provider) {
    oauthError.value = '';
    await openAuthPage(await getOAuthUrl(provider, oauthRedirect()));
  }

  async function redeem(invite) {
    await redeemInvite(invite);
    await checkMember();
  }

  async function logout() {
    await signOut();
    user.value = null;
  }

  return {
    user,
    member,
    admin,
    ready,
    enabled,
    oauthError,
    loggedIn,
    allowed,
    displayName,
    avatarUrl,
    providerLabel,
    whenReady,
    loginWithEmail,
    registerWithEmail,
    loginWithProvider,
    redeem,
    logout,
  };
});

// 开发时改了这个文件：直接换成新版本（不然页面会继续用旧的 store）
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
