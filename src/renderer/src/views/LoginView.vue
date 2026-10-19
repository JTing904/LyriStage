<script setup>
// 登录页（邀请制）：
// - 登录：GitHub 或邮箱 + 密码
// - 注册：邮箱 + 密码 + 邀请码
// - 登录了但还不是成员（例如第一次用 GitHub 登录）：输入邀请码
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useAvatarStore } from '../stores/avatar';
import { redirectTarget } from '../router';
import AvatarFigure from '../components/AvatarFigure.vue';
import Icon from '../components/Icon.vue';

const auth = useAuthStore();
const avatar = useAvatarStore();
const route = useRoute();
const router = useRouter();

// Google 登录还没在 Supabase 设置好，先只开 GitHub
const PROVIDERS = [{ id: 'github', label: '使用 GitHub 登录' }];

const mode = ref('login'); // 'login' | 'register'
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const invite = ref('');
const busy = ref(false);
const error = ref('');

/** 登录了但还没兑换邀请码 */
const needInvite = computed(() => auth.loggedIn && auth.member === false);

// 成为成员就进 App
watch(
  () => auth.allowed,
  allowed => {
    if (allowed) router.replace(redirectTarget(route));
  },
  { immediate: true }
);

// 换模式时清掉错误
watch([mode, needInvite], () => (error.value = ''));

/** Supabase 的英文错误换成中文 */
function describe(err) {
  const message = err?.message || String(err);
  if (/invalid login credentials/i.test(message)) return '邮箱或密码不对';
  if (/already registered|already been registered/i.test(message))
    return '这个邮箱已经注册过了，请直接登录（之前用 GitHub 登录过的话，请按"使用 GitHub 登录"）';
  if (/password should be at least/i.test(message)) return '密码太短了';
  if (/unable to validate email|invalid.*email/i.test(message))
    return '邮箱格式不对';
  if (/rate limit|too many/i.test(message)) return '尝试太多次了，请稍后再试';
  if (/failed to fetch|network/i.test(message)) return '连不上服务器，请检查网络';
  return message;
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
      : auth.registerWithEmail(email.value.trim(), password.value, invite.value)
  );
}

function submitInvite() {
  run(() => auth.redeem(invite.value));
}
</script>

<template>
  <div class="login">
    <!-- 左：品牌、我的公仔（手机上隐藏） -->
    <aside class="brand">
      <div class="logo display">Lyri<span>Stage</span></div>
      <AvatarFigure class="figure" :url="avatar.url" />
      <p class="tagline">以歌词为主角的音乐播放器。九种歌词舞台，电脑和手机都能听。</p>
    </aside>

    <main class="panel">
      <div class="form-wrap">
        <div class="logo display small">Lyri<span>Stage</span></div>
        <AvatarFigure class="mobile-figure" :url="avatar.url" />

        <!-- 没设置 Supabase：没办法登录 -->
        <section v-if="!auth.enabled" class="head">
          <h1 class="display">还不能登录</h1>
          <p>这个版本没有设置 LyriStage 账号服务（.env 的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。</p>
        </section>

        <!-- 还在读登录状态 -->
        <section v-else-if="!auth.ready" class="head">
          <p>正在读取登录状态…</p>
        </section>

        <!-- 登录了，但还不是成员 -->
        <form v-else-if="needInvite" class="form" @submit.prevent="submitInvite">
          <div class="head">
            <h1 class="display">输入邀请码</h1>
            <p>
              LyriStage 目前只开放给受邀的朋友。你已经用
              <strong>{{ auth.user?.email || auth.displayName }}</strong>
              登录，输入邀请码就能开始使用。
            </p>
          </div>
          <label>
            邀请码
            <input
              v-model="invite"
              class="code"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              placeholder="例如 7KQ3MZ9TXA"
              required
            />
          </label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" class="primary" :disabled="busy">
            {{ busy ? '正在验证…' : '开始使用' }}
          </button>
          <p class="switch">
            不是这个账号？<button type="button" class="link" @click="auth.logout()">换个账号</button>
          </p>
        </form>

        <!-- 登录 / 注册 -->
        <form v-else class="form" @submit.prevent="submit">
          <div class="head">
            <h1 class="display">{{ mode === 'login' ? '登录 LyriStage' : '注册 LyriStage' }}</h1>
            <p v-if="mode === 'login'">
              不需要网易云账号。你的喜欢、歌单和听歌记录保存在 LyriStage 自己的账号里，电脑和手机同步。
            </p>
            <p v-else>LyriStage 目前只开放给受邀的朋友，注册需要邀请码。</p>
          </div>

          <template v-if="mode === 'login'">
            <button
              v-for="p in PROVIDERS"
              :key="p.id"
              type="button"
              class="provider"
              :disabled="busy"
              @click="run(() => auth.loginWithProvider(p.id))"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />
              </svg>
              {{ p.label }}
            </button>
            <p v-if="auth.oauthError" class="error" role="alert">
              第三方登录失败：{{ auth.oauthError }}
            </p>
            <div class="divider"><span />或用邮箱<span /></div>
          </template>

          <label>
            邮箱
            <input
              v-model="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            密码
            <span class="password-field">
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                placeholder="至少 8 位"
                minlength="8"
                required
              />
              <button
                type="button"
                class="eye"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="20" />
              </button>
            </span>
          </label>
          <label v-if="mode === 'register'">
            邀请码
            <input
              v-model="invite"
              class="code"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              placeholder="向邀请你的朋友要"
              required
            />
          </label>

          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" class="primary" :disabled="busy">
            <template v-if="busy">请稍候…</template>
            <template v-else>{{ mode === 'login' ? '登录' : '注册并开始使用' }}</template>
          </button>

          <p class="switch">
            <RouterLink to="/" class="browse">先不登录，随便看看</RouterLink>
          </p>
          <p class="switch">
            <template v-if="mode === 'login'">
              还没有账号？<button type="button" class="link" @click="mode = 'register'">用邀请码注册</button>
            </template>
            <template v-else>
              已经有账号？<button type="button" class="link" @click="mode = 'login'">去登录</button>
            </template>
          </p>
        </form>
      </div>
    </main>
  </div>
</template>

<style scoped>
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
@media (max-width: 899px) {
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
  .mobile-figure {
    display: block;
    height: 200px;
    margin-bottom: 16px;
  }
  .panel {
    align-items: flex-start;
    padding-top: 48px;
  }
}
</style>
