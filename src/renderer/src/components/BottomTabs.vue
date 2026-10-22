<script setup>
// 手机版底部的 Tab
import Icon from './Icon.vue';

const TABS = [
  { to: '/', icon: 'home', label: '首页' },
  { to: '/search', icon: 'search', label: '搜索' },
  { to: '/library', icon: 'library', label: '音乐库' },
  { to: '/room', icon: 'users', label: '一起听' },
];
</script>

<template>
  <nav class="tabs" :aria-label="$t('主导航')">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.to"
      :to="tab.to"
      class="tab"
      active-class=""
      exact-active-class="active"
    >
      <Icon :name="tab.icon" />
      <span>{{ $t(tab.label) }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
  min-width: 0;
  padding: 0 2px;
  font-size: 11px;
  white-space: nowrap;
  color: var(--text-dim);
}
.tab.active {
  color: var(--text);
  font-weight: 700;
}
/* 手机横屏：变成左边一条直的（App.vue 把它放到左边） */
@media (pointer: coarse) and (max-height: 600px) and (orientation: landscape) {
  .tabs {
    grid-template-columns: none;
    grid-auto-rows: 60px;
    align-content: center;
    width: 76px;
    height: auto;
    padding-bottom: 0;
    border-top: 0;
    border-right: 1px solid var(--line);
  }
}
</style>
