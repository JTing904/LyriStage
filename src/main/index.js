// Electron 主进程
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { startApiServer, API_PORT } from './apiServer';
import { loadWindowState, trackWindowState } from './windowState';

const isMac = process.platform === 'darwin';

// 只允许开一个 LyriStage；第二次打开时把已有窗口叫到前面
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  // 和 src/renderer/src/styles/base.css 的 --bg / --text 保持一致
  const themeColors = () =>
    nativeTheme.shouldUseDarkColors
      ? { background: '#111111', symbol: '#f2f2f2' }
      : { background: '#f5f5f7', symbol: '#1c1c1e' };

  // Windows / Linux 右上角系统按钮的样式（透明底，图标颜色跟随深浅色）
  const titleBarOverlay = () => ({
    color: '#00000000',
    symbolColor: themeColors().symbol,
    height: 40,
  });

  function createWindow() {
    const state = loadWindowState();
    mainWindow = new BrowserWindow({
      ...state.bounds,
      minWidth: 360, // 允许拉到手机宽度，方便调响应式布局
      minHeight: 560,
      show: false,
      backgroundColor: themeColors().background,
      // 隐藏系统标题栏，但保留系统自带的最小化 / 最大化 / 关闭按钮
      titleBarStyle: 'hidden',
      ...(isMac
        ? { trafficLightPosition: { x: 16, y: 14 } }
        : { titleBarOverlay: titleBarOverlay() }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // 安全默认值：页面里不能直接用 Node，只能用 preload 暴露的有限接口
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    if (state.maximized) mainWindow.maximize();
    trackWindowState(mainWindow);

    // 系统切换深浅色时，系统按钮的颜色跟着变
    const onThemeChange = () => {
      if (mainWindow.isDestroyed()) return;
      if (!isMac) mainWindow.setTitleBarOverlay(titleBarOverlay());
      mainWindow.setBackgroundColor(themeColors().background);
    };
    nativeTheme.on('updated', onThemeChange);
    mainWindow.on('closed', () => nativeTheme.off('updated', onThemeChange));

    mainWindow.once('ready-to-show', () => mainWindow.show());

    // 页面里的外部链接用系统浏览器打开，不在 App 里开新窗口
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  app.whenReady().then(() => {
    startApiServer().catch(err => {
      console.error(`[LyriStage] 网易云 API 启动失败（端口 ${API_PORT}）`, err);
    });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
