<script setup>
// 导入歌单：看在网易云找到的歌、确认可疑的、存成自己的歌单（stores/importer.js）
// - 一首一首出来：✓ 找到了；! 可能是别的版本（Live、翻唱、伴奏、时长差很多、歌手不一样）；灰色找不到
// - 按一首展开：其他搜到的版本选一首、「不加这首」、自己打字搜
// - 从别的 App 分享进来（Android 分享选单 → ?text=）：马上开始读
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useImporterStore, SOURCE_NAMES } from '../stores/importer';
import { useNoticeStore } from '../stores/notice';
import { artistNames } from '../utils/format';
import { t } from '../i18n';
import { showError } from '../friendlyError';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import ImportSheet from '../components/ImportSheet.vue';

const route = useRoute();
const router = useRouter();
const importer = useImporterStore();
const notice = useNoticeStore();
const sheet = ref(null);

// 从别的 App 分享进来：马上读（导入页已经开着时再分享一张，也会换成新的那张）
watch(
  () => route.query.text,
  async shared => {
    if (typeof shared !== 'string' || !shared) return;
    router.replace('/import');
    const result = await importer.start(shared);
    if (typeof result === 'object' && result) router.replace(`/playlist/${result.netease}`);
    else if (!result) sheet.value?.open();
  },
  { immediate: true }
);
// 直接打开导入页、还没开始：先跳出贴链接的面板
onMounted(() => {
  if (!route.query.text && importer.phase === 'idle') sheet.value?.open();
});

const filter = ref('all');
const shown = computed(() =>
  importer.items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => filter.value === 'all' || item.status === filter.value)
);
// 分类空了（都处理完）就回到全部
watch(
  () => importer.counts[filter.value],
  n => filter.value !== 'all' && n === 0 && (filter.value = 'all')
);

const name = ref('');
watch(
  () => importer.origin?.name,
  value => (name.value = value ?? ''),
  { immediate: true }
);

const REASONS = {
  live: '可能是 Live 版',
  cover: '可能是翻唱',
  instrumental: '可能是伴奏',
  remix: '可能是混音、加速版',
  'other-version': '可能是别的版本',
  artist: '歌手不一样',
};
const reasonText = item => (item.reason === 'duration' ? t('时长差 {n} 秒', { n: item.diffSec }) : t(REASONS[item.reason] ?? ''));
const clock = ms => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const original = src => [src.name, src.artists.join(' / ')].filter(Boolean).join(' - ');

// 展开的那一首：换版本、不加、自己搜
const open = ref(-1);
const keyword = ref('');
const searching = ref(false);
function toggle(i) {
  if (importer.items[i].status === 'wait') return;
  open.value = open.value === i ? -1 : i;
  keyword.value = importer.items[i]?.src.query ?? '';
}
function choose(i, song) {
  importer.choose(i, song);
  open.value = -1;
}
async function search(i) {
  searching.value = true;
  try {
    await importer.searchFor(i, keyword.value);
  } finally {
    searching.value = false;
  }
}

const saving = ref(false);
const matching = computed(() => importer.phase === 'matching');
async function save() {
  saving.value = true;
  const count = importer.picks.length;
  const title = name.value.trim() || importer.origin?.name || t('导入的歌单');
  try {
    const row = await importer.save(title);
    if (!row) return;
    notice.show(t('已存成歌单「{name}」（{n} 首）', { name: title, n: count }));
    router.replace(`/my/${row.id}`);
  } catch (err) {
    showError(err, t('没存成功'));
  } finally {
    saving.value = false;
  }
}
function startOver() {
  importer.reset();
  sheet.value?.open();
}
</script>

