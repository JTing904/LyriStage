<script setup>
// 每日推荐：按自己的听歌记录计算（core/recommend），每天第一次打开时算好存起来
import { computed, onMounted, ref } from 'vue';
import { getDailyRecommendations } from '@core/recommend';
import { netease } from '../services';
import { usePlayCollection } from '../composables/usePlayCollection';
import { totalLength } from '../utils/format';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';

const { playAll, shuffleAll } = usePlayCollection();

const tracks = ref([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref('');

async function load(force = false) {
  error.value = '';
  try {
    tracks.value = await getDailyRecommendations({ netease, force });
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}
onMounted(() => load());

function refresh() {
  refreshing.value = true;
  load(true);
}

const now = new Date();
const title = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
const context = computed(() => `daily:${now.toISOString().slice(0, 10)}`);
const meta = computed(() =>
  tracks.value.length
    ? `${tracks.value.length} 首 · ${totalLength(tracks.value)}`
    : ''
);
</script>

<template>
  <div class="page">
    <CollectionHeader
      kind="每日推荐"
      :cover="tracks[0]?.al?.picUrl || ''"
      :title="title"
      description="按你最近听的歌、喜欢的歌手挑的，每天更新一次。"
      :meta="meta"
      :playable="tracks.length > 0"
      @play="playAll(tracks, context)"
      @shuffle="shuffleAll(tracks, context)"
    >
      <template #actions>
        <button :disabled="loading || refreshing" @click="refresh">
          {{ refreshing ? '正在重新挑…' : '换一批' }}
        </button>
      </template>
    </CollectionHeader>

    <p v-if="loading" class="page-state">正在按你的口味挑歌，第一次会久一点…</p>
    <p v-else-if="error" class="page-state">每日推荐加载失败：{{ error }}</p>
    <TrackList v-else :tracks="tracks" :context="context" />
  </div>
</template>
