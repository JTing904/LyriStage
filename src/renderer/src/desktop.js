// 电脑版专用：托盘的播放控制、托盘显示正在播什么、桌面歌词（现在唱到哪一句）
// 只在 Electron 里载入（main.js）
import { reactive } from 'vue';
import { findLineIndex } from '@core/lyrics';
import { controls, player, getLyrics } from './services';
import { displayText, LINE_LEAD_MS } from './lyric-stage/useStage';

/** 桌面歌词开着没有、锁定没有（播放条上的按钮用） */
export const desktopLyrics = reactive({ enabled: false, locked: false });

/** @param {any} bridge window.lyristage（preload 提供） */
export function connectDesktop(bridge) {
  // ---- 托盘按钮 ----
  bridge.onCommand(command => {
    if (command === 'toggle') controls.toggle();
    else if (command === 'next') controls.next();
    else if (command === 'prev') controls.prev();
  });

  // ---- 托盘显示正在播什么 ----
  let lastInfo = '';
  function sendNowPlaying() {
    const { track, playing } = player.getState();
    const info = {
      title: track?.name ?? '',
      artist: (track?.ar ?? []).map(a => a.name).join(' / '),
      playing,
    };
    const key = JSON.stringify(info);
    if (key === lastInfo) return;
    lastInfo = key;
    bridge.sendNowPlaying(info);
  }

  // ---- 桌面歌词 ----
  let lines = [];
  let lastIndex = null;
  let lastPlaying = null;
  let lastForced = 0;

  async function loadLyrics(track) {
    lines = [];
    push(true);
    if (!track) return;
    try {
      const lyrics = await getLyrics(track);
      if (player.getState().track?.id === track.id) {
        lines = lyrics.instrumental ? [] : lyrics.lines;
        push(true);
      }
    } catch {
      // 拿不到歌词就只显示歌名
    }
  }

  /** 唱到新的一句、播放 / 暂停、拖进度时传给桌面歌词窗口；另外每 2 秒校正一次 */
  function push(force = false) {
    if (!desktopLyrics.enabled) return;
    const { track, playing: isPlaying, loading } = player.getState();
    // 缓冲中声音停了：桌面歌词也要停，不然会自己往前跑、跑到声音前面
    const playing = isPlaying && !loading;
    const time = player.currentTime();
    const index = findLineIndex(lines, time * 1000 + LINE_LEAD_MS);
    const now = Date.now();
    if (!force && index === lastIndex && playing === lastPlaying && now - lastForced < 2000) return;
    lastIndex = index;
    lastPlaying = playing;
    lastForced = now;
    const line = lines[index];
    bridge.sendLyric({
      title: track?.name ?? '',
      artist: (track?.ar ?? []).map(a => a.name).join(' / '),
      playing,
      time,
      line: line
        ? {
            start: line.start,
            end: line.end,
            text: displayText(line.text),
            translation: line.translation,
            words: line.words.map(w => ({ start: w.start, duration: w.duration, text: w.text })),
          }
        : null,
      next: lines[index + 1] ? displayText(lines[index + 1].text) : '',
    });
  }

  player.on('track', track => loadLyrics(track));
  player.on('time', () => push());
  player.on('change', () => {
    sendNowPlaying();
    push(true);
  });

  bridge.onDesktopLyricsState(state => {
    Object.assign(desktopLyrics, state);
    if (state.enabled) push(true);
  });

  // App 开起来时可能已经恢复了上次的歌
  const current = player.getState().track;
  if (current) loadLyrics(current);
  sendNowPlaying();
}
