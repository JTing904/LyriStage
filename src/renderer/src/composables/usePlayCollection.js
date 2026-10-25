// 「播放全部」「随机播放」（歌单、专辑、歌手、每日推荐的页头按钮）
// 手机 App 没网络时：只播存在手机里的歌（没存的播不了）
import { usePlayer } from './usePlayer';
import { isOffline, offlineSupported, online } from '../offline';
import { useNoticeStore } from '../stores/notice';
import { t } from '../i18n';

/** 没网络时只留存在手机的歌；一首都没有就说明 */
function playable(tracks) {
  if (!offlineSupported || online.value) return tracks;
  const saved = tracks.filter(track => isOffline(track.id));
  if (!saved.length) useNoticeStore().show(t('没有网络，这里的歌都没存到手机'));
  return saved;
}

export function usePlayCollection() {
  const { player } = usePlayer();
  return {
    playAll(tracks, context = null) {
      const list = playable(tracks);
      if (!list.length) return;
      player.setShuffle(false);
      player.playList(list, 0, context);
    },
    shuffleAll(tracks, context = null) {
      const list = playable(tracks);
      if (!list.length) return;
      player.setShuffle(true);
      player.playList(list, Math.floor(Math.random() * list.length), context);
    },
  };
}
