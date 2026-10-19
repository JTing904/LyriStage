<script setup>
// 选歌对话框（自己的歌单里「添加歌曲」用）：
// 从「搜索 / 我喜欢的 / 最近播放」里勾选好几首，一次加进歌单
import { computed, nextTick, ref, watch } from 'vue';
import { fromRow, listLikedTracks, listRecentHistory } from '@core/data';
import { netease } from '../services';
import { artistNames, clock } from '../utils/format';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import { t } from '../i18n';

const props = defineProps({
  /** 已经在歌单里的歌（显示「已加入」，不能再选） */
  existingIds: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['add']);

const dialog = ref(null);
const searchInput = ref(null);
const tab = ref('search');
const keywords = ref('');
const results = ref([]);
const liked = ref([]);
const recent = ref([]);
const loading = ref(false);
/** 选中的歌：id → 歌曲（跨分类保留） */
const picked = ref(new Map());

const existing = computed(() => new Set(props.existingIds.map(Number)));
const list = computed(
  () => ({ search: results.value, liked: liked.value, recent: recent.value })[tab.value]
);

async function open() {
  picked.value = new Map();
  dialog.value.showModal();
  await nextTick();
  searchInput.value?.focus();
  // 我喜欢的、最近播放先载入好，切过去马上有
  listLikedTracks().then(v => (liked.value = v)).catch(() => {});
  listRecentHistory({ days: 60, limit: 400 })
    .then(rows => {
      const seen = new Set();
      recent.value = rows
        .filter(r => !seen.has(r.track_id) && seen.add(r.track_id))
        .map(fromRow);
    })
    .catch(() => {});
}
const close = () => dialog.value.close();
defineExpose({ open, close });

let searchId = 0;
async function search() {
  const q = keywords.value.trim();
  if (!q) return;
  tab.value = 'search';
  const id = ++searchId;
  loading.value = true;
  try {
    const list = await netease.searchSongs(q, { limit: 40 });
    if (id === searchId) results.value = list;
  } catch {
    if (id === searchId) results.value = [];
  } finally {
    if (id === searchId) loading.value = false;
  }
}

function toggle(track) {
  if (existing.value.has(Number(track.id))) return;
  const next = new Map(picked.value);
  if (next.has(track.id)) next.delete(track.id);
  else next.set(track.id, track);
  picked.value = next;
}
const selectable = computed(() => list.value.filter(t => !existing.value.has(Number(t.id))));
const allPicked = computed(
  () => selectable.value.length > 0 && selectable.value.every(t => picked.value.has(t.id))
);
function toggleAll() {
  const next = new Map(picked.value);
  if (allPicked.value) selectable.value.forEach(t => next.delete(t.id));
  else selectable.value.forEach(t => next.set(t.id, t));
  picked.value = next;
}

function confirm() {
  if (picked.value.size) emit('add', [...picked.value.values()]);
}

// 加完（busy 从 true 变 false）就关掉
watch(
  () => props.busy,
  (now, before) => {
    if (before && !now) close();
  }
);

const TABS = [
  { id: 'search', label: '搜索' },
  { id: 'liked', label: '我喜欢的' },
  { id: 'recent', label: '最近播放' },
];
const emptyText = computed(() =>
  ({
    search: keywords.value.trim() ? t('没有找到') : t('输入歌名或歌手，按 Enter 搜索'),
    liked: t('还没有喜欢的歌'),
    recent: t('最近 60 天没有听歌记录'),
  })[tab.value]
);
</script>

<template>
  <dialog ref="dialog" class="picker" @click.self="close">
    <div class="box">
      <header>
        <h2>{{ $t('添加歌曲') }}</h2>
        <button class="icon-btn" :aria-label="$t('关闭')" @click="close"><Icon name="x" :size="20" /></button>
      </header>

      <form class="search" role="search" @submit.prevent="search">
        <Icon name="search" :size="18" />
        <input ref="searchInput" v-model="keywords" :placeholder="$t('搜索歌曲、歌手')" enterkeyhint="search" />
      </form>

      <nav class="tabs">
        <button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">
          {{ $t(t.label) }}
        </button>
        <span class="grow" />
        <button v-if="selectable.length" class="link" @click="toggleAll">
          {{ allPicked ? $t('取消全选') : $t('全选') }}
        </button>
      </nav>

      <div class="list">
        <p v-if="loading && tab === 'search'" class="empty">{{ $t('搜索中…') }}</p>
        <p v-else-if="!list.length" class="empty">{{ emptyText }}</p>
        <button
          v-for="t in list"
          v-else
          :key="t.id"
          class="row"
          :class="{ on: picked.has(t.id), done: existing.has(Number(t.id)) }"
          :aria-pressed="picked.has(t.id)"
          :disabled="existing.has(Number(t.id))"
          @click="toggle(t)"
        >
          <span class="check" :class="{ on: picked.has(t.id) || existing.has(Number(t.id)) }">
            <svg v-if="picked.has(t.id) || existing.has(Number(t.id))" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" /></svg>
          </span>
          <Cover :url="t.al?.picUrl" :size="40" radius="6px" class="cover" />
          <span class="meta">
            <strong>{{ t.name }}</strong>
            <span>{{ existing.has(Number(t.id)) ? $t('已在歌单里') : artistNames(t) }}</span>
          </span>
          <span class="time">{{ clock(t.dt) }}</span>
        </button>
      </div>

      <footer>
        <span>{{ $t('已选 {n} 首', { n: picked.size }) }}</span>
        <button class="primary" :disabled="!picked.size || busy" @click="confirm">
          {{ busy ? $t('加入中…') : $t('加入歌单') }}
        </button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.picker {
  width: min(560px, calc(100vw - 24px));
  height: min(680px, calc(100vh - 48px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
}
.picker::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.box {
  display: flex;
  flex-direction: column;
  height: 100%;
}
header {
  display: flex;
  align-items: center;
  padding: 16px 16px 8px 20px;
}
h2 {
  flex: 1;
  margin: 0;
  font-size: 18px;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  margin: 0 16px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: 22px;
  background: var(--bg);
  color: var(--text-dim);
}
.search:focus-within {
  border-color: var(--accent);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 15px;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px 8px;
}
.tabs button {
  padding: 6px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.tabs button.on {
  border-color: var(--text);
  background: var(--text);
  color: var(--bg);
  font-weight: 700;
}
.tabs .link {
  border: 0;
  color: var(--accent);
  font-weight: 700;
}
.grow {
  flex: 1;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px;
}
.empty {
  margin: 40px 0;
  text-align: center;
  color: var(--text-dim);
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover:not(:disabled) {
  background: var(--surface-hover);
}
.row.on {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.row.done {
  opacity: 0.5;
  cursor: default;
}
.check {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border: 2px solid var(--line-strong);
  border-radius: 6px;
}
.check.on {
  border-color: var(--accent);
  background: var(--accent);
}
.done .check.on {
  border-color: var(--text-faint);
  background: var(--text-faint);
}
.check svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--on-accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cover {
  flex: none;
  width: 40px;
}
.meta {
  flex: 1;
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
.meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.time {
  font-size: 13px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 16px 20px;
  border-top: 1px solid var(--line);
  font-size: 14px;
  font-weight: 700;
}
.primary {
  padding: 11px 24px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
