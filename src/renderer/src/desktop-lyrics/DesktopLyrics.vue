<script setup>
// 桌面歌词：透明背景上的一行大字，唱到哪里就从左到右填上颜色（卡拉 OK）。
// 下面一行小字：翻译，没有翻译就显示下一句。
// 没锁定时鼠标移上来会出现底色和按钮（锁定、关闭），整个窗口可以拖动、拉大小
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { wordProgress } from '@core/lyrics';

const bridge = window.lyristage;
const payload = shallowRef(null);
let receivedAt = 0;
const locked = ref(false);
/** 现在的播放时间（毫秒），每一帧更新 */
const now = ref(0);

onMounted(() => {
  bridge?.onLyric(data => {
    payload.value = data;
    receivedAt = performance.now();
  });
  bridge?.onLyricsWindowState(state => {
    locked.value = state.locked;
  });
  tick();
});

let raf = 0;
function tick() {
  const p = payload.value;
  if (p) now.value = p.time * 1000 + (p.playing ? performance.now() - receivedAt : 0);
  raf = requestAnimationFrame(tick);
}
onBeforeUnmount(() => cancelAnimationFrame(raf));

const line = computed(() => payload.value?.line ?? null);
const words = computed(() => line.value?.words ?? []);
const sub = computed(() => line.value?.translation || payload.value?.next || '');
/** 每个字唱到哪里（0~1） */
const progress = computed(() => words.value.map(w => wordProgress(w, now.value)));
/** 还没到第一句：显示歌名 */
const title = computed(() => {
  const p = payload.value;
  if (!p?.title) return '';
  return p.artist ? `${p.title} - ${p.artist}` : p.title;
});
</script>

<template>
  <div class="desktop-lyrics" :class="{ locked }">
    <div class="bar">
      <button title="锁定（鼠标会穿透，从托盘解锁）" @click="bridge?.lyricsWindow('lock')">🔒 锁定</button>
      <button title="关掉桌面歌词" @click="bridge?.lyricsWindow('close')">✕</button>
    </div>

    <div class="text">
      <p v-if="line && words.length" class="main" :key="line.start">
        <span
          v-for="(w, i) in words"
          :key="i"
          class="word"
          :style="{ '--p': progress[i] }"
          >{{ w.text }}</span
        >
      </p>
      <p v-else-if="line" class="main plain">{{ line.text }}</p>
      <p v-else class="main plain">{{ title || 'LyriStage' }}</p>
      <p v-if="line && sub" class="sub">{{ sub }}</p>
    </div>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
  background: transparent;
  overflow: hidden;
}
body {
  font-family: 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif;
  user-select: none;
}
</style>

<style scoped>
.desktop-lyrics {
  position: relative;
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  transition: background 0.2s;
  /* 整个窗口都可以拖动 */
  -webkit-app-region: drag;
}
.desktop-lyrics:not(.locked):hover {
  background: rgb(0 0 0 / 0.45);
}
.bar {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 10px 0;
  opacity: 0;
  transition: opacity 0.2s;
}
.desktop-lyrics:not(.locked):hover .bar {
  opacity: 1;
}
.bar button {
  -webkit-app-region: no-drag;
  padding: 4px 10px;
  border: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.16);
  color: #fff;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.bar button:hover {
  background: rgb(255 255 255 / 0.3);
}
.text {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 0 24px 12px;
  text-align: center;
}
p {
  margin: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main {
  font-size: clamp(22px, 5vh + 1vw, 40px);
  font-weight: 900;
  line-height: 1.25;
  /* 白字黑边：任何背景上都看得清 */
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.9)) drop-shadow(0 2px 6px rgb(0 0 0 / 0.6));
}
.plain {
  color: #fff;
}
/* 卡拉 OK：唱过的部分是红色渐变，没唱到的是白色 */
.word {
  white-space: pre;
  background: linear-gradient(
    90deg,
    #ff5d7a 0%,
    #ffb36b calc(var(--p) * 100%),
    #fff calc(var(--p) * 100%),
    #fff 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sub {
  color: rgb(255 255 255 / 0.85);
  font-size: clamp(13px, 2.4vh + 0.4vw, 20px);
  font-weight: 700;
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.9)) drop-shadow(0 1px 4px rgb(0 0 0 / 0.6));
}
</style>
