<script setup>
// 风格 G：打字机 / 终端
// 黑底、扫描线、琥珀色等宽字；当前这句跟着演唱一个字一个字"打"出来，光标闪烁；
// 前面的句子像终端记录一样留在上面，翻译用绿色注释
import { computed } from 'vue';
import { useStage, displayWords } from '../useStage';

const { lines, lineIndex, line, now, track, settings } = useStage();

const HISTORY = 9; // 上面保留几句

const history = computed(() => {
  const end = Math.max(0, lineIndex.value);
  return lines.value.slice(Math.max(0, end - HISTORY), end).map(l => ({
    text: displayWords(l.words)
      .map(w => w.text)
      .join(''),
    sub: l.translation || l.romaji,
  }));
});

/** 当前这句的字（换句时才重算，不要每一帧都算） */
const currentWords = computed(() => (line.value ? displayWords(line.value.words) : []));

/** 当前这句已经打出来的字：每个词按唱到的比例露出 */
const typed = computed(() => {
  let out = '';
  for (const word of currentWords.value) {
    if (now.value < word.start) break;
    const chars = [...word.text];
    const ratio =
      word.duration > 0 ? (now.value - word.start) / word.duration : 1;
    out += chars
      .slice(0, Math.ceil(Math.min(1, ratio) * chars.length))
      .join('');
  }
  return out;
});

const command = computed(
  () =>
    `lyristage play "${track.value?.name ?? ''}" --by "${(track.value?.ar ?? [])
      .map(a => a.name)
      .join(', ')}"`
);
</script>

<template>
  <div class="typewriter">
    <div class="screen">
      <p class="prompt">
        <span class="user">you@lyristage</span>:<span class="path">~</span>$
        {{ command }}
      </p>
      <div
        v-for="(item, i) in history"
        :key="`${lineIndex}-${i}`"
        class="entry"
      >
        <p class="out">{{ item.text }}</p>
        <p v-if="settings.showTranslation && item.sub" class="comment"
          >// {{ item.sub }}</p
        >
      </div>
      <div class="entry current">
        <p class="out">
          <span class="marker">&gt;</span> {{ typed
          }}<span class="cursor" aria-hidden="true" />
        </p>
        <p
          v-if="
            settings.showTranslation &&
            line &&
            (line.translation || line.romaji) &&
            typed
          "
          class="comment"
        >
          // {{ line.translation || line.romaji }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.typewriter {
  --amber: #ffb547;
  --green: #7bd88f;
  overflow: hidden;
  background: radial-gradient(ellipse at center, #1a1206 0%, #070604 75%);
  color: var(--amber);
  font-family: 'JetBrains Mono', 'Noto Sans SC', ui-monospace, monospace;
}
/* 扫描线 */
.typewriter::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    transparent 0 2px,
    rgba(0, 0, 0, 0.28) 2px 3px
  );
}
.screen {
  position: absolute;
  left: 8vw;
  right: 8vw;
  top: 10vh;
  bottom: calc(var(--controls-space, 170px) + 30px);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.6em;
  overflow: hidden;
  font-size: clamp(16px, 1.9vw, 28px);
  line-height: 1.45;
  text-shadow: 0 0 6px rgba(255, 181, 71, 0.55),
    0 0 18px rgba(255, 181, 71, 0.25);
  mask-image: linear-gradient(transparent, #000 30%);
}
.screen p {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.prompt {
  color: rgba(255, 181, 71, 0.65);
  font-size: 0.75em;
}
.user {
  color: var(--green);
}
.path {
  color: #6cb6ff;
}
.entry .out {
  opacity: 0.55;
}
.entry.current .out {
  opacity: 1;
  font-size: 1.35em;
  font-weight: 500;
}
.marker {
  color: var(--green);
}
.comment {
  color: var(--green);
  opacity: 0.7;
  font-size: 0.8em;
  text-shadow: 0 0 6px rgba(123, 216, 143, 0.45);
}
.cursor {
  display: inline-block;
  width: 0.6em;
  height: 1.05em;
  margin-left: 2px;
  vertical-align: -0.15em;
  background: var(--amber);
  box-shadow: 0 0 8px rgba(255, 181, 71, 0.8);
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cursor {
    animation: none;
  }
}
</style>
