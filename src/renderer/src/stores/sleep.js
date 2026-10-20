// 睡眠定时：N 分钟后暂停，或这首播完就停
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { player } from '../services';
import { useNoticeStore } from './notice';
import { t } from '../i18n';

export const useSleepStore = defineStore('sleep', () => {
  /** 几点停（毫秒时间戳），0 = 没有在倒数 */
  const endsAt = ref(0);
  /** 这首播完就停 */
  const afterSong = ref(false);
  const now = ref(Date.now());
  let timer = 0;
  let ticker = 0;

  const active = computed(() => afterSong.value || endsAt.value > 0);
  /** 还剩多久（"12:05"） */
  const remaining = computed(() => {
    if (!endsAt.value) return '';
    const s = Math.max(0, Math.round((endsAt.value - now.value) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  function cancel() {
    clearTimeout(timer);
    clearInterval(ticker);
    endsAt.value = 0;
    if (afterSong.value) player.setStopAfterCurrent(false);
    afterSong.value = false;
  }

  /** @param {number} minutes */
  function start(minutes) {
    cancel();
    endsAt.value = Date.now() + minutes * 60_000;
    now.value = Date.now();
    ticker = setInterval(() => (now.value = Date.now()), 1000);
    timer = setTimeout(() => {
      cancel();
      player.pause();
      useNoticeStore().show(t('睡眠定时到了，已经暂停'));
    }, minutes * 60_000);
  }

  function startAfterSong() {
    cancel();
    afterSong.value = true;
    player.setStopAfterCurrent(true);
  }

  player.on('sleep', () => {
    afterSong.value = false;
    useNoticeStore().show(t('睡眠定时到了，已经暂停'));
  });

  return { endsAt, afterSong, active, remaining, start, startAfterSong, cancel };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useSleepStore, import.meta.hot));
