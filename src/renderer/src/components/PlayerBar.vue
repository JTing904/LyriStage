<script setup>
// 播放条，两种样子：
// - 完整（默认，参考 YouTube Music）：贴满底部，最上面一条细进度条，
//   左边播放控制和时间，中间封面和歌名，右边音量 / 循环 / 随机
// - 精简（compact）：放在底部中间，封面和歌名在上，进度条两边是时间，下面一排按钮；歌词舞台用
import { computed, onBeforeUnmount, ref } from 'vue';
import LikeButton from './LikeButton.vue';
import AddToPlaylistButton from './AddToPlaylistButton.vue';
import Icon from './Icon.vue';
import { isElectron, setDesktopLyrics } from '../platform';
import { desktopLyrics } from '../desktop';
import { useUiStore } from '../stores/ui';
import { useSleepStore } from '../stores/sleep';
import { useAuthStore } from '../stores/auth';
import { useFmDislike } from '../composables/useFmDislike';
import { useRoomLocked } from '../composables/useRoomLock';
import { useLoadingHint } from '../composables/useLoadingHint';
import HostLine from './HostLine.vue';

const ui = useUiStore();
const sleep = useSleepStore();
const auth = useAuthStore();
const dislike = useFmDislike();
/** 一起听的成员：播放键、进度条变灰（还是按得到，按了会说只有房主能控制） */
const locked = computed(useRoomLocked());

// 歌词舞台的睡眠定时选单（点外面就关）
const SLEEP_OPTIONS = [15, 30, 60];
const sleepMenu = ref(false);
const closeSleepMenu = event => {
  if (sleepMenu.value && !event.target.closest?.('.sleep-wrap')) sleepMenu.value = false;
};
document.addEventListener('pointerdown', closeSleepMenu, true);
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeSleepMenu, true));

const props = defineProps({
  state: { type: Object, required: true },
  player: { type: Object, required: true },
  /** 透明底：叠在歌词舞台这种全屏画面上时用，文字和图标靠阴影保证看得清 */
  transparent: { type: Boolean, default: false },
  /** 精简：只占底部中间一块（封面和歌名在上，进度条在中间，按钮在下） */
  compact: { type: Boolean, default: false },
  /** 浅色背景上用：文字和图标换成深色 */
  light: { type: Boolean, default: false },
});
const emit = defineEmits(['open-stage']);

const track = computed(() => props.state.track);
const artists = computed(() =>
  (track.value?.ar ?? []).map(a => a.name).join(', ')
);
const subtitle = computed(() =>
  [artists.value, track.value?.al?.name].filter(Boolean).join(' • ')
);
/** 找音源找很久：歌手那一行改成「正在找其他音源…」 */
const loadingHint = useLoadingHint(props.state);
const cover = computed(
  () =>
    track.value?.al?.picUrl &&
    `${track.value.al.picUrl.replace(/^http:/, 'https:')}?param=96y96`
);

