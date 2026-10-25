<script setup>
// 一起听的成员：歌名下面的「👑 小明 控制播放」（名字太长只截名字，「控制播放」一定看得到）
// 颜色由外面决定（迷你播放条、播放条各自的配色）
import { computed } from 'vue';
import { useRoomStore } from '../stores/room';
import { t } from '../i18n';

const room = useRoomStore();
const MARK = '@@name@@';
const parts = computed(() => t('{name} 控制播放', { name: MARK }).split(MARK).map(s => s.trim()));
const name = computed(() => room.host?.name ?? t('房主'));
</script>

<template>
  <span class="host-line">
    <span aria-hidden="true">👑</span>
    <span v-if="parts[0]">{{ parts[0] }}</span>
    <span class="name">{{ name }}</span>
    <span v-if="parts[1]">{{ parts[1] }}</span>
  </span>
</template>

<style scoped>
.host-line {
  display: inline-flex;
  gap: 0.3em;
  min-width: 0;
  white-space: nowrap;
}
.host-line > span {
  flex: none;
}
.host-line > .name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
