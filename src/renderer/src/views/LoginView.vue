<script setup>
// 登录页（邀请制）：
// - 登录：GitHub 或邮箱 + 密码
// - 注册：邮箱 + 密码 + 邀请码
// - 登录了但还不是成员（例如第一次用 GitHub 登录）：输入邀请码
// - 忘记密码：邮箱收一组验证码，输入验证码和新密码就登录
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { listOAuthProviders } from '@core/data';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useAvatarStore } from '../stores/avatar';
import { useNoticeStore } from '../stores/notice';
import { redirectTarget } from '../router';
import AvatarFigure from '../components/AvatarFigure.vue';
import Icon from '../components/Icon.vue';
import { LOCALES, locale, t } from '../i18n';
import { humanMessage } from '../friendlyError';

const auth = useAuthStore();
const avatar = useAvatarStore();
const route = useRoute();
const router = useRouter();

// 第三方登录按钮：只显示 Supabase 上已经开启的（后台开了 Google，按钮就会出现）
const PROVIDERS = [
  { id: 'github', label: '使用 GitHub 登录' },
  { id: 'google', label: '使用 Google 登录' },
];
const enabledProviders = ref(['github']);
onMounted(() => {
  listOAuthProviders()
    .then(list => (enabledProviders.value = list))
    .catch(() => {});
});
const providers = computed(() => PROVIDERS.filter(p => enabledProviders.value.includes(p.id)));

const mode = ref('login'); // 'login' | 'register' | 'reset'
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const invite = ref('');
/** 名字：注册时填；GitHub / Google 登录的人在输入邀请码那一步填（先帮他填好那边的名字） */
const name = ref('');
watch(
  () => auth.loggedIn && auth.member === false,
  needs => needs && !name.value && (name.value = auth.displayName),
  { immediate: true }
);
const busy = ref(false);
const error = ref('');

/** 登录了但还没兑换邀请码 */
const needInvite = computed(() => auth.loggedIn && auth.member === false);

// 朋友分享的邀请链接（#/invite/邀请码 → 这里的 ?invite=）：直接到「注册」，邀请码帮他填好。
// 也记在这台设备：用 Google / GitHub 登录要先离开 App，回来到「输入邀请码」那一步时也帮他填好
const PENDING_INVITE_KEY = 'lyristage:pending-invite';
const fromLink = String(route.query.invite ?? '').trim();
try {
  if (fromLink) localStorage.setItem(PENDING_INVITE_KEY, fromLink);
} catch {
  // 存不了：这次照样帮他填
}
/** 链接带来的邀请码（没有就是 ''） */
const linkedInvite = (() => {
  try {
    return fromLink || localStorage.getItem(PENDING_INVITE_KEY) || '';
  } catch {
    return fromLink;
  }
})();
if (linkedInvite) invite.value = linkedInvite;
if (fromLink) mode.value = 'register';
/** 邀请码是链接帮他填的（还没改过）：显示「已填好」 */
const inviteFilled = computed(() => Boolean(linkedInvite) && invite.value === linkedInvite);

// 成为成员就进 App
watch(
  () => auth.allowed,
  allowed => {
    if (!allowed) return;
    try {
      localStorage.removeItem(PENDING_INVITE_KEY);
    } catch {
      // 没关系
    }
    router.replace(redirectTarget(route));
  },
  { immediate: true }
);

// 换模式时清掉错误
watch([mode, needInvite], () => (error.value = ''));

/** Supabase 的英文错误换成中文 */
function describe(err) {
  const message = err?.message || String(err);
  if (/invalid login credentials/i.test(message)) return t('邮箱或密码不对');
  if (/already registered|already been registered/i.test(message))
    return t('这个邮箱已经注册过了，请直接登录（之前用 GitHub 登录过的话，请按"使用 GitHub 登录"）');
  if (/password should be at least/i.test(message)) return t('密码太短了');
  if (/unable to validate email|invalid.*email/i.test(message))
    return t('邮箱格式不对');
  if (/rate limit|too many|only request this after/i.test(message)) return t('尝试太多次了，请稍后再试');
  if (/token has expired|otp.*(expired|invalid)|invalid.*(token|otp)/i.test(message)) return t('验证码不对或过期了');
  if (/should be different/i.test(message)) return t('新密码不能跟旧密码一样');
  if (/failed to fetch|network/i.test(message)) return t('连不上服务器，请检查网络');
  // 自己丢出的中文错误（例如邀请码不对）有对照就换成目前的语言；其他的说人话
  return humanMessage(err, t('没登录成功'));
}

async function run(action) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (err) {
    error.value = describe(err);
  } finally {
    busy.value = false;
  }
}

function submit() {
  run(() =>
    mode.value === 'login'
      ? auth.loginWithEmail(email.value.trim(), password.value)
      : auth.registerWithEmail(email.value.trim(), password.value, invite.value, name.value)
  );
}

