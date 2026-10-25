<script setup>
// 搜索：综合（最佳结果 + 单曲 + 专辑 + 歌单）和各分类（可以加载更多）。
// 关键词和分类放在网址里（/search?q=晴天&tab=album），返回时结果还在
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { netease } from '../services';
import { originalArtistIn } from '@core/netease';
import { usePlayer } from '../composables/usePlayer';
import { artistNames, year } from '../utils/format';
import { t } from '../i18n';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import TileGrid from '../components/TileGrid.vue';
import TrackList from '../components/TrackList.vue';
import LoadError from '../components/LoadError.vue';
import { explainError } from '../friendlyError';

const TABS = [
  { id: 'all', label: '综合' },
  { id: 'song', label: '单曲' },
  { id: 'lyric', label: '歌词' },
  { id: 'artist', label: '歌手' },
  { id: 'album', label: '专辑' },
  { id: 'playlist', label: '歌单' },
];
const PAGE = 30;

const route = useRoute();
const router = useRouter();
const { player } = usePlayer();

const q = computed(() => String(route.query.q ?? '').trim());
const tab = computed(() =>
  TABS.some(t => t.id === route.query.tab) ? route.query.tab : 'all'
);

const input = ref(q.value);
watch(q, value => (input.value = value));

// ---- 最近搜索（存在这台设备，最多 10 个）----
const RECENT_KEY = 'lyristage:recent-searches';
const RECENT_MAX = 10;
const recent = ref((() => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
})());
function saveRecent(list) {
  recent.value = list;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 存不了就只在这次有
  }
}
// 搜过的放最前面（同一个词不重复）
watch(
  q,
  value => value && saveRecent([value, ...recent.value.filter(x => x.toLowerCase() !== value.toLowerCase())].slice(0, RECENT_MAX)),
  { immediate: true }
);
const removeRecent = word => saveRecent(recent.value.filter(x => x !== word));
const searchRecent = word => router.replace({ query: { q: word, tab: tab.value } });

// 输入框右边的 ✕：清掉字，回到最近搜索
const inputEl = ref(null);
function clearInput() {
  input.value = '';
  if (q.value) router.replace({ query: {} });
  inputEl.value?.focus();
}
function submit() {
  const keywords = input.value.trim();
  if (keywords) router.replace({ query: { q: keywords, tab: tab.value } });
}
const selectTab = id => router.replace({ query: { q: q.value, tab: id } });

// 综合
const overview = ref({ song: [], artist: [], album: [], playlist: [] });
// 某个分类
const items = ref([]);
const hasMore = ref(false);
const loading = ref(false);
const loadingMore = ref(false);
/** 加载更多失败：已经有的结果留着，只在下面说一句（不要整页变成错误） */
const moreError = ref('');
const error = ref('');

/**
 * 网易云没有版权的歌（例如周杰伦自己的歌）搜不到：关键词里有歌手名时，
 * 去他的所有歌曲里找回来，放在搜索结果最前面（播放时会改用 B 站等其他音源）
 */
const withHidden = (songs, hidden) => {
  const ids = new Set(hidden.map(s => s.id));
  return [...hidden, ...songs.filter(s => !ids.has(s.id))];
};
/** 先显示一般结果，找回来的歌之后再补上（要多问几次网易云，最慢要几秒，不要拖慢整个搜索） */
function addHidden(id, songs, limit, apply) {
  netease
    .hiddenSongs(q.value, { limit, originalArtist: originalArtistIn(songs) })
    .then(hidden => {
      if (id === requestId && hidden.length) apply(hidden);
    })
    .catch(() => {});
}

let requestId = 0;
async function load() {
  moreError.value = '';
  const id = ++requestId;
  error.value = '';
  items.value = [];
  hasMore.value = false;
  if (!q.value) return;
  loading.value = true;
  try {
    if (tab.value === 'all') {
      const [song, artist, album, playlist] = await Promise.allSettled([
        netease.search(q.value, { type: 'song', limit: 10 }),
        netease.search(q.value, { type: 'artist', limit: 6 }),
        netease.search(q.value, { type: 'album', limit: 12 }),
        netease.search(q.value, { type: 'playlist', limit: 12 }),
      ]);
      if (id !== requestId) return;
      const value = r => (r.status === 'fulfilled' ? r.value : []);
      overview.value = {
        song: value(song),
        artist: value(artist),
        album: value(album),
        playlist: value(playlist),
      };
      if ([song, artist, album, playlist].every(r => r.status === 'rejected')) {
        throw song.reason;
      }
      addHidden(id, overview.value.song, 5, hidden => {
        overview.value = { ...overview.value, song: withHidden(overview.value.song, hidden) };
      });
    } else {
      const list = await netease.search(q.value, { type: tab.value, limit: PAGE });
      if (id !== requestId) return;
      items.value = list;
      hasMore.value = list.length === PAGE;
      if (tab.value === 'song') {
        addHidden(id, list, 20, hidden => (items.value = withHidden(items.value, hidden)));
      }
    }
  } catch (err) {
    if (id === requestId) error.value = err;
  } finally {
    if (id === requestId) loading.value = false;
  }
}
watch([q, tab], load, { immediate: true });