const clock = seconds => {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// 进度条：拖动时只预览位置，放开才跳过去（避免拖动中一直重新缓冲）
const bar = ref(null);
const dragging = ref(false);
const hoverRatio = ref(null);
const dragRatio = ref(0);

const duration = computed(
  () => props.state.duration || (track.value?.dt ?? 0) / 1000
);
const playedRatio = computed(() => {
  if (dragging.value) return dragRatio.value;
  return duration.value ? Math.min(1, props.state.time / duration.value) : 0;
});
const currentClock = computed(() =>
  clock(dragging.value ? dragRatio.value * duration.value : props.state.time)
);

function ratioAt(event) {
  const rect = bar.value.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}
function onPointerDown(event) {
  if (!duration.value) return;
  if (locked.value) return props.player.seek(ratioAt(event) * duration.value);
  dragging.value = true;
  dragRatio.value = ratioAt(event);
  bar.value.setPointerCapture(event.pointerId);
}
function onPointerMove(event) {
  if (locked.value) return;
  hoverRatio.value = ratioAt(event);
  if (dragging.value) dragRatio.value = hoverRatio.value;
}
function onPointerUp(event) {
  // 手指放开：拖动时显示的时间也收起来（滑鼠的话移开才收）
  if (event?.pointerType !== 'mouse') hoverRatio.value = null;
  if (!dragging.value) return;
  dragging.value = false;
  props.player.seek(dragRatio.value * duration.value);
}
function onKeydown(event) {
  const step =
    event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0;
  if (!step) return;
  event.preventDefault();
  props.player.seek(
    Math.min(duration.value, Math.max(0, props.state.time + step))
  );
}

// 播放模式（像网易云一样一个按钮轮流切换，循环和随机不会同时开、互相打架）
const MODES = ['order', 'loop', 'one', 'shuffle'];
const MODE_LABEL = {
  order: '顺序播放',
  loop: '列表循环',
  one: '单曲循环',
  shuffle: '随机播放',
};
const mode = computed(() => {
  if (props.state.shuffle) return 'shuffle';
  if (props.state.repeat === 'one') return 'one';
  return props.state.repeat === 'all' ? 'loop' : 'order';
});
function nextMode() {
  const next = MODES[(MODES.indexOf(mode.value) + 1) % MODES.length];
  props.player.setShuffle(next === 'shuffle');
  props.player.setRepeat(next === 'one' ? 'one' : next === 'order' ? 'off' : 'all');
}

const volumeIcon = computed(() => {
  const v = props.state.volume;
  if (v === 0) return 'mute';
  return v < 0.5 ? 'low' : 'high';
});
let lastVolume = 1;
function toggleMute() {
  if (props.state.volume > 0) {
    lastVolume = props.state.volume;
    props.player.setVolume(0);
  } else {
    props.player.setVolume(lastVolume || 1);
  }
}
</script>

<template>
  <div class="player-bar" :class="{ transparent, compact, light }">
    <div v-if="compact" class="compact-meta">
      <img v-if="cover" class="cover" :src="cover" alt="" />
      <div class="meta">
        <strong>{{ track?.name ?? $t('没有在播放') }}</strong>
        <HostLine v-if="locked" />
        <span v-else :class="{ 'loading-hint': loadingHint }">{{ loadingHint || artists }}</span>
      </div>
      <LikeButton v-if="track" :track="track" />
      <AddToPlaylistButton v-if="track" :track="track" />
    </div>
    <div class="progress">
      <span v-if="compact" class="time">{{ currentClock }}</span>
      <div
        ref="bar"
        class="scrubber"
        :class="{ active: dragging, locked }"
        role="slider"
        tabindex="0"
        :aria-label="$t('播放进度')"
        :aria-valuemin="0"
        :aria-valuemax="Math.round(duration)"
        :aria-valuenow="Math.round(state.time)"
        :aria-valuetext="`${currentClock} / ${clock(duration)}`"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="hoverRatio = null"
        @keydown="onKeydown"
      >
        <div class="track-line">
          <div
            v-if="hoverRatio !== null"
            class="hover-fill"
            :style="{ width: `${hoverRatio * 100}%` }"
          />
          <div class="played" :style="{ width: `${playedRatio * 100}%` }" />
          <div class="knob" :style="{ left: `${playedRatio * 100}%` }" />
        </div>
        <span
          v-if="hoverRatio !== null && duration"
          class="tooltip"
          :style="{ left: `${hoverRatio * 100}%` }"
          >{{ clock(hoverRatio * duration) }}</span
        >
      </div>
      <span v-if="compact" class="time">{{ clock(duration) }}</span>
    </div>

    <div class="row">
      <!-- 精简：播放模式放左边，和右边的音量对称 -->
      <div v-if="compact" class="side side-left">
        <button
          class="icon toggle mode"
          :class="{ on: mode !== 'order' }"
          :title="$t('{mode}（点一下切换）', { mode: $t(MODE_LABEL[mode]) })"
          :aria-label="$t('播放模式：{mode}', { mode: $t(MODE_LABEL[mode]) })"
          @click="nextMode"
        >
          <svg v-if="mode === 'shuffle'" viewBox="0 0 24 24">
            <path
              d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z"
            />
          </svg>
          <svg v-else-if="mode === 'order'" viewBox="0 0 24 24">
            <path d="M4 6h11v2H4zm0 5h11v2H4zm0 5h7v2H4zm13-4v6.2l-2-2-1.4 1.4L18 22l4.4-4.4-1.4-1.4-2 2V12z" />
          </svg>
          <svg v-else viewBox="0 0 24 24">
            <path
              d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"
            />
          </svg>
          <span v-if="mode === 'one'" class="badge">1</span>
        </button>
      </div>

      <div class="transport" :class="{ locked }">
        <button class="icon" :title="$t('上一首')" @click="player.prev()">
          <svg viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>
        <button
          class="icon play"
          :title="state.playing ? $t('暂停') : $t('播放')"
          @click="player.toggle()"
        >
          <svg v-if="state.playing" viewBox="0 0 24 24">
            <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
          </svg>
          <svg v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        </button>
        <button class="icon" :title="$t('下一首')" @click="player.next()">
          <svg viewBox="0 0 24 24">
            <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
          </svg>
        </button>
        <span v-if="!compact" class="time"
          >{{ currentClock }} / {{ clock(duration) }}</span
        >
      </div>

      <div v-if="!compact" class="center">
        <img v-if="cover" class="cover" :src="cover" alt="" />
        <div class="meta">
          <strong>{{ track?.name ?? $t('没有在播放') }}</strong>
          <HostLine v-if="locked" />
          <span v-else :class="{ 'loading-hint': loadingHint }">{{ loadingHint || subtitle }}</span>
        </div>
        <LikeButton v-if="track" :track="track" />
      <AddToPlaylistButton v-if="track" :track="track" />
      </div>

      <div class="side side-right">
        <button
          v-if="!compact"
          class="stage-btn"
          :title="$t('打开歌词舞台')"
          :disabled="!track"
          @click="emit('open-stage')"
        >
          {{ $t('歌词') }}
        </button>
        <button
          v-if="isElectron && !compact"
          class="icon toggle"
          :class="{ on: desktopLyrics.enabled }"
          :title="desktopLyrics.enabled ? $t('关掉桌面歌词') : $t('打开桌面歌词')"
          :aria-pressed="desktopLyrics.enabled"
          @click="setDesktopLyrics(!desktopLyrics.enabled)"
        >
          <Icon name="desktop-lyrics" :size="20" />
        </button>
        <button
          v-if="!compact"
          class="icon toggle mode"
          :class="{ on: mode !== 'order' }"
          :title="$t('{mode}（点一下切换）', { mode: $t(MODE_LABEL[mode]) })"
          :aria-label="$t('播放模式：{mode}', { mode: $t(MODE_LABEL[mode]) })"
          @click="nextMode"
        >
          <svg v-if="mode === 'shuffle'" viewBox="0 0 24 24">
            <path
              d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z"
            />
          </svg>
          <svg v-else-if="mode === 'order'" viewBox="0 0 24 24">
            <path d="M4 6h11v2H4zm0 5h11v2H4zm0 5h7v2H4zm13-4v6.2l-2-2-1.4 1.4L18 22l4.4-4.4-1.4-1.4-2 2V12z" />
          </svg>
          <svg v-else viewBox="0 0 24 24">
            <path
              d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"
            />
          </svg>
          <span v-if="mode === 'one'" class="badge">1</span>
        </button>
        <button
          v-if="state.mode === 'fm' && track && auth.allowed"
          class="icon toggle"
          :title="$t('不喜欢（跳过，以后少推荐）')"
          :aria-label="$t('不喜欢（跳过，以后少推荐）')"
          @click="dislike"
        >
          <Icon name="dislike" :size="20" />
        </button>
        <!-- 睡眠定时（开着时写还剩多久）：歌词舞台和电脑版的播放条都有 -->
        <span class="sleep-wrap">
          <button
            class="icon toggle sleep-btn"
            :class="{ on: sleep.active }"
            :title="$t('睡眠定时')"
            :aria-label="$t('睡眠定时')"
            :aria-expanded="sleepMenu"
            @click="sleepMenu = !sleepMenu"
          >
            <Icon name="moon" :size="20" />
            <span v-if="sleep.active" class="sleep-left">{{ sleep.afterSong ? $t('这首') : sleep.remaining }}</span>
          </button>
          <div v-if="sleepMenu" class="sleep-menu" role="menu">
            <button v-for="m in SLEEP_OPTIONS" :key="m" role="menuitem" @click="(sleep.start(m), (sleepMenu = false))">
              {{ $t('{n} 分钟', { n: m }) }}
            </button>
            <button role="menuitem" @click="(sleep.startAfterSong(), (sleepMenu = false))">{{ $t('这首播完') }}</button>
            <button v-if="sleep.active" role="menuitem" class="off" @click="(sleep.cancel(), (sleepMenu = false))">
              {{ $t('关掉睡眠定时') }}
            </button>
          </div>
        </span>
        <button
          class="icon toggle queue-btn"
          :class="{ on: ui.queueOpen }"
          :title="$t('播放队列')"
          :aria-label="$t('播放队列')"
          :aria-expanded="ui.queueOpen"
          @click="ui.queueOpen = !ui.queueOpen"
        >
          <Icon name="queue" :size="20" />
        </button>
        <div class="volume">
          <button
            class="icon toggle on"
            :title="state.volume === 0 ? $t('取消静音') : $t('静音')"
            @click="toggleMute"
          >
            <svg v-if="volumeIcon === 'mute'" viewBox="0 0 24 24">
              <path
                d="M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"
              />
            </svg>
            <svg v-else-if="volumeIcon === 'low'" viewBox="0 0 24 24">
              <path
                d="M5 9v6h4l5 5V4L9 9zm11.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24">
              <path
                d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"
              />
            </svg>
          </button>
          <input
            class="volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="state.volume"
            :aria-label="$t('音量')"
            :style="{ '--v': `${state.volume * 100}%` }"
            @input="player.setVolume(Number($event.target.value))"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 找音源找很久时的提示（代替歌手那一行） */
.loading-hint {
  color: var(--accent);
  font-weight: 600;
}
/* 完整模式跟随 App 的深色 / 浅色主题 */
.player-bar {
  --bar-bg: var(--bar, #18181b);
  --bar-fg: var(--text, #fff);
  --bar-dim: var(--text-dim, rgba(255, 255, 255, 0.64));
  --bar-accent: var(--accent, #ff3b5c);
  position: relative;
  background: var(--bar-bg);
  color: var(--bar-fg);
  border-top: 1px solid var(--line, transparent);
}
/* 透明模式（歌词舞台）：叠在画面上，固定白字 */
.player-bar.transparent {
  --bar-fg: #fff;
  --bar-dim: rgba(255, 255, 255, 0.64);
  --bar-accent: #ff3b5c;
  background: transparent;
  border-top: 0;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.stage-btn {
  height: 34px;
  margin-right: 6px;
  padding: 0 14px;
  border: 0;
  border-radius: 17px;
  background: var(--bar-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-shadow: none;
}
.stage-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.player-bar.transparent button.icon svg {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}
/* 浅色背景：深色字和图标，不要阴影 */
.player-bar.light {
  --bar-fg: #1d1a16;
  --bar-dim: rgba(29, 26, 22, 0.6);
  --bar-accent: #b3261e;
  text-shadow: none;
}
.player-bar.light button.icon svg {
  filter: none;
}
.player-bar.light .track-line {
  background: rgba(0, 0, 0, 0.18);
}
.player-bar.light button.icon:hover {
  background: rgba(0, 0, 0, 0.08);
}

.sleep-wrap {
  position: relative;
  display: flex;
}
button.icon.sleep-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 40px;
  gap: 4px;
  padding: 0 8px;
  border-radius: 999px;
}
.sleep-left {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sleep-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 5;
  display: grid;
  min-width: 160px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(20, 20, 22, 0.92);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
  color: #fff;
  text-shadow: none;
  transform: translateX(-50%);
}
.sleep-menu button {
  min-height: 42px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.sleep-menu button:hover {
  background: rgba(255, 255, 255, 0.1);
}
.sleep-menu .off {
  color: #ff8fa3;
}
.queue-btn {
  position: relative;
}
/* 睡眠定时开着：队列按钮右上角一个小月亮 */
/* ---------- 进度条 ---------- */
/* 完整：贴在播放条最上缘，平时 2px，滑过 / 拖动时变粗并出现圆点 */
.progress {
  position: absolute;
  left: 0;
  right: 0;
  top: -7px;
}
.scrubber {
  position: relative;
  height: 16px;
  cursor: pointer;
  touch-action: none;
  outline: none;
}
.track-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 7px;
  height: 2px;
  background: color-mix(in srgb, var(--bar-fg) 22%, transparent);
  transition: height 0.12s, top 0.12s;
}
.scrubber:hover .track-line,
.scrubber.active .track-line,
.scrubber:focus-visible .track-line {
  top: 6px;
  height: 4px;
}
.hover-fill,
.played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
}
.hover-fill {
  background: color-mix(in srgb, var(--bar-fg) 25%, transparent);
}
.played {
  background: var(--bar-accent);
}
.knob {
  position: absolute;
  top: 50%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--bar-accent);
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.12s;
}
.scrubber:hover .knob,
.scrubber.active .knob,
.scrubber:focus-visible .knob {
  transform: translate(-50%, -50%) scale(1);
}
.tooltip {
  position: absolute;
  bottom: 18px;
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.8);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  text-shadow: none;
}

/* 手指：进度条的感应范围加大到 32px（细线本身不变粗太多），圆点一直看得到；
   拖的时候圆点变大、上面显示拖到几分几秒 */
@media (pointer: coarse) {
  .scrubber {
    height: 32px;
  }
  .track-line {
    top: 14px;
    height: 4px;
  }
  .scrubber.active .track-line {
    top: 13px;
    height: 6px;
  }
  .knob {
    transform: translate(-50%, -50%) scale(1);
  }
  .scrubber.active .knob {
    transform: translate(-50%, -50%) scale(1.6);
  }
  .tooltip {
    bottom: 32px;
    padding: 4px 8px;
    font-size: 14px;
  }
  /* 完整播放条（平板）：线贴着上缘，感应范围只往播放条里面长（不要伸进上面的页面，
     按列表最下面那一行时会不小心拖到进度） */
  .player-bar:not(.compact) .progress {
    top: -2px;
  }
  .player-bar:not(.compact) .scrubber {
    height: 22px;
  }
  .player-bar:not(.compact) .track-line {
    top: 1px;
  }
  .player-bar:not(.compact) .scrubber.active .track-line {
    top: 0;
  }
}

/* ---------- 按钮行（完整） ---------- */
.row {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) minmax(0, 2fr) minmax(
      max-content,
      1fr
    );
  align-items: center;
  gap: 16px;
  height: 72px;
  padding: 0 16px;
}
.transport,
.side {
  display: flex;
  align-items: center;
  gap: 4px;
}
.side-right {
  justify-content: flex-end;
}
.center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-width: 0;
}

