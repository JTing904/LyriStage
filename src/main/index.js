// Electron 主进程
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startApiServer, API_PORT } from './apiServer';
import { loadWindowState, trackWindowState } from './windowState';
import { createTray } from './tray';
import { createDesktopLyricsController } from './desktopLyrics';
import { getSettings, updateSettings } from './settings';
import appIcon from '../../resources/icon.png?asset';
import trayIcon from '../../resources/tray.png?asset';

// 用系统浏览器打开的网址：只放行 https 和 App 里真的会开的网站
// （登录授权页、GitHub、IG、官网…），其他网址一律不开
const EXTERNAL_HOSTS = [
  'github.com',
  'supabase.co',
  'instagram.com',
  'jting904.github.io',
  'lyristage.vercel.app',
  'music.163.com',
];
function openExternalSafely(url) {
  try {
    const { protocol, hostname } = new URL(url);
    const allowed = EXTERNAL_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
    if (protocol === 'https:' && allowed) shell.openExternal(url);
    else console.warn('[LyriStage] 不在白名单，不打开：', url);
  } catch {
    // 不是网址
  }
}

// 本机网易云 API 的通行证：每次启动都不一样，浏览器里的其他网站拿不到，就调不了这个 API
const apiToken = randomBytes(24).toString('hex');

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
  let tray = null;
  /** 真的要退出（托盘「退出」、系统关机）；不然关窗口只是缩到托盘 */
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  const sendToMain = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  const fromMain = event => event.sender === mainWindow?.webContents;

  // 桌面歌词
  const desktopLyrics = createDesktopLyricsController({
    onStateChange: state => {
      sendToMain('lyristage:desktop-lyrics-state', state);
      tray?.setLyricsState(state);
    },
  });

  // 主窗口 → 托盘：正在播什么（托盘的提示文字和菜单）
  ipcMain.on('lyristage:now-playing', (event, info) => {
    if (!fromMain(event) || typeof info !== 'object' || !info) return;
    tray?.setNowPlaying({
      title: String(info.title ?? ''),
      artist: String(info.artist ?? ''),
      playing: Boolean(info.playing),
    });
  });
  // 主窗口 → 桌面歌词窗口：现在这一句
  ipcMain.on('lyristage:lyric', (event, payload) => {
    if (fromMain(event)) desktopLyrics.send(payload);
  });
  // 主窗口的「桌面歌词」按钮
  ipcMain.on('lyristage:desktop-lyrics', (event, enabled) => {
    if (fromMain(event)) desktopLyrics.setEnabled(Boolean(enabled));
  });
  // App 的语言（托盘菜单、桌面歌词窗口跟着换）
  let locale = 'zh-CN';
  ipcMain.on('lyristage:set-locale', (event, value) => {
    if (!fromMain(event) || !['zh-CN', 'en'].includes(value)) return;
    locale = value;
    tray?.setLocale(value);
    desktopLyrics.setLocale(value);
  });
  // 设置页的「锁定桌面歌词」
  ipcMain.on('lyristage:desktop-lyrics-lock', (event, locked) => {
    if (fromMain(event)) desktopLyrics.setLocked(Boolean(locked));
  });
  // 桌面歌词窗口上的按钮：锁定、关闭
  ipcMain.on('lyristage:lyrics-window', (event, action) => {
    if (!desktopLyrics.isLyricsWindow(event.sender)) return;
    if (action === 'lock') desktopLyrics.setLocked(true);
    else if (action === 'close') desktopLyrics.setEnabled(false);
  });

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
  ipcMain.on('lyristage:set-theme', (event, mode) => {
    if (!fromMain(event)) return;
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
      icon: appIcon,
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
        // 本机 API 的通行证：preload 从启动参数读出来，请求时放在 X-LyriStage-Token
        additionalArguments: [`--lyristage-api-token=${apiToken}`],
      },
    });
    if (state.maximized) mainWindow.maximize();
    trackWindowState(mainWindow);

    // 桌面歌词只在主窗口收起来（最小化、关到托盘）时出现
    const appVisible = () => mainWindow.isVisible() && !mainWindow.isMinimized();
    for (const event of ['show', 'hide', 'minimize', 'restore']) {
      mainWindow.on(event, () => desktopLyrics.setAppVisible(appVisible()));
    }

    // 系统切换深浅色时，系统按钮的颜色跟着变
    const onThemeChange = () => {
      if (mainWindow.isDestroyed()) return;
      if (!isMac) mainWindow.setTitleBarOverlay(titleBarOverlay());
      mainWindow.setBackgroundColor(themeColors().background);
    };
    nativeTheme.on('updated', onThemeChange);
    mainWindow.on('closed', () => nativeTheme.off('updated', onThemeChange));

    mainWindow.once('ready-to-show', () => mainWindow.show());
    // 页面载入好：告诉它桌面歌词现在开着没有
    mainWindow.webContents.on('did-finish-load', () =>
      sendToMain('lyristage:desktop-lyrics-state', desktopLyrics.state())
    );

    // 关窗口 = 缩到托盘，歌继续播；第一次提示一下
    mainWindow.on('close', event => {
      if (quitting || isMac) return;
      event.preventDefault();
      mainWindow.hide();
      if (!getSettings().trayHintShown) {
        updateSettings({ trayHintShown: true });
        tray?.displayBalloon(
          locale === 'en'
            ? {
                iconType: 'info',
                title: 'LyriStage is still playing',
                content: 'It is now in the tray. To quit, right-click the tray icon and choose Quit.',
              }
            : {
                iconType: 'info',
                title: 'LyriStage 还在播放',
                content: '窗口缩到右下角的托盘了。要完全关掉，在托盘图标按右键选「退出」。',
              }
        );
      }
    });

    // 页面里的外部链接用系统浏览器打开，不在 App 里开新窗口
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url);
      return { action: 'deny' };
    });
    // 主视窗只显示 App 自己的页面：被链接带去别的网站时，改用系统浏览器开
    const appOrigin = process.env.ELECTRON_RENDERER_URL
      ? new URL(process.env.ELECTRON_RENDERER_URL).origin
      : 'file://';
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(appOrigin)) return;
      event.preventDefault();
      openExternalSafely(url);
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  app.whenReady().then(() => {
    startApiServer(apiToken).catch(err => {
      console.error(`[LyriStage] 网易云 API 启动失败（端口 ${API_PORT}）`, err);
    });
    createWindow();

    tray = createTray({
      icon: trayIcon,
      onShow: focusWindow,
      onCommand: command => sendToMain('lyristage:command', command),
      onToggleLyrics: () => desktopLyrics.toggle(),
      onToggleLock: () => desktopLyrics.toggleLock(),
      onQuit: () => {
        quitting = true;
        app.quit();
      },
    });
    tray.setLocale(locale);
    desktopLyrics.restore();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
