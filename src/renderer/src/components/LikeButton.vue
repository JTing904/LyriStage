<script setup>
// 红心：喜欢 / 取消喜欢（颜色跟着外层文字颜色，喜欢了变红）
import { computed } from 'vue';
import { useLibraryStore } from '../stores/library';
import Icon from './Icon.vue';

const props = defineProps({
  track: { type: Object, default: null },
  size: { type: Number, default: 20 },
});
const library = useLibraryStore();
const liked = computed(() => props.track && library.isLiked(props.track.id));
</script>

<template>
  <button
    class="like"
    :class="{ liked }"
    :disabled="!track"
    :aria-label="liked ? $t('取消喜欢') : $t('喜欢')"
    :aria-pressed="liked"
    :title="liked ? $t('取消喜欢') : $t('喜欢')"
    @click.stop="library.toggleLike(track)"
  >
    <Icon :name="liked ? 'heart-fill' : 'heart'" :size="size" />
  </button>
</template>

<style scoped>
.like {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  opacity: 0.75;
  cursor: pointer;
  transition: transform 0.15s, opacity 0.15s;
}
.like:hover {
  opacity: 1;
}
.like:active {
  transform: scale(0.88);
}
.like.liked {
  color: var(--accent, #ff3b5c);
  opacity: 1;
}
.like:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
