<script setup>
// 设置：账号（退出登录）、邀请朋友（管理员才有）、我的公仔（换衣服）、外观（深色 / 浅色 / 跟随系统）、
// 桌面歌词（电脑版才有）
import { ref, watch } from 'vue';
import { clearHistory, createInvite, listInvites } from '@core/data';
import { useAuthStore } from '../stores/auth';
import { useLibraryStore } from '../stores/library';
import { useThemeStore, THEME_OPTIONS } from '../stores/theme';
import { useAvatarStore, OUTFITS } from '../stores/avatar';
import Cover from '../components/Cover.vue';
import AvatarFigure from '../components/AvatarFigure.vue';
import { isElectron, setDesktopLyrics, setDesktopLyricsLocked } from '../platform';
import { desktopLyrics } from '../desktop';
import { t, locale, LOCALES } from '../i18n';

const auth = useAuthStore();
const library = useLibraryStore();
const theme = useThemeStore();
const avatar = useAvatarStore();
const AVATAR_CHOICES = [...OUTFITS, { id: 'auto', label: '按时间自动换' }];

// ---- 邀请朋友（管理员）----
const invites = ref([]);
const newCode = ref('');
const copied = ref('');
const inviteBusy = ref(false);
const inviteError = ref('');

async function loadInvites() {
  try {
    invites.value = await listInvites();
  } catch (err) {
    inviteError.value = t(err.message || String(err));
  }
}
watch(
  () => auth.admin,
  admin => admin && loadInvites(),
  { immediate: true }
);

async function generate() {
  inviteBusy.value = true;
  inviteError.value = '';
  try {
    newCode.value = await createInvite();
    await copy(newCode.value);
    await loadInvites();
  } catch (err) {
    inviteError.value = t(err.message || String(err));
  } finally {
    inviteBusy.value = false;
  }
}

async function copy(code) {
  try {
    await navigator.clipboard.writeText(code);
    copied.value = code;
    setTimeout(() => {
      if (copied.value === code) copied.value = '';
    }, 2000);
  } catch {
    // 不能复制就让用户自己选
  }
}

const inviteStatus = i =>
  i.usedCount >= i.maxUses
    ? t('已使用')
    : i.maxUses > 1
      ? t('已用 {used} / {max}', { used: i.usedCount, max: i.maxUses })
      : t('未使用');
const shortDate = iso =>
  new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

/** 换介面语言（中文 / English） */
const setLocale = value => (locale.value = value);

// 清除听歌记录（隐私权政策里说可以在 App 里删）
const clearBox = ref(null);
const clearing = ref(false);
async function clearAllHistory() {
  clearing.value = true;
  try {
    await clearHistory();
    clearBox.value.close();
    library.say(t('听歌记录已经清除'));
  } catch (err) {
    library.say(t('清除失败：{error}', { error: err.message || String(err) }));
  } finally {
    clearing.value = false;
  }
}

