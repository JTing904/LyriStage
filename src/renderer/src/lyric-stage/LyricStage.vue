<script setup>
// 歌词舞台：全屏显示，负责共用的部分（数据、风格切换、播放控制），
// 歌词怎么画交给 styles/ 里的风格组件
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { provideStage } from './useStage';
import { findStyle } from './styles';
import { isElectron } from '../platform';
import PlayerBar from '../components/PlayerBar.vue';
import StylePicker from './StylePicker.vue';

const props = defineProps({
  state: { type: Object, required: true },
  player: { type: Object, required: true },
  getLyrics: { type: Function, required: true },
});
const emit = defineEmits(['close']);

const stage = provideStage(props);
const { settings, track, lyrics, lyricsError, lines } = stage;
const style = computed(() => findStyle(settings.style));

const status = computed(() => {
  if (!track.value) return 'empty';
  if (lyricsError.value) return 'error';
  if (!lyrics.value) return 'loading';
  if (lyrics.value.instrumental) return 'instrumental';
  if (lines.value.length === 0) return 'no-lyrics';
  return 'ready';
});

/** 浅色背景的风格（例如竖排诗词）：按钮和播放条换成深色 */
const lightStyle = computed(
  () => status.value === 'ready' && Boolean(style.value.light)
);

// 控制条：鼠标或手指一段时间不动就隐藏，沉浸看歌词
const controlsVisible = ref(true);
const pickerOpen = ref(false);
let hideTimer = 0;
function wake() {
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!pickerOpen.value) controlsVisible.value = false;
  }, 3000);
}

function onKey(event) {
  if (event.key === 'Escape') {
    if (pickerOpen.value) pickerOpen.value = false;
    else emit('close');
  } else if (event.key === ' ' && event.target === document.body) {
    event.preventDefault();
    props.player.toggle();
  }
}
onMounted(() => {
  wake();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  clearTimeout(hideTimer);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div
    class="stage"
    :class="{
      'controls-hidden': !controlsVisible,
      electron: isElectron,
      light: lightStyle,
    }"
    @pointermove="wake"
    @pointerdown="wake"
  >
    <component
      :is="style.component"
      v-if="status === 'ready'"
      class="style-layer"
    />

    <div v-else class="placeholder">
      <p class="placeholder-title">{{ track?.name ?? 'LyriStage' }}</p>
      <p class="placeholder-sub">
        <template v-if="status === 'empty'">还没有在播放的歌</template>
        <template v-else-if="status === 'loading'">歌词加载中…</template>
        <template v-else-if="status === 'instrumental'"
          >纯音乐，请欣赏</template
        >
        <template v-else-if="status === 'no-lyrics'"
          >这首歌暂时没有歌词</template
        >
        <template v-else>歌词加载失败：{{ lyricsError?.message }}</template>
      </p>
    </div>

    <!-- 顶部：关闭、风格（电脑版这一条也是拖动窗口的地方） -->
    <header class="topbar">
      <button class="icon-button" title="关闭（Esc）" @click="emit('close')"
        >✕</button
      >
      <span class="spacer" />
      <button
        class="pill"
        :aria-expanded="pickerOpen"
        @click="pickerOpen = !pickerOpen"
      >
        风格：{{ style.name }}
      </button>
    </header>

    <StylePicker
      v-if="pickerOpen"
      class="picker"
      :current="style.id"
      :show-translation="settings.showTranslation"
      @select="settings.style = $event"
      @update:show-translation="settings.showTranslation = $event"
      @pointerdown.stop
    />

    <!-- 底部：播放条（YouTube Music 风格，精简、透明） -->
    <PlayerBar
      class="controls"
      transparent
      compact
      :light="lightStyle"
      :state="state"
      :player="player"
    />
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: hidden;
  background: #0b0d0d;
  color: #f2f2f2;
  font-family: 'Noto Sans SC', system-ui, sans-serif;
}
.style-layer {
  position: absolute;
  inset: 0;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 8px;
  padding: 0 24px;
}
.placeholder-title {
  margin: 0;
  font: 900 clamp(32px, 6vw, 64px) / 1.2 'Noto Serif SC', serif;
}
.placeholder-sub {
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
}

.topbar,
.controls {
  z-index: 10;
  transition: opacity 0.4s;
}
.controls-hidden .topbar,
.controls-hidden .controls {
  opacity: 0;
  pointer-events: none;
}
.topbar {
  position: absolute;
  /* 手机 App：避开状态栏 */
  top: env(safe-area-inset-top);
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--titlebar-height);
  padding: 0 12px;
}
/* 电脑版：顶部可以拖动窗口；右边留给系统的最小化 / 关闭按钮 */
.electron .topbar {
  -webkit-app-region: drag;
  padding-right: 150px;
}
.topbar button {
  -webkit-app-region: no-drag;
}
.spacer {
  flex: 1;
}

button {
  border: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.icon-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(8px);
}
.pill {
  padding: 7px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(8px);
  font-size: 13px;
}
.icon-button:hover,
.pill:hover {
  background: rgba(255, 255, 255, 0.24);
}
button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
/* 浅色风格：顶部按钮换成深色 */
.light .topbar {
  color: #1d1a16;
}
.light .icon-button,
.light .pill {
  background: rgba(0, 0, 0, 0.08);
}
.light .icon-button:hover,
.light .pill:hover {
  background: rgba(0, 0, 0, 0.16);
}

.picker {
  position: absolute;
  z-index: 11;
  top: calc(var(--titlebar-height) + 8px);
  right: 12px;
}

/* PlayerBar 自己有 position: relative（给进度条定位用），
   这里要用更具体的选择器才能把它固定在底部 */
.stage > .controls {
  position: absolute;
  left: 0;
  right: 0;
  /* 手机 App：避开底部导航条 */
  bottom: env(safe-area-inset-bottom);
}
</style>
