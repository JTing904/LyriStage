import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { isElectron } from './platform';
import { i18nPlugin } from './i18n';
import { installErrorReporting } from './errorReporter';
import { useAuthStore } from './stores/auth';
import './styles/base.css';

const pinia = createPinia();
const app = createApp(App).use(pinia).use(router).use(i18nPlugin);
// 出错时自动记一笔给管理员（只有成员会回报）
installErrorReporting(app, () => useAuthStore(pinia).allowed);
app.mount('#app');

// 手机 App：关着也收得到好友回应、好友邀请、敲门的通知
import('./push').then(m => m.startPush(pinia));

// 电脑版：托盘控制、桌面歌词
if (isElectron) import('./desktop').then(m => m.connectDesktop(window.lyristage));
