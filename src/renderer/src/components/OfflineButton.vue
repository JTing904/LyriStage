<script setup>
// 歌单、专辑、我喜欢的音乐页头的「存到手机」（只有手机 App 有，放在 CollectionHeader 的 actions）：
// 按了把这张整张存进手机，之后歌单加了歌会自动存、拿掉的会从手机删（offline.js 的 collections）；
// 存的时候显示存到第几首，再按一次就不存了；全部存好变绿色，再按会问要不要从手机删掉
import { computed, ref, watch } from 'vue';
import {
  isOffline,
  isQueued,
  isSavedCollection,
  offlineSupported,
  requestOffline,
  stopCollection,
  syncCollection,
  unsaveCollection,
  waitingForWifi,
} from '../offline';
import { useNoticeStore } from '../stores/notice';
import { t } from '../i18n';
import ConfirmSheet from './ConfirmSheet.vue';
import Icon from './Icon.vue';

const props = defineProps({
  tracks: { type: Array, required: true },
  /** 是哪一张：{ key: 'playlist:123', kind: 'playlist', id: '123', name } */
  collection: { type: Object, required: true },
});

const notice = useNoticeStore();
const confirmSheet = ref(null);
const total = computed(() => props.tracks.length);
const saved = computed(() => props.tracks.filter(track => isOffline(track.id)).length);
const queued = computed(() => props.tracks.some(track => isQueued(track.id)));
const savedHere = computed(() => isSavedCollection(props.collection.key));
/** saving：整张存起来、还有在排队；done：整张存起来、都存好了；idle：还没整张存（可能有几首单独存了） */
const status = computed(() => (!savedHere.value ? 'idle' : queued.value ? 'saving' : 'done'));

// 打开这一页拿到最新的歌：存起来的歌单就对一下（新加的存、拿掉的删）。还没载入（空的）不要对，不然会全删
watch(
  () => props.tracks,
  tracks => savedHere.value && tracks.length && syncCollection(props.collection.key, tracks),
  { immediate: true }
);
const label = computed(() =>
  status.value === 'done' ? t('已存到手机') : status.value === 'saving' ? t('不存了') : t('存到手机')
);
const showCount = computed(() => status.value === 'saving' || (status.value === 'idle' && saved.value > 0));
/** 读屏：手机上数字藏起来了（只画一圈进度），「存到手机」后面念出存了几首 */
const ariaLabel = computed(() => (showCount.value ? `${label.value} ${saved.value}/${total.value}` : label.value));

async function onClick() {
  if (status.value === 'saving') {
    stopCollection(props.collection.key);
    notice.show(t('不存了，已经存好的留着'));
  } else if (status.value === 'done') {
    if (!(await confirmSheet.value.ask())) return;
    await unsaveCollection(props.collection.key);
  } else {
    requestOffline(props.tracks, props.collection);
    notice.show(waitingForWifi() ? t('连上 Wi-Fi 后开始存到手机') : t('开始存到手机'));
  }
}
</script>

<template>
  <button
    v-if="offlineSupported && total"
    class="icon-action offline-btn"
    :class="status"
    :style="{ '--saved': total ? saved / total : 0 }"
    :aria-label="ariaLabel"
    :aria-pressed="status === 'done'"
    @click="onClick"
  >
    <Icon :name="status === 'done' ? 'check' : 'offline'" :size="18" />
    <span class="label">{{ label }}</span>
    <span v-if="showCount" class="count" aria-hidden="true">{{ saved }}/{{ total }}</span>
    <Teleport to="body">
      <ConfirmSheet
        ref="confirmSheet"
        :title="$t('从手机删除这 {n} 首？', { n: total })"
        :text="$t('删掉后，没网络时就不能听这些歌了')"
        :confirm-label="$t('删除')"
      />
    </Teleport>
  </button>
</template>

<style scoped>
.count {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
/* 存好了：绿色（跟歌名旁边的小箭头一样） */
.offline-btn.done {
  border-color: #16a34a;
  color: #16a34a;
}
/* 手机只留圆形图标（文字给读屏用 aria-label）：放不下「43/55」，变宽会把整排撑出画面，
   改成存的时候沿着按钮画一圈进度（参考 Spotify 下载歌单）。
   CollectionHeader 藏 .label 的样式套不到元件里面，这里自己藏 */
@media (max-width: 640px) {
  .label,
  .count {
    display: none;
  }
  .offline-btn {
    position: relative;
  }
  .offline-btn.saving::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: 50%;
    background: conic-gradient(var(--accent) calc(var(--saved) * 1turn), transparent 0);
    mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
    pointer-events: none;
  }
}
</style>
