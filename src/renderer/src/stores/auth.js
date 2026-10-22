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
  resetAvatar,
  signIn,
  signOut,
  signUp,
  updateDisplayName,
  uploadAvatar,
} from '@core/data';
import { isElectron, isNativeApp, onAuthCallback, openAuthPage } from '../platform';
import { t } from '../i18n';

const PROVIDER_LABEL = { github: 'GitHub', google: 'Google', email: '邮箱' };

// 上次查到的成员身份（按账号存），断网时用
const MEMBERSHIP_KEY = 'lyristage-membership';
function cachedMembership(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(MEMBERSHIP_KEY) || 'null');
    return saved?.userId === userId ? saved : null;
  } catch {
    return null;
  }
}
function saveMembership(userId, { member, admin }) {
  try {
    localStorage.setItem(MEMBERSHIP_KEY, JSON.stringify({ userId, member, admin }));
  } catch {
    // 存不了就算了，下次还是会在线查
  }
}

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
  /** 没登录的人按了要登录才能用的功能：这里是那个功能的名字（App 外框会弹出提示），空 = 不弹 */
  const loginPrompt = ref('');
  const enabled = isSupabaseConfigured();

  // 同一个账号同时只查一次（登录状态读完、账号变了都会叫，打开 App 时两个会同时发生）
  /** @type {{ userId: string, promise: Promise<void> } | null} */
  let checking = null;
  function checkMember() {
    if (!user.value) {
      member.value = null;
      admin.value = false;
      return Promise.resolve();
    }
    const userId = user.value.id;
    if (checking?.userId === userId) return checking.promise;
    const promise = queryMember(userId).finally(() => {
      if (checking?.promise === promise) checking = null;
    });
    checking = { userId, promise };
    return promise;
  }
  async function queryMember(userId) {
    try {
      const result = await getMembership();
      member.value = result.member;
      admin.value = result.admin;
      saveMembership(userId, result);
    } catch (err) {
      // 断网、服务器连不上：用上次查到的结果，不要把成员当成非成员踢去输邀请码。
      // （这里只影响界面；数据库和 API 还是会自己检查成员身份）
      console.warn('[LyriStage] 查询成员身份失败', err);
      const cached = cachedMembership(userId);
      member.value = cached ? cached.member : false;
      admin.value = cached ? cached.admin : false;
      // 网络恢复后再查一次
      window.addEventListener('online', () => checkMember(), { once: true });
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
      // 上次查过这个账号：先用上次的答案，画面马上出来，背景再确认一次（不是成员了会被踢回首页）
      const cached = user.value && cachedMembership(user.value.id);
      if (cached) {
        member.value = cached.member;
        admin.value = cached.admin;
        checkMember();
      } else {
        await checkMember();
      }
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
      meta.custom_name ||
      meta.user_name ||
      meta.full_name ||
      meta.name ||
      user.value?.email?.split('@')[0] ||
      ''
    );
  });
  // 自定义头像优先，没有就用 GitHub / Google 的
  const avatarUrl = computed(() => {
    const meta = user.value?.user_metadata ?? {};
    return meta.custom_avatar || meta.avatar_url || meta.picture || null;
  });
  /** 有没有自定义头像（设置页显示"用回 GitHub 头像"） */
  const customAvatar = computed(() => Boolean(user.value?.user_metadata?.custom_avatar));
  /** GitHub / Google 原本的头像（没有就是 null，例如邮箱注册） */
  const providerAvatar = computed(() => {
    const meta = user.value?.user_metadata ?? {};
    return meta.avatar_url || meta.picture || null;
  });
  const providerLabel = computed(
    () => t(PROVIDER_LABEL[user.value?.app_metadata?.provider] ?? '已登录')
  );

  /**
   * 没登录也能逛 App，但真正用（听歌、收藏、歌单…）要登录而且是成员。
   * 可以用就返回 true；不行就弹出「登录后才能…」提示，返回 false
   * @param {string} action 例如「听歌」
   */
  function requireMember(action = '使用这个功能') {
    if (allowed.value) return true;
    loginPrompt.value = action;
    return false;
  }

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
      throw new Error(t('注册成功，但需要先去邮箱点确认链接再登录'));
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

  // ---- 编辑资料（设置页）----

  async function saveName(name) {
    user.value = await updateDisplayName(name);
  }

  /** @param {Blob} image 已经裁成正方形、缩小过的图片 */
  async function saveAvatar(image) {
    user.value = await uploadAvatar(image);
  }

  async function restoreProviderAvatar() {
    user.value = await resetAvatar();
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
    loginPrompt,
    requireMember,
    loggedIn,
    allowed,
    displayName,
    avatarUrl,
    customAvatar,
    providerAvatar,
    providerLabel,
    whenReady,
    loginWithEmail,
    registerWithEmail,
    loginWithProvider,
    saveName,
    saveAvatar,
    restoreProviderAvatar,
    redeem,
    logout,
  };
});

// 开发时改了这个文件：直接换成新版本（不然页面会继续用旧的 store）
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
