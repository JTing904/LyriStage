<script setup>
// 歌单 / 专辑 / 歌手 / 每日推荐的页头：封面、类型、名字、介绍、播放按钮。
// 背景是封面的主色往下渐变（深浅主题都适用）
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { getPalette, rgb } from '../lyric-stage/palette';
import { useUiStore } from '../stores/ui';
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

// 手机：页头滑出画面后，顶部的返回列显示名字
const ui = useUiStore();
watch(
  () => props.title,
  title => (ui.pageTitle = title),
  { immediate: true }
);
onBeforeUnmount(() => {
  if (ui.pageTitle === props.title) ui.pageTitle = '';
});

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
        <!-- 手机：随机播放只留图标，播放全部是右边的大圆钮（文字收起来，给读屏用 aria-label） -->
        <slot name="actions" />
        <button
          class="shuffle"
          :disabled="!playable"
          :aria-label="$t('随机播放')"
          @click="emit('shuffle')"
        >
          <Icon name="shuffle" :size="18" /><span class="label">{{ $t('随机播放') }}</span>
        </button>
        <button
          class="play"
          :disabled="!playable"
          :aria-label="$t('播放全部')"
          @click="emit('play')"
        >
          <Icon name="play" :size="20" /><span class="label">{{ $t('播放全部') }}</span>
        </button>
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

/* 电脑：播放全部在最前面 */
.play {
  order: -2;
}
.shuffle {
  order: -1;
}

/* 手机（参考 Spotify）：封面小一点、置中；名字靠左；
   操作列：自定的按钮在左，随机播放（图标）+ 播放（大圆钮）在右，拇指按得到 */
@media (max-width: 640px) {
  .collection-header {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    /* 顶部让出返回列（52px） */
    padding-top: 56px;
    padding-bottom: 8px;
  }
  .cover {
    align-self: center;
    width: min(200px, 52vw);
  }
  .info {
    gap: 6px;
  }
  .kind {
    display: none;
  }
  h1 {
    font-size: clamp(22px, 6.4vw, 28px);
    line-height: 1.2;
  }
  .description {
    font-size: 13px;
  }
  /* 「展开」只有一行小字，手指不好点：加大可点的范围 */
  .more {
    margin: -8px 0 -4px;
    padding: 8px 12px 8px 0;
  }
  .meta {
    font-size: 13px;
  }
  .actions {
    align-self: stretch;
    align-items: center;
    flex-wrap: nowrap;
    margin-top: 4px;
  }
  .play,
  .shuffle {
    order: 0;
  }
  .actions :slotted(button) {
    height: 36px;
    padding: 0 14px;
    font-size: 13px;
  }
  .shuffle {
    width: 44px;
    padding: 0;
    justify-content: center;
    margin-left: auto;
  }
  .play {
    width: 56px;
    height: 56px;
    padding: 0;
    justify-content: center;
    box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .actions .label {
    display: none;
  }
  /* 页面自己的按钮有图标的（.icon-action）：手机只留图标、圆形，一排放得下 */
  .actions :slotted(button.icon-action) {
    flex: none;
    width: 40px;
    height: 40px;
    padding: 0;
    justify-content: center;
  }
  .actions :slotted(button.icon-action .label) {
    display: none;
  }
}

/* 手机横屏：画面矮，封面放左边、缩小 */
@media (pointer: coarse) and (max-height: 600px) and (orientation: landscape) {
  .collection-header {
    align-items: center;
    gap: 20px;
    padding-top: 56px;
    padding-bottom: 8px;
  }
  .cover {
    width: 120px;
  }
  .kind {
    display: none;
  }
  h1 {
    font-size: 26px;
  }
  .actions button,
  .actions :slotted(button) {
    height: 38px;
    padding: 0 16px;
    font-size: 14px;
  }
}
</style>
