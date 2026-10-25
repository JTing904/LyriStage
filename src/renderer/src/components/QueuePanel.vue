<script setup>
// 播放队列面板（电脑：右边滑出；手机：从下面拉上来）
// - 正在播放
// - 接下来（你加入的）：可以拖动排序、移除、清空
// - 歌单里接下来的歌：可以拖动排序、移除
// 拖动只能用左边的把手（不会拖的时候误点到歌）；拖到上下边缘会自动卷动；把手也可以用 ↑ ↓ 键移动
import { nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';
import { usePlayer } from '../composables/usePlayer';
import { useUiStore } from '../stores/ui';
import { artistNames } from '../utils/format';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const ui = useUiStore();
const { state, player } = usePlayer();

const LIST_LIMIT = 100; // 歌单很长时只显示接下来这么多首

// ---- 资料：播放器有变化就重新拿 ----
const view = shallowRef(player.getQueue());
const refresh = () => (view.value = player.getQueue());
const off = ['queue', 'change', 'track'].map(event => player.on(event, refresh));
onBeforeUnmount(() => off.forEach(fn => fn()));

// ---- 打开 / 关闭（原生 dialog：Esc、Android 返回键都会关） ----
const dialog = ref(null);
watch(
  () => ui.queueOpen,
  open => {
    if (open) {
      refresh();
      nextTick(() => dialog.value?.showModal());
    } else dialog.value?.close();
  },
  { immediate: true }
);
const close = () => (ui.queueOpen = false);

// ---- 清空「你加入的」：6 秒内可以复原（面板会盖住画面下方的提示，所以提示放在面板里） ----
const cleared = ref(null);
let clearedTimer = 0;
function clearQueued() {
  cleared.value = [...view.value.queued];
  player.clearQueued();
  clearTimeout(clearedTimer);
  clearedTimer = setTimeout(() => (cleared.value = null), 6000);
}
function undoClear() {
  const tracks = cleared.value ?? [];
  cleared.value = null;
  clearTimeout(clearedTimer);
  // 清空之后又加的排在后面
  const addedSince = [...view.value.queued];
  player.clearQueued();
  [...tracks, ...addedSince].forEach(track => player.addToQueue(track));
}
onBeforeUnmount(() => clearTimeout(clearedTimer));
function openWall() {
  close();
  ui.wallOpen = true;
}

// ---- 拖动排序 ----
const scroller = ref(null);
const lists = { queued: ref(null), list: ref(null) };
const drag = reactive({ section: '', from: -1, over: -1, startY: 0, y: 0, scroll0: 0, scroll: 0 });
let scrollFrame = 0;

/** 手指在 y 时，放下去会到第几个位置（跳过正在拖的那一行，它跟着手指走） */
function indexAt(section, y) {
  const rows = [...(lists[section].value?.querySelectorAll('.row') ?? [])];
  for (let i = 0; i < rows.length; i++) {
    if (i === drag.from) continue;
    const r = rows[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i > drag.from ? i - 1 : i;
  }
  return rows.length - 1;
}

function autoScroll() {
  const box = scroller.value?.getBoundingClientRect();
  if (box && drag.from >= 0) {
    const edge = 56;
    if (drag.y < box.top + edge) scroller.value.scrollTop -= 10;
    else if (drag.y > box.bottom - edge) scroller.value.scrollTop += 10;
    drag.scroll = scroller.value.scrollTop;
    drag.over = indexAt(drag.section, drag.y);
    scrollFrame = requestAnimationFrame(autoScroll);
  }
}

function onHandleDown(event, section, index) {
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  const scroll = scroller.value?.scrollTop ?? 0;
  Object.assign(drag, {
    section, from: index, over: index, startY: event.clientY, y: event.clientY, scroll0: scroll, scroll,
  });
  scrollFrame = requestAnimationFrame(autoScroll);
}
function onHandleMove(event) {
  if (drag.from < 0) return;
  drag.y = event.clientY;
  drag.over = indexAt(drag.section, event.clientY);
}
function onHandleUp() {
  if (drag.from < 0) return;
  cancelAnimationFrame(scrollFrame);
  const { section, from, over } = drag;
  Object.assign(drag, { section: '', from: -1, over: -1 });
  if (over !== from) player.moveInQueue(section, from, over);
}
function onHandleKey(event, section, index, length) {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
  if (to < 0 || to >= length) return;
  event.preventDefault();
  player.moveInQueue(section, index, to);
  // 焦点跟着移到新位置的把手
  nextTick(() => lists[section].value?.querySelectorAll('.handle')[to]?.focus());
}

/** 拖动中的那一行跟着手指走；其他行在放下的位置空出一条线 */
function rowStyle(section, index) {
  if (drag.section !== section || drag.from !== index) return undefined;
  // 列表自动卷动时，这一行原本的位置也跟着动，要加回卷动的距离
  return { transform: `translateY(${drag.y - drag.startY + drag.scroll - drag.scroll0}px)` };
}
const dropClass = (section, index) =>
  drag.section === section && drag.over === index && drag.over !== drag.from
    ? drag.over > drag.from
      ? 'drop-after'
      : 'drop-before'
    : '';

</script>

<template>
  <dialog ref="dialog" class="queue-panel" :aria-label="$t('播放队列')" @close="close" @click.self="close">
    <div class="panel">
      <header class="head">
        <h2>{{ $t('播放队列') }}</h2>
        <button v-if="view.mode !== 'fm' && view.current" class="wall-btn" @click="openWall">
          <Icon name="grid" :size="16" />{{ $t('海报墙') }}
        </button>
        <button class="icon-btn" :aria-label="$t('关闭')" @click="close"><Icon name="x" :size="20" /></button>
      </header>

      <div ref="scroller" class="scroller">
        <!-- 正在播放 -->
        <section v-if="view.current">
          <h3>{{ $t('正在播放') }}</h3>
          <div class="row now">
            <span class="handle-space" />
            <Cover :url="view.current.al?.picUrl" :size="44" radius="6px" class="cover" />
            <span class="meta">
              <strong>{{ view.current.name }}</strong>
              <span>{{ artistNames(view.current) }}</span>
            </span>
          </div>
        </section>

        <p v-if="view.mode === 'fm'" class="hint">
          {{
            String(state.context).startsWith('radio:')
              ? $t('电台会一首一首挑相似的歌，没有固定的播放队列。')
              : $t('私人 FM 会一首一首为你挑歌，没有固定的播放队列。')
          }}
        </p>

        <p v-if="cleared" class="undo-row" role="status">
          {{ $t('已清空你加入的 {n} 首', { n: cleared.length }) }}
          <button class="undo-btn" @click="undoClear">{{ $t('复原') }}</button>
          <span class="undo-line" aria-hidden="true" />
        </p>
        <!-- 你加入的 -->
        <section v-if="view.queued.length">
          <h3>
            {{ $t('接下来（你加入的）') }}
            <button class="text-btn" @click="clearQueued">{{ $t('清空') }}</button>
          </h3>
          <div :ref="el => (lists.queued.value = el)">
            <div
              v-for="(t, i) in view.queued"
              :key="`q-${i}-${t.id}`"
              class="row"
              :class="[{ dragging: drag.section === 'queued' && drag.from === i }, dropClass('queued', i)]"
              :style="rowStyle('queued', i)"
            >
              <button
                class="handle"
                :aria-label="$t('拖动排序：{name}（也可以按上下键）', { name: t.name })"
                @pointerdown="onHandleDown($event, 'queued', i)"
                @pointermove="onHandleMove"
                @pointerup="onHandleUp"
                @pointercancel="onHandleUp"
                @keydown="onHandleKey($event, 'queued', i, view.queued.length)"
              >
                <Icon name="grip" :size="18" />
              </button>
              <button class="play" @click="player.playFromQueue('queued', i)">
                <Cover :url="t.al?.picUrl" :size="44" radius="6px" class="cover" />
                <span class="meta">
                  <strong>{{ t.name }}</strong>
                  <span>{{ artistNames(t) }}</span>
                </span>
              </button>
              <button class="icon-btn" :aria-label="$t('从队列移除')" @click="player.removeFromQueue('queued', i)">
                <Icon name="x" :size="16" />
              </button>
            </div>
          </div>
        </section>

        <!-- 歌单里接下来的 -->
        <section v-if="view.list.length">
          <h3>{{ $t('接下来') }}</h3>
          <div :ref="el => (lists.list.value = el)">
            <div
              v-for="(t, i) in view.list.slice(0, LIST_LIMIT)"
              :key="`l-${i}-${t.id}`"
              class="row"
              :class="[{ dragging: drag.section === 'list' && drag.from === i }, dropClass('list', i)]"
              :style="rowStyle('list', i)"
            >
              <button
                class="handle"
                :aria-label="$t('拖动排序：{name}（也可以按上下键）', { name: t.name })"
                @pointerdown="onHandleDown($event, 'list', i)"
                @pointermove="onHandleMove"
                @pointerup="onHandleUp"
                @pointercancel="onHandleUp"
                @keydown="onHandleKey($event, 'list', i, Math.min(view.list.length, LIST_LIMIT))"
              >
                <Icon name="grip" :size="18" />
              </button>
              <button class="play" @click="player.playFromQueue('list', i)">
                <Cover :url="t.al?.picUrl" :size="44" radius="6px" class="cover" />
                <span class="meta">
                  <strong>{{ t.name }}</strong>
                  <span>{{ artistNames(t) }}</span>
                </span>
              </button>
              <button class="icon-btn" :aria-label="$t('从队列移除')" @click="player.removeFromQueue('list', i)">
                <Icon name="x" :size="16" />
              </button>
            </div>
          </div>
          <p v-if="view.list.length > LIST_LIMIT" class="hint">
            {{ $t('还有 {n} 首', { n: view.list.length - LIST_LIMIT }) }}
          </p>
        </section>

        <p v-if="view.mode !== 'fm' && !view.queued.length && !view.list.length" class="hint">
          {{ $t('后面没有歌了。在歌曲的「⋯」选「下一首播放」或「加入播放队列」就会出现在这里。') }}
        </p>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.queue-panel {
  /* 电脑：右边一条，上下留空，播放条还看得到 */
  position: fixed;
  inset: calc(var(--titlebar-height, 0px) + 12px) 12px 104px auto;
  width: min(400px, calc(100vw - 24px));
  height: auto;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.35);
}
.queue-panel[open] {
  display: flex;
  animation: slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.queue-panel::backdrop {
  background: rgb(0 0 0 / 0.25);
}
@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
}
.panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 12px 8px 20px;
}
.head h2 {
  flex: 1;
  margin: 0;
  font-size: 18px;
}
.wall-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  margin-right: 4px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.wall-btn:hover {
  border-color: var(--text-dim);
}
.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 16px;
  overscroll-behavior: contain;
}
section {
  margin-bottom: 14px;
}
h3 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 10px 12px 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.undo-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 12px;
  padding: 8px 8px 8px 16px;
  border-radius: 14px;
  background: var(--text);
  color: var(--bg);
  font-size: 14px;
  font-weight: 700;
}
.undo-btn {
  flex: none;
  min-height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.undo-line {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 3px;
  height: 2px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg) 60%, transparent);
  transform-origin: left;
  animation: undo-countdown 6s linear forwards;
}
@keyframes undo-countdown {
  to {
    transform: scaleX(0);
  }
}
.hint {
  margin: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-dim);
}

