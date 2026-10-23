<script setup>
// 手机版底部的 Tab
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Icon from './Icon.vue';
import { useFriendsStore } from '../stores/friends';
import { locale } from '../i18n';

const friendsStore = useFriendsStore();
const route = useRoute();

const TABS = [
  { to: '/', icon: 'home', label: '首页' },
  { to: '/search', icon: 'search', label: '搜索' },
  { to: '/friends', icon: 'friends', label: '好友' },
  { to: '/library', icon: 'library', label: '音乐库' },
  // 英文的 Listen Together 在五个分页里放不下，底部这里用短的
  { to: '/room', icon: 'users', label: '一起听', en: 'Together' },
];

// 子页面（歌单、专辑、设置…）不是任何一个分页：继续亮着刚才那个分页，才知道自己在哪一区
// 我的歌单、我喜欢的、离线、听歌报告属于音乐库；每日推荐属于首页
const OWNER = [
  [/^\/(my|liked|offline|report)(\/|$)/, '/library'],
  [/^\/daily(\/|$)/, '/'],
  [/^\/join\//, '/library'],
];
const current = ref('/');
watch(
  () => route.path,
  path => {
    const tab = TABS.find(t => t.to === path)?.to ?? OWNER.find(([re]) => re.test(path))?.[1];
    if (tab) current.value = tab;
  },
  { immediate: true }
);
</script>

<template>
  <nav class="tabs" :aria-label="$t('主导航')">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.to"
      :to="tab.to"
      class="tab"
      :class="{ active: current === tab.to }"
      active-class=""
      exact-active-class=""
      :aria-current="current === tab.to ? 'page' : undefined"
    >
      <span class="icon">
        <Icon :name="tab.icon" />
        <!-- 好友：新的邀请、还没看的回应 -->
        <span v-if="tab.to === '/friends' && friendsStore.badge" class="dot" :aria-label="$t('有新的好友动态')" />
      </span>
      <span>{{ locale === 'en' && tab.en ? tab.en : $t(tab.label) }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
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
  font-size: 12px;
  white-space: nowrap;
  color: var(--text-dim);
}
.icon {
  position: relative;
  display: grid;
}
.dot {
  position: absolute;
  top: -2px;
  right: -5px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--sidebar);
  border-radius: 50%;
  background: var(--accent);
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
