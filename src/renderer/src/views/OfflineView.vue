<script setup>
// 存在手机里的歌（离线听歌）：没网络也能播；可以全部清掉
import { computed } from 'vue';
import { usePlayCollection } from '../composables/usePlayCollection';
import { offlineBytes, offlineSettings, offlineSupported, offlineTracks, clearOffline } from '../offline';
import { totalLength } from '../utils/format';
import { t } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';

const { playAll, shuffleAll } = usePlayCollection();

const mb = bytes => Math.round(bytes / 1024 / 1024);
const meta = computed(() =>
  offlineTracks.value.length
    ? `${t('{n} 首', { n: offlineTracks.value.length })} · ${totalLength(offlineTracks.value)} · ${t('{used} / {limit} MB', {
        used: mb(offlineBytes.value),
        limit: offlineSettings.limitMb,
      })}`
    : ''
);

async function clearAll() {
  if (window.confirm(t('把存在手机里的歌全部删掉？之后听到的歌会再存进来。'))) await clearOffline();
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
    <p v-else-if="!offlineTracks.length" class="page-state">
      {{ offlineSettings.cellular ? $t('听超过 30 秒的歌会自动存进来。') : $t('连着 Wi-Fi 时，听超过 30 秒的歌会自动存进来。') }}
    </p>
    <template v-else>
      <TrackList :tracks="offlineTracks" context="offline" />
      <p class="foot">
        <button class="ghost" @click="clearAll">{{ $t('全部删掉') }}</button>
      </p>
    </template>
  </div>
</template>

<style scoped>
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
