<script setup>
// 播放条，两种样子：
// - 完整（默认，参考 YouTube Music）：贴满底部，最上面一条细进度条，
//   左边播放控制和时间，中间封面和歌名，右边音量 / 循环 / 随机
// - 精简（compact）：放在底部中间，封面和歌名在上，进度条两边是时间，下面一排按钮；歌词舞台用
import { computed, ref } from 'vue';
import LikeButton from './LikeButton.vue';
import AddToPlaylistButton from './AddToPlaylistButton.vue';

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
  dragging.value = true;
  dragRatio.value = ratioAt(event);
  bar.value.setPointerCapture(event.pointerId);
}
function onPointerMove(event) {
  hoverRatio.value = ratioAt(event);
  if (dragging.value) dragRatio.value = hoverRatio.value;
}
function onPointerUp() {
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

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const REPEAT_LABEL = { off: '循环：关', all: '列表循环', one: '单曲循环' };

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
        <strong>{{ track?.name ?? '没有在播放' }}</strong>
        <span>{{ artists }}</span>
      </div>
      <LikeButton v-if="track" :track="track" />
      <AddToPlaylistButton v-if="track" :track="track" />
    </div>
    <div class="progress">
      <span v-if="compact" class="time">{{ currentClock }}</span>
      <div
        ref="bar"
        class="scrubber"
        :class="{ active: dragging }"
        role="slider"
        tabindex="0"
        aria-label="播放进度"
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
      <!-- 精简：循环放左边，和右边的随机对称 -->
      <div v-if="compact" class="side side-left">
        <button
          class="icon toggle"
          :class="{ on: state.repeat !== 'off' }"
          :title="REPEAT_LABEL[state.repeat]"
          @click="player.setRepeat(REPEAT_NEXT[state.repeat])"
        >
          <svg viewBox="0 0 24 24">
            <path
              d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"
            />
          </svg>
          <span v-if="state.repeat === 'one'" class="badge">1</span>
        </button>
      </div>

      <div class="transport">
        <button class="icon" title="上一首" @click="player.prev()">
          <svg viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>
        <button
          class="icon play"
          :title="state.playing ? '暂停' : '播放'"
          @click="player.toggle()"
        >
          <svg v-if="state.playing" viewBox="0 0 24 24">
            <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
          </svg>
          <svg v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        </button>
        <button class="icon" title="下一首" @click="player.next()">
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
          <strong>{{ track?.name ?? '没有在播放' }}</strong>
          <span>{{ subtitle }}</span>
        </div>
        <LikeButton v-if="track" :track="track" />
      <AddToPlaylistButton v-if="track" :track="track" />
      </div>

      <div class="side side-right">
        <button
          v-if="!compact"
          class="stage-btn"
          title="打开歌词舞台"
          :disabled="!track"
          @click="emit('open-stage')"
        >
          歌词
        </button>
        <button
          v-if="!compact"
          class="icon toggle"
          :class="{ on: state.repeat !== 'off' }"
          :title="REPEAT_LABEL[state.repeat]"
          @click="player.setRepeat(REPEAT_NEXT[state.repeat])"
        >
          <svg viewBox="0 0 24 24">
            <path
              d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"
            />
          </svg>
          <span v-if="state.repeat === 'one'" class="badge">1</span>
        </button>
        <button
          class="icon toggle"
          :class="{ on: state.shuffle }"
          :title="state.shuffle ? '随机播放：开' : '随机播放：关'"
          @click="player.setShuffle(!state.shuffle)"
        >
          <svg viewBox="0 0 24 24">
            <path
              d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z"
            />
          </svg>
        </button>
        <div class="volume">
          <button
            class="icon toggle on"
            :title="state.volume === 0 ? '取消静音' : '静音'"
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
            aria-label="音量"
            :style="{ '--v': `${state.volume * 100}%` }"
            @input="player.setVolume(Number($event.target.value))"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
