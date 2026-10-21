// 全局的界面状态：播放队列面板开关（播放条、迷你播放条、歌词舞台都能打开）、手机返回列的标题
import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const queueOpen = ref(false);
  /** 手机：子页面的名字（页头滑出画面后，顶部的返回列显示它） */
  const pageTitle = ref('');
  return { queueOpen, pageTitle };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