const busy = ref(false);
async function logout() {
  busy.value = true;
  try {
    await auth.logout();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="settings">
    <h1 class="display">{{ $t('设置') }}</h1>

    <div class="group">
      <h2>{{ $t('账号') }}</h2>
      <div class="row account">
        <Cover v-if="auth.avatarUrl" :url="auth.avatarUrl" :size="48" round class="avatar" />
        <span v-else class="avatar initial">{{ auth.displayName.slice(0, 1).toUpperCase() }}</span>
        <span class="who">
          <strong>{{ auth.displayName }}</strong>
          <span>{{ auth.providerLabel }}<template v-if="auth.user?.email"> · {{ auth.user.email }}</template></span>
        </span>
        <button class="ghost" :disabled="busy" @click="logout">{{ $t('退出登录') }}</button>
      </div>
      <div class="row privacy-row">
        <span class="label">
          {{ $t('听歌记录') }}
          <small>{{ $t('用来做听歌排行和每日推荐。清除后不能复原。') }}</small>
        </span>
        <button class="ghost danger" @click="clearBox.showModal()">{{ $t('清除') }}</button>
      </div>
      <p class="policy"><a href="./privacy.html" target="_blank" rel="noopener">{{ $t('隐私权政策') }}</a></p>
    </div>

    <dialog ref="clearBox" class="confirm" @click.self="clearBox.close()">
      <div class="confirm-box">
        <h3>{{ $t('清除所有听歌记录？') }}</h3>
        <p>{{ $t('听歌排行会归零，每日推荐要重新累积你的口味。喜欢的歌和歌单不受影响。') }}</p>
        <div class="confirm-buttons">
          <button class="ghost" @click="clearBox.close()">{{ $t('取消') }}</button>
          <button class="primary" :disabled="clearing" @click="clearAllHistory">{{ $t('清除') }}</button>
        </div>
      </div>
    </dialog>

    <div v-if="auth.admin" class="group">
      <h2>{{ $t('邀请朋友') }}</h2>
      <div class="row invite-row">
        <div class="invite-top">
          <p class="hint">{{ $t('每个邀请码只能用一次。生成后会自动复制，直接贴给朋友就好。') }}</p>
          <button class="primary" :disabled="inviteBusy" @click="generate">
            {{ inviteBusy ? $t('生成中…') : $t('一键生成邀请码') }}
          </button>
        </div>
        <div v-if="newCode" class="new-code">
          <code>{{ newCode }}</code>
          <button class="ghost small" @click="copy(newCode)">
            {{ copied === newCode ? $t('已复制 ✓') : $t('复制') }}
          </button>
        </div>
        <p v-if="inviteError" class="invite-error" role="alert">{{ inviteError }}</p>
        <ul v-if="invites.length" class="invite-list">
          <li v-for="i in invites" :key="i.code" :class="{ used: i.usedCount >= i.maxUses }">
            <code>{{ i.code }}</code>
            <span v-if="i.grantsAdmin" class="badge" :title="$t('用这个码注册的人也会是管理员，不要给朋友')">{{ $t('管理员码') }}</span>
            <span class="status">{{ inviteStatus(i) }}</span>
            <span class="date">{{ shortDate(i.createdAt) }}</span>
            <button
              v-if="i.usedCount < i.maxUses && !i.grantsAdmin"
              class="link-btn"
              @click="copy(i.code)"
            >
              {{ copied === i.code ? $t('已复制 ✓') : $t('复制') }}
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div class="group">
      <h2>{{ $t('我的公仔') }}</h2>
      <div class="row avatar-row">
        <AvatarFigure class="preview" :url="avatar.url" />
        <div class="avatar-side">
          <p class="hint">{{ $t('首页和登录页都会出现。选"按时间自动换"的话，早上、中午、下午、晚上各穿一套。') }}</p>
          <div class="chips" role="radiogroup" :aria-label="$t('公仔造型')">
            <button
              v-for="o in AVATAR_CHOICES"
              :key="o.id"
              role="radio"
              :aria-checked="avatar.choice === o.id"
              :class="{ on: avatar.choice === o.id }"
              @click="avatar.choice = o.id"
            >
              {{ $t(o.label) }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isElectron" class="group">
      <h2>{{ $t('桌面歌词') }}</h2>
      <div class="row switch-row">
        <span class="label">
          {{ $t('显示桌面歌词') }}
          <small>{{ $t('App 收起来（最小化或关到托盘）时，在桌面上显示正在唱的歌词') }}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          class="switch"
          :checked="desktopLyrics.enabled"
          @change="setDesktopLyrics($event.target.checked)"
        />
      </div>
      <div class="row switch-row">
        <span class="label">
          {{ $t('锁定位置') }}
          <small>{{ $t('锁定后鼠标会穿过歌词，点得到后面的东西；在托盘图标按右键也能解锁') }}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          class="switch"
          :checked="desktopLyrics.locked"
          :disabled="!desktopLyrics.enabled"
          @change="setDesktopLyricsLocked($event.target.checked)"
        />
      </div>
    </div>

    <div class="group">
      <h2>{{ $t('外观') }}</h2>
      <div class="row">
        <span class="label">{{ $t('主题') }}</span>
        <div class="segmented" role="radiogroup" :aria-label="$t('主题')">
          <button
            v-for="o in THEME_OPTIONS"
            :key="o.value"
            role="radio"
            :aria-checked="theme.mode === o.value"
            :class="{ on: theme.mode === o.value }"
            @click="theme.mode = o.value"
          >
            {{ $t(o.label) }}
          </button>
        </div>
      </div>
      <div class="row">
        <span class="label">{{ $t('语言') }}</span>
        <div class="segmented" role="radiogroup" :aria-label="$t('语言')">
          <button
            v-for="o in LOCALES"
            :key="o.value"
            role="radio"
            :aria-checked="locale === o.value"
            :class="{ on: locale === o.value }"
            @click="setLocale(o.value)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings {
  max-width: 720px;
  padding: 32px clamp(16px, 4vw, 48px) 48px;
}
h1 {
  margin: 0 0 28px;
  font-size: 40px;
}
.group {
  margin-bottom: 28px;
}
h2 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
}
.avatar {
  width: 48px;
  flex: none;
}
.initial {
  display: grid;
  place-items: center;
  height: 48px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 900;
  font-size: 20px;
}
.who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.who span {
  font-size: 13px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label {
  flex: 1;
  font-weight: 700;
}
button {
  font: inherit;
  cursor: pointer;
}
.ghost {
  padding: 9px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font-weight: 700;
}
.ghost:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.segmented {
  display: flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-hover);
}
.segmented button {
  padding: 7px 14px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font-size: 14px;
}
.segmented button.on {
  background: var(--bg);
  color: var(--text);
  font-weight: 700;
}
.row + .row {
  margin-top: 8px;
}
.label small {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  font-weight: 400;
  color: var(--text-dim);
}
/* 开关 */
.switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 44px;
  height: 26px;
  margin: 0;
  border-radius: 999px;
  background: var(--line-strong);
  cursor: pointer;
  transition: background 0.2s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch:checked {
  background: var(--accent);
}
.switch:checked::after {
  transform: translateX(18px);
}
.switch:disabled {
  opacity: 0.4;
  cursor: default;
}
.switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.invite-row {
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
}
.invite-top {
  display: flex;
  align-items: center;
  gap: 16px;
}
.invite-top .hint {
  flex: 1;
}
.primary {
  flex: none;
  padding: 10px 18px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
}
.primary:disabled {
  opacity: 0.6;
}
code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  letter-spacing: 0.12em;
}
.new-code {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.new-code code {
  font-size: 22px;
  font-weight: 700;
}
.ghost.small {
  padding: 6px 14px;
  font-size: 13px;
}
.invite-error {
  margin: 0;
  font-size: 13px;
  color: var(--accent);
}
.invite-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}
.invite-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.invite-list li:last-child {
  border-bottom: 0;
}
.invite-list code {
  flex: 1;
}
.invite-list .status,
.invite-list .date {
  font-size: 13px;
  color: var(--text-dim);
}
.invite-list li.used code {
  color: var(--text-faint);
  text-decoration: line-through;
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}
.link-btn {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}
.avatar-row {
  align-items: stretch;
  gap: 20px;
}
.preview {
  flex: none;
  width: 160px;
  height: 220px;
  border-radius: 12px;
  background: radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%);
}
.avatar-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
}
.hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-dim);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chips button {
  padding: 8px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font-size: 14px;
}
.chips button:hover {
  color: var(--text);
}
.chips button.on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-weight: 700;
}
.privacy-row {
  margin-top: 8px;
}
.ghost.danger:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.policy {
  margin: 10px 4px 0;
  font-size: 13px;
}
.policy a {
  color: var(--text-dim);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.confirm {
  width: min(420px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
}
.confirm::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.confirm-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
}
.confirm-box h3 {
  margin: 0;
  font-size: 18px;
}
.confirm-box p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}
.confirm-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 520px) {
  .invite-top {
    flex-direction: column;
    align-items: stretch;
  }
  .avatar-row {
    flex-direction: column;
    align-items: center;
  }
  .row {
    flex-wrap: wrap;
  }
}
</style>
