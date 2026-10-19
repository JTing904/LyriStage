<script setup>
// 电脑版左边的侧边栏：Logo、主导航、我的歌单、账号
import Icon from './Icon.vue';
import Cover from './Cover.vue';
import { useAuthStore } from '../stores/auth';
import { useLibraryStore } from '../stores/library';
import { useRoomStore } from '../stores/room';

const auth = useAuthStore();
const library = useLibraryStore();
const room = useRoomStore();

const NAV = [
  { to: '/', icon: 'home', label: '首页' },
  { to: '/search', icon: 'search', label: '搜索' },
  { to: '/library', icon: 'library', label: '我的音乐库' },
  { to: '/room', icon: 'users', label: '一起听' },
];
</script>

<template>
  <nav class="sidebar" aria-label="主导航">
    <RouterLink to="/" class="logo display">Lyri<span>Stage</span></RouterLink>

    <div class="nav">
      <RouterLink
        v-for="item in NAV"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        active-class=""
        exact-active-class="active"
      >
        <Icon :name="item.icon" />{{ item.label }}
        <!-- 在房间里：显示几个人在一起听 -->
        <span v-if="item.to === '/room' && room.inRoom" class="live">{{ room.members.length }} 人</span>
      </RouterLink>
    </div>

    <div v-if="auth.allowed" class="mine">
      <div class="mine-head">
        <span>我的歌单</span>
        <RouterLink to="/library" class="mine-all" title="全部">全部</RouterLink>
      </div>
      <RouterLink to="/liked" class="mine-item" active-class="active">
        <span class="mine-icon liked"><Icon name="heart-fill" :size="16" /></span>
        我喜欢的音乐
      </RouterLink>
      <RouterLink
        v-for="p in library.playlists"
        :key="p.id"
        :to="`/my/${p.id}`"
        class="mine-item"
        active-class="active"
      >
        <span class="mine-icon">{{ p.name.slice(0, 1) }}</span>
        <span class="mine-name">{{ p.name }}</span>
      </RouterLink>
    </div>

    <div class="spacer" />

    <RouterLink v-if="auth.loggedIn" to="/settings" class="account">
      <Cover
        v-if="auth.avatarUrl"
        class="avatar"
        :url="auth.avatarUrl"
        :size="36"
        round
      />
      <span v-else class="avatar initial">{{ auth.displayName.slice(0, 1).toUpperCase() }}</span>
      <span class="who">
        <strong>{{ auth.displayName }}</strong>
        <span>{{ auth.providerLabel }}</span>
      </span>
      <Icon name="settings" :size="18" class="gear" />
    </RouterLink>
    <div v-else-if="auth.ready" class="account guest">
      <span class="who">
        <strong>还没登录</strong>
        <span>登录后才能听歌、收藏</span>
      </span>
      <RouterLink to="/login" class="login">登录</RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 24px 16px;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}
.logo {
  padding: 0 12px;
  font-size: 26px;
  letter-spacing: 0.02em;
}
.logo span {
  color: var(--accent);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  color: var(--text-dim);
  font-weight: 500;
}
.nav-item:hover {
  color: var(--text);
  background: var(--surface-hover);
}
.nav-item.active {
  color: var(--text);
  background: var(--surface-hover);
  font-weight: 700;
}
.live {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 700;
}
.mine {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}
.mine-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.mine-all {
  letter-spacing: 0;
}
.mine-all:hover {
  color: var(--text);
}
.mine-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 7px 12px;
  border-radius: 10px;
  font-size: 14px;
  color: var(--text-dim);
}
.mine-item:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.mine-item.active {
  background: var(--surface-hover);
  color: var(--text);
  font-weight: 700;
}
.mine-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--surface-hover);
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
}
.mine-icon.liked {
  background: linear-gradient(135deg, #ff3b5c, #7b2ff7);
  color: #fff;
}
.mine-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}

.account {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--surface-hover);
}
.avatar {
  width: 36px;
  height: 36px;
}
.initial {
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  color: #fff;
  font-weight: 700;
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
}
.who strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.who span {
  color: var(--text-dim);
}
.gear {
  margin-left: auto;
  color: var(--text-dim);
}
.guest {
  flex-wrap: wrap;
}
.login {
  margin-left: auto;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 13px;
  font-weight: 700;
}
</style>
