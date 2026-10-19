<script setup>
// 阶段 1 调试页：搜索 → 点歌 → 播放。验证电脑版和网页版的整条链路都通。
import { ref } from 'vue';
import { netease } from './services';
import { isElectron, platform, apiBase } from './platform';

const keywords = ref('有你爱就明媚');
const songs = ref([]);
const searching = ref(false);
const error = ref('');

const current = ref(null); // { song, url, br, source, lyric }
const resolving = ref(false);
const audio = ref(null);

async function search() {
  if (!keywords.value.trim()) return;
  searching.value = true;
  error.value = '';
  try {
    songs.value = await netease.searchSongs(keywords.value.trim());
  } catch (err) {
    error.value = `搜索失败：${err.message}`;
  } finally {
    searching.value = false;
  }
}

async function play(song) {
  resolving.value = true;
  error.value = '';
  try {
    // 先拿网易云自己的链接，拿不到再去其他平台找（解灰）
    const [source, lyric] = await Promise.all([
      netease.songUrl(song.id).then(s => s ?? netease.unblockUrl(song.id)),
      netease.lyric(song.id).catch(() => null),
    ]);
    if (!source) {
      current.value = null;
      error.value = `《${song.name}》网易云和其他平台都拿不到播放链接`;
      return;
    }
    current.value = { song, ...source, lyric };
    // 等 <audio> 换好 src 再播放
    requestAnimationFrame(() => audio.value?.play().catch(() => {}));
  } catch (err) {
    error.value = `获取播放链接失败：${err.message}`;
  } finally {
    resolving.value = false;
  }
}

const artists = song => song.ar.map(a => a.name).join(' / ');
const duration = ms => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const lyricPreview = lyric =>
  lyric.lrc
    .split('\n')
    .map(line => line.replace(/^\[[^\]]*\]/g, '').trim())
    .filter(line => line && !line.startsWith('{'))
    .slice(0, 6);
</script>

<template>
  <div class="app" :class="{ electron: isElectron }">
    <header class="titlebar">
      <span class="brand">LyriStage</span>
      <span class="badge">阶段 1 调试页</span>
    </header>

    <main>
      <form class="search" @submit.prevent="search">
        <input v-model="keywords" placeholder="搜索歌曲、歌手" autofocus />
        <button :disabled="searching">{{
          searching ? '搜索中…' : '搜索'
        }}</button>
      </form>

      <p v-if="error" class="error">{{ error }}</p>

      <section v-if="current" class="now-playing">
        <img :src="`${current.song.al.picUrl}?param=120y120`" alt="" />
        <div class="info">
          <strong>{{ current.song.name }}</strong>
          <span>{{ artists(current.song) }}</span>
          <span class="meta">
            音源 {{ current.source }} · {{ Math.round(current.br / 1000) }}k
            <template v-if="current.lyric">
              · 逐字歌词 {{ current.lyric.yrc ? '有' : '无' }} · 翻译
              {{ current.lyric.translation ? '有' : '无' }}
            </template>
          </span>
          <audio ref="audio" :src="current.url" controls />
        </div>
        <ul v-if="current.lyric" class="lyric-preview">
          <li v-for="(line, i) in lyricPreview(current.lyric)" :key="i">{{
            line
          }}</li>
        </ul>
      </section>

      <ul class="songs">
        <li v-for="song in songs" :key="song.id">
          <button :disabled="resolving" @click="play(song)">
            <span class="name">{{ song.name }}</span>
            <span class="artist">{{ artists(song) }} · {{ song.al.name }}</span>
            <span class="time">{{ duration(song.dt) }}</span>
          </button>
        </li>
      </ul>
    </main>

    <footer>{{ platform }} · API {{ apiBase }}</footer>
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
/* 电脑版：标题栏可以拖动窗口；右边留出系统按钮的位置 */
.electron .titlebar {
  -webkit-app-region: drag;
  padding-right: 150px;
}
.brand {
  font-weight: 700;
  letter-spacing: 0.02em;
}
.badge {
  font-size: 12px;
  color: var(--text-dim);
}

main {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 24px;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}

.search {
  display: flex;
  gap: 8px;
}
.search input {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: var(--surface);
  outline: none;
}
.search input:focus {
  border-color: var(--accent);
}
.search button {
  padding: 0 18px;
  border: 0;
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.error {
  color: var(--danger);
}

.now-playing {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px 16px;
  margin: 16px 0;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--surface);
}
.now-playing img {
  width: 96px;
  height: 96px;
  border-radius: 8px;
  object-fit: cover;
}
.info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.meta {
  font-size: 12px;
  color: var(--text-dim);
}
.info audio {
  width: 100%;
  margin-top: 6px;
}
.lyric-preview {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--text-dim);
  line-height: 1.8;
}

.songs {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.songs button {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 12px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  text-align: left;
  cursor: pointer;
}
.songs button:hover {
  background: var(--surface-hover);
}
.name {
  font-weight: 600;
}
.artist {
  grid-row: 2;
  font-size: 13px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  grid-row: 1 / span 2;
  align-self: center;
  font-size: 13px;
  color: var(--text-dim);
}

footer {
  padding: 6px 16px;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
