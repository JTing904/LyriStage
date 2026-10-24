// 唯一知道"现在跑在电脑版、手机 App 还是网页版"的地方，其他代码只从这里拿配置。
// 电脑版的 window.lyristage 由 src/preload/index.js 提供；
// 手机 App（Capacitor 打包的 Android）由 Capacitor 注入 window.Capacitor。
const bridge = window.lyristage;

export const isElectron = Boolean(bridge?.isElectron);

/** Android App（Capacitor） */
export const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());

/** 'win32' | 'darwin' | 'linux' | 'android' | 'web' */
export const platform =
  bridge?.platform ?? (isNativeApp ? window.Capacitor.getPlatform() : 'web');

/**
 * 网易云 API 地址：
 * - 电脑版：主进程在本机启动的 API
 * - 手机 App：Vercel 上的 API（.env.app 的 VITE_API_BASE）
 * - 网页版：同源的 /api（开发时由 Vite 代理，部署后由 Vercel rewrite 转发）
 */
export const apiBase = isElectron
  ? bridge.apiBase
  : import.meta.env.VITE_API_BASE || '/api';

/**
 * 歌词英文翻译的 API（server/lib/translate.js）：翻译的密钥只在 Vercel 上，
 * 电脑版本机的 API 没有，所以电脑版也直接连 Vercel
 */
export const translateApiBase = isElectron ? 'https://lyristage-api.vercel.app' : apiBase;

/** 电脑版请求本机 API 要带的通行证 header（其他平台是空的） */
export const localApiHeaders = bridge?.apiHeaders ?? {};

/**
 * 手机横屏：宽度可能超过 900px（会被当成电脑），但矮、用手指点。
 * CSS 里对应的写法见 styles/base.css 的说明
 */
export const PHONE_LANDSCAPE_QUERY =
  '(pointer: coarse) and (orientation: landscape) and (max-height: 600px)';

/**
 * 手机 App：状态栏、导航列的图标颜色。darkBackground=true 用白色图标。
 * 一直用白色图标的话，浅色页面上 Android 会自动垫一层深色底，顶部变成一条咖啡色
 */
export async function setSystemBarsStyle(darkBackground) {
  if (!isNativeApp) return;
  const { SystemBars, SystemBarsStyle } = await import('@capacitor/core');
  await SystemBars.setStyle({
    style: darkBackground ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  }).catch(() => {});
}

/** 手机 App：藏起 / 叫回状态栏和导航列（横屏看歌词时全屏）。其他平台什么都不做 */
export async function setSystemBarsHidden(hidden) {
  if (!isNativeApp) return;
  const { SystemBars } = await import('@capacitor/core');
  await (hidden ? SystemBars.hide() : SystemBars.show()).catch(() => {});
}

/**
 * 电脑版：让窗口（系统按钮颜色、窗口底色）跟着 App 的主题切换；网页版不需要
 * @param {'system' | 'dark' | 'light'} mode
 */
export function setNativeTheme(mode) {
  bridge?.setTheme?.(mode);
}

/** 电脑版：打开 / 关掉桌面歌词 */
export function setDesktopLyrics(enabled) {
  bridge?.setDesktopLyrics?.(enabled);
}

/** 电脑版：锁定桌面歌词（鼠标穿透） */
export function setDesktopLyricsLocked(locked) {
  bridge?.setDesktopLyricsLocked?.(locked);
}

/**
 * 第三方登录（GitHub / Google）授权完会打开 lyristage://auth/callback?code=…，回到 App：
 * - 电脑版：主进程收到网址后转过来
 * - 手机 App：Android 把网址交给 App（AndroidManifest 里登记了 lyristage://）
 * 网页版没有这回事（直接跳回网页）
 * @param {(url: string) => void} callback
 */
export function onAuthCallback(callback) {
  if (isElectron) {
    bridge.onAuthCallback?.(callback);
  } else if (isNativeApp) {
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appUrlOpen', async ({ url }) => {
        if (!url?.startsWith('lyristage://auth/callback')) return;
        const { Browser } = await import('@capacitor/browser');
        Browser.close().catch(() => {});
        callback(url);
      });
    });
  }
}

/**
 * 手机 App：在 WhatsApp 等地方点了 https://lyristage.vercel.app/#/… 的链接（例如一起听的邀请），
 * 装了 App 的会直接在 App 打开（AndroidManifest 的 App Links + 网站上的 .well-known/assetlinks.json）：
 * 把链接里 # 后面那一页交给 callback。App 关着时是用这个链接打开的，也要接着去那一页
 * @param {(path: string) => void} callback 例如 '/room?code=ABC123'
 */
export function onAppLink(callback) {
  if (!isNativeApp) return;
  const open = url => {
    try {
      const { host, hash } = new URL(url);
      if (host === 'lyristage.vercel.app' && hash.startsWith('#/')) callback(hash.slice(1));
    } catch {
      // 不是网址
    }
  };
  import('@capacitor/app').then(async ({ App }) => {
    App.addListener('appUrlOpen', ({ url }) => open(url));
    // 打开 App 的那条链接：页面重新载入后还会拿到同一条，只处理一次（不然又跳回邀请的房间）
    const launch = (await App.getLaunchUrl())?.url ?? '';
    const KEY = 'lyristage:launch-url';
    try {
      if (!launch || sessionStorage.getItem(KEY) === launch) return;
      sessionStorage.setItem(KEY, launch);
    } catch {
      // 存不了就照样打开
    }
    open(launch);
  });
}

/**
 * Android 返回键（其他平台没有这个键，不会触发）。
 * handler 回传 true = 已经处理了（例如关掉了歌词舞台）；
 * 回传 false 就照一般的返回：页面能后退就后退，不能就把 App 收到背景（音乐继续播）
 * @param {() => boolean} handler
 */