/* 一行 */
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--surface);
}
.row:hover {
  background: var(--surface-hover);
}
.row.now .meta strong {
  color: var(--accent);
}
.row.dragging {
  z-index: 2;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  background: var(--surface-hover);
}
.row.drop-before::before,
.row.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}
.row.drop-before::before {
  top: -1px;
}
.row.drop-after::after {
  bottom: -1px;
}
.handle,
.handle-space {
  flex: none;
  width: 32px;
  height: 44px;
}
.handle {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--text-faint);
  cursor: grab;
  touch-action: none;
}
.handle:active {
  cursor: grabbing;
}
.play {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row.now {
  gap: 10px;
}
.cover {
  flex: none;
  width: 44px;
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
  font-size: 14px;
  font-weight: 600;
}
.meta span {
  font-size: 12px;
  color: var(--text-dim);
}
.icon-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--text);
  background: var(--surface-hover);
}
.text-btn {
  padding: 4px 8px;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* 手机：从下面拉上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .queue-panel {
    inset: auto 0 0 0;
    width: 100%;
    /* 浏览器默认给 dialog 设了 max-width，不取消的话右边会露出一条 */
    max-width: none;
    height: 82vh;
    padding-bottom: env(safe-area-inset-bottom);
    border-radius: 18px 18px 0 0;
    border-bottom: 0;
  }
  .queue-panel[open] {
    animation-name: slide-up;
  }
  @keyframes slide-up {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }
}
</style>
