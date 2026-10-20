<script setup>
// 封面图：网易云的图可以用 ?param=宽y高 要指定尺寸，按显示大小的 2 倍要（高清屏）
import { computed, ref, watch } from 'vue';

const props = defineProps({
  url: { type: String, default: '' },
  /** 显示的边长（px），用来决定要多大的图 */
  size: { type: Number, default: 64 },
  radius: { type: String, default: '8px' },
  /** 圆形（歌手头像） */
  round: { type: Boolean, default: false },
});

const failed = ref(false);
watch(
  () => props.url,
  () => (failed.value = false)
);

const src = computed(() => {
  if (!props.url || failed.value) return '';
  const px = Math.min(1024, Math.round(props.size * 2));
  return `${props.url.replace(/^http:/, 'https:')}?param=${px}y${px}`;
});
</script>

<template>
  <span
    class="cover"
    :style="{ borderRadius: round ? '50%' : radius }"
    :class="{ empty: !src }"
  >
    <img v-if="src" :src="src" alt="" loading="lazy" @error="failed = true" />
    <!-- 没有图、或图载不出来时显示的东西（例如头像用名字的第一个字） -->
    <slot v-else />
  </span>
</template>

<style scoped>
.cover {
  display: block;
  flex-shrink: 0;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--surface-hover);
}
.cover.empty {
  background: linear-gradient(135deg, var(--surface-hover), var(--line-strong));
}
img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
