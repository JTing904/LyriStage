<script setup>
// App 外框：
// - 电脑（宽 ≥ 900px）：左边侧边栏 + 中间内容 + 底部完整播放条
// - 手机（窄，或手机横过来：矮又是触控）：内容 + 迷你播放条 + 底部 Tab
// 歌词舞台是盖在最上面的全屏层
import { computed, nextTick, onUnmounted, ref, shallowRef, watch, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { ApiError } from '@core/http/client';
import { adminStorageUsage } from '@core/data';
import { isUnavailable, isUnblockRateLimited } from '@core/netease';
import { createFmSource, getEnglishTranslation, getLyrics, warmUpFm } from './services';
import { usePlayer } from './composables/usePlayer';
import { installRoomLock } from './composables/useRoomLock';
import { offlineSupported } from './offline';
import { PULL_TRIGGER, attachPullRefresh } from './composables/usePullRefresh';
import { findAndroidUpdate, installUpdate, isElectron, onBackButton, onUpdateReady } from './platform';
import { updateAndroidNow } from './androidUpdate';
import { t } from './i18n';
import { useThemeStore } from './stores/theme';
import { useAuthStore } from './stores/auth';
import { useRoomStore } from './stores/room';
import { connectHandoff } from './handoff';
import { useRecentStore } from './stores/recent';
import { useFriendsStore } from './stores/friends';
import { useNoticeStore } from './stores/notice';
import { useUiStore } from './stores/ui';
import AddToPlaylistDialog from './components/AddToPlaylistDialog.vue';
import LoginPrompt from './components/LoginPrompt.vue';
import AppSidebar from './components/AppSidebar.vue';
import BottomTabs from './components/BottomTabs.vue';
import GuestPlaySheet from './components/GuestPlaySheet.vue';
import NameConfirmSheet from './components/NameConfirmSheet.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import MobileBackBar from './components/MobileBackBar.vue';
import PlayerBar from './components/PlayerBar.vue';
import QueuePanel from './components/QueuePanel.vue';
import RoomReactions from './components/RoomReactions.vue';
import { report, trackContext } from './errorReporter';
// 歌词舞台、海报墙：打开时才载入（App 打开时不用等）
const LyricStage = defineAsyncComponent(() => import('./lyric-stage/LyricStage.vue'));
const QueueWall = defineAsyncComponent(() => import('./components/QueueWall.vue'));

const { state, player } = usePlayer();
useThemeStore();
const auth = useAuthStore();
useRecentStore();
// 换设备接着听：登录好过几秒（这台先恢复好自己上次的歌）问一次，之后切回 App 时再问
const roomStore = useRoomStore();
const handoff = connectHandoff({ isMember: () => auth.allowed, inRoom: () => roomStore.inRoom });
watch(
  () => auth.allowed,
  allowed => allowed && setTimeout(() => handoff.check(), 3000),
  { immediate: true }
);
// 私人 FM：登录好过一会儿在背景先挑好第一批歌（按下去就马上有歌，不用等 8 秒）
watch(
  () => auth.allowed,
  allowed => allowed && setTimeout(warmUpFm, 8000),
  { immediate: true }
);
// 好友：一打开就要开始告诉好友在听什么、收到好友换歌的通知
const friendsStore = useFriendsStore();

// 有人加你为好友：提示一次（好友资料会即时更新，App 开着时马上就知道；关着的话下次打开时说）
const SEEN_REQUESTS_KEY = 'lyristage:seen-friend-requests';
watch(
  () => friendsStore.incoming,
  incoming => {
    let seen;
    try {
      seen = new Set(JSON.parse(localStorage.getItem(SEEN_REQUESTS_KEY) ?? '[]'));
    } catch {
      seen = new Set();
    }
    const fresh = incoming.filter(p => !seen.has(p.id));
    if (!fresh.length) return;
    try {
      // 只记还在等的，名单不会一直变长
      localStorage.setItem(SEEN_REQUESTS_KEY, JSON.stringify(incoming.map(p => p.id)));
    } catch {
      // 记不住顶多下次再提示一次
    }
    if (route.path === '/friends') return; // 已经在好友页，看得到
    notice.show(
      fresh.length === 1
        ? t('{name} 想加你为好友', { name: fresh[0].name })
        : t('{n} 个好友邀请', { n: fresh.length }),
      { action: { label: t('查看'), run: () => router.push('/friends') }, duration: 8000 }
    );
  }
);
const notice = useNoticeStore();
// 有对话框开着（加到歌单、便签…）时，提示放进最上面那个对话框里：
// 放在外面会被对话框盖住，按钮也按不到（对话框外面的东西都按不到）
const toastHost = shallowRef('body');
watch(
  () => notice.current?.id,
  async () => {
    await nextTick(); // 等「按了就关掉」的对话框先关
    toastHost.value = [...document.querySelectorAll('dialog[open]')].pop() ?? 'body';
  },
  { flush: 'post' }
);
// 放着提示的对话框关掉了：提示搬回外面（不然跟着对话框一起不见）
const rehostToast = () => {
  if (toastHost.value !== 'body' && !toastHost.value.open) toastHost.value = [...document.querySelectorAll('dialog[open]')].pop() ?? 'body';
};
document.addEventListener('close', rehostToast, true);
onUnmounted(() => document.removeEventListener('close', rehostToast, true));

const ui = useUiStore();

// 断网：下面（迷你播放条上方）一个小胶囊「没有网络 · 听存在手机的歌」（手机 App 才有离线歌）；网络回来说一声
const offline = ref(!navigator.onLine);
const onOffline = () => (offline.value = true);
const onOnline = () => {
  if (!offline.value) return;
  offline.value = false;
  notice.show(t('网络恢复了'));
};
window.addEventListener('offline', onOffline);
window.addEventListener('online', onOnline);
onUnmounted(() => {
  window.removeEventListener('offline', onOffline);
  window.removeEventListener('online', onOnline);
});
const { stageOpen } = storeToRefs(ui);
const route = useRoute();
const router = useRouter();
// 一起听的成员不能自己控制播放
installRoomLock();

// 退出登录（或成员身份没了）：停止播放；在个人页面（音乐库、设置…）的话回首页
watch(
  () => auth.allowed,
  allowed => {
    if (allowed || !auth.ready) return;
    player.pause();
    stageOpen.value = false;
    ui.wallOpen = false;
    if (route.meta.member) router.replace('/');
  }
);

/** 歌词舞台：要登录才能听歌，也就要登录才能打开 */
function openStage() {
  if (auth.requireMember('听歌、看歌词')) stageOpen.value = true;
}

// 上次关 App 时在听私人 FM：知道登录状态后补上 FM 的来源，按下一首才有歌
auth.whenReady().then(() => {
  if (player.needsFmSource()) player.setFmSource(createFmSource(auth.loggedIn));
});

// 播不了的时候告诉用户原因（以前是默默跳过，看起来像坏了）
const offPlayer = [
  player.on('unplayable', ({ track }) => {
    const name = track?.name ?? '';
    report('unplayable', isUnavailable(track) ? '网易云已下架，也找不到其他音源' : '找不到音源', {
      context: trackContext(track),
    });
    if (isUnavailable(track)) {
      notice.show(t('《{name}》在网易云已下架', { name }), {
        action: {
          label: t('搜索其他版本'),
          run: () => router.push({ path: '/search', query: { q: name } }),
        },
      });
    } else {
      notice.show(t('《{name}》暂时没有音源', { name }));
    }
  }),
  player.on('error', ({ track, error }) => {
    // 浏览器要用户先点一下页面才允许出声，不算错误
    if (error?.name === 'NotAllowedError') return;
    // 断网不用回报（不是 App 的问题）
    if (!(error instanceof ApiError && error.status === undefined)) {
      report('playback', isUnblockRateLimited(error) ? 'B 站暂时限制搜索' : error?.message ?? String(error), {
        detail: error?.stack ?? null,
        context: { ...trackContext(track), status: error?.status ?? null },
      });
    }
    if (isUnblockRateLimited(error)) {
      notice.show(t('B 站暂时限制搜索，过一会儿再按播放'));
    } else if (error instanceof ApiError && error.status === undefined) {
      notice.show(t('网络连不上，检查网络后再按播放'));
    } else if (track) {
      notice.show(t('《{name}》播放失败', { name: track.name }));
    }
  }),
];
onUnmounted(() => offPlayer.forEach(off => off()));

// 电脑版：新版本在背景下载好了
onUpdateReady(({ version }) => {
  notice.show(t('新版本 {version} 已经下载好', { version }), {
    action: { label: t('重启更新'), run: installUpdate },
    duration: 20000,
  });
});

// Android：GitHub 上有新版本就提示更新（电脑版会自动更新，网页版永远是最新的）
findAndroidUpdate().then(update => {
  if (!update) return;
  notice.show(t('有新版本 {version}', { version: update.version }), {
    action: { label: t('更新'), run: () => updateAndroidNow(update) },
    duration: 20000,
  });
});

// 管理员：数据库快满时提醒（免费方案 500 MB；每天最多检查一次）
const STORAGE_CHECKED_KEY = 'lyristage:storage-checked';
watch(
  () => auth.admin,
  async admin => {
    if (!admin) return;
    try {
      if (Date.now() - Number(localStorage.getItem(STORAGE_CHECKED_KEY)) < 86400 * 1000) return;
      localStorage.setItem(STORAGE_CHECKED_KEY, String(Date.now()));
      const { total } = await adminStorageUsage();
      const percent = Math.round((total / (500 * 1024 * 1024)) * 100);
      if (percent >= 70) {
        notice.show(t('数据库已经用了 {p}%，快满了', { p: percent }), {
          action: { label: t('查看'), run: () => router.push('/settings') },
          duration: 20000,
        });
      }
    } catch {
      // 查不到就算了
    }
  },
  { immediate: true }
);

// 键盘：空格 播放 / 暂停，Ctrl + ← → 上一首 / 下一首（在输入框里打字、按着按钮时不算；歌词舞台有自己的）
function onKey(event) {
  if (stageOpen.value || document.querySelector('dialog[open]')) return;
  const el = event.target;
  if (el instanceof HTMLElement && (el.closest('input, textarea, select, button, [contenteditable]') || el.isContentEditable)) return;
  if (event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    player.toggle();
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowRight') {
    event.preventDefault();
    player.next();
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowLeft') {
    event.preventDefault();
    player.prev();
  }
}
window.addEventListener('keydown', onKey);
onUnmounted(() => window.removeEventListener('keydown', onKey));

// Android 返回键：先关对话框、歌词舞台，没有才是一般的返回
onBackButton(() => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    dialog.close();
    return true;
  }
  if (ui.wallOpen) {
    ui.wallOpen = false;
    return true;
  }
  if (stageOpen.value) {
    stageOpen.value = false;
    return true;
  }
  return false;
});

