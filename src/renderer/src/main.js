import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { isElectron } from './platform';
import './styles/base.css';

createApp(App).use(createPinia()).use(router).mount('#app');

// 电脑版：托盘控制、桌面歌词
if (isElectron) import('./desktop').then(m => m.connectDesktop(window.lyristage));
