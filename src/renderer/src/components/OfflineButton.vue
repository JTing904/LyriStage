<script setup>
// 歌单、我喜欢的音乐页头的「存到手机」（只有手机 App 有，放在 CollectionHeader 的 actions）：
// 按了把这页的歌排队存进手机；存的时候显示存到第几首，再按一次就不存了；全部存好变绿色，再按会问要不要从手机删掉
import { computed, ref } from 'vue';
import {
  cancelOffline,
  isOffline,
  isQueued,
  offlineSupported,
  removeOffline,
  requestOffline,
  waitingForWifi,
} from '../offline';
import { useNoticeStore } from '../stores/notice';
import { t } from '../i18n';
import ConfirmSheet from './ConfirmSheet.vue';
import Icon from './Icon.vue';

const props = defineProps({
  tracks: { type: Array, required: true },
});

const notice = useNoticeStore();
const confirmSheet = ref(null);
const total = computed(() => props.tracks.length);
const saved = computed(() => props.tracks.filter(track => isOffline(track.id)).length);
const queued = computed(() => props.tracks.some(track => isQueued(track.id)));
/** saving：还有在排队；done：全部存好；idle：还没存（或存了一部分） */
const status = computed(() => (queued.value ? 'saving' : total.value && saved.value === total.value ? 'done' : 'idle'));
const label = computed(() =>
  status.value === 'done' ? t('已存到手机') : status.value === 'saving' ? t('不存了') : t('存到手机')
);

async function onClick() {
  if (status.value === 'saving') {
    cancelOffline(props.tracks.map(track => track.id));
    notice.show(t('不存了，已经存好的留着'));
  } else if (status.value === 'done') {
    if (!(await confirmSheet.value.ask())) return;
    for (const track of props.tracks) await removeOffline(track.id);
  } else {
    requestOffline(props.tracks);
    notice.show(waitingForWifi() ? t('连上 Wi-Fi 后开始存到手机') : t('开始存到手机'));
  }
}
</script>

<template>
  <button
    v-if="offlineSupported && total"
    class="icon-action offline-btn"
    :class="status"
    :aria-label="label"
    :aria-pressed="status === 'done'"
    @click="onClick"
  >
    <Icon :name="status === 'done' ? 'check' : 'offline'" :size="18" />
    <span class="label">{{ label }}</span>
    <span v-if="status === 'saving' || (status === 'idle' && saved)" class="count">{{ saved }}/{{ total }}</span>
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
/* 手机的圆形图标按钮放不下「12/40」：存的时候变宽 */
@media (max-width: 640px) {
  /* 手机只留图标（文字给读屏用 aria-label）；CollectionHeader 藏 .label 的样式套不到元件里面，这里自己藏 */
  .label {
    display: none;
  }
  button.offline-btn.icon-action.saving,
  button.offline-btn.icon-action.idle:has(.count) {
    width: auto;
    padding: 0 12px;
    gap: 6px;
  }
}
</style>
