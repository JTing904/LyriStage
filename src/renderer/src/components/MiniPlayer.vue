<script setup>
// 手机版的迷你播放条：点一下打开歌词舞台
import { computed } from 'vue';
import Icon from './Icon.vue';
import Cover from './Cover.vue';
import { useUiStore } from '../stores/ui';
import HostLine from './HostLine.vue';
import { useRoomLocked } from '../composables/useRoomLock';

const ui = useUiStore();
/** 一起听的成员：播放键变灰（还是按得到，按了会说只有房主能控制） */
const locked = computed(useRoomLocked());

const props = defineProps({
  state: { type: Object, required: true },
  player: { type: Object, required: true },
});
const emit = defineEmits(['open-stage']);

const progress = computed(() =>
  props.state.duration ? Math.min(1, props.state.time / props.state.duration) : 0
);
const artists = computed(() =>
  (props.state.track?.ar ?? []).map(a => a.name).join(' / ')
);
</script>

<template>
  <div v-if="state.track" class="mini">
    <button class="open" :aria-label="$t('打开歌词')" @click="emit('open-stage')">
      <Cover :url="state.track.al?.picUrl" :size="42" radius="8px" class="cover" />
      <span class="meta">
        <strong>{{ state.track.name }}</strong>
        <HostLine v-if="locked" />
        <span v-else>{{ artists }}</span>
      </span>
    </button>
    <button
      class="icon-btn"
      :class="{ locked }"
      :aria-label="state.playing ? $t('暂停') : $t('播放')"
      @click="player.toggle()"
    >
      <Icon :name="state.playing ? 'pause' : 'play'" :size="26" />
    </button>
    <button class="icon-btn" :class="{ locked }" :aria-label="$t('下一首')" @click="player.next()">
      <Icon name="next" />
    </button>
    <button class="icon-btn" :aria-label="$t('播放队列')" @click="ui.queueOpen = true">
      <Icon name="queue" :size="22" />
    </button>
    <span class="line"><span :style="{ width: `${progress * 100}%` }" /></span>
  </div>
</template>

<style scoped>
.mini {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 60px;
  margin: 0 8px 8px;
  padding: 0 4px 0 8px;
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow);
  border: 1px solid var(--line);
}
.open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  background: none;
  text-align: left;
  padding: 0;
}
.cover {
  width: 42px;
}
.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.meta strong,
.meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta strong {
  font-size: 14px;
}
.meta span {
  font-size: 12px;
  color: var(--text-dim);
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: none;
}
.meta .host-line {
  align-self: flex-start;
  max-width: 100%;
  margin-top: 1px;
  padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
}
.icon-btn.locked {
  opacity: 0.3;
}
.line {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2px;
  background: var(--line);
}
.line span {
  display: block;
  height: 100%;
  background: var(--accent);
}
</style>
