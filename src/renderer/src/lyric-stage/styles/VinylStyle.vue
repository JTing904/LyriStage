<script setup>
// 风格 H：黑胶唱片
// 左边一张转动的黑胶（中间是封面），唱臂在播放时放下、暂停时抬起；右边 5 行歌词，当前行最大最亮
import { computed } from 'vue';
import { useStage, displayWords } from '../useStage';
import CoverBackdrop from '../CoverBackdrop.vue';

const { lines, lineIndex, coverUrl, playing, seekToLine, subText } =
  useStage();

const label = computed(
  () => coverUrl.value && `${coverUrl.value}?param=400y400`
);

/** 当前行前后各 2 行 */
const window5 = computed(() => {
  const center = Math.max(0, lineIndex.value);
  return [-2, -1, 0, 1, 2].map(offset => {
    const index = center + offset;
    const line = lines.value[index];
    return {
      index,
      offset,
      text: line
        ? displayWords(line.words)
            .map(w => w.text)
            .join('')
        : '',
      sub: subText(line),
    };
  });
});
</script>

<template>
  <div class="vinyl-style" :class="{ paused: !playing }">
    <CoverBackdrop :dim="0.62" filter="saturate(1.3)" />

    <div class="turntable">
      <div class="record">
        <img v-if="label" class="label" :src="label" alt="" />
        <span class="spindle" />
      </div>
      <svg class="arm" viewBox="0 0 100 220" aria-hidden="true">
        <circle cx="70" cy="22" r="16" fill="#cfcfcf" />
        <circle cx="70" cy="22" r="7" fill="#7b7b7b" />
        <path
          d="M70 22 L70 150 L52 190"
          stroke="#d9d9d9"
          stroke-width="6"
          fill="none"
          stroke-linecap="round"
        />
        <rect
          x="40"
          y="186"
          width="22"
          height="30"
          rx="4"
          fill="#2b2b2b"
          transform="rotate(25 51 201)"
        />
      </svg>
    </div>

    <div class="lyrics">
      <div
        v-for="item in window5"
        :key="item.index"
        class="line"
        :class="`o${item.offset + 2}`"
        @click="item.text && seekToLine(item.index)"
      >
        <p class="text">{{ item.text || ' ' }}</p>
        <p
          v-if="item.sub && item.offset === 0"
          class="sub"
        >
          {{ item.sub }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vinyl-style {
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  align-items: center;
  gap: 4vw;
  padding: 6vh 6vw calc(var(--controls-space, 170px) + 30px);
}

.turntable {
  position: relative;
  justify-self: center;
  width: min(40vw, 56vh);
  aspect-ratio: 1;
}
.record {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  /* 唱片纹路：一圈一圈的细纹 + 一道反光 */
  background: conic-gradient(
      from 30deg,
      transparent 0 20%,
      rgba(255, 255, 255, 0.09) 25%,
      transparent 30% 70%,
      rgba(255, 255, 255, 0.06) 75%,
      transparent 80%
    ),
    repeating-radial-gradient(circle, #111 0 2px, #1c1c1c 2px 3px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), inset 0 0 0 6px #0b0b0b;
  display: grid;
  place-items: center;
  animation: spin 6s linear infinite;
}
.paused .record {
  animation-play-state: paused;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.label {
  width: 38%;
  height: 38%;
  border-radius: 50%;
  object-fit: cover;
  grid-area: 1 / 1;
  box-shadow: 0 0 0 4px #0d0d0d;
}
.spindle {
  grid-area: 1 / 1;
  width: 3%;
  height: 3%;
  border-radius: 50%;
  background: #e8e8e8;
}
/* 唱臂：播放时放到唱片上，暂停时抬起 */
.arm {
  position: absolute;
  right: -14%;
  top: -6%;
  width: 26%;
  transform-origin: 70% 10%;
  transform: rotate(18deg);
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.5));
}
.paused .arm {
  transform: rotate(-6deg);
}

.lyrics {
  position: relative;
  display: grid;
  gap: 2.4vh;
  font-family: 'Noto Sans SC', system-ui, sans-serif;
}
.line {
  cursor: pointer;
  transition: opacity 0.4s, transform 0.4s;
}
.text {
  margin: 0;
  font-weight: 700;
  line-height: 1.3;
}
.o0,
.o4 {
  opacity: 0.22;
}
.o1,
.o3 {
  opacity: 0.5;
}
.o0 .text,
.o4 .text,
.o1 .text,
.o3 .text {
  font-size: clamp(16px, 1.8vw, 26px);
}
.o2 .text {
  font-size: clamp(24px, 3.2vw, 48px);
  font-weight: 900;
}
.sub {
  white-space: pre-line;
  margin: 0.3em 0 0;
  font-size: clamp(14px, 1.5vw, 20px);
  color: rgba(255, 255, 255, 0.75);
}

/* 窄屏：唱片在上，歌词在下 */
@media (max-width: 760px) {
  .vinyl-style {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    padding-top: 10vh;
    text-align: center;
  }
  .turntable {
    width: min(64vw, 36vh);
  }
}
@media (prefers-reduced-motion: reduce) {
  .record {
    animation: none;
  }
}
</style>
