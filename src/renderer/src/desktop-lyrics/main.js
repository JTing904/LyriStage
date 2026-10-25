// 桌面歌词窗口的入口（electron.vite.config.mjs 的 renderer 第二个页面）
import { createApp } from 'vue';
import DesktopLyrics from './DesktopLyrics.vue';

createApp(DesktopLyrics).mount('#app');
