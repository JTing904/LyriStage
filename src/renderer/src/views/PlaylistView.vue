<script setup>
// 网易云歌单
import { computed, ref, watch } from 'vue';
import { onPullRefresh } from '../composables/usePullRefresh';
import { useRoute } from 'vue-router';
import { netease } from '../services';
import { usePlayCollection } from '../composables/usePlayCollection';
import { count, totalLength } from '../utils/format';
import { t } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import SaveAsPlaylistButton from '../components/SaveAsPlaylistButton.vue';
import OfflineButton from '../components/OfflineButton.vue';
import TrackList from '../components/TrackList.vue';
import LoadError from '../components/LoadError.vue';

const route = useRoute();
const { playAll, shuffleAll } = usePlayCollection();

const info = ref(null);
const tracks = ref([]);
const loading = ref(true);
const error = ref('');

async function load(id) {
  loading.value = true;
  error.value = '';
  info.value = null;
  tracks.value = [];
  try {
    const [detail, songs] = await Promise.all([
      netease.playlist(id),
      netease.playlistTracks(id),
    ]);
    if (String(id) !== String(route.params.id)) return; // 等的时候换了别的歌单
    info.value = detail;
    tracks.value = songs;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}
watch(() => route.params.id, id => id && load(id), { immediate: true });
onPullRefresh(() => load(route.params.id));

const context = computed(() => `playlist:${route.params.id}`);
const meta = computed(() => {
  if (!info.value) return '';
  return [
    info.value.creator?.nickname,
    t('{n} 首', { n: info.value.trackCount ?? tracks.value.length }),
    totalLength(tracks.value),
    info.value.playCount ? t('{n} 次播放', { n: count(info.value.playCount) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
});
</script>

<template>
  <div class="page">
    <p v-if="loading" class="page-state">{{ $t('加载中…') }}</p>
    <LoadError v-else-if="error" :error="error" :what="$t('歌单')" @retry="load(route.params.id)" />
    <template v-else-if="info">
      <CollectionHeader
        :kind="$t('歌单')"
        :cover="info.coverImgUrl"
        :title="info.name"
        :description="info.description || ''"
        :meta="meta"
        :playable="tracks.length > 0"
        @play="playAll(tracks, context)"
        @shuffle="shuffleAll(tracks, context)"
      >
        <template #actions>
          <SaveAsPlaylistButton :name="info.name" :tracks="tracks" />
          <OfflineButton
            :tracks="tracks"
            :collection="{ key: `playlist:${route.params.id}`, kind: 'playlist', id: route.params.id, name: info.name }"
          />
        </template>
      </CollectionHeader>
      <TrackList :tracks="tracks" :context="context" />
    </template>
  </div>
</template>
