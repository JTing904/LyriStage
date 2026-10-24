<script setup>
// 手机：子页面（歌手、歌单、专辑、设置…）顶部的返回列。
// iPhone 网页版没有返回键，没有这个就回不去；Android 也比按系统返回键直观。
// 平时透明叠在页头上，内容往下滑过页头后变成实心，并显示页面名字（参考 Spotify / Apple Music）
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import Icon from './Icon.vue';

defineProps({
  /** 内容已经往下滑过页头 */
  scrolled: { type: Boolean, default: false },
});

const router = useRouter();
const ui = useUiStore();

function back() {
  // 直接打开这一页（没有上一页）时回首页
  if (window.history.state?.back) router.back();
  else router.push('/');
}
</script>

<template>
  <div class="back-bar" :class="{ scrolled }">
    <button class="back" :aria-label="$t('返回')" @click="back">
      <Icon name="chevron-left" :size="24" />
    </button>
    <span class="title">{{ ui.pageTitle }}</span>
  </div>
</template>

<style scoped>
.back-bar {
  display: none;
}
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .back-bar {
    position: sticky;
    z-index: 20;
    top: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 52px;
    /* 叠在页面上面，不占位置 */
    margin-bottom: -52px;
    padding: 0 8px;
    transition: background 0.2s, box-shadow 0.2s;
  }
  .back-bar.scrolled {
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(12px);
    box-shadow: 0 1px 0 var(--line);
  }
}
.back {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  /* 几乎实心再加模糊：卷动时底下的字（例如设置的卡片标题）不会透出来跟箭头叠在一起 */
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.12);
  color: var(--text);
  cursor: pointer;
}
.scrolled .back {
  background: none;
  backdrop-filter: none;
  box-shadow: none;
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 700;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.2s, transform 0.2s;
}
.scrolled .title {
  opacity: 1;
  transform: none;
}
</style>
