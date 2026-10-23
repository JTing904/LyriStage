<script setup>
// 设置：左边分类、右边那一类的设定（手机：先列分类，点进去才看到；网址 ?c=分类 记住在哪一类）
// - 我的：账号、播放与音效、歌词、外观、快捷键、关于（这台设备没有的选项，那一类就不出现）
// - 管理员（只有管理员看得到）：总览、邀请码、音源、存储、错误回报
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { version as appVersion } from '../../../../package.json';
import { NAME_MAX, adminClearErrors, adminErrorSummary, adminStorageUsage, clearHistory, createInvite, deleteMyAccount, exportMyData, listInvites } from '@core/data';
import { useAuthStore } from '../stores/auth';
import { useLibraryStore } from '../stores/library';
import { useThemeStore, THEME_OPTIONS } from '../stores/theme';
import { useAvatarStore, OUTFITS } from '../stores/avatar';
import Cover from '../components/Cover.vue';
import AvatarFigure from '../components/AvatarFigure.vue';
import Icon from '../components/Icon.vue';
import { squareAvatar } from '../utils/image';
import {
  checkForUpdates,
  installUpdate,
  saveImage as saveFile,
  isElectron,
  isNativeApp,
  setDesktopLyrics,
  setDesktopLyricsLocked,
  updateStatus,
} from '../platform';
import { desktopLyrics } from '../desktop';
import { netease, audioEffects } from '../services';
import EqualizerPanel from '../components/EqualizerPanel.vue';
import { pinWidget } from '../widget';
import { isLockScreenLyricsOn, setLockScreenLyrics } from '../mediaSession';
import { pushSupported, pushWanted, setPushWanted } from '../push';
import { OFFLINE_LIMITS, offlineBytes, offlineSettings, offlineSupported, offlineTracks, saveOfflineSettings } from '../offline';
import { t, locale, LOCALES } from '../i18n';
import { timeAgo } from '../utils/format';
import { showError, humanMessage } from '../friendlyError';
import { useFriendsStore } from '../stores/friends';

// ---- 锁屏歌词（Android App）----
const lockLyrics = ref(isLockScreenLyricsOn());
const widgetHint = ref('');
async function addWidget() {
  widgetHint.value = (await pinWidget()) ? '' : t('长按桌面空白处 → 小组件 → LyriStage');
}
function toggleLockLyrics(on) {
  lockLyrics.value = on;
  setLockScreenLyrics(on);
}

// ---- 电脑版：版本和更新 ----
const update = ref(null);
const checking = ref(false);
if (isElectron) updateStatus().then(s => (update.value = s));
async function checkUpdate() {
  checking.value = true;
  try {
    update.value = await checkForUpdates();
  } finally {
    checking.value = false;
  }
}
const updateText = computed(() => {
  const s = update.value?.status;
  if (s === 'dev') return t('开发模式不会自动更新');
  if (s === 'checking') return t('正在检查…');
  if (s === 'downloading') return t('有新版本，正在下载…');
  if (s === 'ready') return t('新版本 {version} 已经下载好', { version: update.value.version });
  if (s === 'latest') return t('已经是最新版本');
  if (s === 'error') return t('检查更新失败，等一下再试');
  return t('有新版本会自动下载，下载好会提示你重启');
});

const auth = useAuthStore();

// ---- 通知（手机 App） ----
const pushOn = ref(pushWanted());
/** 开了但系统设置里不允许通知 */
const pushBlocked = ref(false);
// 让别人用名字搜到我
const friendsStore = useFriendsStore();
async function toggleSearchable(on, input) {
  try {
    await friendsStore.setSearchable(on);
  } catch (err) {
    input.checked = !on;
    showError(err, t('没改成功'));
  }
}

async function togglePush(on) {
  pushOn.value = on;
  const granted = await setPushWanted(on).catch(() => false);
  pushBlocked.value = on && !granted;
}
const library = useLibraryStore();
const theme = useThemeStore();
const avatar = useAvatarStore();
const AVATAR_CHOICES = [...OUTFITS, { id: 'auto', label: '按时间自动换' }];

// ---- 音源状态（管理员）：解灰靠别人的免费服务，坏了要第一个知道 ----
const sourceStatus = ref(null);
const sourceChecking = ref(false);
const sourceError = ref('');
// 上次检查的结果记在这台设备上（总览一打开就看得到，不用每次重测）
const SOURCE_KEY = 'lyristage:source-status';
try {
  sourceStatus.value = JSON.parse(localStorage.getItem(SOURCE_KEY) ?? 'null');
} catch {
  // 没有就等按「检查」
}
async function checkSources() {
  sourceChecking.value = true;
  sourceError.value = '';
  try {
    sourceStatus.value = { ...(await netease.unblockStatus()), checkedAt: new Date().toISOString() };
    try {
      localStorage.setItem(SOURCE_KEY, JSON.stringify(sourceStatus.value));
    } catch {
      // 存不了就下次再测
    }
  } catch (err) {
    sourceError.value = err.message;
  } finally {
    sourceChecking.value = false;
  }
}
const SOURCE_LABEL = { bilibili: 'B 站' };
/** 测的是这个 App 走的那条路：电脑版是自己电脑的网络，手机和网页是 Vercel 的服务器（香港） */
const sourceRoute = isElectron ? '这台电脑' : '服务器（香港）';

