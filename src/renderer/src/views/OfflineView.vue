<script setup>
// 存在手机里的歌（离线听歌）：自己按「存到手机」的歌，没网络也能播；可以一首首删或全部删掉
import { computed, ref } from 'vue';
import { usePlayCollection } from '../composables/usePlayCollection';
import { offlineBytes, offlineSupported, offlineTracks, clearOffline, queuedIds } from '../offline';
import { totalLength } from '../utils/format';
import { t } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';
import ConfirmSheet from '../components/ConfirmSheet.vue';

const { playAll, shuffleAll } = usePlayCollection();

const mb = bytes => Math.round(bytes / 1024 / 1024);
const meta = computed(() =>
  offlineTracks.value.length
    ? `${t('{n} 首', { n: offlineTracks.value.length })} · ${totalLength(offlineTracks.value)} · ${mb(offlineBytes.value)} MB`
    : ''
);
/** 还有几首排队等着存 */
const waiting = computed(() => queuedIds.value.size);

const confirmClear = ref(null);
async function clearAll() {
  if (await confirmClear.value.ask()) await clearOffline();
}
</script>

<template>
  <div class="page">
    <CollectionHeader
      :kind="$t('离线听歌')"
      :cover="offlineTracks[0]?.al?.picUrl || ''"
      :title="$t('存在手机里的歌')"
      :meta="meta"
      :playable="offlineTracks.length > 0"
      @play="playAll(offlineTracks, 'offline')"
      @shuffle="shuffleAll(offlineTracks, 'offline')"
    />
    <p v-if="!offlineSupported" class="page-state">{{ $t('只有手机 App 有离线听歌') }}</p>
    <p v-if="offlineSupported && waiting" class="waiting">{{ $t('还有 {n} 首等着存', { n: waiting }) }}</p>
    <p v-if="!offlineSupported" class="page-state">{{ $t('只有手机 App 有离线听歌') }}</p>
    <p v-else-if="!offlineTracks.length" class="page-state">
      {{ $t('在歌单页按「存到手机」，或在歌曲的 ⋯ 按「存到手机」，歌就会存在这里。') }}
    </p>
    <template v-else>
      <TrackList :tracks="offlineTracks" context="offline" />
      <p class="foot">
        <button class="ghost" @click="clearAll">{{ $t('全部删掉') }}</button>
      </p>
    </template>
    <ConfirmSheet
      ref="confirmClear"
      :title="$t('把存在手机里的歌全部删掉？')"
      :text="$t('删掉后，没网络时就不能听这些歌了')"
      :confirm-label="$t('全部删掉')"
    />
  </div>
</template>

<style scoped>
.waiting {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-dim);
}
.foot {
  display: flex;
  justify-content: center;
  margin: 24px 0 0;
}
.ghost {
  height: 40px;
  padding: 0 18px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
</style>