// 换页面时内容区回到顶部
const content = ref(null);
watch(
  () => route.fullPath,
  () => {
    content.value?.scrollTo({ top: 0 });
    scrolled.value = false;
  }
);

// 手机：底部 Tab 的四个主页面以外（歌手、歌单、设置…）顶部要有返回列；
// 往下滑过页头后，返回列变实心并显示名字
const TAB_PAGES = ['home', 'search', 'friends', 'library', 'room'];
const showBackBar = computed(() => !TAB_PAGES.includes(String(route.name)));
const {
  distance: pullDistance,
  refreshing: pullRefreshing,
  enabled: pullEnabled,
} = attachPullRefresh(content);
const scrolled = ref(false);
function onContentScroll() {
  scrolled.value = (content.value?.scrollTop ?? 0) > 180;
}
</script>

<template>
  <!-- 登录页：整页显示，没有侧边栏和播放条 -->
  <div v-if="route.meta.bare" class="bare" :class="{ electron: isElectron }">
    <div v-if="isElectron" class="drag-strip" aria-hidden="true" />
    <RouterView />
  </div>

  <div v-else class="shell" :class="{ electron: isElectron }">
    <div v-if="isElectron" class="drag-strip" aria-hidden="true" />
    <AppSidebar class="area-side" />
    <main ref="content" class="area-main" @scroll.passive="onContentScroll">
      <MobileBackBar v-if="showBackBar" :scrolled="scrolled" />
      <RouterView />
    </main>
    <!-- 下拉刷新的圈圈 -->
    <div
      v-if="pullEnabled && (pullDistance > 0 || pullRefreshing)"
      class="pull-indicator"
      :style="{ transform: `translate(-50%, ${pullDistance - 48}px)` }"
      aria-hidden="true"
    >
      <span
        class="pull-spinner"
        :class="{ spinning: pullRefreshing, ready: pullDistance >= PULL_TRIGGER }"
        :style="{ transform: pullRefreshing ? undefined : `rotate(${(pullDistance / PULL_TRIGGER) * 270}deg)` }"
      />
    </div>
    <PlayerBar
      class="area-bar"
      :state="state"
      :player="player"
      @open-stage="openStage"
    />
    <div class="area-mobile">
      <MiniPlayer :state="state" :player="player" @open-stage="openStage" />
      <BottomTabs />
    </div>

    <AddToPlaylistDialog />
    <GuestPlaySheet />
    <NameConfirmSheet />
    <QueuePanel />
    <RoomReactions />
    <LoginPrompt />
    <Transition name="toast">
      <component
        :is="offlineSupported ? 'RouterLink' : 'div'"
        v-if="offline && !stageOpen"
        :to="offlineSupported ? '/offline' : undefined"
        class="offline-pill"
        role="status"
      >
        <span aria-hidden="true">📡</span>{{ $t('没有网络') }}
        <template v-if="offlineSupported"> · <b>{{ $t('听存在手机的歌') }}</b></template>
      </component>
    </Transition>
    <Teleport :to="toastHost">
      <Transition name="toast">
        <!-- 点提示就关掉（按钮照常） -->
        <div
          v-if="notice.current"
          class="toast"
          :class="{ 'in-dialog': toastHost !== 'body', 'above-pill': offline && !stageOpen }"
          role="status"
          @click="notice.dismiss()"
        >
          <span>{{ notice.current.message }}</span>
          <button
            v-if="notice.current.action"
            class="toast-action"
            @click.stop="notice.current.action.run(), notice.dismiss()"
          >
            {{ notice.current.action.label }}
          </button>
          <span
            v-if="notice.current.countdown"
            :key="notice.current.id"
            class="toast-countdown"
            :style="{ animationDuration: `${notice.current.countdown}ms` }"
            aria-hidden="true"
          />
        </div>
      </Transition>
    </Teleport>

    <QueueWall v-if="ui.wallOpen" @close="ui.wallOpen = false" />

    <LyricStage
      v-if="stageOpen"
      :state="state"
      :player="player"
      :get-lyrics="getLyrics"
      :get-translation="getEnglishTranslation"
      @close="stageOpen = false"
    />
  </div>
