// 画面下方的小提示（加到歌单了、出错了…），可以带一个按钮（例如"搜索其他版本"）
import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';
import { t } from '../i18n';

/** 「复原」停多久（下面一条细线显示还剩多久） */
const UNDO_MS = 6000;

export const useNoticeStore = defineStore('notice', () => {
  /** @type {import('vue').Ref<{ id: number, message: string, action?: { label: string, run: () => void }, countdown?: number } | null>} */
  const current = ref(null);
  let timer = 0;
  let seq = 0;

  /**
   * @param {string} message
   * @param {{ action?: { label: string, run: () => void }, duration?: number, countdown?: boolean }} [options]
   *   有按钮的停久一点，让人来得及按；countdown：下面画一条细线显示还剩多久
   */
  function show(message, { action, duration, countdown = false } = {}) {
    clearTimeout(timer);
    const ms = duration ?? (action ? 6000 : 2600);
    current.value = { id: ++seq, message, action, countdown: countdown ? ms : 0 };
    timer = setTimeout(() => (current.value = null), ms);
  }

  /**
   * 移除、取消喜欢、清空之后：「已移除《x》 复原」
   * @param {string} message
   * @param {() => void | Promise<void>} restore
   */
  function undo(message, restore) {
    show(message, { action: { label: t('复原'), run: restore }, duration: UNDO_MS, countdown: true });
  }

  function dismiss() {
    clearTimeout(timer);
    current.value = null;
  }

  return { current, show, undo, dismiss };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useNoticeStore, import.meta.hot));
