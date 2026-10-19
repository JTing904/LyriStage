// preload：页面和 Electron 之间唯一的桥梁。
// 只暴露页面需要的最少信息，页面拿不到 Node 和 ipcRenderer 本身。
import { contextBridge, ipcRenderer } from 'electron';

const THEMES = ['system', 'dark', 'light'];

contextBridge.exposeInMainWorld('lyristage', {
  isElectron: true,
  platform: process.platform,
  apiBase: 'http://127.0.0.1:10754',
  setTheme: mode => {
    if (THEMES.includes(mode)) ipcRenderer.send('lyristage:set-theme', mode);
  },
  /** 第三方登录回调（lyristage://auth/callback?code=…） */
  onAuthCallback: callback => {
    ipcRenderer.on('lyristage:auth-callback', (_event, url) => {
      if (typeof url === 'string') callback(url);
    });
    // 页面准备好了：如果是被登录回调网址叫起来的，主进程这时才把网址发过来
    ipcRenderer.send('lyristage:auth-ready');
  },

  // ---- 主窗口：托盘控制、桌面歌词 ----
  /** 托盘按了播放 / 暂停、上一首、下一首 */
  onCommand: callback => {
    ipcRenderer.on('lyristage:command', (_event, command) => {
      if (['toggle', 'prev', 'next'].includes(command)) callback(command);
    });
  },
  /** 正在播什么（托盘显示） */
  sendNowPlaying: info => ipcRenderer.send('lyristage:now-playing', info),
  /** 现在唱到的这一句（传给桌面歌词窗口） */
  sendLyric: payload => ipcRenderer.send('lyristage:lyric', payload),
  setLocale: locale => ipcRenderer.send('lyristage:set-locale', locale),
  setDesktopLyrics: enabled => ipcRenderer.send('lyristage:desktop-lyrics', Boolean(enabled)),
  setDesktopLyricsLocked: locked =>
    ipcRenderer.send('lyristage:desktop-lyrics-lock', Boolean(locked)),
  /** 桌面歌词开着没有、锁定没有 */
  onDesktopLyricsState: callback => {
    ipcRenderer.on('lyristage:desktop-lyrics-state', (_event, state) => callback(state));
  },

  // ---- 桌面歌词窗口 ----
  onLyric: callback => {
    ipcRenderer.on('lyristage:lyric', (_event, payload) => callback(payload));
  },
  onLyricsWindowState: callback => {
    ipcRenderer.on('lyristage:lyrics-window-state', (_event, state) => callback(state));
  },
  /** 'lock' 锁定 | 'close' 关掉桌面歌词 */
  lyricsWindow: action => {
    if (['lock', 'close'].includes(action)) ipcRenderer.send('lyristage:lyrics-window', action);
  },
});
