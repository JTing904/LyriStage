// 系统的「正在播放」：手机锁屏 / 通知栏、Windows 的媒体控制都能看到歌名封面、按播放暂停切歌。
// 手机 App 里这个插件还会开一个前台服务，切出 App、锁屏时歌不会被系统停掉。
// 电脑版和网页版用浏览器自带的 navigator.mediaSession（插件的网页版本就是包它）
import { MediaSession } from '@capgo/capacitor-media-session';

const ignore = () => {};

/** @param {ReturnType<typeof import('@core/player/player').createPlayer>} player */
export function connectMediaSession(player) {
  const handlers = {
    play: () => player.play(),
    pause: () => player.pause(),
    previoustrack: () => player.prev(),
    nexttrack: () => player.next(),
    seekto: ({ seekTime }) => typeof seekTime === 'number' && player.seek(seekTime),
    seekbackward: () => player.seek(Math.max(0, player.currentTime() - 10)),
    seekforward: () => player.seek(player.currentTime() + 10),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    MediaSession.setActionHandler({ action }, handler).catch(ignore);
  }

  player.on('track', track => {
    const cover = track?.al?.picUrl?.replace(/^http:/, 'https:');
    MediaSession.setMetadata({
      title: track?.name ?? '',
      artist: (track?.ar ?? []).map(a => a.name).join(' / '),
      album: track?.al?.name ?? '',
      artwork: cover
        ? [{ src: `${cover}?param=512y512`, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    }).catch(ignore);
  });

  // 播放 / 暂停、拖动进度时更新（time 事件太频繁，锁屏的进度条自己会走）
  let lastPlaying = null;
  player.on('change', state => {
    if (state.playing !== lastPlaying) {
      lastPlaying = state.playing;
      MediaSession.setPlaybackState({
        playbackState: state.track ? (state.playing ? 'playing' : 'paused') : 'none',
      }).catch(ignore);
    }
    if (state.duration > 0) {
      MediaSession.setPositionState({
        duration: state.duration,
        position: Math.min(state.time, state.duration),
        playbackRate: 1,
      }).catch(ignore);
    }
  });
}
