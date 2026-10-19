<script setup>
// 我喜欢的音乐（取消红心的歌马上从列表消失）
import { computed, onMounted, ref } from 'vue';
import { listLikedTracks } from '@core/data';
import { useLibraryStore } from '../stores/library';
import { usePlayCollection } from '../composables/usePlayCollection';
import { totalLength } from '../utils/format';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';

const library = useLibraryStore();
const { playAll, shuffleAll } = usePlayCollection();

const all = ref([]);
const loading = ref(true);
const error = ref('');
onMounted(async () => {
  try {
    all.value = await listLikedTracks();
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
});

const tracks = computed(() => all.value.filter(t => library.isLiked(t.id)));
const meta = computed(() =>
  tracks.value.length ? `${tracks.value.length} 首 · ${totalLength(tracks.value)}` : ''
);
</script>

<template>
  <div class="page">
    <CollectionHeader
      kind="歌单"
      :cover="tracks[0]?.al?.picUrl || ''"
      title="我喜欢的音乐"
      :meta="meta"
      :playable="tracks.length > 0"
      @play="playAll(tracks, 'liked')"
      @shuffle="shuffleAll(tracks, 'liked')"
    />
    <p v-if="loading" class="page-state">加载中…</p>
    <p v-else-if="error" class="page-state">加载失败：{{ error }}</p>
    <p v-else-if="!tracks.length" class="page-state">还没有喜欢的歌。听到喜欢的就按一下 ♡。</p>
    <TrackList v-else :tracks="tracks" context="liked" />
  </div>
</template>
