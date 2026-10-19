// 系统托盘（Windows 右下角）：关掉窗口后歌继续播，从这里控制或叫回窗口
import { Menu, Tray, nativeImage } from 'electron';

/** 托盘菜单的英文（App 设定成 English 时用） */
const EN = {
  没有在播放: 'Not playing',
  暂停: 'Pause',
  播放: 'Play',
  上一首: 'Previous',
  下一首: 'Next',
  桌面歌词: 'Desktop lyrics',
  锁定桌面歌词: 'Lock desktop lyrics',
  '显示 LyriStage': 'Show LyriStage',
  退出: 'Quit',
};

/**
 * @param {object} options
 * @param {string} options.icon 托盘图标路径
 * @param {() => void} options.onShow 显示主窗口
 * @param {(command: 'toggle' | 'prev' | 'next') => void} options.onCommand
 * @param {() => void} options.onToggleLyrics 桌面歌词开 / 关
 * @param {() => void} options.onToggleLock 桌面歌词锁定 / 解锁
 * @param {() => void} options.onQuit
 */
export function createTray({ icon, onShow, onCommand, onToggleLyrics, onToggleLock, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(icon));
  let nowPlaying = null;
  let lyrics = { enabled: false, locked: false };
  let locale = 'zh-CN';
  const t = text => (locale === 'en' ? (EN[text] ?? text) : text);

  function render() {
    const title = nowPlaying?.title
      ? `${nowPlaying.title}${nowPlaying.artist ? ` - ${nowPlaying.artist}` : ''}`
      : t('没有在播放');
    tray.setToolTip(`LyriStage\n${title}`.slice(0, 127));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: title.length > 40 ? `${title.slice(0, 40)}…` : title, enabled: false },
        { type: 'separator' },
        {
          label: nowPlaying?.playing ? t('暂停') : t('播放'),
          enabled: Boolean(nowPlaying?.title),
          click: () => onCommand('toggle'),
        },
        { label: t('上一首'), enabled: Boolean(nowPlaying?.title), click: () => onCommand('prev') },
        { label: t('下一首'), enabled: Boolean(nowPlaying?.title), click: () => onCommand('next') },
        { type: 'separator' },
        {
          label: t('桌面歌词'),
          type: 'checkbox',
          checked: lyrics.enabled,
          click: onToggleLyrics,
        },
        {
          label: t('锁定桌面歌词'),
          type: 'checkbox',
          checked: lyrics.locked,
          enabled: lyrics.enabled,
          click: onToggleLock,
        },
        { type: 'separator' },
        { label: t('显示 LyriStage'), click: onShow },
        { label: t('退出'), click: onQuit },
      ])
    );
  }

  tray.on('click', onShow);
  render();

  return {
    setNowPlaying(info) {
      nowPlaying = info;
      render();
    },
    setLocale(value) {
      locale = value;
      render();
    },
    setLyricsState(state) {
      lyrics = state;
      render();
    },
    displayBalloon: options => tray.displayBalloon?.(options),
    destroy: () => tray.destroy(),
  };
}
