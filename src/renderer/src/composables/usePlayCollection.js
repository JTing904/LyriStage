// 「播放全部」「随机播放」（歌单、专辑、歌手、每日推荐的页头按钮）
import { usePlayer } from './usePlayer';

export function usePlayCollection() {
  const { player } = usePlayer();
  return {
    playAll(tracks, context = null) {
      if (!tracks.length) return;
      player.setShuffle(false);
      player.playList(tracks, 0, context);
    },
    shuffleAll(tracks, context = null) {
      if (!tracks.length) return;
      player.setShuffle(true);
      player.playList(tracks, Math.floor(Math.random() * tracks.length), context);
    },
  };
}
