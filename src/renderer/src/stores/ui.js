// 全局的界面状态：播放队列面板、海报墙开关（播放条、迷你播放条、歌词舞台都能打开）、手机返回列的标题
import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const queueOpen = ref(false);
  /** 海报墙（播放队列排成封面墙，从播放队列面板打开） */
  const wallOpen = ref(false);
  /** 手机：子页面的名字（页头滑出画面后，顶部的返回列显示它） */
  const pageTitle = ref('');
  /** 全屏歌词（播放条、迷你播放条、一起听的房间都能打开） */
  const stageOpen = ref(false);
  /** 一起听的成员在歌单里点了歌：问要点给房主还是离开房间自己播（GuestPlaySheet）。{ track, replay } */
  const guestPick = ref(null);
  return { queueOpen, wallOpen, pageTitle, stageOpen, guestPick };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useUiStore, import.meta.hot));
