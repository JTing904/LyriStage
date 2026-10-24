<script setup>
// 风格 A：单行大字 · 动态歌词（参考抖音动态歌词视频，字体 F1 思源宋体 Black + 做旧）
// 一次只显示当前这一句，一段一段浮现（按空格和标点分段）；后面叠一层放大模糊的残影
import { computed } from 'vue';
import { useStage, splitPhrases, displayWords, displayText } from '../useStage';

const { track, coverUrl, line, lineIndex, now, inInterlude, subText } =
  useStage();

// 背景：小尺寸封面放大，浏览器插值后自然变模糊，比实时 blur 滤镜省电
const backdrop = computed(
  () => coverUrl.value && `${coverUrl.value}?param=24y24`
);

// 显示用的字：全角括号换半角、句尾标点去掉，大字才会真正居中
const words = computed(() => displayWords(line.value?.words ?? []));
const lineText = computed(() => words.value.map(w => w.text).join(''));
const title = computed(() => displayText(track.value?.name).trim());

/** 字数越多字越小，保证一行放得下 */
const charCount = computed(() =>
  Math.max(2, [...(lineIndex.value < 0 ? title.value : lineText.value)].length)
);

const phrases = computed(() => splitPhrases(words.value));

// 提前一点开始浮现，动画做完时刚好唱到
const PHRASE_LEAD_MS = 120;
const shown = phrase => now.value >= phrase.start - PHRASE_LEAD_MS;

const particles = Array.from({ length: 18 }, (_, i) => ({
  x: `${6 + ((i * 37) % 88)}%`,
  y: `${12 + ((i * 53) % 76)}%`,
  delay: `${(i * 0.7) % 8}s`,
  size: `${2 + (i % 3)}px`,
}));
</script>

<template>
  <div class="kinetic" :style="{ '--chars': charCount }">
    <img v-if="backdrop" class="backdrop" :src="backdrop" alt="" />
    <div class="tint" />
    <span
      v-for="(p, i) in particles"
      :key="i"
      class="particle"
      :style="{
        left: p.x,
        top: p.y,
        animationDelay: p.delay,
        width: p.size,
        height: p.size,
      }"
    />

    <!-- 还没到第一句：显示歌名 -->
    <Transition name="line">
      <div v-if="lineIndex < 0" key="intro" class="center">
        <p class="lead intro">{{ title }}</p>
        <p class="sub">{{ (track?.ar ?? []).map(a => a.name).join(' / ') }}</p>
      </div>
      <div
        v-else
        :key="lineIndex"
        class="center"
        :class="{ interlude: inInterlude }"
      >
        <p class="ghost" aria-hidden="true">{{ lineText }}</p>
        <p class="lead">
          <template v-for="(phrase, p) in phrases" :key="p">
            <span
              v-for="(word, i) in phrase.words"
              :key="i"
              class="word"
              :class="{ shown: shown(phrase) }"
              >{{ word.text }}</span
            >
          </template>
        </p>
        <p
          v-if="subText(line)"
          class="sub"
        >
          {{ subText(line) }}
        </p>
      </div>
    </Transition>

    <p class="credit"
      >《{{ track?.name }}》{{
        (track?.ar ?? []).map(a => a.name).join(' / ')
      }}</p
    >

    <svg class="defs" aria-hidden="true">
      <!-- 做旧：噪点挖掉一部分笔画，再让边缘轻微扭曲 -->
      <filter id="kinetic-rough" x="-5%" y="-15%" width="110%" height="130%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="1.1"
          numOctaves="3"
          seed="7"
          result="noise"
        />
        <feColorMatrix
          in="noise"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.75"
          result="holes"
        />
        <feComposite
          in="SourceGraphic"
          in2="holes"
          operator="in"
          result="eroded"
        />
        <feDisplacementMap
          in="eroded"
          in2="noise"
          scale="2.6"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  </div>
</template>

<style scoped>
.kinetic {
  --mist: #9fb4a9;
  overflow: hidden;
  background: #0b0d0d;
  isolation: isolate;
}
.backdrop {
  position: absolute;
  inset: -10%;
  width: 120%;
  height: 120%;
  /* 全局样式有 img { max-width: 100% }，不取消的话右边会露出一条黑边 */
  max-width: none;
  object-fit: cover;
  filter: grayscale(0.55) brightness(0.42) contrast(1.1);
  transform: scale(1.05);
}
/* 冷灰绿色调 + 四周压暗 */
.tint {
  position: absolute;
  inset: 0;
  background: radial-gradient(
      ellipse 70% 60% at 50% 45%,
      rgba(159, 180, 169, 0.14),
      transparent 70%
    ),
    radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.4));
}
/* 颗粒噪点 */
.kinetic::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  opacity: 0.32;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
.particle {
  position: absolute;
  z-index: 1;
  border-radius: 50%;
  background: #d4e6dc;
  box-shadow: 0 0 6px #d4e6dc;
  opacity: 0;
  animation: drift 8s infinite ease-in-out;
}
@keyframes drift {
  0% {
    opacity: 0;
    transform: translate(0, 0);
  }
  30% {
    opacity: 0.8;
  }
  100% {
    opacity: 0;
    transform: translate(16px, -60px);
  }
}

