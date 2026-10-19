// 页面路由（hash 模式：电脑版用 file:// / app:// 加载，网页版部署也不用另外设置改写规则）
import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue') },
    { path: '/library', name: 'library', component: () => import('./views/LibraryView.vue') },
    { path: '/liked', name: 'liked', component: () => import('./views/LikedView.vue') },
    { path: '/daily', name: 'daily', component: () => import('./views/DailyView.vue') },
    { path: '/playlist/:id', name: 'playlist', component: () => import('./views/PlaylistView.vue') },
    { path: '/album/:id', name: 'album', component: () => import('./views/AlbumView.vue') },
    { path: '/artist/:id', name: 'artist', component: () => import('./views/ArtistView.vue') },
    { path: '/my/:id', name: 'my-playlist', component: () => import('./views/MyPlaylistView.vue') },
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      // public：不用登录也能看；bare：不显示侧边栏和播放条
      meta: { public: true, bare: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

/** 登录后要回到的页面（只接受站内路径） */
export function redirectTarget(route) {
  const target = route.query.redirect;
  return typeof target === 'string' && target.startsWith('/') ? target : '/';
}

// 邀请制：没登录、或登录了但还没兑换邀请码，只能看到登录页
router.beforeEach(async to => {
  const auth = useAuthStore();
  await auth.whenReady();
  if (to.meta.public) {
    return to.name === 'login' && auth.allowed ? redirectTarget(to) : true;
  }
  if (auth.allowed) return true;
  return {
    name: 'login',
    query: to.fullPath === '/' ? {} : { redirect: to.fullPath },
  };
});
