<script setup>
// 风格 B：滚动歌词（参考 Apple Music）
// 整页歌词上下滚动，当前行逐字点亮，离当前行越远越淡越模糊；背景是封面取色的流动色块
import { computed } from 'vue';
import { useStage, displayWords } from '../useStage';
import LitWords from '../LitWords.vue';
import { useCenteredList } from '../useCenteredList';
import { rgb } from '../palette';
import CoverBackdrop from '../CoverBackdrop.vue';

// 这里不读 now（每一帧都在变）：正在唱的那行交给 LitWords，整页歌词才不会每帧重画
const { lines, lineIndex, palette, settings, seekToLine } = useStage();
const { viewport, lineRef, offset } = useCenteredList(lineIndex, {
  anchor: 0.42,
});

const shownLines = computed(() =>
  lines.value.map(line => ({ ...line, words: displayWords(line.words) }))
);

/** 和当前行的距离：0 是当前行 */
const distance = i => Math.abs(i - Math.max(0, lineIndex.value));

const blobs = computed(() => ({
  '--c1': rgb(palette.value.vibrant, 0.75),
  '--c2': rgb(palette.value.dominant, 0.85),
  '--c3': rgb(palette.value.dark, 1),
}));
</script>

<template>
  <div class="scroll-style" :style="blobs">
    <CoverBackdrop :dim="0.35" filter="saturate(1.6)" />
    <div class="blob b1" />
    <div class="blob b2" />
    <div class="blob b3" />
    <div class="shade" />

    <div ref="viewport" class="viewport">
      <div class="list" :style="{ transform: `translateY(${offset}px)` }">
        <div
          v-for="(line, i) in shownLines"
          :key="i"
          :ref="lineRef(i)"
          class="line"
          :class="{ current: i === lineIndex, near: distance(i) <= 4 }"
          :style="{ '--d': Math.min(distance(i), 4) }"
          @click="seekToLine(i)"
        >
          <p class="text">
            <LitWords v-if="i === lineIndex" :words="line.words" />
            <template v-else>{{
              line.words.map(w => w.text).join('')
            }}</template>
          </p>
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
.scroll-style {
  overflow: hidden;
  background: var(--c3);
}
/* 流动色块：三团封面颜色的光慢慢飘 */
.blob {
  position: absolute;
  width: 70vmax;
  height: 70vmax;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.7;
  animation: float 26s ease-in-out infinite alternate;
}
.b1 {
  background: var(--c1);
  left: -20vmax;
  top: -25vmax;
}
.b2 {
  background: var(--c2);
  right: -25vmax;
  top: 10vmax;
  animation-duration: 32s;
  animation-delay: -8s;
}
.b3 {
  background: var(--c1);
  left: 10vmax;
  bottom: -35vmax;
  opacity: 0.45;
  animation-duration: 38s;
  animation-delay: -16s;
}
@keyframes float {
  0% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(8vmax, 6vmax) scale(1.15);
  }
  100% {
    transform: translate(-6vmax, 10vmax) scale(0.95);
  }
}
.shade {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
}

.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  mask-image: linear-gradient(transparent, #000 18%, #000 72%, transparent 92%);
}
.list {
  position: relative;
  padding: 0 8vw;
  max-width: 1100px;
  transition: transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
}
.line {
  padding: 1.2vh 1vw;
  margin: 0 -1vw;
  border-radius: 14px;
  cursor: pointer;
  opacity: 0.12;
  transition: opacity 0.5s, filter 0.5s;
}
.line.near {
  opacity: calc(0.62 - var(--d) * 0.1);
  filter: blur(calc(var(--d) * 0.7px));
}
.line.current {
  opacity: 1;
  filter: none;
}
.line:hover {
  background: rgba(255, 255, 255, 0.08);
  filter: none;
}
.text {
  margin: 0;
  font: 900 clamp(26px, 3.6vw, 52px) / 1.25 'Noto Sans SC', system-ui,
    sans-serif;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: -0.01em;
}
/* 逐字点亮：唱过的部分白色，没唱的半透明 */
.text :deep(.word) {
  background: linear-gradient(
    90deg,
    #fff calc(var(--p) * 100%),
    rgba(255, 255, 255, 0.38) calc(var(--p) * 100%)
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  white-space: pre-wrap;
}
.sub {
  margin: 0.4em 0 0;
  font: 600 clamp(14px, 1.6vw, 22px) / 1.4 'Noto Sans SC', system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.7);
}

@media (prefers-reduced-motion: reduce) {
  .blob {
    animation: none;
  }
  .list {
    transition-duration: 0.2s;
  }
}
</style>