button.icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bar-fg);
  cursor: pointer;
}
button.icon svg {
  width: 24px;
  height: 24px;
  fill: currentColor;
}
/* 线条图标（Icon 组件，例如桌面歌词）不要被填满 */
button.icon svg.icon {
  width: 20px;
  height: 20px;
  fill: none;
}
button.icon:hover {
  background: color-mix(in srgb, var(--bar-fg) 10%, transparent);
}
button.icon:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 1px;
}
button.icon.play {
  width: 48px;
  height: 48px;
}
button.icon.play svg {
  width: 36px;
  height: 36px;
}
/* 关闭状态的循环 / 随机是暗的，打开才是亮白色 */
button.icon.toggle {
  color: var(--bar-dim);
}
button.icon.toggle.on {
  color: var(--bar-fg);
}
.badge {
  position: absolute;
  right: 7px;
  bottom: 7px;
  font-size: 9px;
  font-weight: 700;
}

.time {
  font-size: 12px;
  color: var(--bar-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.transport .time {
  margin-left: 8px;
}

.cover {
  width: 40px;
  height: 40px;
  border-radius: 2px;
  object-fit: cover;
  flex-shrink: 0;
}
.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.meta strong,
.meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta strong {
  font-size: 15px;
}
.meta span {
  font-size: 13px;
  color: var(--bar-dim);
}
.meta .host-line {
  align-self: flex-start;
  max-width: 100%;
  margin-top: 1px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bar-accent) 16%, transparent);
  color: var(--bar-accent);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
}
/* 一起听的成员：播放键和进度条变灰 */
.transport.locked button.icon,
.scrubber.locked {
  opacity: 0.35;
}
.scrubber.locked .knob {
  display: none;
}

