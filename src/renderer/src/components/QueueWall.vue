<script setup>
// 海报墙：整个播放队列排成一面封面墙（参考 Folia 的 Lattice）
// - 照播放顺序：播过的（稍暗）→ 正在播（2×2，显示当前那句歌词）→ 接下来的
// - 点一下播那首；右键（电脑）或长按（手机）出现选单
// - 关灯：只亮正在播的那张；换歌时自动移到新的那首
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { findLineIndex } from '@core/lyrics';
import { usePlayer } from '../composables/usePlayer';
import { useAuthStore } from '../stores/auth';
import { useLibraryStore } from '../stores/library';
import { useNoticeStore } from '../stores/notice';
import { createSongRadio, getLyrics } from '../services';
import { isElectron } from '../platform';
import { artistNames } from '../utils/format';
import { t as tr } from '../i18n';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const emit = defineEmits(['close']);
const { state, player } = usePlayer();

// ---- 队列：播放器有变化就重新拿 ----
const view = shallowRef(player.getQueue());
const refresh = () => (view.value = player.getQueue());
const off = ['queue', 'change', 'track'].map(event => player.on(event, refresh));

/** 墙上的每一张：section + 在那一段里的位置，点下去才知道要播哪首 */
const tiles = computed(() => {
  const { played, current, queued, list } = view.value;
  return [
    ...played.map((track, index) => ({ track, section: 'played', index })),
    ...(current ? [{ track: current, section: 'current', index: 0 }] : []),
    ...queued.map((track, index) => ({ track, section: 'queued', index })),
    ...list.map((track, index) => ({ track, section: 'list', index })),
  ];
});

// ---- 正在播那张上的歌词 ----
const lyricLines = shallowRef([]);
watch(
  () => state.track?.id,
  async id => {
    lyricLines.value = [];
    if (!id) return;
    const track = state.track;
    try {
      const lyrics = await getLyrics(track);
      if (state.track?.id === id) lyricLines.value = lyrics.lines ?? [];
    } catch {
      // 没有歌词就只显示歌名
    }
  },
  { immediate: true }
);
const lyricLine = computed(() => {
  const i = findLineIndex(lyricLines.value, state.time * 1000 + 200);
  return lyricLines.value[i]?.text ?? '';
});

// ---- 关灯、移到正在播的那张 ----
const lightsOff = ref(false);
const wall = ref(null);
// 只卷动封面区（scrollIntoView 会连整个画面一起往上推，顶部那条就跑到状态栏下面）
function focusCurrent(behavior = 'smooth') {
  const box = wall.value;
  const tile = box?.querySelector('.tile.current');
  if (!tile) return;
  box.scrollTo({ top: tile.offsetTop - (box.clientHeight - tile.offsetHeight) / 2, behavior });
}
watch(
  () => state.track?.id,
  () => nextTick(() => focusCurrent())
);
onMounted(() => nextTick(() => focusCurrent('instant')));

// ---- 点一下：播那首（正在播的那张：暂停 / 继续） ----
function play(tile) {
  if (tile.section === 'current') player.toggle();
  else player.playFromQueue(tile.section, tile.index);
}

// ---- 选单：右键（电脑）、长按（手机） ----
const library = useLibraryStore();
const notice = useNoticeStore();
/** @type {import('vue').Ref<{ tile: any, x: number, y: number } | null>} */
const menu = ref(null);
function openMenu(tile, x, y) {
  // 选单宽 200、高约 250：放不下就往左、往上开
  menu.value = {
    tile,
    x: Math.max(8, Math.min(x, window.innerWidth - 208)),
    y: Math.max(8, Math.min(y, window.innerHeight - 258)),
  };
}
const closeMenu = () => (menu.value = null);
function menuAction(action) {
  const tile = menu.value?.tile;
  closeMenu();
  if (!tile) return;
  const { track } = tile;
  const allowed = useAuthStore().allowed;
  if (action === 'next') {
    player.playNext(track);
    if (allowed) notice.show(tr('下一首播放：{name}', { name: track.name }));
  } else if (action === 'radio') {
    player.playFm(createSongRadio(track), { context: `radio:${track.id}` });
    if (allowed) notice.show(tr('开始《{name}》的电台：接下来是相似的歌', { name: track.name }));
    emit('close'); // 电台没有固定的队列，墙上没东西可看
  } else if (action === 'playlist') {
    library.openAddDialog([track]);
  } else if (action === 'remove') {
    player.removeFromQueue(tile.section, tile.index);
  }
}

