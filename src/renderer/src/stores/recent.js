// 最近播放（存在本机，不需要登录）：首页"继续播放"用
import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';
import { toSnapshot } from '@core/data';
import { player } from '../services';

const KEY = 'lyristage:recent';
const MAX = 20;

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export const useRecentStore = defineStore('recent', () => {
  const tracks = ref(load());

  player.on('track', track => {
    const snapshot = toSnapshot(track);
    tracks.value = [snapshot, ...tracks.value.filter(t => t.id !== track.id)].slice(0, MAX);
    try {
      localStorage.setItem(KEY, JSON.stringify(tracks.value));
    } catch {
      // 存不了就只在这次有效
    }
  });

  return { tracks };
});

// 开发时改了这个文件：直接换成新版本（不然页面会继续用旧的 store）
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useRecentStore, import.meta.hot));