function submitInvite() {
  run(() => auth.redeem(invite.value, name.value));
}

// ---- 忘记密码：寄验证码 → 输入验证码和新密码（改好就登录） ----
const code = ref('');
/** 验证码寄到哪个邮箱（空的 = 还没寄） */
const codeSentTo = ref('');
/** 几秒后可以重新寄（Supabase 同一个人 60 秒只能寄一次） */
const resendIn = ref(0);
let resendTimer = 0;
function startReset() {
  mode.value = 'reset';
  code.value = '';
  codeSentTo.value = '';
  password.value = '';
}
function sendCode() {
  run(async () => {
    const to = email.value.trim();
    await auth.sendPasswordResetCode(to);
    codeSentTo.value = to;
    resendIn.value = 60;
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      if (--resendIn.value <= 0) clearInterval(resendTimer);
    }, 1000);
  });
}
function submitReset() {
  if (!codeSentTo.value) return sendCode();
  run(async () => {
    await auth.resetPassword(codeSentTo.value, code.value.replace(/\s/g, ''), password.value);
    useNoticeStore().show(t('密码改好了'));
  });
}
// 改了邮箱：要重新寄
watch(email, value => codeSentTo.value && value.trim() !== codeSentTo.value && (codeSentTo.value = ''));
onBeforeUnmount(() => clearInterval(resendTimer));
</script>

