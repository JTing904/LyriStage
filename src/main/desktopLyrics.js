// 桌面歌词：透明、无边框、总在最上层的小窗口（页面是 src/renderer/desktop-lyrics.html）。
// 歌词由主窗口算好（现在唱到哪一句）传过来，这个窗口只负责显示。
// 锁定后鼠标会穿透过去（点得到后面的东西），从托盘解锁。
// 只在主窗口收起来（最小化、关到托盘）时显示，主窗口开着就藏起来，不跟 App 里的歌词重复
import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { getSettings, updateSettings } from './settings';

const SIZE = { width: 960, height: 150 };

export function createDesktopLyricsController({ onStateChange }) {
  let win = null;
  let lastPayload = null;
  /** 主窗口现在看得到吗（最小化、关到托盘时是 false） */
  let appVisible = true;
  let locale = 'zh-CN';

  const state = () => {
    const { enabled, locked } = getSettings().desktopLyrics;
    return { enabled, locked, locale };
  };
  const save = patch =>
    updateSettings({ desktopLyrics: { ...getSettings().desktopLyrics, ...patch } });

  function defaultBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    return {
      ...SIZE,
      x: Math.round(workArea.x + (workArea.width - SIZE.width) / 2),
      y: Math.round(workArea.y + workArea.height - SIZE.height - 60),
    };
  }

  /** 上次的位置还在某个屏幕上吗（拔掉外接屏幕后，那个位置会看不到） */
  function onScreen(bounds) {
    if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return false;
    return screen.getAllDisplays().some(({ workArea: a }) => {
      return (
        bounds.x + 100 > a.x &&
        bounds.y + 40 > a.y &&
        bounds.x + 100 <= a.x + a.width &&
        bounds.y + 40 <= a.y + a.height
      );
    });
  }

  function open() {
    if (win) return;
    const remembered = getSettings().desktopLyrics.bounds;
    const saved = onScreen(remembered) ? remembered : null;
    win = new BrowserWindow({
      ...(saved ?? defaultBounds()),
      minWidth: 360,
      minHeight: 90,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // 'screen-saver' 层级：连全屏的视频、游戏上面也看得到
    win.setAlwaysOnTop(true, 'screen-saver');
    applyLock();

    const persist = () => win && !win.isDestroyed() && save({ bounds: win.getBounds() });
    win.on('moved', persist);
    win.on('resized', persist);
    win.on('closed', () => {
      win = null;
    });
    win.once('ready-to-show', () => sync());
    win.webContents.once('did-finish-load', () => {
      if (lastPayload) win.webContents.send('lyristage:lyric', lastPayload);
      win.webContents.send('lyristage:lyrics-window-state', state());
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/desktop-lyrics.html`);
    } else {
      win.loadFile(join(__dirname, '../renderer/desktop-lyrics.html'));
    }
  }

  function close() {
    win?.destroy();
    win = null;
  }

  /** 按开关和主窗口状态决定显示还是藏起来 */
  function sync() {
    if (!state().enabled) return close();
    if (!win) return open();
    if (appVisible) win.hide();
    else if (!win.isVisible()) win.showInactive();
  }

  function applyLock() {
    if (!win) return;
    const { locked } = state();
    // 锁定：鼠标穿透（forward 让窗口还收得到鼠标移动，用来淡淡地显示「已锁定」）
    win.setIgnoreMouseEvents(locked, { forward: true });
    win.webContents.send('lyristage:lyrics-window-state', state());
  }

  function changed() {
    onStateChange(state());
  }

  return {
    state,
    /** App 启动时：上次开着就打开 */
    restore() {
      sync();
      changed();
    },
    setEnabled(enabled) {
      save({ enabled });
      sync();
      changed();
    },
    /** App 的语言（桌面歌词窗口上的按钮跟着换） */
    setLocale(value) {
      locale = value;
      if (win && !win.isDestroyed()) win.webContents.send('lyristage:lyrics-window-state', state());
    },
    /** 主窗口显示 / 收起来了 */
    setAppVisible(visible) {
      appVisible = visible;
      sync();
    },
    toggle() {
      this.setEnabled(!state().enabled);
    },
    setLocked(locked) {
      save({ locked });
      applyLock();
      changed();
    },
    toggleLock() {
      this.setLocked(!state().locked);
    },
    /** 主窗口传来的歌词（现在这一句、进度） */
    send(payload) {
      lastPayload = payload;
      if (win && !win.isDestroyed()) win.webContents.send('lyristage:lyric', payload);
    },
    isLyricsWindow: contents => Boolean(win && contents === win.webContents),
    destroy: close,
  };
}
