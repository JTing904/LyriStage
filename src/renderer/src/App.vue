<script setup>
// 阶段 2 调试页：用新的播放器、歌词解析验证核心逻辑。
// 正式界面在阶段 3（歌词舞台）和阶段 4（页面）重做。
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { findLineIndex, wordProgress } from '@core/lyrics';
import { netease, getLyrics } from './services';
import { usePlayer } from './composables/usePlayer';
import { isElectron, platform, apiBase } from './platform';
import LyricStage from './lyric-stage/LyricStage.vue';

const stageOpen = ref(false);

const { state, player } = usePlayer();

const keywords = ref('有你爱就明媚');
const songs = ref([]);
const searching = ref(false);
const message = ref('');

async function search() {
  if (!keywords.value.trim()) return;
  searching.value = true;
  message.value = '';
  try {
    songs.value = await netease.searchSongs(keywords.value.trim());
  } catch (err) {
    message.value = `搜索失败：${err.message}`;
  } finally {
    searching.value = false;
  }
}

// 自己点歌时清掉旧提示（自动跳过时保留，才看得到哪首被跳过）
function playAt(index) {
  message.value = '';
  player.playList(songs.value, index, 'search');
}
player.on('unplayable', ({ track }) => {
  message.value = `《${track.name}》网易云和其他平台都拿不到播放链接，已跳过`;
});
player.on('error', ({ error }) => {
  message.value = `播放出错：${error.message}`;
});

// 歌词 ---------------------------------------------------------------------------
const lyrics = ref(null);
watch(
  () => state.track?.id,
  async id => {
    lyrics.value = null;
    if (!id) return;
    try {
      const result = await getLyrics(state.track);
      if (state.track?.id === id) lyrics.value = result;
    } catch (err) {
      message.value = `歌词加载失败：${err.message}`;
    }
  },
  { immediate: true }
);

// 每一帧读精确的播放时间，算当前行和每个字的进度
const nowMs = ref(0);
let frame = 0;
function tick() {
  nowMs.value = player.currentTime() * 1000;
  frame = requestAnimationFrame(tick);
}
onMounted(() => (frame = requestAnimationFrame(tick)));
onBeforeUnmount(() => cancelAnimationFrame(frame));

const lineIndex = computed(() =>
  lyrics.value ? findLineIndex(lyrics.value.lines, nowMs.value) : -1
);
const lineRefs = ref([]);
const lyricsBox = ref(null);
// 只滚动歌词区域：scrollIntoView 会把所有外层容器（整页、左边歌单）一起滚动
watch(lineIndex, index => {
  const box = lyricsBox.value;
  const line = lineRefs.value[index];
  if (!box || !line) return;
  const top = line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2;
  box.scrollTo({ top, behavior: 'smooth' });
});

