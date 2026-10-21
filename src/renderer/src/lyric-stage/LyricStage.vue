<script setup>
// 歌词舞台：全屏显示，负责共用的部分（数据、风格切换、播放控制），
// 歌词怎么画交给 styles/ 里的风格组件
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { provideStage } from './useStage';
import { findStyle } from './styles';
import { isElectron, PHONE_LANDSCAPE_QUERY, setSystemBarsHidden } from '../platform';
import PlayerBar from '../components/PlayerBar.vue';
import StylePicker from './StylePicker.vue';
import ShareLyricsDialog from './ShareLyricsDialog.vue';

const props = defineProps({
  state: { type: Object, required: true },
  player: { type: Object, required: true },
  getLyrics: { type: Function, required: true },
});
const emit = defineEmits(['close']);

const stage = provideStage(props);
const { settings, track, lyrics, lyricsError, lines, retryLyrics } = stage;
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
const shareOpen = ref(false);
let hideTimer = 0;
function wake() {
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!pickerOpen.value) controlsVisible.value = false;
  }, 3000);
}

// 手机横屏：藏起状态栏和导航列，整个画面都给歌词（转回竖屏、关掉舞台时叫回来）
const phoneLandscape = window.matchMedia(PHONE_LANDSCAPE_QUERY);
const syncSystemBars = () => setSystemBarsHidden(phoneLandscape.matches);

// 往下滑关闭（手机）：手指往下拉，舞台跟着往下移；拉超过 1/4 画面或甩得够快就关。
// 只认明显往下的手势，左右滑、点歌词跳转都不受影响
const dragY = ref(0);
let drag = null;
function onDragStart(event) {
  wake();
  if (event.pointerType !== 'touch' || pickerOpen.value || shareOpen.value) return;
  if (event.target.closest('.controls, .topbar button, .picker')) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), active: false };
}
function onDragMove(event) {
  wake();
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.active) {
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) drag = null;
    else if (dy > 12 && dy > Math.abs(dx) * 1.7) drag.active = true;
    return;
  }
  dragY.value = Math.max(0, dy);
}
function onDragEnd(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const { active, at } = drag;
  drag = null;
  const speed = dragY.value / (performance.now() - at); // px / ms
  if (active && (dragY.value > window.innerHeight / 4 || speed > 0.8)) emit('close');
  else dragY.value = 0;
}

function onKey(event) {
  // 上面开着对话框（分享、播放队列…）：Esc 只关对话框，空格不要暂停
  if (document.querySelector('dialog[open]')) return;
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
  phoneLandscape.addEventListener('change', syncSystemBars);
  syncSystemBars();
});
onBeforeUnmount(() => {
  clearTimeout(hideTimer);
  window.removeEventListener('keydown', onKey);
  phoneLandscape.removeEventListener('change', syncSystemBars);
  setSystemBarsHidden(false);
});
</script>

<template>
  <div
    class="stage"
    :class="{
      'controls-hidden': !controlsVisible,
      electron: isElectron,
      light: lightStyle,
      dragging: dragY > 0,
    }"
    :style="dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : null"
    @pointerdown="onDragStart"
    @pointermove="onDragMove"
    @pointerup="onDragEnd"
    @pointercancel="onDragEnd"
  >
    <!-- 手机：提示可以往下拉关闭 -->
    <span class="grabber" aria-hidden="true" />
    <component
      :is="style.component"
      v-if="status === 'ready'"
      class="style-layer"
    />

    <div v-else class="placeholder">
      <p class="placeholder-title">{{ track?.name ?? 'LyriStage' }}</p>
      <p class="placeholder-sub">
        <template v-if="status === 'empty'">{{ $t('还没有在播放的歌') }}</template>
        <template v-else-if="status === 'loading'">{{ $t('歌词加载中…') }}</template>
        <template v-else-if="status === 'instrumental'"
          >{{ $t('纯音乐，请欣赏') }}</template
        >
        <template v-else-if="status === 'no-lyrics'"
          >{{ $t('这首歌暂时没有歌词') }}</template
        >
        <template v-else>{{ $t('歌词加载失败：{error}', { error: lyricsError?.message }) }}</template>
      </p>
      <button v-if="status === 'error'" class="retry" @click="retryLyrics">{{ $t('重试') }}</button>
    </div>

    <!-- 顶部：关闭、风格（电脑版这一条也是拖动窗口的地方） -->
    <header class="topbar">
      <button class="icon-button" :title="$t('关闭（Esc）')" @click="emit('close')"
        >✕</button
      >
      <span class="spacer" />
      <button
        v-if="lines.length"
        class="pill"
        :title="$t('把歌词做成图片分享')"
        @click="shareOpen = true"
      >
        {{ $t('分享歌词') }}
      </button>
      <button
        class="pill"
        :aria-expanded="pickerOpen"
        @click="pickerOpen = !pickerOpen"
      >
        {{ $t('风格：{name}', { name: $t(style.name) }) }}
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

    <ShareLyricsDialog v-if="shareOpen" @close="shareOpen = false" />

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
  /* 底部播放条占的高度：风格组件排版时让出这块（手机横屏是单行，比较矮） */
  --controls-space: calc(170px + env(safe-area-inset-bottom));
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: hidden;
  background: #0b0d0d;
  color: #f2f2f2;
  font-family: 'Noto Sans SC', system-ui, sans-serif;
  transition: transform 0.25s ease-out, border-radius 0.25s;
}
@media (pointer: coarse) and (orientation: landscape) and (max-height: 600px) {
  .stage {
    --controls-space: calc(92px + env(safe-area-inset-bottom));
  }
}
.stage.dragging {
  border-radius: 20px 20px 0 0;
}
.grabber {
  display: none;
}
@media (pointer: coarse) {
  /* 提示线在最上面，按钮列往下让一点，窄屏时才不会和右边的按钮叠在一起 */
  .stage .topbar {
    top: calc(env(safe-area-inset-top) + 12px);
  }
  .grabber {
    position: absolute;
    z-index: 10;
    top: calc(env(safe-area-inset-top) + 5px);
    left: 50%;
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.45);
    transform: translateX(-50%);
    transition: opacity 0.4s;
  }
  .controls-hidden .grabber {
    opacity: 0;
  }
}
.style-layer {
  position: absolute;
  inset: 0;
}
/* 歌词画面上的手势自己处理（往下滑关闭），不要让浏览器拿去滚动。
   只设在这里：设在整个舞台的话，风格列表、分享对话框里就滑不动了 */
.style-layer,
.placeholder {
  touch-action: none;
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
.retry {
  justify-self: center;
  margin-top: 18px;
  padding: 8px 22px;
  border: 1px solid rgb(255 255 255 / 0.5);
  border-radius: 999px;
  background: none;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.retry:hover {
  background: rgb(255 255 255 / 0.12);
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
  /* 横屏时避开挖孔 */
  padding: 0 calc(12px + env(safe-area-inset-right)) 0 calc(12px + env(safe-area-inset-left));
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
  top: calc(env(safe-area-inset-top) + var(--titlebar-height) + 20px);
  right: calc(12px + env(safe-area-inset-right));
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
