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

/** 电脑版请求本机 API 要带的通行证 header（其他平台是空的） */
export const localApiHeaders = bridge?.apiHeaders ?? {};

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
