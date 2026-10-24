<script setup>
// 我的 3D 公仔（透明背景，大小跟着外层元素）。
// 载入完才淡入；电脑不支持 WebGL 等情况下就什么都不显示，不影响其他功能
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NAME_CARD_HANDLE } from '../stores/avatar';

const props = defineProps({
  /** 模型网址，通常用 useAvatarStore().url */
  url: { type: String, required: true },
});

const canvas = ref(null);
const loaded = ref(false);
const failed = ref(false);
let view = null;
let unmounted = false;

async function show(url) {
  try {
    if (await view.setModel(url)) loaded.value = true;
  } catch (err) {
    console.warn('[LyriStage] 公仔载入失败', err);
    failed.value = true;
  }
}

onMounted(async () => {
  try {
    const { createAvatarScene } = await import('../avatar/scene.js');
    if (unmounted) return;
    view = createAvatarScene(canvas.value, { handle: NAME_CARD_HANDLE });
  } catch (err) {
    console.warn('[LyriStage] 不能显示 3D 公仔', err);
    failed.value = true;
    return;
  }
  show(props.url);
});

watch(
  () => props.url,
  url => view && show(url)
);

onBeforeUnmount(() => {
  unmounted = true;
  view?.dispose();
});
</script>

<template>
  <div v-if="!failed" class="avatar-figure" :class="{ loaded }" aria-hidden="true">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.avatar-figure {
  position: relative;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.6s, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
}
.avatar-figure.loaded {
  opacity: 1;
  transform: none;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
