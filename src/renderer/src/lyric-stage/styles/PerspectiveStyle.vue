<script setup>
// 风格 I：3D 透视（参考用户提供的抖音截图）
// 背景是清晰的歌曲封面铺满；左边一整列歌词往右后方倾斜成立体透视，
// 当前行最大最亮，上下渐隐；光斑和花瓣飘落
import { computed } from 'vue';
import { useStage, displayWords } from '../useStage';
import { useCenteredList } from '../useCenteredList';
import CoverBackdrop from '../CoverBackdrop.vue';

const { lines, lineIndex, settings, seekToLine, coverUrl } = useStage();

// 封面是正方形：宽屏时铺满会被放大裁切（只看到局部），
// 所以宽屏用模糊封面铺底，完整的清晰封面放在右边；竖屏（手机）才整张铺满
const art = computed(
  () => coverUrl.value && `${coverUrl.value}?param=1024y1024`
);
const { viewport, lineRef, offset } = useCenteredList(lineIndex, {
  anchor: 0.56, // 歌词区底部让出了播放条，0.56 大约是整个画面的 45%
});

const shownLines = computed(() =>
  lines.value.map(line => ({
    ...line,
    text: displayWords(line.words)
      .map(w => w.text)
      .join(''),
  }))
);
const distance = i => Math.abs(i - Math.max(0, lineIndex.value));

// 光斑和花瓣：位置、大小、速度固定（用下标算），每次打开都一样
const bokeh = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 41) % 100}%`,
  top: `${(i * 67) % 100}%`,
  size: `${6 + ((i * 13) % 22)}px`,
  delay: `${(i * 0.9) % 9}s`,
}));
const petals = Array.from({ length: 12 }, (_, i) => ({
  left: `${(i * 29 + 7) % 100}%`,
  delay: `${(i * 1.7) % 14}s`,
  duration: `${10 + (i % 5) * 2}s`,
  size: `${8 + (i % 4) * 3}px`,
}));
</script>

<template>
  <div class="perspective-style">
    <CoverBackdrop :dim="0.3" filter="saturate(1.2)" />
    <img v-if="art" class="art" :src="art" alt="" />
    <div class="legibility" />

    <span
      v-for="(b, i) in bokeh"
      :key="`b${i}`"
      class="bokeh"
      :style="{
        left: b.left,
        top: b.top,
        width: b.size,
        height: b.size,
        animationDelay: b.delay,
      }"
    />
    <span
      v-for="(p, i) in petals"
      :key="`p${i}`"
      class="petal"
      :style="{
        left: p.left,
        width: p.size,
        height: p.size,
        animationDelay: p.delay,
        animationDuration: p.duration,
      }"
    />

    <div ref="viewport" class="viewport">
      <div class="tilt">
        <div class="list" :style="{ transform: `translateY(${offset}px)` }">
          <div
            v-for="(line, i) in shownLines"
            :key="i"
            :ref="lineRef(i)"
            class="line"
            :class="{ current: i === lineIndex }"
            :style="{ '--d': Math.min(distance(i), 6) }"
            @click="seekToLine(i)"
          >
            <p class="text">{{ line.text }}</p>
            <p
              v-if="
                settings.showTranslation &&
                i === lineIndex &&
                (line.translation || line.romaji)
              "
              class="sub"
            >
              {{ line.translation || line.romaji }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.perspective-style {
  overflow: hidden;
}
/* 清晰的完整封面：宽屏时放在右边，左缘渐渐融进模糊背景 */
.art {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  mask-image: linear-gradient(90deg, transparent, #000 30%);
}
/* 竖屏（手机）或接近正方形的窗口：封面整张铺满，和参考图一样 */
@media (max-aspect-ratio: 5/4) {
  .art {
    inset: 0;
    width: 100%;
    height: 100%;
    mask-image: none;
  }
}
/* 左边稍微压暗，白字才看得清；右边保留封面原样 */
.legibility {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.5),
    rgba(0, 0, 0, 0.12) 55%,
    transparent
  );
}

.bokeh {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(255, 246, 214, 0.95),
    rgba(255, 246, 214, 0) 70%
  );
  filter: blur(1px);
  opacity: 0;
  animation: twinkle 9s ease-in-out infinite;
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 0;
    transform: scale(0.6);
  }
  50% {
    opacity: 0.85;
    transform: scale(1);
  }
}
.petal {
  position: absolute;
  top: -5%;
  border-radius: 80% 0 80% 0;
  background: #d9363e;
  opacity: 0.85;
  animation: fall linear infinite;
}
@keyframes fall {
  0% {
    transform: translate(0, 0) rotate(0deg);
  }
  50% {
    transform: translate(6vw, 55vh) rotate(200deg);
  }
  100% {
    transform: translate(-2vw, 112vh) rotate(420deg);
  }
}

.viewport {
  position: absolute;
  inset: 0 0 160px 0;
  overflow: hidden;
  /* 透视：离得越远越小 */
  perspective: 1200px;
  perspective-origin: 10% 50%;
  mask-image: linear-gradient(transparent, #000 15%, #000 80%, transparent);
}
/* 整列往右后方倾斜 */
.tilt {
  position: absolute;
  inset: 0;
  transform: rotateY(12deg) rotateX(2deg);
  transform-origin: 0% 50%;
  transform-style: preserve-3d;
}
.list {
  position: relative;
  /* 不要贴着左边：宽屏时大约在左半边的中间 */
  padding: 0 4vw 0 13vw;
  width: min(62vw, 980px);
  transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
}
.line {
  padding: 1.1vh 0;
  cursor: pointer;
  opacity: calc(0.75 - var(--d) * 0.1);
  transform-origin: 0% 50%;
  transition: opacity 0.45s, transform 0.45s;
}
.line.current {
  opacity: 1;
  transform: scale(1.12);
}
.text {
  margin: 0;
  font: 700 clamp(18px, 2.4vw, 34px) / 1.3 'Noto Sans SC', system-ui, sans-serif;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
}
.line.current .text {
  font-weight: 900;
}
.sub {
  margin: 0.25em 0 0;
  font: 500 clamp(13px, 1.4vw, 20px) / 1.4 'Noto Sans SC', system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}

@media (max-width: 760px) {
  .list {
    width: 86vw;
    padding-left: 6vw;
  }
  .tilt {
    transform: rotateY(10deg) rotateX(2deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .bokeh,
  .petal {
    animation: none;
  }
  .petal {
    display: none;
  }
}
</style>