<template>
  <div class="page import">
    <template v-if="importer.origin">
      <header class="head">
        <Cover :url="importer.origin.cover" :size="72" radius="12px" class="cover" />
        <div class="meta">
          <h1 class="display">{{ importer.origin.name }}</h1>
          <p>
            {{ $t(SOURCE_NAMES[importer.origin.source] ?? '') }} · {{ $t('{n} 首', { n: importer.items.length }) }}
            <template v-if="importer.origin.total > importer.items.length">
              · {{ $t('只读到前 {n} 首', { n: importer.items.length }) }}
            </template>
          </p>
        </div>
      </header>

      <div v-if="matching" class="progress">
        <span class="bar"><span :style="{ width: `${(importer.done / importer.items.length) * 100}%` }" /></span>
        <span class="progress-text">
          <span>{{ $t('正在网易云找对应的歌…') }}</span>
          <span>{{ importer.done }} / {{ importer.items.length }}</span>
        </span>
      </div>

      <div class="filters" role="radiogroup" :aria-label="$t('显示哪些')">
        <button role="radio" :aria-checked="filter === 'all'" :class="{ on: filter === 'all' }" @click="filter = 'all'">
          {{ $t('全部 {n}', { n: importer.items.length }) }}
        </button>
        <button
          v-if="importer.counts.version"
          role="radio"
          :aria-checked="filter === 'version'"
          :class="{ on: filter === 'version' }"
          @click="filter = 'version'"
        >
          {{ $t('版本不同 {n}', { n: importer.counts.version }) }}
        </button>
        <button
          v-if="importer.counts.none"
          role="radio"
          :aria-checked="filter === 'none'"
          :class="{ on: filter === 'none' }"
          @click="filter = 'none'"
        >
          {{ $t('找不到 {n}', { n: importer.counts.none }) }}
        </button>
      </div>

      <ol class="rows">
        <li v-for="{ item, i } in shown" :key="i" :class="['row-wrap', item.status, { open: open === i }]">
          <button class="row" :disabled="item.status === 'wait'" :aria-expanded="open === i" @click="toggle(i)">
            <span class="mark" aria-hidden="true">
              <Icon v-if="item.status === 'ok'" name="check" :size="14" />
              <template v-else-if="item.status === 'version'">!</template>
              <template v-else-if="item.status === 'none'">–</template>
            </span>
            <span class="text">
              <template v-if="item.pick">
                <b>{{ item.pick.name }}</b>
                <small v-if="item.status === 'version'">
                  <em>{{ reasonText(item) }}</em> · {{ $t('原本：{name}', { name: original(item.src) }) }}
                </small>
                <small v-else>{{ artistNames(item.pick) }}</small>
              </template>
              <template v-else>
                <b>{{ item.src.name }}</b>
                <small>{{ item.status === 'wait' ? item.src.artists.join(' / ') : item.confirmed ? $t('不加这首') : $t('网易云找不到') }}</small>
              </template>
            </span>
            <span v-if="item.status === 'version'" class="act">{{ $t('换一首') }}</span>
            <span v-else-if="item.status === 'none'" class="act">{{ $t('搜索') }}</span>
          </button>

          <div v-if="open === i" class="alts">
            <button
              v-for="song in item.candidates"
              :key="song.id"
              class="alt"
              role="radio"
              :aria-checked="item.pick?.id === song.id"
              @click="choose(i, song)"
            >
              <span class="radio" :class="{ on: item.pick?.id === song.id }" aria-hidden="true" />
              <span class="text">
                <b>{{ song.name }}</b>
                <small>
                  {{ artistNames(song) }} · {{ clock(song.dt) }}
                  <template v-if="item.src.durationMs">{{ $t('（原本 {time}）', { time: clock(item.src.durationMs) }) }}</template>
                </small>
              </span>
            </button>
            <button class="alt" role="radio" :aria-checked="!item.pick" @click="choose(i, null)">
              <span class="radio" :class="{ on: !item.pick }" aria-hidden="true" />
              <span class="text"><b>{{ $t('不加这首') }}</b></span>
            </button>
            <form class="search" @submit.prevent="search(i)">
              <input v-model="keyword" :aria-label="$t('自己搜')" :placeholder="$t('自己搜')" enterkeyhint="search" />
              <button :disabled="searching || !keyword.trim()">{{ searching ? $t('搜索中…') : $t('搜索') }}</button>
            </form>
          </div>
        </li>
      </ol>

      <div class="foot">
        <label class="name">
          <small>{{ $t('歌单名字') }}</small>
          <input v-model="name" maxlength="100" />
        </label>
        <button class="save" :disabled="matching || saving || !importer.picks.length" @click="save">
          {{
            matching
              ? $t('还在找… {done} / {n}', { done: importer.done, n: importer.items.length })
              : $t('存成我的歌单（{n} 首）', { n: importer.picks.length })
          }}
        </button>
        <button class="again" @click="startOver">{{ $t('换一张歌单') }}</button>
      </div>
    </template>

    <p v-else-if="importer.phase === 'reading'" class="page-state">{{ $t('正在读取歌单…') }}</p>
    <div v-else class="page-state empty">
      <p>{{ $t('贴上别的 App 的歌单链接，复制一份成自己的歌单。') }}</p>
      <button class="save" @click="sheet.open()">{{ $t('导入歌单') }}</button>
    </div>

    <ImportSheet ref="sheet" />
  </div>
