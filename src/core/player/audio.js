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
 * @param {{ createFallback?: () => HTMLAudioElement }} [options]
 * @returns {AudioBackend & { element: HTMLAudioElement, useCors: boolean, reload: () => void }}
 */
export function createHtmlAudio(element = new Audio(), { createFallback = () => new Audio() } = {}) {
  // 平常不设 crossOrigin：设了以后音源都必须允许跨域。
  // 开了均衡器（audioEffects.js 把 useCors 设成 true）才以跨域方式载入，Web Audio 才处理得了声音。
  // 网易云、B 站的音源都允许（2026-10 实测）；遇到不允许的，那首歌改用一个没接均衡器的
  // 备用元素播放（接了均衡器的元素载入不允许跨域的音源会完全没声音），保证一定有声音。
  // 备用元素只在电脑版、Android 用得到（iPhone 不开均衡器，那里换元素会被挡自动播放）。
  /** @type {HTMLAudioElement | null} */
  let fallback = null;
  let active = element;
  /** @type {string | null} */
  let currentUrl = null;
  let switchingToFallback = false;

  // 音频还没加载出时长就跳转，部分浏览器（尤其 iOS Safari）会忽略，
  // 先记下来，等 loadedmetadata 再跳
  /** @type {number | null} */
  let pendingSeek = null;
  const applyPendingSeek = event => {
    if (event.target === active && pendingSeek !== null) {
      active.currentTime = pendingSeek;
      pendingSeek = null;
    }
  };

  /** @param {HTMLAudioElement} el */
  function prepare(el) {
    el.preload = 'auto';
    el.addEventListener('loadedmetadata', applyPendingSeek);
  }
  prepare(element);

  /** 播放器注册的监听：两个元素都挂，只有正在用的那个发出的才算 */
  /** @type {[string, (event: Event) => void][]} */
  const listeners = [];

  element.addEventListener('error', event => {
    const corsBlocked =
      element.crossOrigin !== null &&
      element.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED &&
      element.readyState === HTMLMediaElement.HAVE_NOTHING;
    if (!corsBlocked || !currentUrl || active !== element) return;
    // 这一次的失败不告诉播放器（这个监听比播放器的先注册），改用备用元素
    event.stopImmediatePropagation();
    if (!fallback) {
      fallback = createFallback();
      prepare(fallback);
      for (const [type, fn] of listeners) fallback.addEventListener(type, fn);
    }
    fallback.volume = element.volume;
    active = fallback;
    switchingToFallback = true;
    fallback.src = currentUrl;
    fallback.load();
  });

  return {
    element,
    useCors: false,
    load(url) {
      pendingSeek = null;
      currentUrl = url;
      switchingToFallback = false;
      if (active !== element) {
        active.pause();
        active.removeAttribute('src');
        active.load();
        active = element;
      }
      if (this.useCors) element.crossOrigin = 'anonymous';
      else element.removeAttribute('crossorigin');
      element.src = url;
      element.load();
    },
    async play() {
      try {
        await active.play();
      } catch (err) {
        // 快速切歌时，上一次 play() 会被新的 load() 打断，这是正常现象
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // 音源不允许跨域、刚换成备用元素：改播备用的
        if (switchingToFallback && active !== element) {
          switchingToFallback = false;
          return this.play();
        }
        throw err;
      }
    },
    /** 用现在的设定（useCors）重新载入同一首，从原来的位置接着播 */
    reload() {
      if (!currentUrl) return;
      const time = active.currentTime;
      const playing = !active.paused;
      this.load(currentUrl);
      this.seek(time);
      if (playing) this.play().catch(() => {});
    },
    pause: () => active.pause(),
    seek(seconds) {
      if (!Number.isFinite(seconds)) return;
      const target = Math.max(0, seconds);
      if (active.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingSeek = target;
      } else {
        active.currentTime = target;
      }
    },
    // 还没跳过去之前，回报"将要跳到的位置"，避免进度条先闪回 0
    currentTime: () => pendingSeek ?? active.currentTime,
    setVolume(volume) {
      const v = Math.min(1, Math.max(0, volume));
      element.volume = v;
      if (fallback) fallback.volume = v;
    },
    duration: () => active.duration,
    on(event, fn) {
      /** @param {Event} e */
      const guarded = e => {
        if (e.target === active) fn();
      };
      const entry = /** @type {[string, (event: Event) => void]} */ ([event, guarded]);
      listeners.push(entry);
      element.addEventListener(event, guarded);
      fallback?.addEventListener(event, guarded);
      return () => {
        listeners.splice(listeners.indexOf(entry), 1);
        element.removeEventListener(event, guarded);
        fallback?.removeEventListener(event, guarded);
      };
    },
    dispose() {
      for (const el of [element, fallback]) {
        if (!el) continue;
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    },
  };
}
