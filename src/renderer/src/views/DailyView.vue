<script setup>
// 每日推荐：按自己的听歌记录计算（core/recommend），每天第一次打开时算好存起来
import { computed, onMounted, ref } from 'vue';
import { getDailyRecommendations } from '@core/recommend';
import { netease } from '../services';
import { usePlayCollection } from '../composables/usePlayCollection';
import { totalLength } from '../utils/format';
import { t, locale } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';
import LoadError from '../components/LoadError.vue';

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
    error.value = err;
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
const title = computed(() =>
  locale.value === 'en'
    ? now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${now.getMonth() + 1} 月 ${now.getDate()} 日`
);
const context = computed(() => `daily:${now.toISOString().slice(0, 10)}`);
const meta = computed(() =>
  tracks.value.length
    ? `${t('{n} 首', { n: tracks.value.length })} · ${totalLength(tracks.value)}`
    : ''
);
</script>

<template>
  <div class="page">
    <CollectionHeader
      :kind="$t('每日推荐')"
      :cover="tracks[0]?.al?.picUrl || ''"
      :title="title"
      :description="$t('按你最近听的歌、喜欢的歌手挑的，每天更新一次。')"
      :meta="meta"
      :playable="tracks.length > 0"
      @play="playAll(tracks, context)"
      @shuffle="shuffleAll(tracks, context)"
    >
      <template #actions>
        <button :disabled="loading || refreshing" @click="refresh">
          {{ refreshing ? $t('正在重新挑…') : $t('换一批') }}
        </button>
      </template>
    </CollectionHeader>

    <p v-if="loading" class="page-state">{{ $t('正在按你的口味挑歌，第一次会久一点…') }}</p>
    <LoadError v-else-if="error" :error="error" :what="$t('每日推荐')" @retry="load()" />
    <TrackList v-else :tracks="tracks" :context="context" />
  </div>
</template>