<template>
  <div class="login">
    <!-- 左：品牌、我的公仔（手机上隐藏） -->
    <aside class="brand">
      <div class="logo display">Lyri<span>Stage</span></div>
      <AvatarFigure class="figure" :url="avatar.url" />
      <p class="tagline">{{ $t('以歌词为主角的音乐播放器。九种歌词舞台，电脑和手机都能听。') }}</p>
    </aside>

    <main class="panel">
      <!-- 还没登录也能换语言（第一次打开跟着系统，不对的话在这里换） -->
      <div class="lang" role="group" :aria-label="$t('语言')">
        <button
          v-for="l in LOCALES"
          :key="l.value"
          type="button"
          :class="{ on: locale === l.value }"
          :aria-pressed="locale === l.value"
          @click="locale = l.value"
        >
          {{ l.value === 'en' ? 'EN' : '中' }}
        </button>
      </div>
      <div class="form-wrap">
        <div class="logo display small">Lyri<span>Stage</span></div>
        <AvatarFigure class="mobile-figure" :url="avatar.url" />

        <!-- 没设置 Supabase：没办法登录 -->
        <section v-if="!auth.enabled" class="head">
          <h1 class="display">{{ $t('还不能登录') }}</h1>
          <p>{{ $t('这个版本没有设置 LyriStage 账号服务（.env 的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。') }}</p>
        </section>

        <!-- 还在读登录状态 -->
        <section v-else-if="!auth.ready" class="head">
          <p>{{ $t('正在读取登录状态…') }}</p>
        </section>

        <!-- 登录了，但还不是成员 -->
        <form v-else-if="needInvite" class="form" @submit.prevent="submitInvite">
          <div class="head">
            <h1 class="display">{{ $t('输入邀请码') }}</h1>
            <p>
              {{ $t('LyriStage 目前只开放给受邀的朋友。你已经用') }}
              <strong>{{ auth.user?.email || auth.displayName }}</strong>
              {{ $t('登录，输入邀请码就能开始使用。') }}
            </p>
          </div>
          <label>
            <span class="label-row">{{ $t('名字') }}<small class="field-hint">{{ $t('朋友会看到、可以用来搜你') }}</small></span>
            <input v-model="name" autocomplete="nickname" maxlength="30" required />
          </label>
          <label>
            <span class="label-row">{{ $t('邀请码') }}<small v-if="inviteFilled" class="filled">{{ $t('✓ 已填好') }}</small></span>
            <input
              v-model="invite"
              class="code"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              :placeholder="$t('例如 7KQ3MZ9TXA')"
              required
            />
          </label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" class="primary" :disabled="busy">
            {{ busy ? $t('正在验证…') : $t('开始使用') }}
          </button>
          <p class="switch">
            {{ $t('不是这个账号？') }}<button type="button" class="link" @click="auth.logout()">{{ $t('换个账号') }}</button>
          </p>
        </form>

        <!-- 忘记密码 -->
        <form v-else-if="mode === 'reset'" class="form" @submit.prevent="submitReset">
          <div class="head">
            <h1 class="display">{{ $t('重设密码') }}</h1>
            <p v-if="!codeSentTo">{{ $t('输入注册时用的邮箱，我们会寄一组验证码给你。') }}</p>
          </div>
          <label>
            {{ $t('邮箱') }}
            <input v-model="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </label>
          <template v-if="codeSentTo">
            <p class="sent" role="status">
              {{ $t('验证码寄到 {email} 了。没收到的话看看垃圾邮件。', { email: codeSentTo }) }}
            </p>
            <label>
              {{ $t('验证码') }}
              <input
                v-model="code"
                class="otp"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="10"
                placeholder="12345678"
                required
              />
            </label>
            <label>
              {{ $t('新密码') }}
              <span class="password-field">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="$t('至少 8 位')"
                  minlength="8"
                  required
                />
                <button
                  type="button"
                  class="eye"
                  :aria-label="showPassword ? $t('隐藏密码') : $t('显示密码')"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                >
                  <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="20" />
                </button>
              </span>
            </label>
          </template>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" class="primary" :disabled="busy">
            <template v-if="busy">{{ $t('请稍候…') }}</template>
            <template v-else>{{ codeSentTo ? $t('改好并登录') : $t('寄验证码') }}</template>
          </button>
          <p class="switch">
            <template v-if="codeSentTo">
              <button v-if="resendIn <= 0" type="button" class="link" :disabled="busy" @click="sendCode">{{ $t('重新寄') }}</button>
              <span v-else>{{ $t('重新寄（{n} 秒）', { n: resendIn }) }}</span>
              ·
            </template>
            <button type="button" class="link" @click="mode = 'login'">{{ $t('回到登录') }}</button>
          </p>
        </form>

        <!-- 登录 / 注册 -->
        <form v-else class="form" @submit.prevent="submit">
          <!-- 登录 / 注册切换：小手机一打开就看得到「注册」（第一次来的多半是拿到邀请码的朋友） -->
          <div class="tabs" role="tablist">
            <button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ on: mode === 'login' }" @click="mode = 'login'">
              {{ $t('登录') }}
            </button>
            <button type="button" role="tab" :aria-selected="mode === 'register'" :class="{ on: mode === 'register' }" @click="mode = 'register'">
              {{ $t('注册') }}
            </button>
          </div>
          <div class="head">
            <h1 class="display">{{ mode === 'login' ? $t('登录 LyriStage') : $t('注册 LyriStage') }}</h1>
            <p v-if="mode === 'login'">
              {{ $t('不需要网易云账号。你的喜欢、歌单和听歌记录保存在 LyriStage 自己的账号里，电脑和手机同步。') }}
            </p>
            <p v-else-if="!inviteFilled">{{ $t('LyriStage 目前只开放给受邀的朋友，注册需要邀请码。') }}</p>
            <p v-else class="invited">
              {{ $t('🎉 有朋友邀请你加入 LyriStage') }}
              <small>{{ $t('邀请码已经帮你填好，填完下面就能开始听歌') }}</small>
            </p>
          </div>

          <template v-if="mode === 'login'">
            <button
              v-for="p in providers"
              :key="p.id"
              type="button"
              class="provider"
              :class="p.id"
              :disabled="busy"
              @click="run(() => auth.loginWithProvider(p.id))"
            >
              <svg v-if="p.id === 'google'" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.3 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z" />
              </svg>
              <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />
              </svg>
              {{ $t(p.label) }}
            </button>
            <p v-if="auth.oauthError" class="error" role="alert">
              {{ auth.oauthError }}
            </p>
            <div class="divider"><span />{{ $t('或用邮箱') }}<span /></div>
          </template>

          <label v-if="mode === 'register'">
            <span class="label-row">{{ $t('名字') }}<small class="field-hint">{{ $t('朋友会看到、可以用来搜你') }}</small></span>
            <input v-model="name" autocomplete="nickname" maxlength="30" required />
          </label>
          <label>
            {{ $t('邮箱') }}
            <input
              v-model="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            <span class="label-row">
              {{ $t('密码') }}
              <button v-if="mode === 'login'" type="button" class="link" @click="startReset">{{ $t('忘记密码？') }}</button>
            </span>
            <span class="password-field">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                :placeholder="$t('至少 8 位')"
                minlength="8"
                required
              />
              <button
                type="button"
                class="eye"
                :aria-label="showPassword ? $t('隐藏密码') : $t('显示密码')"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="20" />
              </button>
            </span>
          </label>
          <label v-if="mode === 'register'">
            <span class="label-row">{{ $t('邀请码') }}<small v-if="inviteFilled" class="filled">{{ $t('✓ 已填好') }}</small></span>
            <input
              v-model="invite"
              class="code"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              :placeholder="$t('向邀请你的朋友要')"
              required
            />
          </label>

          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" class="primary" :disabled="busy">
            <template v-if="busy">{{ $t('请稍候…') }}</template>
            <template v-else>{{ mode === 'login' ? $t('登录') : $t('注册并开始使用') }}</template>
          </button>

          <p class="switch">
            <RouterLink to="/" class="browse">{{ $t('先不登录，随便看看') }}</RouterLink>
            ·
            <a href="./privacy.html" target="_blank" rel="noopener" class="browse">{{ $t('隐私权政策') }}</a>
          </p>
          <p class="switch">
            <template v-if="mode === 'login'">
              {{ $t('还没有账号？') }}<button type="button" class="link" @click="mode = 'register'">{{ $t('用邀请码注册') }}</button>
            </template>
            <template v-else>
              {{ $t('已经有账号？') }}<button type="button" class="link" @click="mode = 'login'">{{ $t('去登录') }}</button>
            </template>
          </p>
        </form>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 登录 / 注册切换 */
