<script setup>
// 风格 D：卡拉OK / KTV 双行
// 画面下方两行交替：单数行靠左、双数行靠右；当前行逐字填色，文字有黑色描边
import { computed } from 'vue';
import { wordProgress } from '@core/lyrics';
import { useStage, displayWords } from '../useStage';
import CoverBackdrop from '../CoverBackdrop.vue';

const { lines, lineIndex, now, track, subText } =
  useStage();

/**
 * 两个位置：上面靠左（双数行）、下面靠右（单数行）。
 * 当前行在它的位置上填色，另一个位置显示下一行（还没唱）
 */
const slots = computed(() => {
  const index = Math.max(0, lineIndex.value);
  const pair = [index, index + 1].map(i => {
    const line = lines.value[i];
    return line && { index: i, ...line, words: displayWords(line.words) };
  });
  const result = [null, null];
  for (const line of pair) {
    if (line) result[line.index % 2] = line;
  }
  return result;
});

const progressOf = (line, word) =>
  line.index === lineIndex.value ? wordProgress(word, now.value) : 0;
</script>

<template>
  <div class="karaoke">
    <CoverBackdrop :dim="0.55" />
    <div class="title">
      <strong>{{ track?.name }}</strong>
      <span>{{ (track?.ar ?? []).map(a => a.name).join(' / ') }}</span>
    </div>

    <div class="slots">
      <div
        v-for="(line, slot) in slots"
        :key="slot"
        class="slot"
        :class="slot === 0 ? 'left' : 'right'"
      >
        <Transition name="swap" mode="out-in">
          <div v-if="line" :key="line.index">
            <p class="text">
              <span
                v-for="(word, w) in line.words"
                :key="w"
                class="word"
                :data-text="word.text"
                :style="{ '--p': progressOf(line, word) }"
                >{{ word.text }}</span
              >
            </p>
            <p
              v-if="
                subText(line)
              "
              class="sub"
            >
              {{ subText(line) }}
            </p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.karaoke {
  overflow: hidden;
}
.title {
  position: absolute;
  top: 12vh;
  left: 0;
  right: 0;
  display: grid;
  justify-items: center;
  gap: 6px;
  text-align: center;
  font-family: 'Noto Sans SC', system-ui, sans-serif;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}
.title strong {
  font-size: clamp(22px, 3vw, 40px);
  font-weight: 900;
}
.title span {
  color: rgba(255, 255, 255, 0.75);
}

.slots {
  position: absolute;
  left: 6vw;
  right: 6vw;
  /* 底部播放条的上方（--controls-space 由 LyricStage 按版面给） */
  bottom: calc(var(--controls-space, 170px) + 20px);
  display: grid;
  gap: 2.5vh;
}
.slot.left {
  justify-self: start;
}
.slot.right {
  justify-self: end;
  text-align: right;
}
.text {
  margin: 0;
  font: 900 clamp(28px, 4.4vw, 68px) / 1.2 'Noto Sans SC', system-ui, sans-serif;
  letter-spacing: 0.02em;
}
/*
  每个字两层：
  - 底层：白字 + 黑描边（还没唱的样子）
  - 上层（::after）：金色字，宽度按 --p 露出（唱过的部分）
*/
.word {
  position: relative;
  display: inline-block;
  white-space: pre;
  color: #fff;
  -webkit-text-stroke: 0.06em #111;
  paint-order: stroke fill;
}
.word::after {
  content: attr(data-text);
  position: absolute;
  left: 0;
  top: 0;
  color: #ffd23f;
  -webkit-text-stroke: 0.06em #3a1d00;
  paint-order: stroke fill;
  clip-path: inset(-20% calc((1 - var(--p)) * 100%) -20% -5%);
}
.sub {
  white-space: pre-line;
  margin: 0.3em 0 0;
  font: 700 clamp(14px, 1.8vw, 24px) / 1.4 'Noto Sans SC', system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
}

.swap-enter-active,
.swap-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
