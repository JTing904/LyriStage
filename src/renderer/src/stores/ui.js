// 全局的面板开关（播放队列面板），播放条、迷你播放条、歌词舞台都能打开
import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const queueOpen = ref(false);
  return { queueOpen };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
