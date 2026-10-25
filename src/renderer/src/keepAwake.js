// 看歌词时屏幕常亮（歌词画面开着、正在播放时；暂停或关掉歌词就恢复）
// - Android：WebView 不支持 Screen Wake Lock，用原生的 KeepAwakePlugin.java
// - iPhone / 网页版 / 电脑版：浏览器的 Screen Wake Lock（切到别的分页会自动放掉，回来再要一次）
// 全屏歌词和一起听房间里的歌词可能同时开着：各自说要不要，只要还有一个要就亮着
import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './platform';

const Native = isNativeApp ? registerPlugin('KeepAwake') : null;
// 页面重新载入时 Android 的视窗还是同一个：上次开着的常亮要先关掉，不然会一直亮着
Native?.allowSleep().catch(() => {});

/** 现在要常亮的（每个歌词画面一个） */
const holders = new Set();
let applied = false;
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
    if (applied && !lock && document.visibilityState === 'visible') requestWebLock();
  });
}

async function apply() {
  const on = holders.size > 0;
  if (on === applied) return;
  applied = on;
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

/**
 * @param {object} who 要常亮的是谁（每个歌词画面传自己的 key）
 * @param {boolean} on
 */
export function setKeepAwake(who, on) {
  if (on) holders.add(who);
  else holders.delete(who);
  return apply();
}
