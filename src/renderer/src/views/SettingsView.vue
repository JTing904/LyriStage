<script setup>
// 设置：账号（编辑头像和名字、退出登录）、邀请朋友（管理员才有）、我的公仔（换衣服）、外观（深色 / 浅色 / 跟随系统）、
// 桌面歌词（电脑版才有）
import { computed, ref, watch } from 'vue';
import { NAME_MAX, adminStorageUsage, clearHistory, createInvite, deleteMyAccount, exportMyData, listInvites } from '@core/data';
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
import { t, locale, LOCALES } from '../i18n';

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
const library = useLibraryStore();
const theme = useThemeStore();
const avatar = useAvatarStore();
const AVATAR_CHOICES = [...OUTFITS, { id: 'auto', label: '按时间自动换' }];

// ---- 音源状态（管理员）：解灰靠别人的免费服务，坏了要第一个知道 ----
const sourceStatus = ref(null);
const sourceChecking = ref(false);
const sourceError = ref('');
async function checkSources() {
  sourceChecking.value = true;
  sourceError.value = '';
  try {
    sourceStatus.value = await netease.unblockStatus();
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
    if (err?.name !== 'AbortError') library.say(t('导出失败：{error}', { error: err.message || String(err) }));
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
    library.say(t('删除失败：{error}', { error: err.message || String(err) }));
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
    library.say(t('清除失败：{error}', { error: err.message || String(err) }));
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
    profileError.value = t('保存失败：{error}', { error: t(err.message || String(err)) });
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
</script>

<template>
  <section class="settings">
    <h1 class="display">{{ $t('设置') }}</h1>

    <div class="group">
      <h2>{{ $t('账号') }}</h2>
      <div v-if="!editing" class="row account">
        <Cover v-if="auth.avatarUrl" :url="auth.avatarUrl" :size="48" round class="avatar" />
        <span v-else class="avatar initial">{{ auth.displayName.slice(0, 1).toUpperCase() }}</span>
        <span class="who">
          <strong>{{ auth.displayName }}</strong>
          <span>{{ auth.providerLabel }}<template v-if="auth.user?.email"> · {{ auth.user.email }}</template></span>
        </span>
        <button v-if="auth.allowed" class="ghost" @click="startEdit">{{ $t('编辑资料') }}</button>
        <button class="ghost" :disabled="busy" @click="logout">{{ $t('退出登录') }}</button>
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
      <div class="row privacy-row">
        <span class="label">
          {{ $t('听歌记录') }}
          <small>{{ $t('用来做听歌排行和每日推荐。清除后不能复原。') }}</small>
        </span>
        <button class="ghost danger" @click="clearBox.showModal()">{{ $t('清除') }}</button>
      </div>
      <div class="row privacy-row">
        <span class="label">
          {{ $t('导出我的资料') }}
          <small>{{ $t('下载一个档案，里面有你喜欢的歌、歌单和听歌记录。') }}</small>
        </span>
        <button class="ghost" :disabled="exporting" @click="exportData">
          {{ exporting ? $t('导出中…') : $t('导出') }}
        </button>
      </div>
      <div class="row privacy-row">
        <span class="label">
          {{ $t('删除账号') }}
          <small>{{ $t('永久删除账号和所有资料，不能复原。') }}</small>
        </span>
        <button class="ghost danger" @click="openDelete">{{ $t('删除账号') }}</button>
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

    <div v-if="auth.admin" class="group">
      <h2>{{ $t('音源状态') }}</h2>
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

    <div v-if="auth.admin" class="group">
      <h2>{{ $t('存储空间') }}</h2>
      <div class="row source-row">
        <div class="invite-top">
          <p class="hint">{{ $t('Supabase 免费方案的数据库是 500 MB。听歌记录会慢慢变多，快满时就要整理。') }}</p>
          <button class="ghost" @click="checkStorage">{{ $t('查看') }}</button>
        </div>
        <p v-if="storageError" class="invite-error" role="alert">{{ storageError }}</p>
        <template v-if="storage">
          <div class="usage" role="meter" :aria-valuenow="storage.total" aria-valuemin="0" :aria-valuemax="FREE_DB_BYTES">
            <span :style="{ width: `${Math.min(100, (storage.total / FREE_DB_BYTES) * 100)}%` }" />
          </div>
          <p class="hint">{{ $t('用了 {used} / 500 MB', { used: mb(storage.total) }) }}</p>
          <ul class="source-list">
            <li v-for="table in storage.tables" :key="table.name">
              <span class="source-name">{{ $t(TABLE_LABEL[table.name] ?? table.name) }}</span>
              <span class="date">{{ mb(table.bytes) }}</span>
            </li>
          </ul>
        </template>
      </div>
    </div>

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

    <div v-if="isNativeApp" class="group">
      <h2>{{ $t('锁屏歌词') }}</h2>
      <div class="row switch-row">
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
    </div>

    <div v-if="isNativeApp" class="group">
      <h2>{{ $t('桌面小组件') }}</h2>
      <div class="row switch-row">
        <span class="label">
          {{ $t('正在播放小组件') }}
          <small>{{ widgetHint || $t('在桌面播放、切歌，拉高显示歌词') }}</small>
        </span>
        <button class="primary" @click="addWidget">{{ $t('加到桌面') }}</button>
      </div>
    </div>

    <div v-if="isElectron" class="group">
      <h2>{{ $t('桌面歌词') }}</h2>
      <div class="row switch-row">
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
      <div class="row switch-row">
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

    <div v-if="audioEffects.supported" class="group">
      <h2>{{ $t('音效') }}</h2>
      <div class="row switch-row">
        <span class="label">
          {{ $t('均衡器') }}
          <small>{{ $t('调整低音、人声、高音') }}</small>
        </span>
        <input
          v-model="audioEffects.settings.enabled"
          type="checkbox"
          role="switch"
          class="switch"
        />
      </div>
      <EqualizerPanel v-if="audioEffects.settings.enabled" :settings="audioEffects.settings" class="eq-panel" />
      <div class="row switch-row">
        <span class="label">
          {{ $t('音量平衡') }}
          <small>{{ $t('让每首歌的音量差不多大') }}</small>
        </span>
        <input
          v-model="audioEffects.settings.leveler"
          type="checkbox"
          role="switch"
          class="switch"
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

    <div class="group">
      <h2>{{ $t('快捷键') }}</h2>
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
      <p v-if="isElectron" class="note">{{ $t('有 Alt 的那组在 App 收到背景时也能用；键盘上的播放、下一首键也可以') }}</p>
    </div>

    <div v-if="isElectron" class="group">
      <h2>{{ $t('版本') }}</h2>
      <div class="row">
        <span class="label">
          LyriStage {{ update?.current ?? '' }}
          <small>{{ updateText }}</small>
        </span>
        <button v-if="update?.status === 'ready'" class="primary" @click="installUpdate()">
          {{ $t('重启更新') }}
        </button>
        <button v-else class="ghost" :disabled="checking || update?.status === 'dev'" @click="checkUpdate">
          {{ $t('检查更新') }}
        </button>
      </div>
    </div>
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
.account .ghost {
  flex: none;
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
.row + .row,
.eq-panel,
.eq-panel + .row {
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
  .row {
    padding: 12px 14px;
  }
  .ghost {
    padding: 7px 14px;
    font-size: 13px;
  }
}
</style>
