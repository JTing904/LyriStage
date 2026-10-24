// 自动更新（只有打包好的安装版才会跑）：
// - 开 App 后 10 秒检查一次，之后每 6 小时一次；有新版就在背景下载
// - 下载好告诉页面（跳出"重启更新"）；用户不按的话，下次退出 App 时自动装好
// - 新版本放在 GitHub Release（electron-builder.yml 的 publish），要连 latest.yml 一起上传
import { app, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const FIRST_CHECK_MS = 10 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * @param {{ send: (channel: string, payload?: any) => void, isMain: (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => boolean }} options
 */
export function setupUpdater({ send, isMain }) {
  /** 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'error' */
  let status = app.isPackaged ? 'idle' : 'dev';
  let readyVersion = '';

  ipcMain.handle('lyristage:update-status', event =>
    isMain(event) ? { status, version: readyVersion, current: app.getVersion() } : null
  );
  ipcMain.handle('lyristage:update-check', async event => {
    if (!isMain(event) || !app.isPackaged) return { status, current: app.getVersion() };
    await check();
    return { status, version: readyVersion, current: app.getVersion() };
  });
  ipcMain.on('lyristage:update-install', event => {
    if (isMain(event) && status === 'ready') autoUpdater.quitAndInstall();
  });

  if (!app.isPackaged) return; // 开发模式没有安装包可以更新

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => (status = 'checking'));
  autoUpdater.on('update-available', () => (status = 'downloading'));
  autoUpdater.on('update-not-available', () => (status = 'latest'));
  autoUpdater.on('update-downloaded', info => {
    status = 'ready';
    readyVersion = info.version;
    send('lyristage:update-ready', { version: info.version });
  });
  autoUpdater.on('error', err => {
    status = 'error';
    console.warn('[LyriStage] 检查更新失败', err?.message ?? err);
  });

  async function check() {
    if (status === 'downloading' || status === 'ready') return;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // error 事件已经处理
    }
  }
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);
}