async function loadMore() {
  const id = requestId;
  loadingMore.value = true;
  moreError.value = '';
  try {
    const list = await netease.search(q.value, {
      type: tab.value,
      limit: PAGE,
      offset: items.value.length,
    });
    if (id !== requestId) return;
    items.value = [...items.value, ...list];
    hasMore.value = list.length === PAGE;
  } catch (err) {
    if (id === requestId) moreError.value = explainError(err, t('载不出更多')).message;
  } finally {
    loadingMore.value = false;
  }
}

// 最佳结果：歌手名字和关键词一样就放歌手，不然放第一首歌
const best = computed(() => {
  const artist = overview.value.artist[0];
  const keyword = q.value.toLowerCase();
  if (artist && artist.name.toLowerCase() === keyword) {
    return { type: 'artist', item: artist };
  }
  const song = overview.value.song[0];
  return song ? { type: 'song', item: song } : null;
});
function playBest() {
  player.playList(overview.value.song, 0, `search:${q.value}`);
}

const albumTiles = list =>
  list.map(al => ({
    key: al.id,
    to: `/album/${al.id}`,
    cover: al.picUrl,
    title: al.name,
    sub: [artistNames({ ar: al.artists ?? (al.artist ? [al.artist] : []) }), year(al.publishTime)]
      .filter(Boolean)
      .join(' · '),
  }));
const playlistTiles = list =>
  list.map(pl => ({
    key: pl.id,
    to: `/playlist/${pl.id}`,
    cover: pl.coverImgUrl,
    title: pl.name,
    sub: [pl.creator?.nickname, pl.trackCount ? t('{n} 首', { n: pl.trackCount }) : '']
      .filter(Boolean)
      .join(' · '),
  }));
const artistTiles = list =>
  list.map(ar => ({
    key: ar.id,
    to: `/artist/${ar.id}`,
    cover: ar.picUrl || ar.img1v1Url,
    title: ar.name,
    round: true,
  }));

const context = computed(() => `search:${q.value}`);
const empty = computed(() =>
  tab.value === 'all'
    ? !overview.value.song.length &&
      !overview.value.artist.length &&
      !overview.value.album.length &&
      !overview.value.playlist.length
    : !items.value.length
);
</script>