</template>

<style scoped>
.bare {
  position: relative;
  height: 100%;
  overflow-y: auto;
}
.shell {
  position: relative;
  height: 100%;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas:
    'side main'
    'bar bar';
}
.area-side {
  grid-area: side;
}
.area-main {
  grid-area: main;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* 下拉刷新：从顶端跟着手指下来的圈圈，拉够了变红，放手后转圈 */
.pull-indicator {
  position: fixed;
  top: calc(env(safe-area-inset-top) + 8px);
  left: 50%;
  z-index: 60;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
  pointer-events: none;
}
.pull-spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid var(--line-strong);
  border-top-color: var(--text-dim);
  border-radius: 50%;
}
.pull-spinner.ready,
.pull-spinner.spinning {
  border-top-color: var(--accent);
}
.pull-spinner.spinning {
  animation: pull-spin 0.8s linear infinite;
}
@keyframes pull-spin {
  to {
    transform: rotate(360deg);
  }
}
.area-bar {
  grid-area: bar;
}
.area-mobile {
  display: none;
}

/* 电脑版：最上面一条可以拖动窗口（系统按钮在右上角），内容往下让出这块 */
.drag-strip {
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--titlebar-height);
  z-index: 5;
  -webkit-app-region: drag;
}
.electron .area-main,
.electron .area-side {
  padding-top: var(--titlebar-height);
}