let pressTimer = 0;
let pressed = false; // 长按开了选单：放开时不要当成点一下
function onPointerDown(event, tile) {
  pressed = false;
  if (event.pointerType === 'mouse') return;
  const { clientX, clientY } = event;
  pressTimer = setTimeout(() => {
    pressed = true;
    navigator.vibrate?.(10);
    openMenu(tile, clientX, clientY);
  }, 500);
}
const cancelPress = () => clearTimeout(pressTimer);
function onClick(tile) {
  if (pressed) return;
  play(tile);
}

// ---- 关闭：Esc（选单开着时先关选单） ----
function onKey(event) {
  if (event.key !== 'Escape') return;
  if (menu.value) closeMenu();
  else emit('close');
}
const onOutside = event => {
  if (menu.value && !event.target.closest?.('.track-menu')) closeMenu();
};
window.addEventListener('keydown', onKey);
window.addEventListener('pointerdown', onOutside, true);
onBeforeUnmount(() => {
  off.forEach(fn => fn());
  clearTimeout(pressTimer);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('pointerdown', onOutside, true);
});

const backdrop = computed(() => {
  const url = state.track?.al?.picUrl;
  return url ? `${url.replace(/^http:/, 'https:')}?param=24y24` : '';
});
</script>

<template>
  <div class="queue-wall" :class="{ 'lights-off': lightsOff, electron: isElectron }" role="dialog" :aria-label="$t('海报墙')">
    <img v-if="backdrop" class="backdrop" :src="backdrop" alt="" />

    <header class="bar">
      <button class="icon-btn" :aria-label="$t('关闭')" @click="emit('close')">
        <Icon name="x" :size="22" />
      </button>
      <h2>{{ $t('播放队列 · {n} 首', { n: tiles.length }) }}</h2>
      <button class="pill" :class="{ on: lightsOff }" :aria-pressed="lightsOff" @click="lightsOff = !lightsOff">
        {{ $t('关灯') }}
      </button>
      <button class="pill" @click="focusCurrent()">{{ $t('正在播') }}</button>
    </header>

    <div ref="wall" class="wall">
      <p v-if="!tiles.length" class="empty">{{ $t('播放队列是空的') }}</p>
      <div class="grid">
        <button
          v-for="(tile, i) in tiles"
          :key="`${tile.section}-${tile.index}-${tile.track.id}`"
          class="tile"
          :class="[tile.section, { playing: tile.section === 'current' && state.playing }]"
          :aria-label="`${i + 1}. ${tile.track.name} - ${artistNames(tile.track)}`"
          @click="onClick(tile)"
          @contextmenu.prevent="openMenu(tile, $event.clientX, $event.clientY)"
          @pointerdown="onPointerDown($event, tile)"
          @pointerup="cancelPress"
          @pointercancel="cancelPress"
          @pointerleave="cancelPress"
        >
          <Cover
            :url="tile.track.al?.picUrl"
            :size="tile.section === 'current' ? 360 : 180"
            radius="0"
            class="art"
          />
          <span class="badge">{{ i + 1 }}</span>
          <span v-if="tile.section === 'current'" class="now">
            <span class="now-tag">
              <Icon :name="state.playing ? 'pause' : 'play'" :size="14" />
              {{ $t('正在播') }}
            </span>
            <span v-if="lyricLine" class="lyric">{{ lyricLine }}</span>
            <strong>{{ tile.track.name }}</strong>
            <span class="artist">{{ artistNames(tile.track) }}</span>
          </span>
          <span v-else class="name">{{ tile.track.name }}</span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="menu"
        class="track-menu"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      >
        <button role="menuitem" @click="menuAction('next')">
          <Icon name="play-next" :size="18" />{{ $t('下一首播放') }}
        </button>
        <button role="menuitem" @click="menuAction('radio')">
          <Icon name="radio" :size="18" />{{ $t('相似歌曲电台') }}
        </button>
        <button role="menuitem" @click="menuAction('playlist')">
          <Icon name="plus" :size="18" />{{ $t('加到歌单') }}
        </button>
        <button
          v-if="menu.tile.section === 'queued' || menu.tile.section === 'list'"
          role="menuitem"
          @click="menuAction('remove')"
        >
          <Icon name="x" :size="18" />{{ $t('从队列移除') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.queue-wall {
  --tile: 168px;
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #0c0c0e;
  color: #f2f2f2;
}
/* 背景：正在播的封面放大模糊（小图放大，省电） */
.backdrop {
  position: absolute;
  inset: -10%;
  width: 120%;
  height: 120%;
  max-width: none;
  object-fit: cover;
  filter: brightness(0.32) saturate(1.3);
  transition: filter 0.6s;
}
.lights-off .backdrop {
  filter: brightness(0.12) saturate(1.1);
}

.bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(env(safe-area-inset-top) + 10px) 16px 10px;
}
/* 电脑版：右上角是视窗按钮，往下让出来 */
.electron .bar {
  padding-top: calc(var(--titlebar-height) + 4px);
}
.bar h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.1);
  color: inherit;
  cursor: pointer;
}
.pill {
  flex: none;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid rgb(255 255 255 / 0.25);
  border-radius: 999px;
  background: rgb(0 0 0 / 0.25);
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.pill.on {
  border-color: #fff;
  background: #fff;
  color: #111;
}

.wall {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px calc(24px + env(safe-area-inset-bottom));
  scrollbar-width: thin;
}
.empty {
  margin: 20vh 0 0;
  text-align: center;
  color: rgb(255 255 255 / 0.6);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
  grid-auto-flow: dense;
  gap: 6px;
}

.tile {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #1c1c1f;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  /* 长队列：画面外的不画，滑到才画 */
  content-visibility: auto;
  contain-intrinsic-size: var(--tile) var(--tile);
  transition: transform 0.2s, opacity 0.4s, filter 0.4s, box-shadow 0.2s;
  -webkit-touch-callout: none;
  user-select: none;
}
.tile:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 24px rgb(0 0 0 / 0.45);
  z-index: 1;
}
.tile:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.art {
  display: block;
  width: 100%;
  height: 100%;
}
.art :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 播过的稍暗 */
.tile.played {
  opacity: 0.45;
  filter: grayscale(0.35);
}
/* 关灯：只亮正在播的 */
.lights-off .tile:not(.current) {
  opacity: 0.1;
  filter: grayscale(0.6);
}
.badge {
  position: absolute;
  top: 6px;
  left: 6px;
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 0.55);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
/* 其他歌：滑过去才显示歌名（手机长按选单也看得到） */
.name {
  position: absolute;
  inset: auto 0 0;
  padding: 18px 8px 6px;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.75));
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transition: opacity 0.2s;
}
.tile:hover .name {
  opacity: 1;
}

/* 正在播：2×2，下面显示当前那句歌词 */
.tile.current {
  grid-column: span 2;
  grid-row: span 2;
  border-radius: 10px;
  box-shadow: 0 0 0 2px #fff, 0 16px 40px rgb(0 0 0 / 0.55);
  content-visibility: visible;
}
.tile.current:hover {
  transform: none;
}
.now {
  position: absolute;
  inset: auto 0 0;
  display: grid;
  gap: 4px;
  padding: 40px 14px 12px;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.85) 55%);
}
.now-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-self: start;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent, #ff3b5c);
  font-size: 11px;
  font-weight: 700;
}
.lyric {
  font-size: clamp(15px, 1.6vw, 20px);
  font-weight: 800;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.now strong {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist {
  font-size: 12px;
  color: rgb(255 255 255 / 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 手机、平板：张数照宽度（手机 3 张、平板直放 6 张左右） */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .queue-wall {
    --tile: 112px;
  }
  .grid {
    gap: 4px;
  }
  .wall {
    padding: 4px 8px calc(24px + env(safe-area-inset-bottom));
  }
  .badge {
    top: 4px;
    left: 4px;
    font-size: 10px;
  }
  .lyric {
    font-size: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tile {
    transition: none;
  }
}
</style>
