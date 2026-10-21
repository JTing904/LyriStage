// 系统的「正在播放」：手机锁屏 / 通知栏、Windows 的媒体控制都能看到歌名封面、按播放暂停切歌。
// 手机 App 里这个插件还会开一个前台服务，切出 App、锁屏时歌不会被系统停掉。
// 电脑版和网页版用浏览器自带的 navigator.mediaSession（插件的网页版本就是包它）
import { MediaSession } from '@capgo/capacitor-media-session';
import { findLineIndex } from '@core/lyrics';
import { isNativeApp } from './platform';

const ignore = () => {};

// ---- 锁屏 / 通知栏歌词（Android App）----
// 一般 App 没办法把歌词放到真正的状态栏（要 root），能做的是锁屏和通知栏：
// 把正在唱的那句放进「正在播放」的标题，歌名和歌手放到下一行（网易云的车载蓝牙歌词也是这样，
// 所以车上的蓝牙屏幕也看得到）。只在 Android App 做：插件更新时只改给了的字段，封面不会重新下载；
// 网页版的 navigator.mediaSession 每次都要整份重设，封面会一直闪
const LOCK_LYRICS_KEY = 'lyristage:lock-screen-lyrics';
/** 设置里的开关，默认开 */
export function isLockScreenLyricsOn() {
  if (!isNativeApp) return false;
  try {
    return localStorage.getItem(LOCK_LYRICS_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setLockScreenLyrics(on) {
  try {
    localStorage.setItem(LOCK_LYRICS_KEY, on ? 'on' : 'off');
  } catch {
    // 存不了就只在这次生效
  }
}

const artistNames = track => (track?.ar ?? []).map(a => a.name).join(' / ');

/**
 * @param {ReturnType<typeof import('@core/player/player').createPlayer>} player
 * @param {{ getLyrics?: (track: object) => Promise<{ lines: Array<{ start: number, text: string }> }> }} [options]
 */
export function connectMediaSession(player, { getLyrics } = {}) {
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

  let current = null;
  /** @type {Array<{ start: number, text: string }>} */
  let lines = [];
  let shownLine = -1; // 锁屏上现在显示的是第几句（-1 = 显示歌名）

  player.on('track', async track => {
    current = track;
    lines = [];
    shownLine = -1;
    const cover = track?.al?.picUrl?.replace(/^http:/, 'https:');
    MediaSession.setMetadata({
      title: track?.name ?? '',
      artist: artistNames(track),
      album: track?.al?.name ?? '',
      artwork: cover
        ? [{ src: `${cover}?param=512y512`, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    }).catch(ignore);
    if (!track || !getLyrics || !isLockScreenLyricsOn()) return;
    try {
      const lyrics = await getLyrics(track);
      if (current === track) lines = lyrics.lines.filter(l => l.text.trim());
    } catch {
      // 没歌词就照常显示歌名
    }
  });

  // 唱到新的一句就换（只改标题和下一行，封面不动）
  player.on('time', time => {
    if (!current || !lines.length) return;
    const on = isLockScreenLyricsOn();
    const index = on ? findLineIndex(lines, time * 1000) : -1;
    if (index === shownLine) return;
    shownLine = index;
    const line = index >= 0 ? lines[index].text.trim() : '';
    MediaSession.setMetadata(
      line
        ? { title: line, artist: `${current.name} - ${artistNames(current)}` }
        : { title: current.name, artist: artistNames(current) }
    ).catch(ignore);
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
