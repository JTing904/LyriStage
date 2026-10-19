<script setup>
// 歌单封面：有自己的封面就用；没有的话用里面歌的封面拼（4 首以上 2×2，不够就用第一首）；
// 空的歌单：按名字挑一个渐层色，放歌单名字的第一个字
import { computed } from 'vue';
import Cover from './Cover.vue';

const props = defineProps({
  cover: { type: String, default: '' },
  /** 前几首歌的封面 */
  covers: { type: Array, default: () => [] },
  name: { type: String, default: '' },
  /** 显示的边长（px），用来决定要多大的图 */
  size: { type: Number, default: 180 },
  radius: { type: String, default: '12px' },
});

const mode = computed(() => {
  if (props.cover) return 'own';
  if (props.covers.length >= 4) return 'grid';
  if (props.covers.length) return 'first';
  return 'empty';
});

const GRADIENTS = [
  ['#ff3b5c', '#7b2ff7'],
  ['#ff8a5b', '#ff3b5c'],
  ['#2fb5f7', '#7b2ff7'],
  ['#1fc98e', '#2f7bf7'],
  ['#f7b52f', '#f7532f'],
  ['#c44dff', '#ff4d9d'],
];
const gradient = computed(() => {
  let hash = 0;
  for (const ch of props.name) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  const [a, b] = GRADIENTS[Math.abs(hash) % GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
});
const initial = computed(() => [...props.name.trim()][0]?.toUpperCase() ?? '♪');
</script>

<template>
  <Cover v-if="mode === 'own'" :url="cover" :size="size" :radius="radius" />
  <Cover v-else-if="mode === 'first'" :url="covers[0]" :size="size" :radius="radius" />
  <div v-else-if="mode === 'grid'" class="grid" :style="{ borderRadius: radius }">
    <Cover v-for="(c, i) in covers.slice(0, 4)" :key="i" :url="c" :size="Math.ceil(size / 2)" radius="0" />
  </div>
  <div v-else class="empty" :style="{ borderRadius: radius, background: gradient, fontSize: `${size * 0.38}px` }">
    {{ initial }}
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  aspect-ratio: 1;
  overflow: hidden;
}
.grid :deep(.cover),
.grid > * {
  width: 100%;
}
.empty {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  color: #fff;
  font-family: var(--font-display);
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 2px 12px rgb(0 0 0 / 0.2);
}
</style>