// ---- 存储空间（管理员）：Supabase 免费方案的数据库是 500 MB ----
const FREE_DB_BYTES = 500 * 1024 * 1024;
const storage = ref(null);
const storageError = ref('');
const TABLE_LABEL = {
  play_history: '听歌记录',
  plays: '听歌记录',
  tracks: '歌曲资料',
  play_history_monthly: '较早的听歌小结',
  liked_tracks: '我喜欢',
  playlist_tracks: '歌单里的歌',
  daily_recommendations: '每日推荐',
  room_messages: '一起听的聊天',
  now_playing: '好友正在听',
  bilibili_picks: 'B 站视频记录',
};
async function checkStorage() {
  storageError.value = '';
  try {
    storage.value = await adminStorageUsage();
  } catch (err) {
    storageError.value = err.message;
  }
}
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---- 错误回报（管理员）：朋友遇到的错误，同一种合并成一行 ----
const ERROR_KIND = { crash: 'App 出错', playback: '播放失败', unplayable: '没有音源', lyrics: '歌词载不出来' };
const errors = ref(null);
const errorsError = ref('');
async function checkErrors() {
  errorsError.value = '';
  try {
    errors.value = await adminErrorSummary(7);
    if (errors.value === null) errorsError.value = t('数据库还没执行错误回报的 SQL');
  } catch (err) {
    errorsError.value = err.message;
  }
}
async function clearErrors() {
  try {
    await adminClearErrors();
    errors.value = [];
  } catch (err) {
    errorsError.value = err.message;
  }
}

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

