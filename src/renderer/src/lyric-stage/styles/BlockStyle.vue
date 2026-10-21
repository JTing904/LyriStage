<script setup>
// 风格 C：色块歌词（参考 Spotify）
// 整个背景是封面的主色（压暗到白字看得清），大号粗体；唱过的行是白色，没唱的是暗色
import { computed } from 'vue';
import { useStage, displayWords } from '../useStage';
import { useCenteredList } from '../useCenteredList';
import { rgb, withLightness } from '../palette';

const { lines, lineIndex, palette, settings, seekToLine } = useStage();
const { viewport, lineRef, offset } = useCenteredList(lineIndex, {
  anchor: 0.4,
});

const shownLines = computed(() =>
  lines.value.map(line => ({
    ...line,
    text: displayWords(line.words)
      .map(w => w.text)
      .join(''),
  }))
);

// 中等亮度、饱和的封面色：唱过的白字和没唱的暗字都看得清
const background = computed(() =>
  rgb(withLightness(palette.value.vibrant, 0.38, 0.45))
);
</script>

<template>
  <div class="block-style" :style="{ background }">
    <div ref="viewport" class="viewport">
      <div class="list" :style="{ transform: `translateY(${offset}px)` }">
        <div
          v-for="(line, i) in shownLines"
          :key="i"
          :ref="lineRef(i)"
          class="line"
          :class="{
            past: i < lineIndex,
            current: i === lineIndex,
          }"
          @click="seekToLine(i)"
        >
          <p class="text">{{ line.text }}</p>
          <p
            v-if="settings.showTranslation && (line.translation || line.romaji)"
            class="sub"
          >
            {{ line.translation || line.romaji }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block-style {
  overflow: hidden;
  transition: background 1.2s;
}
.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
/* 手机横屏：画面很矮，歌词区停在播放条上方，上下边缘淡出（不然歌词会跑到播放条底下） */
@media (pointer: coarse) and (orientation: landscape) and (max-height: 600px) {
  .viewport {
    inset: var(--titlebar-height, 44px) 0 var(--controls-space, 92px) 0;
    mask-image: linear-gradient(transparent, #000 14%, #000 82%, transparent);
  }
}
.list {
  position: relative;
  padding: 0 7vw;
  max-width: 1200px;
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.line {
  padding: 1vh 0;
  cursor: pointer;
  /* 还没唱：深色 */
  color: rgba(0, 0, 0, 0.55);
  transition: color 0.35s;
}
.line.past {
  color: rgba(255, 255, 255, 0.72);
}
.line.current {
  color: #fff;
}
.line:hover {
  color: rgba(255, 255, 255, 0.9);
}
.text {
  margin: 0;
  font: 900 clamp(28px, 4.2vw, 64px) / 1.18 'Noto Sans SC', system-ui,
    sans-serif;
  letter-spacing: -0.015em;
}
.sub {
  margin: 0.3em 0 0;
  font: 700 clamp(14px, 1.7vw, 24px) / 1.4 'Noto Sans SC', system-ui, sans-serif;
  opacity: 0.8;
}
</style>
