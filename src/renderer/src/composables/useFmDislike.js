// 私人 FM 的「不喜欢」：马上跳到下一首，记下来以后少推荐（推荐算法会排除不喜欢的歌）
import { dislikeTrack } from '@core/data';
import { usePlayer } from './usePlayer';
import { useNoticeStore } from '../stores/notice';
import { t } from '../i18n';
import { showError } from '../friendlyError';

export function useFmDislike() {
  const { state, player } = usePlayer();
  const notice = useNoticeStore();
  return async function dislike() {
    const track = state.track;
    if (!track || state.mode !== 'fm') return;
    player.next();
    try {
      await dislikeTrack(track.id);
      // 已经挑好的下几首可能是根据旧的口味，清掉重挑
      player.getFmSource()?.invalidate?.();
      notice.show(t('以后会少推荐这类歌'));
    } catch (err) {
      showError(err, t('没改成功'));
    }
  };
}