<template>
  <div class="page search-page">
    <form class="search" role="search" @submit.prevent="submit">
      <Icon name="search" :size="18" />
      <input
        ref="inputEl"
        v-model="input"
        :placeholder="$t('搜索歌曲、歌手、专辑、歌单或一句歌词')"
        :aria-label="$t('搜索')"
        enterkeyhint="search"
        :autofocus="!q"
      />
      <button v-if="input" type="button" class="clear" :aria-label="$t('清除')" @click="clearInput">
        <Icon name="x" :size="16" />
      </button>
    </form>

    <template v-if="q">
      <nav class="tabs" :aria-label="$t('搜索分类')">
        <button
          v-for="t in TABS"
          :key="t.id"
          :class="{ on: tab === t.id }"
          :aria-pressed="tab === t.id"
          @click="selectTab(t.id)"
        >
          {{ $t(t.label) }}
        </button>
      </nav>

      <p v-if="loading" class="page-state">{{ $t('搜索中…') }}</p>
      <LoadError v-else-if="error" :error="error" :what="$t('搜索结果')" @retry="load()" />
      <p v-else-if="empty" class="page-state">{{ $t('没有找到「{q}」相关的结果', { q }) }}</p>

      <!-- 综合 -->
      <template v-else-if="tab === 'all'">
        <div class="top">
          <section v-if="best" class="best-wrap">
            <h2 class="section-title">{{ $t('最佳结果') }}</h2>
            <RouterLink
              v-if="best.type === 'artist'"
              :to="`/artist/${best.item.id}`"
              class="best"
            >
              <Cover :url="best.item.picUrl || best.item.img1v1Url" :size="120" round class="best-cover" />
              <strong class="display">{{ best.item.name }}</strong>
              <span class="tag">{{ $t('歌手') }}</span>
            </RouterLink>
            <button v-else class="best" @click="playBest">
              <Cover :url="best.item.al?.picUrl" :size="120" radius="10px" class="best-cover" />
              <strong class="display">{{ best.item.name }}</strong>
              <span class="tag">{{ $t('单曲') }} · {{ artistNames(best.item) }}</span>
            </button>
          </section>
          <section v-if="overview.song.length" class="songs">
            <h2 class="section-title">{{ $t('单曲') }}</h2>
            <TrackList
              :tracks="overview.song.slice(0, 5)"
              :context="context"
              :show-header="false"
              :show-album="false"
              :selectable="false"
            />
          </section>
        </div>

        <section v-if="overview.artist.length">
          <h2 class="section-title">{{ $t('歌手') }}</h2>
          <TileGrid :items="artistTiles(overview.artist)" />
        </section>
        <section v-if="overview.album.length">
          <h2 class="section-title">{{ $t('专辑') }}</h2>
          <TileGrid :items="albumTiles(overview.album)" />
        </section>
        <section v-if="overview.playlist.length">
          <h2 class="section-title">{{ $t('歌单') }}</h2>
          <TileGrid :items="playlistTiles(overview.playlist)" />
        </section>
      </template>

      <!-- 单一分类 -->
      <template v-else>
        <TrackList v-if="tab === 'song' || tab === 'lyric'" :tracks="items" :context="context" />
        <TileGrid v-else-if="tab === 'artist'" :items="artistTiles(items)" />
        <TileGrid v-else-if="tab === 'album'" :items="albumTiles(items)" />
        <TileGrid v-else :items="playlistTiles(items)" />
        <p v-if="moreError && !loadingMore" class="more-error" role="alert">{{ moreError }}</p>
        <button v-if="hasMore" class="more" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? $t('加载中…') : moreError ? $t('重试') : $t('加载更多') }}
        </button>
      </template>
    </template>

    <section v-else-if="recent.length" class="recent">
      <div class="recent-head">
        <h2 class="section-title">{{ $t('最近搜索') }}</h2>
        <button type="button" class="recent-clear" @click="saveRecent([])">{{ $t('全部清除') }}</button>
      </div>
      <ul class="chips">
        <li v-for="word in recent" :key="word" class="chip">
          <button type="button" class="chip-word" @click="searchRecent(word)">{{ word }}</button>
          <button type="button" class="chip-x" :aria-label="$t('删除「{word}」', { word })" @click="removeRecent(word)">
            <Icon name="x" :size="14" />
          </button>
        </li>
      </ul>
    </section>
    <p v-else class="page-state">{{ $t('输入歌名、歌手、歌单名字，或记得的一句歌词') }}</p>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 560px;
  height: 48px;
  padding: 0 18px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface-2);
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
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 16px;
}

.more-error {
  margin: 16px 0 0;
  color: var(--text-dim);
  font-size: 14px;
  text-align: center;
}
.clear {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  margin-right: -10px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--surface-hover);
  color: var(--text-dim);
  cursor: pointer;
}
.recent {
  max-width: 720px;
  margin-top: 24px;
}
.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.recent-head .section-title {
  margin: 0;
}
.recent-clear {
  padding: 6px 4px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}
.chip {
  display: flex;
  align-items: center;
  max-width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
}
.chip-word {
  min-width: 0;
  overflow: hidden;
  padding: 9px 4px 9px 14px;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.chip-x {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 36px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-top: -12px;
  overflow-x: auto;
  scrollbar-width: none;
}
/* 全局有自订的滚动条样式，这里明确藏起来（手机上会在按钮下面露出一条） */
.tabs::-webkit-scrollbar {
  display: none;
}
.tabs button {
  flex: none;
  padding: 8px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.tabs button:hover {
  color: var(--text);
}
.tabs button.on {
  border-color: var(--text);
  background: var(--text);
  color: var(--bg);
  font-weight: 700;
}

.top {
  display: grid;
  grid-template-columns: minmax(260px, 2fr) minmax(0, 3fr);
  gap: 32px;
}
.best {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 22px;
  border: 0;
  border-radius: 16px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s;
}
.best:hover {
  background: var(--surface-hover);
}
.best-cover {
  width: 120px;
}
.best strong {
  font-size: 30px;
  line-height: 1.2;
}
.tag {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--bg);
  font-size: 13px;
  color: var(--text-dim);
}

.more {
  align-self: center;
  padding: 10px 24px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.more:disabled {
  opacity: 0.6;
}

@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .top {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
  /* 最佳结果：横向的小卡片（封面在左、名字在右），不要占半个画面 */
  .best {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    grid-template-areas:
      'cover name'
      'cover tag';
    align-items: center;
    column-gap: 14px;
    row-gap: 6px;
    padding: 12px;
  }
  .best-cover {
    grid-area: cover;
    width: 72px;
  }
  .best strong {
    grid-area: name;
    align-self: end;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 20px;
  }
  .best .tag {
    grid-area: tag;
    align-self: start;
    justify-self: start;
    padding: 2px 10px;
    font-size: 12px;
  }
}
</style>
