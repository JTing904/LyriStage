import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { isElectron } from './platform';
import { i18nPlugin } from './i18n';
import './styles/base.css';

createApp(App).use(createPinia()).use(router).use(i18nPlugin).mount('#app');

// 电脑版：托盘控制、桌面歌词
if (isElectron) import('./desktop').then(m => m.connectDesktop(window.lyristage));