/* 加到歌单、出错等的提示 */
.toast {
  position: fixed;
  z-index: 200;
  left: 50%;
  bottom: 110px;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: calc(100vw - 32px);
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--text);
  color: var(--bg);
  font-size: 14px;
  font-weight: 700;
  transform: translateX(-50%);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
}
.offline-pill {
  position: fixed;
  z-index: 190;
  bottom: 110px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100vw - 32px);
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--text);
  color: var(--bg);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transform: translateX(-50%);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.2);
}
.offline-pill b {
  overflow: hidden;
  text-overflow: ellipsis;
  color: color-mix(in srgb, var(--accent) 70%, var(--bg));
}
.toast.above-pill {
  bottom: 156px;
}
.toast.in-dialog {
  /* 对话框（手机是从下面滑上来的面板）的按钮在下面：提示放上面，不要挡住 */
  top: calc(env(safe-area-inset-top) + 16px);
  bottom: auto;
}
.toast-countdown {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 3px;
  height: 2px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg) 60%, transparent);
  transform-origin: left;
  animation: countdown linear forwards;
}
@keyframes countdown {
  to {
    transform: scaleX(0);
  }
}
.toast-action {
  flex: none;
  min-height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

/* 手机 / 窄窗口 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    grid-template-areas:
      'main'
      'mobile';
  }
  .area-side,
  .area-bar {
    display: none;
  }
  .area-mobile {
    grid-area: mobile;
    display: block;
    background: var(--bg);
  }
  /* 提示放在迷你播放条和底部 Tab 的上方，不要盖住它们；字多换行时不要变成椭圆 */
  .toast {
    bottom: calc(148px + env(safe-area-inset-bottom));
    width: max-content;
    border-radius: 16px;
    font-size: 13px;
  }
  .offline-pill {
    bottom: calc(148px + env(safe-area-inset-bottom));
  }
  .toast.above-pill {
    bottom: calc(194px + env(safe-area-inset-bottom));
  }
}
/* 手机横屏：画面矮，Tab 改成左边一条直的，迷你播放条留在底部，内容才不会被挤扁 */
@media (pointer: coarse) and (max-height: 600px) and (orientation: landscape) {
  .shell {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'tabs main'
      'tabs mini';
  }
  .area-mobile {
    display: contents;
  }
  .area-mobile > .tabs {
    grid-area: tabs;
  }
  .area-mobile > .mini {
    grid-area: mini;
  }
  .toast,
  .offline-pill {
    bottom: calc(84px + env(safe-area-inset-bottom));
  }
  .toast.above-pill {
    bottom: calc(130px + env(safe-area-inset-bottom));
  }
}
</style>
