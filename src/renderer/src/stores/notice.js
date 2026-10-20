// 画面下方的小提示（加到歌单了、出错了…），可以带一个按钮（例如"搜索其他版本"）
import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';

export const useNoticeStore = defineStore('notice', () => {
  /** @type {import('vue').Ref<{ message: string, action?: { label: string, run: () => void } } | null>} */
  const current = ref(null);
  let timer = 0;

  /**
   * @param {string} message
   * @param {{ action?: { label: string, run: () => void } }} [options] 有按钮的停久一点，让人来得及按
   */
  function show(message, { action } = {}) {
    clearTimeout(timer);
    current.value = { message, action };
    timer = setTimeout(() => (current.value = null), action ? 6000 : 2600);
  }

  function dismiss() {
    clearTimeout(timer);
    current.value = null;
  }

  return { current, show, dismiss };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useNoticeStore, import.meta.hot));
