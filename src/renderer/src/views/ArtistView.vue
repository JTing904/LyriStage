<script setup>
// 歌手：热门歌曲（先显示 10 首，可以展开到 50 首）+ 专辑
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { netease } from '../services';
import { usePlayCollection } from '../composables/usePlayCollection';
import { year } from '../utils/format';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';
import TileGrid from '../components/TileGrid.vue';

const route = useRoute();
const { playAll, shuffleAll } = usePlayCollection();

const artist = ref(null);
const hotSongs = ref([]);
const albums = ref([]);
const showAll = ref(false);
const loading = ref(true);
const error = ref('');

async function load(id) {
  loading.value = true;
  error.value = '';
  artist.value = null;
  hotSongs.value = [];
  albums.value = [];
  showAll.value = false;
  try {
    const [info, list] = await Promise.all([
      netease.artist(id),
      netease.artistAlbums(id, { limit: 50 }).catch(() => []),
    ]);
    if (String(id) !== String(route.params.id)) return;
    artist.value = info.artist;
    hotSongs.value = info.hotSongs;
    albums.value = list;
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params.id, id => id && load(id), { immediate: true });

const context = computed(() => `artist:${route.params.id}`);
const shownSongs = computed(() =>
  showAll.value ? hotSongs.value : hotSongs.value.slice(0, 10)
);
const meta = computed(() => {
  const a = artist.value;
  if (!a) return '';
  return [
    a.alias?.length ? a.alias.join(' / ') : '',
    a.musicSize ? `${a.musicSize} 首歌` : '',
    a.albumSize ? `${a.albumSize} 张专辑` : '',
  ]
    .filter(Boolean)
    .join(' · ');
});
const albumTiles = computed(() =>
  albums.value.map(al => ({
    key: al.id,
    to: `/album/${al.id}`,
    cover: al.picUrl,
    title: al.name,
    sub: [year(al.publishTime), al.type === '专辑' ? '' : al.type].filter(Boolean).join(' · '),
  }))
);
</script>

<template>
  <div class="page">
    <p v-if="loading" class="page-state">加载中…</p>
    <p v-else-if="error" class="page-state">歌手加载失败：{{ error }}</p>
    <template v-else-if="artist">
      <CollectionHeader
        kind="歌手"
        round
        :cover="artist.picUrl || artist.img1v1Url"
        :title="artist.name"
        :description="artist.briefDesc || ''"
        :meta="meta"
        :playable="hotSongs.length > 0"
        @play="playAll(hotSongs, context)"
        @shuffle="shuffleAll(hotSongs, context)"
      />

      <section v-if="hotSongs.length">
        <h2 class="section-title">热门歌曲</h2>
        <TrackList :tracks="shownSongs" :context="context" :show-header="false" />
        <button
          v-if="hotSongs.length > 10"
          class="expand"
          @click="showAll = !showAll"
        >
          {{ showAll ? '收起' : `显示全部 ${hotSongs.length} 首` }}
        </button>
      </section>

      <section v-if="albumTiles.length">
        <h2 class="section-title">专辑</h2>
        <TileGrid :items="albumTiles" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.expand {
  margin: 12px 0 0 8px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.expand:hover {
  color: var(--text);
}
</style>