/* 音量：滑过喇叭图标才展开滑杆 */
.volume {
  display: flex;
  align-items: center;
}
.volume-slider {
  width: 0;
  opacity: 0;
  margin: 0;
  transition: width 0.2s, opacity 0.2s, margin 0.2s;
  appearance: none;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    var(--bar-fg) var(--v),
    color-mix(in srgb, var(--bar-fg) 25%, transparent) var(--v)
  );
  cursor: pointer;
}
.volume:hover .volume-slider,
.volume-slider:focus-visible {
  width: 90px;
  opacity: 1;
  margin: 0 8px 0 4px;
}
.volume-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bar-fg);
}

/* ---------- 精简：底部中间一块 ---------- */
.player-bar.compact {
  width: min(560px, calc(100% - 32px));
  margin: 0 auto 20px;
  display: grid;
  gap: 4px;
}
.compact-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-width: 0;
  margin-bottom: 6px;
}
.compact-meta .cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
.compact-meta .meta strong {
  font-size: 16px;
}
.compact .progress {
  position: static;
  display: flex;
  align-items: center;
  gap: 12px;
}
.compact .scrubber {
  flex: 1;
}
.compact .row {
  grid-template-columns: 1fr auto 1fr;
  height: 56px;
  padding: 0;
}
.compact .side-left {
  justify-content: flex-end;
}
.compact .side-right {
  justify-content: flex-start;
}

