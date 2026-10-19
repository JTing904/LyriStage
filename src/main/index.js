// Electron 主进程
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import { join, resolve } from 'node:path';
import { startApiServer, API_PORT } from './apiServer';
import { loadWindowState, trackWindowState } from './windowState';

const isMac = process.platform === 'darwin';

// 界面语言用简体中文（表单的"请填写此字段"等浏览器自带提示也会是中文）
app.commandLine.appendSwitch('lang', 'zh-CN');

// 第三方登录（GitHub / Google）：系统浏览器授权完会打开 lyristage://auth/callback?code=…
// 把 lyristage:// 注册给这个 App。开发时是 "electron.exe 项目目录" 这样跑的，要把目录也告诉系统
const PROTOCOL = 'lyristage';
const AUTH_CALLBACK = `${PROTOCOL}://auth/callback`;
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
    resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}
/** Windows / Linux 把网址放在启动参数里 */
const findAuthUrl = argv => argv.find(arg => arg.startsWith(AUTH_CALLBACK));

// 只允许开一个 LyriStage；第二次打开时把已有窗口叫到前面
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  function focusWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  // 登录回调网址：页面准备好（preload 发 auth-ready）之前先存着
  let pageReady = false;
  let pendingAuthUrl = findAuthUrl(process.argv) ?? null;
  function deliverAuthUrl(url) {
    if (!url?.startsWith(AUTH_CALLBACK)) return;
    if (pageReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lyristage:auth-callback', url);
    } else {
      pendingAuthUrl = url;
    }
  }
  ipcMain.on('lyristage:auth-ready', event => {
    if (event.sender !== mainWindow?.webContents) return;
    pageReady = true;
    if (pendingAuthUrl) {
      event.sender.send('lyristage:auth-callback', pendingAuthUrl);
      pendingAuthUrl = null;
    }
  });

  // App 已经开着时，点登录回调网址会再开一个 LyriStage，被单实例锁挡下，网址转到这里
  app.on('second-instance', (_event, argv) => {
    deliverAuthUrl(findAuthUrl(argv));
    focusWindow();
  });
  // macOS 用 open-url 事件
  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverAuthUrl(url);
    focusWindow();
  });

  // 和 src/renderer/src/styles/base.css 的 --bg / --text 保持一致
  const themeColors = () =>
    nativeTheme.shouldUseDarkColors
      ? { background: '#0e0e10', symbol: '#f4f4f5' }
      : { background: '#f4f4f6', symbol: '#18181b' };

  // 页面里切换"深色 / 浅色 / 跟随系统"时，窗口也跟着切（会触发 nativeTheme 的 updated 事件）
  ipcMain.on('lyristage:set-theme', (_event, mode) => {
    if (['system', 'dark', 'light'].includes(mode)) nativeTheme.themeSource = mode;
  });

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
