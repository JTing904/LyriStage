// 下拉刷新（手机）：在页面最上面往下拉、放手就重新读这一页的资料
// - 页面用 onPullRefresh(fn) 说要怎么刷新；没说的页面拉了没反应
// - App.vue 用 attachPullRefresh() 接在会滚动的 <main> 上，画最上面那个转圈圈
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

/** 拉多远（px）放手才刷新 */
export const PULL_TRIGGER = 72;
const PULL_MAX = 120;
/** 转圈圈至少显示多久，太快一闪而过反而像没反应 */
const MIN_SPIN_MS = 600;

/** @type {import('vue').ShallowRef<(() => Promise<unknown> | unknown) | null>} */
const handler = shallowRef(null);

/**
 * 页面里叫：这一页可以下拉刷新
 * @param {() => Promise<unknown> | unknown} fn
 */
export function onPullRefresh(fn) {
  onMounted(() => (handler.value = fn));
  onBeforeUnmount(() => {
    if (handler.value === fn) handler.value = null;
  });
}

/**
 * App.vue 用：手指在 el 最上面往下拉
 * @param {import('vue').Ref<HTMLElement | null>} elRef
 */
export function attachPullRefresh(elRef) {
  /** 现在拉了多远（px） */
  const distance = ref(0);
  const refreshing = ref(false);
  let startY = null;

  function onStart(event) {
    const el = elRef.value;
    if (!handler.value || refreshing.value || !el || el.scrollTop > 0 || event.touches.length > 1) return;
    startY = event.touches[0].clientY;
  }
  function onMove(event) {
    if (startY === null) return;
    const dy = event.touches[0].clientY - startY;
    // 往上滑、或页面已经往下滚了：不是下拉
    if (dy <= 0 || (elRef.value?.scrollTop ?? 0) > 0) {
      distance.value = 0;
      return;
    }
    // 越拉越紧
    distance.value = Math.min(PULL_MAX, dy * 0.5);
  }
  async function onEnd() {
    if (startY === null) return;
    startY = null;
    const run = handler.value;
    if (distance.value < PULL_TRIGGER || !run) {
      distance.value = 0;
      return;
    }
    refreshing.value = true;
    distance.value = PULL_TRIGGER;
    navigator.vibrate?.(10);
    const started = Date.now();
    try {
      await run();
    } catch {
      // 页面自己会显示错误
    } finally {
      const wait = MIN_SPIN_MS - (Date.now() - started);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      refreshing.value = false;
      distance.value = 0;
    }
  }

  const listen = el => {
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
  };
  const unlisten = el => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd);
    el.removeEventListener('touchcancel', onEnd);
  };
  // <main> 可能比 App 晚出现（从登录页进来）：出现时才接上
  watch(
    elRef,
    (el, old) => {
      if (old) unlisten(old);
      if (el) listen(el);
    },
    { immediate: true, flush: 'post' }
  );
  onBeforeUnmount(() => elRef.value && unlisten(elRef.value));

  return { distance, refreshing, enabled: handler };
}
