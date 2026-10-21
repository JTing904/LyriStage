<script setup>
// 打开共同歌单的邀请链接（#/join/邀请码）：加入后直接打开那张歌单
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { joinSharedPlaylist } from '@core/data';
import { useLibraryStore } from '../stores/library';

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();
const error = ref('');

onMounted(async () => {
  try {
    const id = await joinSharedPlaylist(String(route.params.code));
    if (!id) {
      error.value = 'invalid';
      return;
    }
    await library.refreshPlaylists();
    router.replace(`/my/${id}`);
  } catch (err) {
    error.value = err.message || String(err);
  }
});
</script>

<template>
  <div class="page">
    <p v-if="!error" class="page-state">{{ $t('正在加入共同歌单…') }}</p>
    <p v-else-if="error === 'invalid'" class="page-state">
      {{ $t('这个邀请已经失效（歌单主人停止共享了，或链接打错了）') }}
    </p>
    <p v-else class="page-state">{{ $t('加入失败：{error}', { error }) }}</p>
  </div>
</template>