// 导出自己的资料（JSON 档）
const exporting = ref(false);
async function exportData() {
  exporting.value = true;
  try {
    const data = await exportMyData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    await saveFile(blob, `LyriStage-my-data-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    if (err?.name !== 'AbortError') showError(err, t('没导出成功'));
  } finally {
    exporting.value = false;
  }
}

// 删除账号：要打"删除"两个字才按得下去
const deleteBox = ref(null);
const deleteWord = ref('');
const deleting = ref(false);
const DELETE_WORD = computed(() => t('删除'));
function openDelete() {
  deleteWord.value = '';
  deleteBox.value.showModal();
}
async function removeAccount() {
  if (deleteWord.value.trim() !== DELETE_WORD.value) return;
  deleting.value = true;
  try {
    await deleteMyAccount();
    deleteBox.value.close();
    library.say(t('账号和所有资料已经删除'));
    // 登出后路由会自己回到首页
    window.location.hash = '#/';
    window.location.reload();
  } catch (err) {
    showError(err, t('没删掉'));
  } finally {
    deleting.value = false;
  }
}

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
    showError(err, t('没清除成功'));
  } finally {
    clearing.value = false;
  }
}

// ---- 编辑资料：头像、名字 ----
const editing = ref(false);
const nameDraft = ref('');
/** 选好、裁好的新头像（还没上传） */
const avatarDraft = ref(null);
const previewUrl = ref('');
/** 按了"用回 GitHub 头像"（保存时才生效） */
const resetAvatarDraft = ref(false);
const saving = ref(false);
const profileError = ref('');
const fileInput = ref(null);

/** GitHub / Google / 邮箱原本的名字（名字留空就用这个） */
const providerName = computed(() => {
  const meta = auth.user?.user_metadata ?? {};
  return meta.user_name || meta.full_name || meta.name || auth.user?.email?.split('@')[0] || '';
});
/** 编辑时显示的头像（还没选新图时） */
const currentAvatar = computed(() => (resetAvatarDraft.value ? auth.providerAvatar : auth.avatarUrl));

function clearPreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  avatarDraft.value = null;
}

function startEdit() {
  nameDraft.value = auth.user?.user_metadata?.custom_name || auth.displayName;
  resetAvatarDraft.value = false;
  profileError.value = '';
  clearPreview();
  editing.value = true;
}

function cancelEdit() {
  clearPreview();
  editing.value = false;
}

async function pickImage(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  profileError.value = '';
  try {
    const image = await squareAvatar(file);
    clearPreview();
    avatarDraft.value = image;
    previewUrl.value = URL.createObjectURL(image);
    resetAvatarDraft.value = false;
  } catch {
    profileError.value = t('这张图片打不开，换一张试试');
  }
}

async function saveProfile() {
  saving.value = true;
  profileError.value = '';
  try {
    if (avatarDraft.value) await auth.saveAvatar(avatarDraft.value);
    else if (resetAvatarDraft.value) await auth.restoreProviderAvatar();
    // 和原本的名字一样就不存自定义名字（以后 GitHub 改名会跟着变）
    const name = nameDraft.value.trim();
    const custom = name && name !== providerName.value ? name : '';
    if (custom !== (auth.user?.user_metadata?.custom_name || '')) await auth.saveName(custom);
    cancelEdit();
    library.say(t('资料已更新'));
  } catch (err) {
    profileError.value = humanMessage(err, t('没保存成功'));
  } finally {
    saving.value = false;
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

// ---- 分类 ----
const route = useRoute();
const router = useRouter();
const phoneQuery = window.matchMedia('(max-width: 899px)');
const isPhone = ref(phoneQuery.matches);
const onPhoneChange = e => (isPhone.value = e.matches);
phoneQuery.addEventListener('change', onPhoneChange);
onBeforeUnmount(() => phoneQuery.removeEventListener('change', onPhoneChange));

// 没登录（或还不是成员）只看得到外观、快捷键、关于：账号、播放、歌词都要能听歌才有用
const CATEGORIES = computed(() =>
  [
    { id: 'account', group: 'mine', label: '账号', icon: 'users', show: auth.allowed },
    { id: 'playback', group: 'mine', label: '播放与音效', icon: 'volume', show: auth.allowed && (audioEffects.supported || offlineSupported) },
    { id: 'lyrics', group: 'mine', label: '歌词', icon: 'desktop-lyrics', show: auth.allowed && (isNativeApp || isElectron) },
    { id: 'appearance', group: 'mine', label: '外观', icon: 'moon' },
    { id: 'shortcuts', group: 'mine', label: '快捷键', icon: 'grid', show: !isNativeApp },
    { id: 'about', group: 'mine', label: '关于', icon: 'settings' },
    { id: 'overview', group: 'admin', label: '总览', icon: 'chart', show: auth.admin },
    { id: 'invites', group: 'admin', label: '邀请码', icon: 'friends', show: auth.admin },
    { id: 'sources', group: 'admin', label: '音源', icon: 'radio', show: auth.admin },
    { id: 'storage', group: 'admin', label: '存储', icon: 'library', show: auth.admin },
    { id: 'errors', group: 'admin', label: '错误回报', icon: 'eye', show: auth.admin },
  ].filter(c => c.show !== false)
);
const mineCategories = computed(() => CATEGORIES.value.filter(c => c.group === 'mine'));
const adminCategories = computed(() => CATEGORIES.value.filter(c => c.group === 'admin'));

/** 现在在哪一类；手机没选的时候是 null（显示分类列表） */
const cat = computed(() => {
  const c = String(route.query.c ?? '');
  if (CATEGORIES.value.some(x => x.id === c)) return c;
  return isPhone.value ? null : CATEGORIES.value[0].id;
});
const current = computed(() => CATEGORIES.value.find(c => c.id === cat.value) ?? null);
/** 手机：进下一层（按返回回到列表）；电脑：直接换 */
function openCat(id) {
  if (isPhone.value) router.push({ query: { c: id } });
  else router.replace({ query: { c: id } });
}

// 管理员：一打开就载入（音源检查比较花时间，按了才测）
const availableInvites = computed(() => invites.value.filter(i => i.usedCount < i.maxUses && !i.grantsAdmin).length);
watch(
  () => auth.admin,
  admin => admin && checkErrors(),
  { immediate: true }
);
watch(
  cat,
  c => {
    if ((c === 'overview' || c === 'storage') && !storage.value) checkStorage();
    if (c === 'errors' || c === 'overview') checkErrors();
  },
  { immediate: true }
);
const sourcesOk = computed(() => sourceStatus.value?.sources?.filter(s => s.ok).length ?? 0);
const sourcesTotal = computed(() => sourceStatus.value?.sources?.length ?? 0);

/** 手机列表右边的小字：这一类现在的状态 */
function summary(id) {
  if (id === 'playback') return audioEffects.settings.enabled ? t('均衡器开') : t('均衡器关');
  if (id === 'lyrics') {
    if (isNativeApp) return lockLyrics.value ? t('锁屏歌词开') : t('锁屏歌词关');
    return desktopLyrics.enabled ? t('桌面歌词开') : t('桌面歌词关');
  }
  if (id === 'appearance') {
    const themeLabel = THEME_OPTIONS.find(o => o.value === theme.mode)?.label;
    return [themeLabel ? t(themeLabel) : '', LOCALES.find(o => o.value === locale.value)?.label].filter(Boolean).join(' · ');
  }
  if (id === 'about') return appVersion;
  if (id === 'overview' || id === 'errors') return errors.value?.length ? t('{n} 种错误', { n: errors.value.length }) : '';
  if (id === 'invites') return t('{n} 个可用', { n: availableInvites.value });
  if (id === 'sources') return sourcesTotal.value ? t('{ok} / {all} 可以用', { ok: sourcesOk.value, all: sourcesTotal.value }) : '';
  if (id === 'storage') return storage.value ? mb(storage.value.total) : '';
  return '';
}
</script>

<template>
  <section class="settings" :class="{ 'phone-list': !cat }">
    <h1 v-if="!isPhone || !cat" class="display">{{ $t('设置') }}</h1>

    <div class="layout">
      <!-- 分类：电脑在左边；手机是一整页的列表（没选分类时） -->
      <nav v-if="!isPhone" class="cats" :aria-label="$t('设置分类')">
        <span class="cats-head">{{ $t('我的') }}</span>
        <button
          v-for="c in mineCategories"
          :key="c.id"
          :class="{ on: cat === c.id }"
          :aria-current="cat === c.id ? 'page' : undefined"
          @click="openCat(c.id)"
        >
          <Icon :name="c.icon" :size="18" />{{ $t(c.label) }}
        </button>
        <template v-if="adminCategories.length">
          <span class="cats-head">{{ $t('管理员') }}</span>
          <button
            v-for="c in adminCategories"
            :key="c.id"
            :class="{ on: cat === c.id }"
            :aria-current="cat === c.id ? 'page' : undefined"
            @click="openCat(c.id)"
          >
            <Icon :name="c.icon" :size="18" />{{ $t(c.label) }}
            <span v-if="c.id === 'errors' && errors?.length" class="count">{{ errors.length }}</span>
          </button>
        </template>
      </nav>

      <div v-if="isPhone && !cat" class="phone-cats">
        <button v-if="auth.allowed" class="card profile-card" @click="openCat('account')">
          <Cover v-if="auth.avatarUrl" :url="auth.avatarUrl" :size="48" round class="avatar" />
          <span v-else class="avatar initial">{{ auth.displayName.slice(0, 1).toUpperCase() }}</span>
          <span class="who">
            <strong>{{ auth.displayName }}</strong>
            <span>{{ auth.providerLabel }}<template v-if="auth.user?.email"> · {{ auth.user.email }}</template></span>
          </span>
          <Icon name="chevron-right" :size="18" class="chev" />
        </button>
        <!-- 没登录 / 还没兑换邀请码 -->
        <div v-else class="card profile-card guest-card">
          <span class="avatar initial guest-avatar"><Icon name="users" :size="22" /></span>
          <span class="who">
            <strong>{{ auth.loggedIn ? $t('还没输入邀请码') : $t('还没登录') }}</strong>
            <span>{{ $t('登录后才能听歌、收藏') }}</span>
          </span>
          <RouterLink to="/login" class="login-btn">{{ auth.loggedIn ? $t('输入邀请码') : $t('登录') }}</RouterLink>
        </div>
        <h3 class="section-label">{{ $t('我的') }}</h3>
        <div class="card">
          <button
            v-for="c in mineCategories.filter(x => x.id !== 'account')"
            :key="c.id"
            class="row nav-row"
            @click="openCat(c.id)"
          >
            <span class="cat-icon"><Icon :name="c.icon" :size="18" /></span>
            <span class="label">{{ $t(c.label) }}</span>
            <span class="value">{{ summary(c.id) }}</span>
            <Icon name="chevron-right" :size="18" class="chev" />
          </button>
        </div>
        <template v-if="adminCategories.length">
          <h3 class="section-label">{{ $t('管理员') }}</h3>
          <div class="card">
            <button v-for="c in adminCategories" :key="c.id" class="row nav-row" @click="openCat(c.id)">
              <span class="cat-icon admin"><Icon :name="c.icon" :size="18" /></span>
              <span class="label">{{ $t(c.label) }}</span>
              <span class="value" :class="{ warn: (c.id === 'overview' || c.id === 'errors') && errors?.length }">
                {{ summary(c.id) }}
              </span>
              <Icon name="chevron-right" :size="18" class="chev" />
            </button>
          </div>
        </template>
      </div>

      <!-- 那一类的设定 -->
      <div v-if="cat" class="pane">
        <h2 class="pane-title">{{ $t(current.label) }}</h2>

        <!-- ===== 账号 ===== -->
        <template v-if="cat === 'account'">
          <div class="card">
            <div v-if="!editing" class="row account">
              <Cover v-if="auth.avatarUrl" :url="auth.avatarUrl" :size="56" round class="avatar" />
              <span v-else class="avatar initial">{{ auth.displayName.slice(0, 1).toUpperCase() }}</span>
              <span class="who">
                <strong>{{ auth.displayName }}</strong>
                <span>{{ auth.providerLabel }}<template v-if="auth.user?.email"> · {{ auth.user.email }}</template></span>
              </span>
              <span class="account-buttons">
                <button v-if="auth.allowed" class="ghost" @click="startEdit">{{ $t('编辑资料') }}</button>
                <button class="ghost" :disabled="busy" @click="logout">{{ $t('退出登录') }}</button>
              </span>
            </div>

            <!-- 编辑资料：换头像（选图片 → 裁成正方形预览）、改名字，按保存才生效 -->
            <form v-else class="row profile" @submit.prevent="saveProfile">
              <button
                type="button"
                class="avatar-pick"
                :title="$t('换头像')"
                :aria-label="$t('换头像')"
                @click="fileInput.click()"
              >
                <img v-if="previewUrl" :src="previewUrl" alt="" />
                <Cover v-else-if="currentAvatar" :url="currentAvatar" :size="72" round />
                <span v-else class="initial big">{{ (nameDraft || auth.displayName).slice(0, 1).toUpperCase() }}</span>
                <span class="camera"><Icon name="camera" :size="16" /></span>
              </button>
              <input ref="fileInput" type="file" accept="image/*" hidden @change="pickImage" />

              <div class="profile-fields">
                <label class="field">
                  <span>{{ $t('名字') }}</span>
                  <input
                    v-model="nameDraft"
                    :maxlength="NAME_MAX"
                    :placeholder="providerName"
                    autocomplete="nickname"
                  />
                </label>
                <button
                  v-if="!previewUrl && auth.customAvatar && !resetAvatarDraft"
                  type="button"
                  class="text-link"
                  @click="resetAvatarDraft = true"
                >
                  {{ auth.providerAvatar ? $t('用回 {provider} 的头像', { provider: auth.providerLabel }) : $t('不用头像') }}
                </button>
                <p v-if="profileError" class="invite-error">{{ profileError }}</p>
                <div class="profile-buttons">
                  <button type="button" class="ghost" :disabled="saving" @click="cancelEdit">{{ $t('取消') }}</button>
                  <button type="submit" class="primary" :disabled="saving">{{ saving ? $t('保存中…') : $t('保存') }}</button>
                </div>
              </div>
            </form>
          </div>

          <!-- 好友：能不能用名字搜到我（数据库还没加这个功能时不显示） -->
          <template v-if="friendsStore.profile && friendsStore.profile.searchable !== null">
            <h3 class="section-label">{{ $t('好友') }}</h3>
            <div class="card">
              <div class="row">
                <span class="label">
                  {{ $t('让别人用名字搜到我') }}
                  <small>{{ $t('关掉的话，只有拿到你好友码的人才能加你') }}</small>
                </span>
                <input
                  :checked="friendsStore.profile.searchable"
                  type="checkbox"
                  role="switch"
                  class="switch"
                  @change="toggleSearchable($event.target.checked, $event.target)"
                />
              </div>
            </div>
          </template>

          <!-- 手机 App：关着也收得到通知 -->
          <template v-if="pushSupported">
            <h3 class="section-label">{{ $t('通知') }}</h3>
            <div class="card">
              <div class="row">
                <span class="label">
                  {{ $t('App 关着也通知我') }}
                  <small>{{ pushBlocked ? $t('系统设置里关掉了 LyriStage 的通知') : $t('好友回应、好友邀请、有人想加入你的房间') }}</small>
                </span>
                <input :checked="pushOn" type="checkbox" role="switch" class="switch" @change="togglePush($event.target.checked)" />
              </div>
            </div>
          </template>

          <h3 class="section-label">{{ $t('我的资料') }}</h3>
          <div class="card">
            <div class="row">
              <span class="label">
                {{ $t('导出我的资料') }}
                <small>{{ $t('喜欢的歌、歌单和听歌记录') }}</small>
              </span>
              <button class="ghost" :disabled="exporting" @click="exportData">
                {{ exporting ? $t('导出中…') : $t('导出') }}
              </button>
            </div>
            <a class="row link-row" href="./privacy.html" target="_blank" rel="noopener">
              <span class="label">
                {{ $t('隐私权政策') }}
                <small>{{ $t('LyriStage 收集什么、怎么用') }}</small>
              </span>
              <Icon name="chevron-right" :size="18" class="chev" />
            </a>
          </div>

          <h3 class="section-label danger-label">{{ $t('危险区') }}</h3>
          <div class="card danger-zone">
            <div class="row">
              <span class="label">
                {{ $t('清除听歌记录') }}
                <small>{{ $t('听歌排行和每日推荐会重新开始，不能复原') }}</small>
              </span>
              <button class="ghost danger" @click="clearBox.showModal()">{{ $t('清除') }}</button>
            </div>
            <div class="row">
              <span class="label">
                {{ $t('删除账号') }}
                <small>{{ $t('资料会一起删掉，不能复原') }}</small>
              </span>
              <button class="ghost danger" @click="openDelete">{{ $t('删除账号') }}</button>
            </div>
          </div>
        </template>

        <!-- ===== 播放与音效 ===== -->
        <template v-else-if="cat === 'playback'">
          <div class="card">
            <div class="row">
              <span class="label">
                {{ $t('均衡器') }}
                <small>{{ $t('调整低音、人声、高音') }}</small>
              </span>
              <input v-model="audioEffects.settings.enabled" type="checkbox" role="switch" class="switch" />
            </div>
            <EqualizerPanel v-if="audioEffects.settings.enabled" :settings="audioEffects.settings" class="eq-panel" />
            <div class="row">
              <span class="label">
                {{ $t('音量平衡') }}
                <small>{{ $t('让每首歌的音量差不多大') }}</small>
              </span>
              <input v-model="audioEffects.settings.leveler" type="checkbox" role="switch" class="switch" />
            </div>
          </div>

          <!-- 离线听歌（手机 App）：听过的歌存在手机里 -->
          <template v-if="offlineSupported">
            <h3 class="section-label">{{ $t('离线听歌') }}</h3>
            <div class="card">
              <div class="row">
                <span class="label">
                  {{ $t('把听过的歌存在手机') }}
                  <small>{{ $t('没网络也能听') }}</small>
                </span>
                <input
                  :checked="offlineSettings.enabled"
                  type="checkbox"
                  role="switch"
                  class="switch"
                  @change="saveOfflineSettings({ enabled: $event.target.checked })"
                />
              </div>
              <div class="row">
                <span class="label">{{ $t('用行动数据时也存') }}</span>
                <input
                  :checked="offlineSettings.cellular"
                  type="checkbox"
                  role="switch"
                  class="switch"
                  :disabled="!offlineSettings.enabled"
                  @change="saveOfflineSettings({ cellular: $event.target.checked })"
                />
              </div>
              <div class="row">
                <span class="label">{{ $t('最多用多少空间') }}</span>
                <div class="segmented" role="radiogroup" :aria-label="$t('最多用多少空间')">
                  <button
                    v-for="mb in OFFLINE_LIMITS"
                    :key="mb"
                    role="radio"
                    :aria-checked="offlineSettings.limitMb === mb"
                    :class="{ on: offlineSettings.limitMb === mb }"
                    @click="saveOfflineSettings({ limitMb: mb })"
                  >
                    {{ mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB` }}
                  </button>
                </div>
              </div>
              <RouterLink to="/offline" class="row link-row">
                <span class="label">
                  {{ $t('存在手机里的歌') }}
                  <small>{{ $t('{n} 首 · {mb} MB', { n: offlineTracks.length, mb: Math.round(offlineBytes / 1024 / 1024) }) }}</small>
                </span>
                <Icon name="chevron-right" :size="18" class="chev" />
              </RouterLink>
            </div>
          </template>
        </template>

        <!-- ===== 歌词 ===== -->
        <template v-else-if="cat === 'lyrics'">
          <div v-if="isNativeApp" class="card">
            <div class="row">
              <span class="label">
                {{ $t('锁屏和通知栏显示歌词') }}
                <small>{{ $t('车上的蓝牙屏幕也看得到') }}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="switch"
                :checked="lockLyrics"
                @change="toggleLockLyrics($event.target.checked)"
              />
            </div>
            <div class="row">
              <span class="label">
                {{ $t('正在播放小组件') }}
                <small>{{ widgetHint || $t('在桌面播放、切歌，拉高显示歌词') }}</small>
              </span>
              <button class="ghost" @click="addWidget">{{ $t('加到桌面') }}</button>
            </div>
          </div>
          <div v-if="isElectron" class="card">
            <div class="row">
              <span class="label">
                {{ $t('显示桌面歌词') }}
                <small>{{ $t('App 收起来时，在桌面上显示歌词') }}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="switch"
                :checked="desktopLyrics.enabled"
                @change="setDesktopLyrics($event.target.checked)"
              />
            </div>
            <div class="row">
              <span class="label">
                {{ $t('锁定位置') }}
                <small>{{ $t('锁定后点得到歌词后面的东西') }}</small>
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
        </template>

        <!-- ===== 外观 ===== -->
        <template v-else-if="cat === 'appearance'">
          <div class="card">
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

          <h3 class="section-label">{{ $t('我的公仔') }}</h3>
          <div class="card">
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
        </template>

        <!-- ===== 快捷键 ===== -->
        <template v-else-if="cat === 'shortcuts'">
          <div class="card">
            <div class="row shortcut">
              <span class="label">{{ $t('播放 / 暂停') }}</span>
              <span class="keys"><kbd>Space</kbd><template v-if="isElectron"> · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd></template></span>
            </div>
            <div class="row shortcut">
              <span class="label">{{ $t('下一首') }}</span>
              <span class="keys"><kbd>Ctrl</kbd>+<kbd>→</kbd><template v-if="isElectron"> · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>→</kbd></template></span>
            </div>
            <div class="row shortcut">
              <span class="label">{{ $t('上一首') }}</span>
              <span class="keys"><kbd>Ctrl</kbd>+<kbd>←</kbd><template v-if="isElectron"> · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd></template></span>
            </div>
          </div>
          <p v-if="isElectron" class="note">{{ $t('有 Alt 的那组在 App 收到背景时也能用；键盘上的播放、下一首键也可以') }}</p>
        </template>

        <!-- ===== 关于 ===== -->
        <template v-else-if="cat === 'about'">
          <div class="card">
            <div class="row">
              <span class="label">
                LyriStage {{ appVersion }}
                <small v-if="isElectron">{{ updateText }}</small>
              </span>
              <template v-if="isElectron">
                <button v-if="update?.status === 'ready'" class="primary" @click="installUpdate()">
                  {{ $t('重启更新') }}
                </button>
                <button v-else class="ghost" :disabled="checking || update?.status === 'dev'" @click="checkUpdate">
                  {{ $t('检查更新') }}
                </button>
              </template>
            </div>
          </div>
        </template>

        <!-- ===== 管理员：总览 ===== -->
        <template v-else-if="cat === 'overview'">
          <div class="tiles">
            <div class="tile" role="button" tabindex="0" @click="openCat('invites')" @keydown.enter="openCat('invites')">
              <span class="tile-top">{{ $t('邀请码') }}<Icon name="chevron-right" :size="16" /></span>
              <span class="big">{{ availableInvites }}<small>{{ $t('个还没用') }}</small></span>
              <span class="tile-meta">{{ $t('一共发过 {n} 个', { n: invites.length }) }}</span>
              <button class="primary tile-action" :disabled="inviteBusy" @click.stop="generate">
                {{ inviteBusy ? $t('生成中…') : $t('一键生成邀请码') }}
              </button>
              <p v-if="newCode" class="tile-meta">{{ $t('已复制：{code}', { code: newCode }) }}</p>
            </div>
            <div class="tile" role="button" tabindex="0" @click="openCat('sources')" @keydown.enter="openCat('sources')">
              <span class="tile-top">{{ $t('音源') }}<Icon name="chevron-right" :size="16" /></span>
              <template v-if="sourcesTotal">
                <span class="big" :class="sourcesOk === sourcesTotal ? 'ok' : 'warn'">
                  {{ sourcesOk }}<small>/ {{ $t('{n} 可以用', { n: sourcesTotal }) }}</small>
                </span>
                <span class="dots">
                  <i v-for="s in sourceStatus.sources" :key="s.name" :class="{ down: !s.ok }" :title="SOURCE_LABEL[s.name] ?? s.name" />
                </span>
                <span v-if="sourceStatus.checkedAt" class="tile-meta">{{ $t('{ago}检查', { ago: timeAgo(sourceStatus.checkedAt, t) }) }}</span>
              </template>
              <span v-else class="tile-meta">{{ $t('还没检查过') }}</span>
              <button class="ghost tile-action" :disabled="sourceChecking" @click.stop="checkSources">
                {{ sourceChecking ? $t('检查中…') : $t('检查') }}
              </button>
            </div>
            <div class="tile" role="button" tabindex="0" @click="openCat('storage')" @keydown.enter="openCat('storage')">
              <span class="tile-top">{{ $t('存储') }}<Icon name="chevron-right" :size="16" /></span>
              <template v-if="storage">
                <span class="big">{{ (storage.total / 1024 / 1024).toFixed(0) }}<small>{{ $t('MB / 500 MB 数据库') }}</small></span>
                <span class="usage"><span :style="{ width: `${Math.min(100, (storage.total / FREE_DB_BYTES) * 100)}%` }" /></span>
                <span v-if="storage.files != null" class="tile-meta">{{ $t('文件 {used} / 1 GB', { used: mb(storage.files) }) }}</span>
              </template>
              <span v-else class="tile-meta">{{ storageError || $t('载入中…') }}</span>
            </div>
            <div class="tile" role="button" tabindex="0" @click="openCat('errors')" @keydown.enter="openCat('errors')">
              <span class="tile-top">{{ $t('错误回报（7 天）') }}<Icon name="chevron-right" :size="16" /></span>
              <template v-if="errors">
                <span class="big" :class="errors.length ? 'warn' : 'ok'">{{ errors.length }}<small>{{ $t('种错误') }}</small></span>
                <span v-for="e in errors.slice(0, 2)" :key="e.kind + e.message" class="tile-error">
                  <span class="error-kind" :class="e.kind">{{ $t(ERROR_KIND[e.kind] ?? e.kind) }}</span>
                  <span class="tile-error-text">{{ e.example?.song ? `《${e.example.song}》` : e.message }} · {{ timeAgo(e.lastAt, t) }}</span>
                </span>
              </template>
              <span v-else class="tile-meta">{{ errorsError || $t('载入中…') }}</span>
            </div>
          </div>
        </template>

        <!-- ===== 管理员：邀请码 ===== -->
        <template v-else-if="cat === 'invites'">
          <div class="card">
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
        </template>

        <!-- ===== 管理员：音源 ===== -->
        <template v-else-if="cat === 'sources'">
          <div class="card">
            <div class="row source-row">
              <div class="invite-top">
                <p class="hint">
                  {{ $t('VIP 歌和没版权的歌要靠这些音源。用一首 VIP 歌各测一次，测的是{route}的网络。', { route: $t(sourceRoute) }) }}
                </p>
                <button class="ghost" :disabled="sourceChecking" @click="checkSources">
                  {{ sourceChecking ? $t('检查中…') : $t('检查') }}
                </button>
              </div>
              <p v-if="sourceError" class="invite-error" role="alert">{{ sourceError }}</p>
              <ul v-if="sourceStatus" class="source-list">
                <li v-for="s in sourceStatus.sources" :key="s.name" :class="{ down: !s.ok }">
                  <span class="dot" aria-hidden="true" />
                  <span class="source-name">{{ SOURCE_LABEL[s.name] ?? s.name }}</span>
                  <span class="status">{{ s.ok ? $t('可以用') : $t('不能用') }}</span>
                  <span class="date">{{ (s.ms / 1000).toFixed(1) }}s</span>
                  <span v-if="s.rateLimitedAt" class="source-note">
                    {{ $t('上次被要求验证：{time}', { time: new Date(s.rateLimitedAt).toLocaleString() }) }}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </template>

        <!-- ===== 管理员：存储 ===== -->
        <template v-else-if="cat === 'storage'">
          <div class="card">
            <div class="row source-row">
              <div class="invite-top">
                <p class="hint">{{ $t('数据库 500 MB、文件 1 GB（Supabase 免费方案）') }}</p>
                <button class="ghost" @click="checkStorage">{{ $t('重新整理') }}</button>
              </div>
              <p v-if="storageError" class="invite-error" role="alert">{{ storageError }}</p>
              <template v-if="storage">
                <div class="usage" role="meter" :aria-valuenow="storage.total" aria-valuemin="0" :aria-valuemax="FREE_DB_BYTES">
                  <span :style="{ width: `${Math.min(100, (storage.total / FREE_DB_BYTES) * 100)}%` }" />
                </div>
                <p class="hint">{{ $t('用了 {used} / 500 MB', { used: mb(storage.total) }) }}</p>
                <p v-if="storage.files != null" class="hint">
                  {{ $t('文件（头像、歌单封面、旧听歌记录）：{used} / 1 GB', { used: mb(storage.files) }) }}
                </p>
                <ul class="source-list">
                  <li v-for="table in storage.tables" :key="table.name">
                    <span class="source-name">{{ $t(TABLE_LABEL[table.name] ?? table.name) }}</span>
                    <span class="date">{{ mb(table.bytes) }}</span>
                  </li>
                </ul>
              </template>
            </div>
          </div>
        </template>

        <!-- ===== 管理员：错误回报 ===== -->
        <template v-else-if="cat === 'errors'">
          <div class="card">
            <div class="row source-row">
              <div class="invite-top">
                <p class="hint">{{ $t('朋友最近 7 天遇到的错误') }}</p>
                <button class="ghost" @click="checkErrors">{{ $t('重新整理') }}</button>
                <button v-if="errors?.length" class="ghost danger" @click="clearErrors">{{ $t('清除') }}</button>
              </div>
              <p v-if="errorsError" class="invite-error" role="alert">{{ errorsError }}</p>
              <p v-else-if="errors && !errors.length" class="hint">{{ $t('没有错误 🎉') }}</p>
              <ul v-else-if="errors" class="source-list error-list">
                <li v-for="e in errors" :key="e.kind + e.message">
                  <span class="error-kind" :class="e.kind">{{ $t(ERROR_KIND[e.kind] ?? e.kind) }}</span>
                  <span class="source-name error-message">{{ e.message }}</span>
                  <span class="date">
                    {{ $t('{n} 次 · {p} 人 · {ago}', { n: e.times, p: e.people, ago: timeAgo(e.lastAt, t) }) }}
                  </span>
                  <span class="error-meta">
                    {{ [e.names.join('、'), e.platforms.join(' / '), e.versions.join(' / ')].filter(Boolean).join(' · ') }}
                    <template v-if="e.example?.song"> · 《{{ e.example.song }}》{{ e.example.artist }}</template>
                  </span>
                  <details v-if="e.detail" class="error-detail">
                    <summary>{{ $t('详细') }}</summary>
                    <pre>{{ e.detail }}</pre>
                  </details>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </div>
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

    <dialog ref="deleteBox" class="confirm" @click.self="deleteBox.close()">
      <form class="confirm-box" @submit.prevent="removeAccount">
        <h3>{{ $t('永久删除你的 LyriStage 账号？') }}</h3>
        <p>
          {{ $t('会一起删掉：我喜欢的音乐、所有歌单、听歌记录、头像、成员身份。删除后不能复原，要再用就得重新注册、重新拿邀请码。想留一份的话，先按「导出」。') }}
        </p>
        <label class="delete-confirm">
          {{ $t('输入「{word}」确认', { word: DELETE_WORD }) }}
          <input v-model="deleteWord" autocomplete="off" />
        </label>
        <div class="confirm-buttons">
          <button type="button" class="ghost" @click="deleteBox.close()">{{ $t('取消') }}</button>
          <button
            type="submit"
            class="primary danger-fill"
            :disabled="deleting || deleteWord.trim() !== DELETE_WORD"
          >
            {{ deleting ? $t('删除中…') : $t('永久删除') }}
          </button>
        </div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.delete-confirm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0 4px;
  font-size: 13px;
  color: var(--text-dim);
}
.delete-confirm input {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
.primary.danger-fill {
  border-color: #dc2626;
  background: #dc2626;
}
.shortcut .keys {
  font-size: 13px;
  color: var(--text-dim);
}
kbd {
  display: inline-block;
  min-width: 22px;
  padding: 1px 6px;
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  text-align: center;
}
.note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-dim);
}
.settings {
  max-width: 1060px;
  padding: 32px clamp(16px, 4vw, 48px) 48px;
}
h1 {
  margin: 0 0 24px;
  font-size: 40px;
}
/* 左边分类、右边那一类 */
.layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 36px;
  align-items: start;
}
.cats {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cats-head {
  padding: 16px 12px 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.cats-head:first-child {
  padding-top: 0;
}
.cats button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--text-dim);
  font-size: 15px;
  font-weight: 600;
  text-align: left;
}
.cats button:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.cats button.on {
  background: var(--surface-hover);
  color: var(--text);
  font-weight: 700;
}
.count {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}
.pane {
  min-width: 0;
  max-width: 760px;
}
.pane-title {
  margin: 0 0 16px;
  font-size: 24px;
}
.section-label {
  margin: 26px 4px 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.danger-label {
  color: var(--accent);
}
/* 一组一张卡片，行之间用细线分开 */
.card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}
.card + .card {
  margin-top: 14px;
}
.danger-zone {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 64px;
  padding: 12px 18px;
}
.card > * + .row,
.card > .row + * {
  border-top: 1px solid var(--line);
}
.link-row {
  color: inherit;
  text-decoration: none;
}
.link-row:hover {
  background: var(--surface-hover);
}
.chev {
  flex: none;
  color: var(--text-faint);
}
.account-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 管理员总览：四块 */
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-height: 160px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  cursor: pointer;
}
.tile:hover {
  border-color: var(--line-strong);
}
.tile-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  align-self: stretch;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 700;
}
.big {
  font-size: 34px;
  font-weight: 800;
  line-height: 1.1;
}
.big small {
  margin-left: 4px;
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 600;
}
.big.ok {
  color: #30a46c;
}
.big.warn {
  /* 橘色字：浅色主题要深一点才看得清（跟字的颜色混） */
  color: color-mix(in srgb, #f5a524 62%, var(--text));
}
.tile-meta {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
}
.tile-action {
  margin-top: auto;
}
.tile .usage {
  align-self: stretch;
}
.dots {
  display: flex;
  gap: 6px;
}
.dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #30a46c;
}
.dots i.down {
  background: var(--accent);
}
.tile-error {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  font-size: 13px;
}
.tile-error-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
}