.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  margin-bottom: 4px;
  border-radius: 999px;
  background: var(--surface-hover);
}
.tabs button {
  flex: 1;
  min-height: 40px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.tabs button.on {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
}
/* 点邀请链接来的 */
.invited {
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--text);
  font-weight: 700;
}
.invited small {
  display: block;
  margin-top: 2px;
  font-weight: 500;
  color: var(--text-dim);
}
.filled {
  color: #16a34a;
  font-weight: 700;
}
.login {
  min-height: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  background: var(--bg);
  color: var(--text);
}

/* 左边：固定是深色的歌词舞台（不跟主题变） */
.brand {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 56px;
  background: radial-gradient(ellipse at 35% 40%, #3e4b46 0%, #141917 70%);
  color: #e3e9e5;
}
.logo {
  font-size: 32px;
}
.logo span {
  color: var(--accent);
}
.brand .logo span {
  color: #ff3b5c;
}
.figure {
  flex: 1;
  min-height: 0;
  margin: 0 -56px;
}
.mobile-figure {
  display: none;
}
.tagline {
  margin: 0;
  max-width: 34ch;
  font-size: 16px;
  line-height: 1.7;
  color: #c9d3ce;
}

/* 右边：表单 */
.panel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 24px;
}
.form-wrap {
  width: min(400px, 100%);
}
.logo.small {
  display: none;
  margin-bottom: 32px;
  font-size: 28px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.head h1 {
  margin: 0;
  font-size: 36px;
}
.head p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}
.head strong {
  color: var(--text);
}

label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}
input {
  height: 48px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 400;
  font-size: 15px;
}
.password-field {
  position: relative;
  display: flex;
}
.password-field input {
  flex: 1;
  min-width: 0;
  padding-right: 48px;
}
.eye {
  position: absolute;
  top: 50%;
  right: 6px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text-faint);
  transform: translateY(-50%);
}
.eye:hover {
  color: var(--text);
}
input:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
  border-color: transparent;
}
input.code {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
input.code::placeholder {
  text-transform: none;
  letter-spacing: normal;
  font-family: var(--font-sans);
}

button {
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.provider,
.primary {
  height: 50px;
  border: 0;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
}
.provider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--text);
  color: var(--bg);
}
.primary {
  font-size: 16px;
  background: var(--accent);
  color: var(--on-accent);
}
.provider.google {
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text);
}
.provider:not(:disabled):hover,
.primary:not(:disabled):hover {
  filter: brightness(1.08);
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-faint);
}
.divider span {
  flex: 1;
  height: 1px;
  background: var(--line);
}

.error {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.field-hint {
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 400;
}
.label-row .link {
  font-size: 13px;
}
.sent {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.5;
  color: color-mix(in srgb, #16a34a 80%, var(--text));
  background: color-mix(in srgb, #16a34a 12%, transparent);
}
.otp {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 22px;
  letter-spacing: 0.3em;
}
.lang {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 14px);
  right: 16px;
  z-index: 2;
  display: flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-hover);
}
.lang button {
  min-width: 40px;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.lang button.on {
  background: var(--bg);
  color: var(--text);
}
.switch {
  margin: 0;
  text-align: center;
  font-size: 14px;
  color: var(--text-dim);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-weight: 700;
}
.link:hover {
  text-decoration: underline;
}
.browse {
  color: var(--text-dim);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.browse:hover {
  color: var(--text);
}

/* 电脑版：顶部 40px 是拖动窗口的地方 */
.electron .panel {
  padding-top: calc(var(--titlebar-height) + 24px);
}

/* 手机 / 窄窗口：只留表单 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .login {
    grid-template-columns: minmax(0, 1fr);
  }
  .brand {
    display: none;
  }
  .logo.small {
    display: block;
    margin-bottom: 8px;
  }
  /* 公仔小一点：太高的话（还没载入时是一片空白）会把登录按钮推到画面外 */
  .mobile-figure {
    display: block;
    height: min(140px, 18vh);
    margin-bottom: 8px;
  }
  .panel {
    align-items: flex-start;
    padding-top: 28px;
  }
}
</style>
