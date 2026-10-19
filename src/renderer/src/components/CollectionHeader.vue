<script setup>
// 歌单 / 专辑 / 歌手 / 每日推荐的页头：封面、类型、名字、介绍、播放按钮。
// 背景是封面的主色往下渐变（深浅主题都适用）
import { computed, ref, watch } from 'vue';
import { getPalette, rgb } from '../lyric-stage/palette';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const props = defineProps({
  cover: { type: String, default: '' },
  /** 封面上方的小字：歌单 / 专辑 / 歌手 */
  kind: { type: String, default: '' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  /** 第三行的小字，例如「EdwardJT · 10 首 · 31 分钟」 */
  meta: { type: String, default: '' },
  /** 圆形封面（歌手） */
  round: { type: Boolean, default: false },
  /** 还没有歌时不能按播放 */
  playable: { type: Boolean, default: true },
});
const emit = defineEmits(['play', 'shuffle']);

const tint = ref('transparent');
watch(
  () => props.cover,
  async cover => {
    const palette = await getPalette(cover);
    if (cover === props.cover) tint.value = rgb(palette.dominant, 0.5);
  },
  { immediate: true }
);

const expanded = ref(false);
const longDescription = computed(() => props.description.length > 90);
</script>

<template>
  <header class="collection-header" :style="{ '--tint': tint }">
    <Cover class="cover" :url="cover" :size="232" :round="round" radius="14px" />
    <div class="info">
      <span v-if="kind" class="kind">{{ kind }}</span>
      <h1 class="display">{{ title }}</h1>
      <p
        v-if="description"
        class="description"
        :class="{ clamped: longDescription && !expanded }"
      >
        {{ description }}
      </p>
      <button
        v-if="longDescription"
        class="more"
        @click="expanded = !expanded"
      >
        {{ expanded ? $t('收起') : $t('展开') }}
      </button>
      <p v-if="meta" class="meta">{{ meta }}</p>
      <div class="actions">
        <button class="play" :disabled="!playable" @click="emit('play')">
          <Icon name="play" :size="20" />{{ $t('播放全部') }}
        </button>
        <button class="shuffle" :disabled="!playable" @click="emit('shuffle')">
          <Icon name="shuffle" :size="18" />{{ $t('随机播放') }}
        </button>
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.collection-header {
  display: flex;
  align-items: flex-end;
  gap: 32px;
  margin: -24px calc(-1 * clamp(16px, 3vw, 40px)) 0;
  padding: 48px clamp(16px, 3vw, 40px) 28px;
  background: linear-gradient(to bottom, var(--tint), transparent);
  transition: background 0.6s;
}
/* 电脑版：内容区顶部让出了 40px 给标题栏，渐变要往上盖到窗口顶端 */
.electron .collection-header {
  margin-top: calc(-24px - var(--titlebar-height));
  padding-top: calc(48px + var(--titlebar-height));
}
.cover {
  flex: none;
  width: 232px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.3);
}
.info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.kind {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}
h1 {
  margin: 0;
  font-size: clamp(32px, 4.4vw, 60px);
  line-height: 1.1;
  overflow-wrap: anywhere;
}
.description {
  margin: 0;
  max-width: 70ch;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
  white-space: pre-line;
}
.description.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.more {
  margin-top: -6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 700;
}
.more:hover {
  color: var(--text);
}
.meta {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}
.actions button,
.actions :slotted(button) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 20px;
  border-radius: 999px;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.play {
  border: 0;
  background: var(--accent);
  color: var(--on-accent);
}
.shuffle,
.actions :slotted(button) {
  border: 1px solid var(--line-strong);
  background: color-mix(in srgb, var(--bg) 60%, transparent);
  color: var(--text);
}
.actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.play:not(:disabled):hover {
  filter: brightness(1.08);
}
.shuffle:not(:disabled):hover,
.actions :slotted(button:hover) {
  border-color: var(--text-dim);
}

@media (max-width: 640px) {
  .collection-header {
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding-top: 32px;
    text-align: center;
  }
  .cover {
    width: min(220px, 60vw);
  }
  .info {
    align-items: center;
  }
  .actions {
    justify-content: center;
  }
}
</style>
