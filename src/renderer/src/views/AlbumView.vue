<script setup>
// 专辑
import { computed, ref, watch } from 'vue';
import { onPullRefresh } from '../composables/usePullRefresh';
import { useRoute } from 'vue-router';
import { netease } from '../services';
import { usePlayCollection } from '../composables/usePlayCollection';
import { artistNames, totalLength, year } from '../utils/format';
import { t } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import OfflineButton from '../components/OfflineButton.vue';
import TrackList from '../components/TrackList.vue';
import LoadError from '../components/LoadError.vue';

const route = useRoute();
const { playAll, shuffleAll } = usePlayCollection();

const album = ref(null);
const tracks = ref([]);
const loading = ref(true);
const error = ref('');

async function load(id) {
  loading.value = true;
  error.value = '';
  album.value = null;
  tracks.value = [];
  try {
    const data = await netease.album(id);
    if (String(id) !== String(route.params.id)) return;
    album.value = data.album;
    // 专辑接口给的歌里没有封面，补上专辑封面（播放条、歌词舞台要用）
    tracks.value = data.songs.map(song => ({
      ...song,
      al: { ...song.al, picUrl: song.al?.picUrl || data.album?.picUrl },
    }));
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}
watch(() => route.params.id, id => id && load(id), { immediate: true });
onPullRefresh(() => load(route.params.id));

const context = computed(() => `album:${route.params.id}`);
const meta = computed(() => {
  if (!album.value) return '';
  return [
    artistNames({ ar: album.value.artists }),
    year(album.value.publishTime),
    t('{n} 首', { n: tracks.value.length }),
    totalLength(tracks.value),
  ]
    .filter(Boolean)
    .join(' · ');
});
</script>

<template>
  <div class="page">
    <p v-if="loading" class="page-state">{{ $t('加载中…') }}</p>
    <LoadError v-else-if="error" :error="error" :what="$t('专辑')" @retry="load(route.params.id)" />
    <template v-else-if="album">
      <CollectionHeader
        :kind="$t('专辑')"
        :cover="album.picUrl"
        :title="album.name"
        :description="album.description || ''"
        :meta="meta"
        :playable="tracks.length > 0"
        @play="playAll(tracks, context)"
        @shuffle="shuffleAll(tracks, context)"
      >
        <template #actions>
          <RouterLink v-if="album.artist?.id" :to="`/artist/${album.artist.id}`" custom v-slot="{ navigate }">
            <button @click="navigate">{{ $t('歌手：{name}', { name: album.artist.name }) }}</button>
          </RouterLink>
          <OfflineButton :tracks="tracks" />
        </template>
      </CollectionHeader>
      <TrackList :tracks="tracks" :context="context" :show-cover="false" :show-album="false" />
    </template>
  </div>
</template>