export function onBackButton(handler) {
  if (!isNativeApp) return;
  import('@capacitor/app').then(({ App }) => {
    App.addListener('backButton', ({ canGoBack }) => {
      if (handler()) return;
      if (canGoBack) window.history.back();
      else App.minimizeApp();
    });
  });
}

/**
 * 用系统浏览器打开登录授权页（不在 App 里面登录，比较安全，也能用浏览器记住的 GitHub 登录）
 * @param {string} url
 */
export async function openAuthPage(url) {
  if (isNativeApp) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else if (isElectron) {
    // 主进程把 window.open 的 https 网址交给系统浏览器
    window.open(url, '_blank');
  } else {
    location.assign(url);
  }
}

// ---- 分享 / 存图片（歌词卡片、听歌报告） ----------------------------------------

const blobToBase64 = blob =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** 能不能叫出系统的分享（手机 App、支持分享图片的手机浏览器） */
export function canShareImage() {
  if (isNativeApp) return true;
  try {
    const file = new File([new Blob()], 'x.png', { type: 'image/png' });
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

/** 系统分享（IG、WhatsApp…） */
export async function shareImage(blob, fileName) {
  if (isNativeApp) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const { uri } = await Filesystem.writeFile({
      path: fileName,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    await Share.share({ files: [uri] });
    return;
  }
  await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })] });
}

/**
 * 分享一句话和链接（邀请好友、房间、共同歌单）：手机叫出系统分享（WhatsApp…），
 * 电脑没有分享面板就复制到剪贴板
 * @param {{ title: string, text: string, url: string }} content
 * @returns {Promise<'shared' | 'copied' | 'cancelled'>}
 */
export async function shareLink({ title, text, url }) {
  if (isNativeApp) {
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({ title, text, url, dialogTitle: title });
      return 'shared';
    } catch (err) {
      if (/cancel/i.test(err?.message ?? '')) return 'cancelled';
      throw err;
    }
  }
  // 手机浏览器：系统分享；电脑浏览器的分享面板很少人用，直接复制比较顺
  if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(`${text} ${url}`);
  return 'copied';
}

/** 能不能复制图片到剪贴板（电脑版、电脑浏览器） */
export const canCopyImage = () =>
  !isNativeApp && typeof ClipboardItem !== 'undefined' && Boolean(navigator.clipboard?.write);

export async function copyImage(blob) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** 存成文件：电脑版会问存到哪里；网页版下载；手机 App 用分享（可以选"存到相册 / 文件"） */
export async function saveImage(blob, fileName) {
  if (isNativeApp) return shareImage(blob, fileName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---- 手机 App：有没有新版本 ---------------------------------------------------------
// 电脑版会自动更新；Android 装的是 APK，只能提示用户去下载。
// 不提示的话，像 2.1.1 那样服务器换了做法、旧版不能用时，用户根本不知道要更新

const LATEST_RELEASE_API = 'https://api.github.com/repos/JTing904/LyriStage/releases/latest';
const RELEASES_PAGE = 'https://github.com/JTing904/LyriStage/releases/latest';
const UPDATE_CHECKED_KEY = 'lyristage:update-checked';
/** GitHub 没登录每小时只能问 60 次，没必要每次打开都问 */
const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Android：GitHub 上有比现在装的新的版本，就回传 { version, url }（APK 的下载网址）；
 * 没有、不是 Android、刚问过、网络出错都回传 null
 */
export async function findAndroidUpdate() {
  if (!isNativeApp) return null;
  try {
    const last = Number(localStorage.getItem(UPDATE_CHECKED_KEY));
    if (Date.now() - last < UPDATE_CHECK_EVERY_MS) return null;
    const [{ App }, { isNewerVersion }] = await Promise.all([
      import('@capacitor/app'),
      import('@core/version'),
    ]);
    const { version: current } = await App.getInfo();
    const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    localStorage.setItem(UPDATE_CHECKED_KEY, String(Date.now()));
    const release = await res.json();
    if (!isNewerVersion(release.tag_name, current)) return null;
    const apk = release.assets?.find(asset => asset.name?.endsWith('.apk'));
    return {
      version: String(release.tag_name).replace(/^v/i, ''),
      url: apk?.browser_download_url ?? RELEASES_PAGE,
    };
  } catch {
    return null;
  }
}

/**
 * Android App 里直接更新：下载 APK、打开系统的安装画面
 * @param {string} url GitHub Release 上 APK 的下载网址
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<'installing' | 'needs-permission'>} needs-permission：第一次要先允许 LyriStage 安装 App（已经打开那个设定）
 */
export async function installAndroidUpdate(url, onProgress) {
  const { registerPlugin } = await import('@capacitor/core');
  const updater = registerPlugin('AppUpdater');
  const listener = await updater.addListener('progress', ({ percent }) => onProgress?.(percent));
  try {
    const { status } = await updater.downloadAndInstall({ url });
    return status;
  } finally {
    listener.remove();
  }
}

/** 用系统浏览器打开网址（下载 APK） */
export async function openInBrowser(url) {
  if (isNativeApp) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

// ---- 电脑版自动更新 ---------------------------------------------------------------

/** 新版本下载好了（只有电脑版安装版会触发） */
export function onUpdateReady(callback) {
  bridge?.onUpdateReady?.(callback);
}
/** @returns {Promise<{ status: string, version?: string, current?: string } | null>} */
export const updateStatus = () => bridge?.updateStatus?.() ?? Promise.resolve(null);
export const checkForUpdates = () => bridge?.checkForUpdates?.() ?? Promise.resolve(null);
export const installUpdate = () => bridge?.installUpdate?.();