/* 手机：分类列表 */
.phone-cats .card + .section-label {
  margin-top: 22px;
}
.guest-card .who span {
  /* 说明比较长（英文），换行比截掉好 */
  white-space: normal;
}
.initial.guest-avatar {
  background: var(--surface-hover);
  color: var(--text-faint);
}
.login-btn {
  flex: none;
  padding: 9px 18px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
}
.profile-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  color: inherit;
  font: inherit;
  text-align: left;
}
.nav-row {
  width: 100%;
  min-height: 56px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
.nav-row:active {
  background: var(--surface-hover);
}
.cat-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.cat-icon.admin {
  background: color-mix(in srgb, #f5a524 16%, transparent);
  color: #f5a524;
}
.value {
  color: var(--text-dim);
  font-size: 14px;
  white-space: nowrap;
}
.nav-row .label {
  flex: 1 0 auto;
  white-space: nowrap;
}
.nav-row .value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.value.warn {
  /* 橘色字：浅色主题要深一点才看得清（跟字的颜色混） */
  color: color-mix(in srgb, #f5a524 62%, var(--text));
}

@media (max-width: 899px) {
  .settings {
    padding-top: 16px;
  }
  h1 {
    font-size: 30px;
    margin-bottom: 16px;
  }
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .pane-title {
    font-size: 26px;
  }
  .tiles {
    grid-template-columns: minmax(0, 1fr);
  }
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
.account .ghost {
  flex: none;
  white-space: nowrap;
}
/* 编辑资料 */
.profile {
  align-items: flex-start;
  gap: 18px;
}
.avatar-pick {
  position: relative;
  flex: none;
  width: 72px;
  height: 72px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
}
.avatar-pick img {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}
.initial.big {
  width: 72px;
  height: 72px;
  font-size: 28px;
}
.camera {
  position: absolute;
  right: -2px;
  bottom: -2px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
}
.avatar-pick:hover .camera,
.avatar-pick:focus-visible .camera {
  transform: scale(1.08);
}
.avatar-pick:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.profile-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.field {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
}
.field input {
  padding: 10px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 400;
}
.field input:focus {
  outline: none;
  border-color: var(--accent);
}
.text-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}
.text-link:hover {
  text-decoration: underline;
}
.profile-buttons {
  align-self: flex-end;
  display: flex;
  gap: 10px;
}
@media (max-width: 520px) {
  .account {
    flex-wrap: wrap;
  }
  .account .who {
    flex-basis: calc(100% - 62px);
  }
  .account .ghost {
    flex: 1;
  }
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
  flex: none;
  margin-left: auto;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-hover);
  white-space: nowrap;
}
/* 有选项列的那一行：放不下就让选项列掉到下一行，不要把左边的字挤成一字一行 */
.row:has(> .segmented) {
  flex-wrap: wrap;
}
.row:has(> .segmented) > .label {
  flex: 1 1 8em;
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
/* 存储空间的用量条 */
.usage {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--line);
}
.usage span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}
/* 错误回报 */
.error-list li {
  align-items: baseline;
}
.error-kind {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-hover);
  font-size: 12px;
  font-weight: 700;
}
.error-kind.crash,
.error-kind.playback {
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  color: var(--danger);
}
.error-message {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.error-meta {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--text-dim);
}
.error-detail {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--text-dim);
}
.error-detail pre {
  max-height: 200px;
  margin: 6px 0 0;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 11px;
}

