// Windows 任务栏：鼠标移到 LyriStage 的图标上，跳出的缩图下面有「上一首 / 播放·暂停 / 下一首」
// 图标跟着任务栏的深浅色换（白色 / 深色两套，resources/thumbar）
import { nativeImage, nativeTheme } from 'electron';
import prevDark from '../../resources/thumbar/prev-dark.png?asset';
import playDark from '../../resources/thumbar/play-dark.png?asset';
import pauseDark from '../../resources/thumbar/pause-dark.png?asset';
import nextDark from '../../resources/thumbar/next-dark.png?asset';
import prevLight from '../../resources/thumbar/prev-light.png?asset';
import playLight from '../../resources/thumbar/play-light.png?asset';
import pauseLight from '../../resources/thumbar/pause-light.png?asset';
import nextLight from '../../resources/thumbar/next-light.png?asset';

const ICONS = {
  dark: { prev: prevDark, play: playDark, pause: pauseDark, next: nextDark },
  light: { prev: prevLight, play: playLight, pause: pauseLight, next: nextLight },
};

const EN = { 上一首: 'Previous', 播放: 'Play', 暂停: 'Pause', 下一首: 'Next' };

/**
 * @param {import('electron').BrowserWindow} window
 * @param {(command: 'toggle' | 'prev' | 'next') => void} onCommand
 */
export function createThumbar(window, onCommand) {
  if (process.platform !== 'win32') return { setNowPlaying() {}, setLocale() {} };
  let playing = false;
  let hasSong = false;
  let locale = 'zh-CN';
  const t = text => (locale === 'en' ? EN[text] : text);

  function render() {
    if (window.isDestroyed()) return;
    // 任务栏是深色就用白色图标（跟系统设定的「Windows 模式」，不是 App 的主题）
    const icons = ICONS[nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? 'dark' : 'light'];
    const button = (icon, tooltip, command) => ({
      icon: nativeImage.createFromPath(icon),
      tooltip: t(tooltip),
      flags: hasSong ? [] : ['disabled'],
      click: () => onCommand(command),
    });
    window.setThumbarButtons([
      button(icons.prev, '上一首', 'prev'),
      playing ? button(icons.pause, '暂停', 'toggle') : button(icons.play, '播放', 'toggle'),
      button(icons.next, '下一首', 'next'),
    ]);
  }

  nativeTheme.on('updated', render);
  // 窗口缩到托盘再叫回来时 Windows 会清掉按钮：显示时重设
  window.on('show', render);
  window.once('ready-to-show', render);
  window.on('closed', () => nativeTheme.off('updated', render));

  return {
    /** @param {{ title: string, playing: boolean }} info */
    setNowPlaying(info) {
      if (info.playing === playing && Boolean(info.title) === hasSong) return;
      playing = info.playing;
      hasSong = Boolean(info.title);
      render();
    },
    setLocale(value) {
      locale = value;
      render();
    },
  };
}
