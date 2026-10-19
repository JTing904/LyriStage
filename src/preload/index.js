// preload：页面和 Electron 之间唯一的桥梁。
// 只暴露页面需要的最少信息，页面拿不到 Node 和 ipcRenderer 本身。
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('lyristage', {
  isElectron: true,
  platform: process.platform,
  apiBase: 'http://127.0.0.1:10754',
});
