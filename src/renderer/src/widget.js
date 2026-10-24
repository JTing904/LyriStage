// Android 桌面小组件「正在播放」（原生部分在 android/.../NowPlayingWidget.java、WidgetPlugin.java）
// 换歌、播放 / 暂停、唱到新的一句时把资料送过去（大的小组件显示这一句、进度条）；小组件的按钮回来叫播放器。
// 长按桌面图标的快捷选单（android/.../res/xml/shortcuts.xml）也走同一条路：打开 App 后接着做那件事
import { registerPlugin } from '@capacitor/core';
import { findLineIndex } from '@core/lyrics';
import { isNativeApp } from './platform';

const Widget = isNativeApp ? registerPlugin('NowPlayingWidget') : null;
const ignore = () => {};
const artistNames = track => (track?.ar ?? []).map(a => a.name).join(' / ');

/** 设置页：叫桌面跳出「加小组件」的确认；桌面不支持时回传 false */
export async function pinWidget() {
  if (!Widget) return false;
  try {
    return (await Widget.pin()).ok;
  } catch {
    return false;
  }
}

/**
 * @param {ReturnType<typeof import('@core/player/player').createPlayer>} player
 * @param {{
 *   getLyrics: (track: object) => Promise<{ lines: Array<{ start: number, text: string }> }>,
 *   playFm: () => Promise<void>,
 * }} options
 */
export function connectWidget(player, { getLyrics, playFm }) {
  if (!Widget) return;
  const send = data => Widget.update(data).catch(ignore);
  /** 进度条用：跟着歌词、播放暂停一起送（小组件每次都整个重画，不能每秒送） */
  const progress = () => ({ position: player.currentTime() || 0, duration: player.getState().duration || 0 });
  /** 没有歌词的歌：进度条至少每 15 秒动一下 */
  const PROGRESS_EVERY_MS = 15000;
  let progressSentAt = 0;

  const actions = {
    toggle: () => player.toggle(),
    prev: () => player.prev(),
    next: () => player.next(),
    // 快捷选单
    resume: () => !player.getState().playing && player.toggle(),
    daily: () => (location.hash = '#/daily'),
    fm: () => playFm(),
    room: () => (location.hash = '#/room'),
  };
  Widget.addListener('action', ({ action }) => actions[action]?.());
  // App 是按小组件的按钮（或快捷选单）打开的：等上次的歌恢复好再接着做
  Widget.consumeLaunchAction()
    .then(({ action }) => action && setTimeout(() => actions[action]?.(), 1500))
    .catch(ignore);

  let current = null;
  /** @type {Array<{ start: number, text: string }>} */
  let lines = [];
  let shownLine = -2; // -2 = 还没送过；-1 = 还没唱到第一句

  async function onTrack(track) {
    current = track;
    lines = [];
    shownLine = -2;
    const cover = track?.al?.picUrl?.replace(/^http:/, 'https:');
    send({
      title: track?.name ?? '',
      artist: artistNames(track),
      lyric: '',
      lyricNext: '',
      cover: cover ? `${cover}?param=360y360` : '',
      position: 0,
      duration: track?.dt ? track.dt / 1000 : 0,
    });
    if (!track) return;
    try {
      const lyrics = await getLyrics(track);
      if (current !== track) return;
      lines = lyrics.lines.filter(l => l.text.trim());
      // 暂停中也马上显示（例如打开 App 恢复上次的歌）
      showLine(player.currentTime());
    } catch {
      // 没歌词就只显示歌名
    }
  }
  player.on('track', onTrack);

  // 唱到新的一句才送（一句几秒，不会太频繁）
  function showLine(time) {
    if (!current) return;
    if (!lines.length) {
      if (Date.now() - progressSentAt < PROGRESS_EVERY_MS || !player.getState().playing) return;
      progressSentAt = Date.now();
      send(progress());
      return;
    }
    const index = findLineIndex(lines, time * 1000);
    if (index === shownLine) return;
    shownLine = index;
    progressSentAt = Date.now();
    // 还没唱到第一句时，先把第一句当成"下一句"显示
    send({
      lyric: index >= 0 ? lines[index].text.trim() : '',
      lyricNext: lines[index + 1]?.text.trim() ?? '',
      ...progress(),
    });
  }
  player.on('time', showLine);

  // 打开 App 恢复上次的歌时不一定有 track 事件：状态一变就对一下是不是同一首
  let lastPlaying = null;
  function onChange(state) {
    if ((state.track?.id ?? null) !== (current?.id ?? null)) onTrack(state.track);
    if (state.playing === lastPlaying) return;
    lastPlaying = state.playing;
    send({ playing: state.playing, ...progress() });
  }
  player.on('change', onChange);
  onChange(player.getState());
}
