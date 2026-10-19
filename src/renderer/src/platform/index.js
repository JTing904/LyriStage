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
