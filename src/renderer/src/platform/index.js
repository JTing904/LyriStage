// 唯一知道"现在跑在电脑版还是网页版"的地方，其他代码只从这里拿配置。
// 电脑版的 window.lyristage 由 src/preload/index.js 提供。
const bridge = window.lyristage;

export const isElectron = Boolean(bridge?.isElectron);

/** 'win32' | 'darwin' | 'linux' | 'web' */
export const platform = bridge?.platform ?? 'web';

/**
 * 网易云 API 地址：
 * - 电脑版：主进程在本机启动的 API
 * - 网页版：同源的 /api（开发时由 Vite 代理，部署后由 Vercel rewrite 转发）
 */
export const apiBase = isElectron
  ? bridge.apiBase
  : import.meta.env.VITE_API_BASE || '/api';

/**
 * 电脑版：让窗口（系统按钮颜色、窗口底色）跟着 App 的主题切换；网页版不需要
 * @param {'system' | 'dark' | 'light'} mode
 */
export function setNativeTheme(mode) {
  bridge?.setTheme?.(mode);
}

/**
 * 电脑版：GitHub / Google 在系统浏览器授权完，会打开 lyristage://auth/callback?code=…，
 * 主进程把这个网址转过来。网页版没有这回事（直接跳回网页）
 * @param {(url: string) => void} callback
 */
export function onAuthCallback(callback) {
  bridge?.onAuthCallback?.(callback);
}