/* 手机、平板：用实体音量键，不需要音量按钮 */
@media (pointer: coarse) {
  .volume {
    display: none;
  }
}

/* 手机横屏的歌词舞台：画面很矮，播放条压成一行（歌名在左、按钮在中间），
   把高度留给歌词；左右避开挖孔 */
@media (pointer: coarse) and (orientation: landscape) and (max-height: 600px) {
  .player-bar.compact {
    width: auto;
    margin: 0 calc(20px + env(safe-area-inset-right)) 6px calc(20px + env(safe-area-inset-left));
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-areas:
      'progress progress progress'
      'meta row .';
    column-gap: 16px;
    row-gap: 2px;
  }
  .compact .progress {
    grid-area: progress;
  }
  .compact-meta {
    grid-area: meta;
    justify-content: flex-start;
    margin: 0;
  }
  .compact-meta .cover {
    width: 40px;
    height: 40px;
  }
  .compact-meta .meta strong {
    font-size: 15px;
  }
  .compact .row {
    grid-area: row;
    grid-template-columns: auto auto auto;
    gap: 12px;
    height: 52px;
  }
}

/* 窄屏（手机）的完整模式：只留播放控制和歌名，循环 / 随机 / 音量收起来 */
@media (max-width: 760px) {
  .player-bar:not(.compact) .row {
    grid-template-columns: minmax(0, 1fr) auto;
    height: 64px;
    gap: 8px;
  }
  .player-bar:not(.compact) .center {
    order: -1;
    justify-content: flex-start;
  }
  .player-bar:not(.compact) .transport .time,
  .player-bar:not(.compact) .side {
    display: none;
  }
}
</style>
