<script setup>
// 阶段 4 还没做到的页面先用这个占位
import { useRoute } from 'vue-router';

const route = useRoute();
const NAMES = {
  search: '搜索',
  library: '我的音乐库',
  daily: '每日推荐',
  playlist: '歌单',
  album: '专辑',
  artist: '歌手',
  'my-playlist': '我的歌单',
  login: '登录',
  settings: '设置',
};
</script>

<template>
  <section class="soon">
    <h1 class="display">{{ NAMES[route.name] ?? '页面' }}</h1>
    <p>这个页面正在做，很快就好。</p>
    <RouterLink class="back" to="/">回首页</RouterLink>
  </section>
</template>

<style scoped>
.soon {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  min-height: 60vh;
  text-align: center;
}
h1 {
  margin: 0;
  font-size: 40px;
}
p {
  margin: 0;
  color: var(--text-dim);
}
.back {
  margin-top: 8px;
  padding: 10px 20px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
}
</style>