// 显示 ----------------------------------------------------------------------------
const artists = song => (song?.ar ?? []).map(a => a.name).join(' / ');
const clock = seconds => {
  const s = Math.floor(seconds || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const REPEAT_LABEL = { off: '不循环', all: '列表循环', one: '单曲循环' };
const nextRepeat = { off: 'all', all: 'one', one: 'off' };
</script>

<template>
  <div class="app" :class="{ electron: isElectron }">
    <header class="titlebar">
      <span class="brand">LyriStage</span>
      <span class="badge">阶段 2 调试页</span>
    </header>

    <div class="body">
      <section class="left">
        <form class="search" @submit.prevent="search">
          <input v-model="keywords" placeholder="搜索歌曲、歌手" />
          <button :disabled="searching">{{
            searching ? '搜索中…' : '搜索'
          }}</button>
        </form>
        <p v-if="message" class="message">{{ message }}</p>
        <ul class="songs">
          <li v-for="(song, i) in songs" :key="song.id">
            <button
              :class="{ active: state.track?.id === song.id }"
              @click="playAt(i)"
            >
              <span class="name">{{ song.name }}</span>
              <span class="artist"
                >{{ artists(song) }} · {{ song.al?.name }}</span
              >
            </button>
          </li>
        </ul>
      </section>

      <section class="right">
        <div v-if="state.track" class="now">
          <img :src="`${state.track.al?.picUrl}?param=120y120`" alt="" />
          <div class="info">
            <strong>{{ state.track.name }}</strong>
            <span>{{ artists(state.track) }}</span>
            <span class="meta">
              <template v-if="state.source">
                音源 {{ state.source.source }} ·
                {{ Math.round((state.source.br || 0) / 1000) }}k
              </template>
              <template v-if="lyrics">
                · {{ lyrics.hasWordTiming ? '逐字歌词' : '逐字时间为估算' }}
                <template v-if="lyrics.hasTranslation"> · 有翻译</template>
                <template v-if="lyrics.credits.length">
                  · 信息 {{ lyrics.credits.length }} 条</template
                >
              </template>
            </span>
          </div>
        </div>

        <div v-if="state.track" class="controls">
          <button @click="player.prev()">上一首</button>
          <button class="primary" @click="player.toggle()">
            {{ state.loading ? '加载中' : state.playing ? '暂停' : '播放' }}
          </button>
          <button @click="player.next()">下一首</button>
          <button @click="player.setRepeat(nextRepeat[state.repeat])">
            {{ REPEAT_LABEL[state.repeat] }}
          </button>
          <button @click="player.setShuffle(!state.shuffle)">
            {{ state.shuffle ? '随机：开' : '随机：关' }}
          </button>
          <button class="primary" @click="stageOpen = true">歌词舞台</button>
        </div>
        <div v-if="state.track" class="progress">
          <span>{{ clock(state.time) }}</span>
          <input
            type="range"
            min="0"
            :max="state.duration || 1"
            step="0.1"
            :value="state.time"
            @change="player.seek(Number($event.target.value))"
          />
          <span>{{ clock(state.duration) }}</span>
        </div>

        <div v-if="lyrics" ref="lyricsBox" class="lyrics">
          <p v-if="lyrics.instrumental" class="hint">纯音乐，请欣赏</p>
          <div
            v-for="(line, i) in lyrics.lines"
            :key="i"
            :ref="el => (lineRefs[i] = el)"
            class="line"
            :class="{ current: i === lineIndex, past: i < lineIndex }"
            @click="player.seek(line.start / 1000)"
          >
            <p class="text">
              <template v-if="i === lineIndex">
                <span
                  v-for="(word, w) in line.words"
                  :key="w"
                  class="word"
                  :style="{ '--p': wordProgress(word, nowMs) }"
                  >{{ word.text }}</span
                >
              </template>
              <template v-else>{{ line.text }}</template>
            </p>
            <p v-if="line.translation" class="sub">{{ line.translation }}</p>
          </div>
        </div>
      </section>
    </div>

    <footer>{{ platform }} · API {{ apiBase }}</footer>

    <LyricStage
      v-if="stageOpen"
      :state="state"
      :player="player"
      :get-lyrics="getLyrics"
      @close="stageOpen = false"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--titlebar-height);
  padding: 0 16px;
  flex-shrink: 0;
}
.electron .titlebar {
  -webkit-app-region: drag;
  padding-right: 150px;
}
.brand {
  font-weight: 700;
}
.badge,
footer {
  font-size: 12px;
  color: var(--text-dim);
}
footer {
  padding: 6px 16px;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 2fr;
  gap: 16px;
  padding: 0 16px;
}
@media (max-width: 760px) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    overflow-y: auto;
  }
}
.left,
.right {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.search {
  display: flex;
  gap: 8px;
}
.search input {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: var(--surface);
  outline: none;
}
.search input:focus {
  border-color: var(--accent);
}
button {
  padding: 8px 14px;
  border: 0;
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}
button:hover {
  background: var(--surface-hover);
}
.search button,
button.primary {
  background: var(--accent);
  color: #fff;
}
.message {
  color: var(--danger);
  font-size: 13px;
}

.songs {
  flex: 1;
  overflow-y: auto;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.songs button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  background: none;
  text-align: left;
}
.songs button.active {
  background: var(--surface);
}
.songs button.active .name {
  color: var(--accent);
}
.name {
  font-weight: 600;
}
.artist {
  font-size: 12px;
  color: var(--text-dim);
}

.now {
  display: flex;
  gap: 12px;
  align-items: center;
}
.now img {
  width: 64px;
  height: 64px;
  border-radius: 8px;
}
.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta {
  font-size: 12px;
  color: var(--text-dim);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.progress input {
  flex: 1;
  accent-color: var(--accent);
}

/* 歌词：阶段 3 的歌词舞台会完全重做，这里只验证数据是对的 */
.lyrics {
  /* offsetTop 以它为基准，滚动位置才算得准 */
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 12px;
  padding: 30vh 4px;
  mask-image: linear-gradient(transparent, #000 15%, #000 85%, transparent);
}
.line {
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  opacity: 0.45;
  transition: opacity 0.3s;
}
.line:hover {
  background: var(--surface);
}
.line.current {
  opacity: 1;
}
.text {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.4;
}
.sub {
  margin: 2px 0 0;
  font-size: 14px;
  color: var(--text-dim);
}
/* 逐字高亮：--p 是这个字唱到的进度（0~1），用渐变把已唱的部分涂成强调色 */
.word {
  background: linear-gradient(
    90deg,
    var(--accent) calc(var(--p) * 100%),
    var(--text) calc(var(--p) * 100%)
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hint {
  color: var(--text-dim);
  text-align: center;
}
</style>