.center {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1.2cqh;
  padding: 0 5cqw;
  text-align: center;
  transition: opacity 0.8s;
}
/* 矮的画面（手机横屏、一起听的房间）：歌词只在下面那行「《歌名》歌手」以上的区域置中，
   不然会叠在一起 */
@container (max-height: 520px) {
  .center {
    bottom: calc(var(--controls-space, 170px) + 30px);
  }
}
/* 非常矮（房间上面多了一条「有人想加入」）：下面那行跟歌名重复，不显示，让歌词用整个框 */
@container (max-height: 320px) {
  .credit {
    display: none;
  }
  .center {
    bottom: var(--controls-space, 170px);
  }
}
.center.interlude {
  opacity: 0.35;
}

.lead,
.ghost {
  margin: 0;
  font-family: 'Noto Serif SC', 'Songti SC', 'SimSun', serif;
  font-weight: 900;
  line-height: 1.15;
  /* 字数多就缩小：最多占满 88% 宽，也不超过 20% 高 */
  font-size: calc(clamp(28px, min(88cqw / var(--chars), 20cqh), 200px));
  text-wrap: balance;
  /* 再保险：支持的浏览器会自动去掉行首行尾全角标点的半边空白 */
  text-spacing-trim: trim-both;
}
.lead {
  position: relative;
  color: #e3e9e5;
  filter: url(#kinetic-rough);
  text-shadow: 0 0 24px rgba(0, 0, 0, 0.6);
}
.lead.intro {
  /* 还没开始唱时的歌名：宽的矮框也不能太大（不然上下被切掉） */
  font-size: calc(clamp(28px, min(9cqw, 22cqh), 120px));
}
/* 歌名和下面的歌手名之间留一点空（不然手机横屏时贴在一起） */
.lead.intro + .sub {
  margin-top: 0.5em;
}
.ghost {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: -1;
  color: var(--mist);
  opacity: 0.14;
  filter: blur(6px);
  transform: translate(-4%, -10%) scale(1.45);
  white-space: nowrap;
}

/* 逐字浮现：唱到这个字时从模糊、下沉的状态浮上来 */
.word {
  display: inline-block;
  white-space: pre;
  opacity: 0;
  transform: translateY(0.22em) scale(1.06);
  filter: blur(6px);
  transition: opacity 0.18s ease-out,
    transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1.2), filter 0.22s ease-out;
}
.word.shown {
  opacity: 1;
  transform: none;
  filter: blur(0);
}

.sub {
  white-space: pre-line;
  margin: 0;
  font: 500 calc(clamp(14px, 2.2cqw, 22px)) / 1.5 'Noto Sans SC', system-ui,
    sans-serif;
  color: rgba(227, 233, 229, 0.6);
  letter-spacing: 0.04em;
}

.credit {
  position: absolute;
  z-index: 2;
  left: 0;
  right: 0;
  /* 在底部播放条的上方（--controls-space 由 LyricStage 按版面给；手机横屏比较矮） */
  bottom: calc(var(--controls-space, 170px) + 10px);
  margin: 0;
  text-align: center;
  font: 500 13px/1.4 'Noto Serif SC', serif;
  letter-spacing: 0.14em;
  color: rgba(227, 233, 229, 0.45);
}

.defs {
  position: absolute;
  width: 0;
  height: 0;
}

/* 换行：旧的一句淡出放大，新的一句淡入 */
.line-enter-active,
.line-leave-active {
  transition: opacity 0.3s, transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.line-enter-from {
  opacity: 0;
  transform: scale(0.96);
}
.line-leave-to {
  opacity: 0;
  transform: scale(1.06);
  filter: blur(6px);
}

@media (prefers-reduced-motion: reduce) {
  .particle {
    animation: none;
    opacity: 0.4;
  }
  .word {
    transition: opacity 0.2s;
    transform: none;
    filter: none;
  }
  .line-enter-active,
  .line-leave-active {
    transition: opacity 0.3s;
    transform: none;
  }
}
</style>