</template>

<style scoped>
.import {
  max-width: 760px;
  gap: 16px;
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
}
/* 手机：顶部让出返回列 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .head,
  .empty {
    margin-top: 44px;
  }
}
.cover {
  flex: none;
}
.meta {
  min-width: 0;
}
h1 {
  margin: 0;
  font-size: clamp(20px, 5vw, 28px);
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.meta p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-dim);
}
.progress {
  display: grid;
  gap: 6px;
}
.bar {
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-hover);
}
.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
.progress-text {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.filters button {
  padding: 7px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-hover);
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.filters button.on {
  background: var(--text);
  color: var(--bg);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row-wrap {
  border-bottom: 1px solid var(--line);
  content-visibility: auto;
  contain-intrinsic-size: auto 62px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 8px 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:disabled {
  cursor: default;
}
.mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #fff;
  font-size: 14px;
  font-weight: 900;
}
.ok .mark {
  background: #16a34a;
}
.version .mark {
  background: #d97706;
}
.none .mark {
  background: var(--text-faint, #9a9a9a);
}
.wait .mark {
  border: 2px solid var(--line-strong);
}
.text {
  display: grid;
  flex: 1;
  min-width: 0;
}
.text b,
.text small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.text b {
  font-size: 15px;
}
.text small {
  font-size: 12.5px;
  color: var(--text-dim);
}
.text em {
  font-style: normal;
  font-weight: 700;
  color: #d97706;
}
.wait .text,
.none .text b {
  color: var(--text-dim);
}
.act {
  flex: none;
  padding: 5px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--accent);
  font-size: 12.5px;
  font-weight: 800;
}
.alts {
  margin: 0 0 12px 36px;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
}
.alt {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 6px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.radio {
  flex: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--line-strong);
  border-radius: 50%;
}
.radio.on {
  border: 6px solid var(--accent);
}
.search {
  display: flex;
  gap: 8px;
  padding: 10px 0 8px;
}
.search input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.search button {
  flex: none;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: var(--surface-hover);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.foot {
  position: sticky;
  bottom: 0;
  display: grid;
  gap: 10px;
  padding: 14px 0 8px;
  background: linear-gradient(transparent, var(--bg) 18px);
}
.name {
  display: grid;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--surface);
}
.name small {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-dim);
}
.foot > * {
  min-width: 0;
}
.name input {
  width: 100%;
  min-width: 0;
  border: 0;
  padding: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  outline: none;
}
.save {
  height: 48px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}
.save:disabled {
  opacity: 0.55;
  cursor: default;
}
.again {
  justify-self: center;
  padding: 4px 10px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.empty {
  display: grid;
  justify-items: center;
  gap: 16px;
}
.empty p {
  margin: 0;
}
</style>
