// 找音源、载入超过 1.5 秒：播放条歌手那一行改成「正在找其他音源…」「正在载入…」，
// 不然要等好几秒（其他音源要去 B 站找）时看起来像按了没反应
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { isUnavailable } from '@core/netease';
import { t } from '../i18n';

const SLOW_MS = 1500;

/** @param {{ loading: boolean, track: object | null }} state 播放器状态（usePlayer 的 state） */
export function useLoadingHint(state) {
  const slow = ref(false);
  let timer = 0;
  watch(
    () => [state.loading, state.track?.id],
    ([loading]) => {
      clearTimeout(timer);
      slow.value = false;
      if (loading) timer = setTimeout(() => (slow.value = true), SLOW_MS);
    },
    { immediate: true }
  );
  onBeforeUnmount(() => clearTimeout(timer));
  return computed(() => {
    if (!slow.value || !state.loading) return '';
    return isUnavailable(state.track) ? t('正在找其他音源…') : t('正在载入…');
  });
}
