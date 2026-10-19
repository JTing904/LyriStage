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
});
