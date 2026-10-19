<script setup>
// App 外框：
// - 电脑（宽 ≥ 900px）：左边侧边栏 + 中间内容 + 底部完整播放条
// - 手机（窄）：内容 + 迷你播放条 + 底部 Tab
// 歌词舞台是盖在最上面的全屏层
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getLyrics } from './services';
import { usePlayer } from './composables/usePlayer';
import { isElectron } from './platform';
import { useThemeStore } from './stores/theme';
import { useAuthStore } from './stores/auth';
import { useRecentStore } from './stores/recent';
import { useLibraryStore } from './stores/library';
import AddToPlaylistDialog from './components/AddToPlaylistDialog.vue';
import AppSidebar from './components/AppSidebar.vue';
import BottomTabs from './components/BottomTabs.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import PlayerBar from './components/PlayerBar.vue';
import LyricStage from './lyric-stage/LyricStage.vue';

const { state, player } = usePlayer();
useThemeStore();
const auth = useAuthStore();
useRecentStore();
const library = useLibraryStore();

const stageOpen = ref(false);
const route = useRoute();
const router = useRouter();

// 退出登录（或成员身份没了）：停止播放，回到登录页
watch(
  () => auth.allowed,
  allowed => {
    if (allowed || !auth.ready) return;
    player.pause();
    stageOpen.value = false;
    if (!route.meta.public) {
      router.replace({ name: 'login', query: { redirect: route.fullPath } });
    }
  }
);

// 换页面时内容区回到顶部
const content = ref(null);
watch(
  () => route.fullPath,
  () => content.value?.scrollTo({ top: 0 })
);
</script>

<template>
  <!-- 登录页：整页显示，没有侧边栏和播放条 -->
  <div v-if="route.meta.bare" class="bare" :class="{ electron: isElectron }">
    <div v-if="isElectron" class="drag-strip" aria-hidden="true" />
    <RouterView />
  </div>

  <!-- 还在读登录状态（路由守卫还没放行）：先空着，不要闪一下首页 -->
  <div v-else-if="!auth.allowed" class="bare" />

  <div v-else class="shell" :class="{ electron: isElectron }">
    <div v-if="isElectron" class="drag-strip" aria-hidden="true" />
    <AppSidebar class="area-side" />
    <main ref="content" class="area-main">
      <RouterView />
    </main>
    <PlayerBar
      class="area-bar"
      :state="state"
      :player="player"
      @open-stage="stageOpen = true"
    />
    <div class="area-mobile">
      <MiniPlayer :state="state" :player="player" @open-stage="stageOpen = true" />
      <BottomTabs />
    </div>

    <AddToPlaylistDialog />
    <Transition name="toast">
      <div v-if="library.notice" class="toast" role="status">{{ library.notice }}</div>
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
@media (max-width: 899px) {
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
}
</style>
