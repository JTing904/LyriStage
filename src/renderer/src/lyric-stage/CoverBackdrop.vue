<script setup>
// 封面背景：
// - blur：用 24px 的小封面放大，浏览器插值后自然变模糊，比实时 blur 滤镜省电（手机上也流畅）
// - sharp：清晰的大封面铺满（风格 I 用）
import { computed } from 'vue';
import { useStage } from './useStage';

const props = defineProps({
  mode: { type: String, default: 'blur' },
  /** 压暗多少（0 不压暗，1 全黑） */
  dim: { type: Number, default: 0.5 },
  /** 额外的 CSS filter，例如 'saturate(1.4)' */
  filter: { type: String, default: '' },
});

const { coverUrl } = useStage();
const src = computed(() => {
  if (!coverUrl.value) return null;
  const size = props.mode === 'sharp' ? '1024y1024' : '24y24';
  return `${coverUrl.value}?param=${size}`;
});
</script>

<template>
  <div class="cover-backdrop" :class="mode">
    <img
      v-if="src"
      :src="src"
      alt=""
      :style="{ filter: filter || undefined }"
    />
    <div class="dim" :style="{ opacity: dim }" />
  </div>
</template>

<style scoped>
.cover-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #111;
}
img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.blur img {
  inset: -8%;
  width: 116%;
  height: 116%;
}
.dim {
  position: absolute;
  inset: 0;
  background: #000;
}
</style>
