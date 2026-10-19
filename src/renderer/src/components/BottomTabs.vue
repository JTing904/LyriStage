<script setup>
// 手机版底部的 Tab
import Icon from './Icon.vue';

const TABS = [
  { to: '/', icon: 'home', label: '首页' },
  { to: '/search', icon: 'search', label: '搜索' },
  { to: '/library', icon: 'library', label: '音乐库' },
];
</script>

<template>
  <nav class="tabs" aria-label="主导航">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.to"
      :to="tab.to"
      class="tab"
      active-class=""
      exact-active-class="active"
    >
      <Icon :name="tab.icon" />
      <span>{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  height: calc(60px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--sidebar);
  border-top: 1px solid var(--line);
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-dim);
}
.tab.active {
  color: var(--text);
  font-weight: 700;
}
</style>
