<script setup>
// 我喜欢的音乐（取消红心的歌马上从列表消失）
import { computed, onMounted, ref } from 'vue';
import { listLikedTracks } from '@core/data';
import { applyPrivileges, fetchPrivileges } from '../services';
import { useLibraryStore } from '../stores/library';
import { usePlayCollection } from '../composables/usePlayCollection';
import { totalLength } from '../utils/format';
import { t } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';

const library = useLibraryStore();
const { playAll, shuffleAll } = usePlayCollection();

const all = ref([]);
const loading = ref(true);
const error = ref('');
onMounted(async () => {
  try {
    const list = await listLikedTracks();
    all.value = list;
    // 先显示，再补上哪些歌已经下架
    fetchPrivileges(list).then(privileges => {
      if (privileges.size) all.value = applyPrivileges(all.value, privileges);
    });
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
});

const tracks = computed(() => all.value.filter(t => library.isLiked(t.id)));
const meta = computed(() =>
  tracks.value.length ? `${t('{n} 首', { n: tracks.value.length })} · ${totalLength(tracks.value)}` : ''
);
</script>

<template>
  <div class="page">
    <CollectionHeader
      :kind="$t('歌单')"
      :cover="tracks[0]?.al?.picUrl || ''"
      :title="$t('我喜欢的音乐')"
      :meta="meta"
      :playable="tracks.length > 0"
      @play="playAll(tracks, 'liked')"
      @shuffle="shuffleAll(tracks, 'liked')"
    />
    <p v-if="loading" class="page-state">{{ $t('加载中…') }}</p>
    <p v-else-if="error" class="page-state">{{ $t('加载失败：{error}', { error }) }}</p>
    <p v-else-if="!tracks.length" class="page-state">{{ $t('还没有喜欢的歌。听到喜欢的就按一下 ♡。') }}</p>
    <TrackList v-else :tracks="tracks" context="liked" />
  </div>
</template>
