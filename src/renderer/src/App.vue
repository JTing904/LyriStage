<script setup>
// App 外框：
// - 电脑（宽 ≥ 900px）：左边侧边栏 + 中间内容 + 底部完整播放条
// - 手机（窄，或手机横过来：矮又是触控）：内容 + 迷你播放条 + 底部 Tab
// 歌词舞台是盖在最上面的全屏层
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@core/http/client';
import { isUnavailable, isUnblockRateLimited } from '@core/netease';
import { createFmSource, getLyrics } from './services';
import { usePlayer } from './composables/usePlayer';
import { installUpdate, isElectron, onBackButton, onUpdateReady } from './platform';
import { t } from './i18n';
import { useThemeStore } from './stores/theme';
import { useAuthStore } from './stores/auth';
import { useRecentStore } from './stores/recent';
import { useNoticeStore } from './stores/notice';
import AddToPlaylistDialog from './components/AddToPlaylistDialog.vue';
import LoginPrompt from './components/LoginPrompt.vue';
import AppSidebar from './components/AppSidebar.vue';
import BottomTabs from './components/BottomTabs.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import MobileBackBar from './components/MobileBackBar.vue';
import PlayerBar from './components/PlayerBar.vue';
import LyricStage from './lyric-stage/LyricStage.vue';
import QueuePanel from './components/QueuePanel.vue';
import RoomReactions from './components/RoomReactions.vue';

const { state, player } = usePlayer();
useThemeStore();
const auth = useAuthStore();
useRecentStore();
const notice = useNoticeStore();

const stageOpen = ref(false);
const route = useRoute();
const router = useRouter();

// 退出登录（或成员身份没了）：停止播放；在个人页面（音乐库、设置…）的话回首页
watch(
  () => auth.allowed,
  allowed => {
    if (allowed || !auth.ready) return;
    player.pause();
    stageOpen.value = false;
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
const TAB_PAGES = ['home', 'search', 'library', 'room'];
const showBackBar = computed(() => !TAB_PAGES.includes(String(route.name)));
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
    <QueuePanel />
    <RoomReactions />
    <LoginPrompt />
    <Transition name="toast">
      <div v-if="notice.current" class="toast" role="status">
        <span>{{ notice.current.message }}</span>
        <button
          v-if="notice.current.action"
          class="toast-action"
          @click="notice.current.action.run(), notice.dismiss()"
        >
          {{ notice.current.action.label }}
        </button>
      </div>
    </Transition>

    <LyricStage
      v-if="stageOpen"
      :state="state"
      :player="player"
      :get-lyrics="getLyrics"
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
.toast-action {
  flex: none;
  padding: 4px 12px;
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
  .toast {
    bottom: calc(84px + env(safe-area-inset-bottom));
  }
}
</style>
