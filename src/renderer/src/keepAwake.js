// 看歌词时屏幕常亮（歌词画面开着、正在播放时；暂停或关掉歌词就恢复）
// - Android：WebView 不支持 Screen Wake Lock，用原生的 KeepAwakePlugin.java
// - iPhone / 网页版 / 电脑版：浏览器的 Screen Wake Lock（切到别的分页会自动放掉，回来再要一次）
import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './platform';

const Native = isNativeApp ? registerPlugin('KeepAwake') : null;
// 页面重新载入时 Android 的视窗还是同一个：上次开着的常亮要先关掉，不然会一直亮着
Native?.allowSleep().catch(() => {});

let wanted = false;
/** @type {WakeLockSentinel | null} */
let lock = null;

async function requestWebLock() {
  try {
    lock = (await navigator.wakeLock?.request('screen')) ?? null;
    lock?.addEventListener('release', () => (lock = null));
  } catch {
    // 不支持、省电模式、页面没在前面：就不常亮
  }
}

if (!Native) {
  document.addEventListener('visibilitychange', () => {
    if (wanted && !lock && document.visibilityState === 'visible') requestWebLock();
  });
}

/** @param {boolean} on */
export async function setKeepAwake(on) {
  if (on === wanted) return;
  wanted = on;
  if (Native) {
    try {
      await (on ? Native.keepAwake() : Native.allowSleep());
    } catch {
      // 旧版 App 没有这个功能
    }
    return;
  }
  if (on) await requestWebLock();
  else {
    const current = lock;
    lock = null;
    await current?.release().catch(() => {});
  }
}
