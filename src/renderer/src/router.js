// 页面路由（hash 模式：电脑版用 file:// / app:// 加载，网页版部署也不用另外设置改写规则）
import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue') },
    { path: '/library', name: 'library', component: () => import('./views/LibraryView.vue'), meta: { member: true } },
    { path: '/liked', name: 'liked', component: () => import('./views/LikedView.vue'), meta: { member: true } },
    { path: '/offline', name: 'offline', component: () => import('./views/OfflineView.vue') },
    { path: '/daily', name: 'daily', component: () => import('./views/DailyView.vue'), meta: { member: true } },
    { path: '/playlist/:id', name: 'playlist', component: () => import('./views/PlaylistView.vue') },
    { path: '/album/:id', name: 'album', component: () => import('./views/AlbumView.vue') },
    { path: '/artist/:id', name: 'artist', component: () => import('./views/ArtistView.vue') },
    { path: '/my/:id', name: 'my-playlist', component: () => import('./views/MyPlaylistView.vue'), meta: { member: true } },
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      // bare：不显示侧边栏和播放条
      meta: { bare: true },
    },
    { path: '/report', name: 'report', component: () => import('./views/ReportView.vue'), meta: { member: true } },
    // 邀请链接（管理员在设置里分享）：到注册、帮他填好邀请码
    { path: '/invite/:code', redirect: to => ({ path: '/login', query: { invite: to.params.code } }) },
    { path: '/join/:code', name: 'join-playlist', component: () => import('./views/JoinPlaylistView.vue'), meta: { member: true } },
    { path: '/friends', name: 'friends', component: () => import('./views/FriendsView.vue'), meta: { member: true } },
    { path: '/room', name: 'room', component: () => import('./views/RoomView.vue'), meta: { member: true } },
    // 没登录也能进（换主题、换语言、看版本）；要登录的类别在页面里藏起来
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

/** 登录后要回到的页面（只接受站内路径） */
export function redirectTarget(route) {
  const target = route.query.redirect;
  return typeof target === 'string' && target.startsWith('/') ? target : '/';
}

// 没登录也能逛（首页、搜索、歌单、专辑、歌手），听歌和个人的页面（meta.member）要登录而且是成员
router.beforeEach(async to => {
  // 不用登录的页面（首页、搜索、歌单…）直接进去，不等登录状态和成员检查
  if (!to.meta.member && to.name !== 'login') return true;
  const auth = useAuthStore();
  await auth.whenReady();
  if (to.name === 'login') return auth.allowed ? redirectTarget(to) : true;
  if (!to.meta.member || auth.allowed) return true;
  return { name: 'login', query: { redirect: to.fullPath } };
});
