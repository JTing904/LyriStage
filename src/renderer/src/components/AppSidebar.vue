<script setup>
// 电脑版左边的侧边栏：Logo、主导航、我的歌单、账号
import Icon from './Icon.vue';
import Cover from './Cover.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

const NAV = [
  { to: '/', icon: 'home', label: '首页' },
  { to: '/search', icon: 'search', label: '搜索' },
  { to: '/library', icon: 'library', label: '我的音乐库' },
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
        <span>登录后可以收藏、建歌单</span>
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
