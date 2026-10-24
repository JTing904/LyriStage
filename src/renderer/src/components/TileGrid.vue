<script setup>
// 封面网格：歌单、专辑、歌手（圆形）
import Cover from './Cover.vue';
import PlaylistCover from './PlaylistCover.vue';

defineProps({
  /** [{ key, to, cover, title, sub?, round?, covers? }]（covers：自己的歌单，没封面时用歌的封面拼） */
  items: { type: Array, required: true },
});
</script>

<template>
  <div class="tile-grid">
    <RouterLink v-for="item in items" :key="item.key" :to="item.to" class="tile" :class="{ round: item.round }">
      <PlaylistCover
        v-if="item.covers"
        class="cover"
        :cover="item.cover"
        :covers="item.covers"
        :name="item.title"
        :size="180"
      />
      <Cover v-else class="cover" :url="item.cover" :size="180" :round="item.round" radius="12px" />
      <span class="title">{{ item.title }}</span>
      <span v-if="item.sub" class="sub">{{ item.sub }}</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 22px 18px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cover {
  width: 100%;
  margin-bottom: 4px;
  transition: transform 0.2s;
}
.tile:hover .cover {
  transform: translateY(-3px);
}
.round {
  align-items: center;
  text-align: center;
}
.title {
  font-size: 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sub {
  font-size: 13px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .tile-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 14px;
  }
}
</style>