/* 音源状态：绿点可以用，红点不能用 */
.source-row {
  flex-direction: column;
  align-items: stretch;
}
.source-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}
.source-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.source-list li:last-child {
  border-bottom: 0;
}
.source-list .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2fa463;
}
.source-list li.down .dot {
  background: var(--accent);
}
.source-name {
  flex: 1;
  font-weight: 700;
}
.source-list .status,
.source-list .date {
  font-size: 13px;
  color: var(--text-dim);
}
.source-list li.down .status {
  color: var(--accent);
  font-weight: 700;
}
.source-note {
  flex-basis: 100%;
  padding-left: 20px;
  font-size: 12px;
  color: var(--text-faint);
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
  /* 分类那几行：目前的设定放到名字下面（英文放在同一行会挤到只剩一个字） */
  .nav-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'icon label chev' 'icon value chev';
    column-gap: 14px;
    row-gap: 1px;
  }
  .nav-row .cat-icon {
    grid-area: icon;
  }
  .nav-row .label {
    grid-area: label;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav-row .value {
    grid-area: value;
    font-size: 13px;
  }
  .nav-row .value:empty {
    display: none;
  }
  .nav-row .chev {
    grid-area: chev;
  }
}

/* 清除、删除账号：平常就是红字，一眼看得出是危险操作 */
.ghost.danger {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--accent);
}
/* 手机：顶部让出返回列；标题、卡片小一点 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  h1 {
    margin: 44px 0 16px;
    font-size: 28px;
  }
  .pane-title {
    margin-top: 44px;
  }
  .row {
    padding: 12px 14px;
  }
  .ghost {
    padding: 7px 14px;
    font-size: 13px;
  }
}
</style>
