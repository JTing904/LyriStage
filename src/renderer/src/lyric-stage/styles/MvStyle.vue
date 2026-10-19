<script setup>
// 风格 F：动态字体 MV
// 当前这句按空格和标点分成几段，每段是一块：不同的大小、角度、颜色和字体，依次弹出来；
// 短的段更大（强调）。中文一个字就是一个词，按字随机会太乱，所以按段。
// 排版用"行号 + 歌词"当随机种子，同一句每次看到都一样
import { computed } from 'vue';
import { createRng } from '@core/recommend/engine';
import { useStage, displayWords, splitPhrases } from '../useStage';
import { rgb, withLightness } from '../palette';

const { line, lineIndex, now, palette, track, settings } = useStage();

const PHRASE_LEAD_MS = 120;

const pieces = computed(() => {
  if (!line.value) return [];
  const rng = createRng(`mv:${lineIndex.value}:${line.value.text}`);
  const phrases = splitPhrases(displayWords(line.value.words));
  return phrases
    .map((phrase, p) => {
      const text = phrase.words
        .map(w => w.text)
        .join('')
        .trim();
      const chars = [...text].length;
      // 短的段（4 个字以内）放大强调，长的段缩小免得一行太宽
      const base = chars <= 4 ? 1.35 : chars <= 8 ? 1.05 : 0.8;
      const r = rng();
      return {
        key: p,
        text,
        phrase,
        scale: base + r * 0.3,
        rotate: (rng() - 0.5) * 10,
        lift: (rng() - 0.5) * 0.5,
        tone: r < 0.25 ? 'accent' : r < 0.4 ? 'ink' : 'paper',
        serif: rng() < 0.4,
      };
    })
    .filter(piece => piece.text);
});

const shown = piece => now.value >= piece.phrase.start - PHRASE_LEAD_MS;

const colors = computed(() => ({
  '--bg': rgb(withLightness(palette.value.vibrant, 0.48, 0.55)),
  '--bg2': rgb(withLightness(palette.value.dominant, 0.3, 0.4)),
  '--accent': rgb(withLightness(palette.value.vibrant, 0.82, 0.7)),
}));
</script>

<template>
  <div class="mv-style" :style="colors">
    <div class="shape s1" />
    <div class="shape s2" />
    <div class="stripe" />

    <Transition name="burst" mode="out-in">
      <div v-if="lineIndex < 0" key="intro" class="stage-center">
        <span class="piece paper serif shown" style="--scale: 1.6">{{
          track?.name
        }}</span>
      </div>
      <div v-else :key="lineIndex" class="stage-center">
        <span
          v-for="piece in pieces"
          :key="piece.key"
          class="piece"
          :class="[piece.tone, { serif: piece.serif, shown: shown(piece) }]"
          :style="{
            '--scale': piece.scale,
            '--rotate': `${piece.rotate}deg`,
            '--lift': `${piece.lift}em`,
          }"
          >{{ piece.text }}</span
        >
        <p
          v-if="settings.showTranslation && (line.translation || line.romaji)"
          class="sub"
        >
          {{ line.translation || line.romaji }}
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mv-style {
  overflow: hidden;
  background: linear-gradient(135deg, var(--bg), var(--bg2));
  transition: background 1s;
}
/* 大色块和斜条纹，像 MV 的背景板 */
.shape {
  position: absolute;
  border-radius: 50%;
  mix-blend-mode: soft-light;
  background: #fff;
  opacity: 0.35;
}
.s1 {
  width: 60vmin;
  height: 60vmin;
  left: -12vmin;
  top: -18vmin;
  animation: bob 9s ease-in-out infinite alternate;
}
.s2 {
  width: 40vmin;
  height: 40vmin;
  right: -8vmin;
  bottom: -6vmin;
  background: #000;
  opacity: 0.25;
  animation: bob 11s ease-in-out infinite alternate-reverse;
}
.stripe {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    -35deg,
    transparent 0 46px,
    rgba(255, 255, 255, 0.06) 46px 52px
  );
}
@keyframes bob {
  to {
    transform: translate(4vmin, 3vmin) scale(1.08);
  }
}

.stage-center {
  position: absolute;
  inset: 8vh 8vw 200px;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  align-items: center;
  gap: 0.15em 0.35em;
  font-size: clamp(26px, 4.2vw, 64px);
}
.piece {
  display: inline-block;
  font: 900 calc(1em * var(--scale)) / 1.05 'Noto Sans SC', system-ui,
    sans-serif;
  transform: translateY(var(--lift)) rotate(var(--rotate)) scale(0.2);
  opacity: 0;
  transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s;
}
.piece.serif {
  font-family: 'Noto Serif SC', serif;
}
.piece.shown {
  transform: translateY(var(--lift)) rotate(var(--rotate)) scale(1);
  opacity: 1;
}
.piece.paper {
  color: #fff;
  text-shadow: 0.04em 0.05em 0 rgba(0, 0, 0, 0.25);
}
.piece.accent {
  color: var(--accent);
  text-shadow: 0.04em 0.05em 0 rgba(0, 0, 0, 0.3);
}
.piece.ink {
  color: #111;
  background: #fff;
  padding: 0 0.15em;
}
.sub {
  flex-basis: 100%;
  margin: 0.8em 0 0;
  text-align: center;
  font: 700 clamp(14px, 1.6vw, 22px) / 1.4 'Noto Sans SC', system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.85);
}

.burst-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.burst-leave-to {
  opacity: 0;
  transform: scale(1.12);
}

@media (prefers-reduced-motion: reduce) {
  .shape {
    animation: none;
  }
  .piece {
    transition: opacity 0.2s;
    transform: translateY(var(--lift)) rotate(var(--rotate));
  }
}
</style>
