<script setup>
// ＋：把这首歌加到歌单（打开 App 外框里的「加到歌单」对话框）
import { useLibraryStore } from '../stores/library';
import Icon from './Icon.vue';

defineProps({
  track: { type: Object, default: null },
  size: { type: Number, default: 20 },
});
const library = useLibraryStore();
</script>

<template>
  <button
    class="add"
    :disabled="!track"
    :aria-label="$t('加到歌单')"
    :title="$t('加到歌单')"
    @click.stop="library.openAddDialog([track])"
  >
    <Icon name="plus" :size="size" />
  </button>
</template>

<style scoped>
.add {
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
}
.add:hover {
  opacity: 1;
}
.add:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
