<script setup>
// 风格 E：竖排诗词
// 宣纸底色，书法字体从右往左竖排；最新一句在最左边，像墨一样一段一段晕开；左下角红色印章写歌名
import { computed } from 'vue';
import { useStage, displayWords, splitPhrases } from '../useStage';

const { lines, lineIndex, now, track } = useStage();

const VISIBLE = 5; // 同时显示几列

/** 当前行和前面几行，最早的在右边（vertical-rl 的第一列在最右） */
const columns = computed(() => {
  const end = Math.max(0, lineIndex.value);
  const start = Math.max(0, end - VISIBLE + 1);
  return lines.value.slice(start, end + 1).map((line, k) => {
    const index = start + k;
    const words = displayWords(line.words);
    return {
      index,
      phrases: splitPhrases(words),
      // 字数（用来缩小字号，保证一句只占一列，不会折到旁边去和别的列重叠）
      chars: Math.max(4, [...words.map(w => w.text).join('')].length),
      current: index === lineIndex.value,
      age: end - index, // 0 是最新的一列
    };
  });
});

const PHRASE_LEAD_MS = 120;
const inked = (column, phrase) =>
  !column.current || now.value >= phrase.start - PHRASE_LEAD_MS;

/** 印章最多放 8 个字 */
const seal = computed(() =>
  [...(track.value?.name ?? '')].slice(0, 8).join('')
);
</script>

<template>
  <div class="vertical-style">
    <div class="paper" />
    <div class="columns">
      <!-- 不做"离开"动画：离开中的列会脱离排版，和新的列重叠 -->
      <p
        v-for="column in columns"
        :key="column.index"
        class="column"
        :style="{ '--age': column.age, '--chars': column.chars }"
      >
        <template v-for="(phrase, p) in column.phrases" :key="p">
          <span
            v-for="(word, w) in phrase.words"
            :key="w"
            class="word"
            :class="{ inked: inked(column, phrase) }"
            >{{ word.text }}</span
          >
        </template>
      </p>
    </div>
    <div class="seal" :aria-label="$t('歌名')">
      <span>{{ seal }}</span>
    </div>
    <p class="artist">{{ (track?.ar ?? []).map(a => a.name).join(' · ') }}</p>
  </div>
</template>

<style scoped>
.vertical-style {
  overflow: hidden;
  background: #efe6d2;
  color: #1d1a16;
}
/* 宣纸纹理：细噪点 + 四周稍暗 */
.paper {
  position: absolute;
  inset: 0;
  background: radial-gradient(
      ellipse at center,
      transparent 55%,
      rgba(120, 90, 50, 0.22)
    ),
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.27 0 0 0 0 0.15 0 0 0 0.16 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}

.columns {
  position: absolute;
  top: 10vh;
  bottom: 22vh;
  left: 12vw;
  right: 12vw;
  display: flex;
  flex-direction: row-reverse;
  justify-content: center;
  gap: 3.5vw;
}
.column {
  margin: 0;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-family: 'Ma Shan Zheng', 'KaiTi', 'STKaiti', serif;
  /* 一句只占一列：可用高度约 68vh，每个字连间距约 1.12 个字高，字多就缩小 */
  font-size: clamp(16px, min(7vh, 6vw, 60vh / var(--chars)), 72px);
  white-space: nowrap;
  line-height: 1.1;
  letter-spacing: 0.12em;
  /* 越旧的列越淡 */
  opacity: calc(1 - var(--age) * 0.18);
  transition: opacity 0.8s;
}
/* 墨迹晕开：从模糊、透明到清楚 */
.word {
  display: inline-block;
  opacity: 0;
  filter: blur(8px);
  transition: opacity 0.5s ease-out, filter 0.6s ease-out;
}
.word.inked {
  opacity: 1;
  filter: blur(0);
}

/* 印章：红底白字，竖排，略微歪一点 */
.seal {
  position: absolute;
  left: 7vw;
  bottom: 24vh;
  padding: 10px 8px;
  background: #b3261e;
  color: #f8efe2;
  border-radius: 4px;
  transform: rotate(-4deg);
  box-shadow: inset 0 0 0 3px #b3261e, inset 0 0 0 5px #f8efe2;
  font: 700 18px/1.15 'Noto Serif SC', serif;
  writing-mode: vertical-rl;
  letter-spacing: 0.1em;
  opacity: 0.92;
}
.artist {
  position: absolute;
  left: 7vw;
  bottom: 18vh;
  margin: 0;
  font: 500 14px/1.4 'Noto Serif SC', serif;
  color: rgba(29, 26, 22, 0.6);
  letter-spacing: 0.1em;
}

@media (prefers-reduced-motion: reduce) {
  .word {
    filter: none;
    transition: opacity 0.2s;
  }
}
</style>
