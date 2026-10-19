// @ts-check
// 音频后端：包装一个长期存在的 <audio> 元素。
// 整个 App 只用这一个元素，每次只换 src —— 手机浏览器（尤其 iOS）对"用户点过一次之后
// 才能自动播放"的限制是绑定在元素上的，一直用同一个元素才能顺利切歌和后台播放。
// v1 用的 Howler 每首歌新建一个音频对象，这里不再使用。

/**
 * 播放器需要的音频接口；测试时用假的实现
 * @typedef {object} AudioBackend
 * @property {(url: string) => void} load
 * @property {() => Promise<void>} play
 * @property {() => void} pause
 * @property {(seconds: number) => void} seek
 * @property {(volume: number) => void} setVolume 0 到 1
 * @property {() => number} currentTime 秒
 * @property {() => number} duration 秒（未知时是 NaN）
 * @property {(event: 'timeupdate' | 'ended' | 'playing' | 'pause' | 'waiting' | 'error' | 'loadedmetadata', fn: () => void) => () => void} on
 * @property {() => void} [dispose] 停止并释放（开发时热更新会建新的播放器，旧的要停掉）
 */

/**
 * @param {HTMLAudioElement} [element]
 * @returns {AudioBackend}
 */
export function createHtmlAudio(element = new Audio()) {
  element.preload = 'auto';
  // 不设 crossOrigin：设了以后所有音源都必须允许跨域，解灰找到的其他平台音源不一定允许。
  // 以后要做频谱（Web Audio）时再针对网易云的音源单独开启。

  // 音频还没加载出时长就跳转，部分浏览器（尤其 iOS Safari）会忽略，
  // 先记下来，等 loadedmetadata 再跳
  /** @type {number | null} */
  let pendingSeek = null;
  element.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) {
      element.currentTime = pendingSeek;
      pendingSeek = null;
    }
  });

  return {
    load(url) {
      pendingSeek = null;
      element.src = url;
      element.load();
    },
    async play() {
      try {
        await element.play();
      } catch (err) {
        // 快速切歌时，上一次 play() 会被新的 load() 打断，这是正常现象
        if (err instanceof DOMException && err.name === 'AbortError') return;
        throw err;
      }
    },
    pause: () => element.pause(),
    seek(seconds) {
      if (!Number.isFinite(seconds)) return;
      const target = Math.max(0, seconds);
      if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingSeek = target;
      } else {
        element.currentTime = target;
      }
    },
    // 还没跳过去之前，回报"将要跳到的位置"，避免进度条先闪回 0
    currentTime: () => pendingSeek ?? element.currentTime,
    setVolume(volume) {
      element.volume = Math.min(1, Math.max(0, volume));
    },
    duration: () => element.duration,
    on(event, fn) {
      element.addEventListener(event, fn);
      return () => element.removeEventListener(event, fn);
    },
    dispose() {
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
  };
}
