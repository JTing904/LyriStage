<script setup>
// 首页：问候、每日推荐 / 私人 FM / 继续播放、推荐歌单、新歌速递、排行榜
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { netease, createFmSource } from '../services';
import { usePlayer } from '../composables/usePlayer';
import { useAuthStore } from '../stores/auth';
import { useRecentStore } from '../stores/recent';
import { useAvatarStore } from '../stores/avatar';
import AvatarFigure from '../components/AvatarFigure.vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';

const router = useRouter();
const { state, player } = usePlayer();
const auth = useAuthStore();
const avatar = useAvatarStore();
const recent = useRecentStore();

const now = new Date();
const greeting = computed(() => {
  const h = now.getHours();
  if (h < 5) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
});
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

const keywords = ref('');
function search() {
  const q = keywords.value.trim();
  if (q) router.push({ path: '/search', query: { q } });
}

const playlists = ref([]);
const newSongs = ref([]);
const charts = ref([]);
const loading = ref(true);
const failed = ref(false);

onMounted(async () => {
  const [p, s, c] = await Promise.allSettled([
    netease.recommendedPlaylists(12),
    netease.newSongs(10),
    netease.toplists(),
  ]);
  if (p.status === 'fulfilled') playlists.value = p.value.slice(0, 12);
  if (s.status === 'fulfilled') newSongs.value = s.value.slice(0, 8);
  if (c.status === 'fulfilled') charts.value = c.value.slice(0, 4);
  failed.value = [p, s, c].every(r => r.status === 'rejected');
  loading.value = false;
});

const fmPlaying = computed(() => state.mode === 'fm' && state.track);
async function playFm() {
  if (fmPlaying.value) return player.toggle();
  await player.playFm(createFmSource(auth.loggedIn));
}

const continueList = computed(() => recent.tracks.slice(0, 3));
const artists = track => (track.ar ?? []).map(a => a.name).join(' / ');
const clock = ms => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
</script>

<template>
  <div class="home">
    <form class="search" role="search" @submit.prevent="search">
      <Icon name="search" :size="18" />
      <input v-model="keywords" placeholder="搜索歌曲、歌手、歌单" aria-label="搜索" />
    </form>

    <header class="hello">
      <div class="hello-text">
        <h1 class="display">
          {{ greeting }}<template v-if="auth.displayName">，{{ auth.displayName }}</template>
        </h1>
        <p>今天也有歌想听吗？</p>
      </div>
      <!-- 我的公仔（衣服在设置里换，默认蓝格子） -->
      <AvatarFigure class="hello-figure" :url="avatar.url" />
      <!-- 手机版没有侧边栏，从这里进设置 -->
      <RouterLink to="/settings" class="mobile-settings" aria-label="设置">
        <Icon name="settings" />
      </RouterLink>
    </header>

    <section class="cards" aria-label="为你准备">
      <RouterLink to="/daily" class="card daily">
        <span class="label">每日推荐</span>
        <span class="day display">{{ now.getDate() }}</span>
        <span class="sub">{{ MONTHS[now.getMonth()] }}月 · 星期{{ WEEKDAYS[now.getDay()] }}</span>
        <span class="hint">
          {{ auth.loggedIn ? '按你最近的听歌记录挑选' : '登录后会按你的口味推荐' }}
        </span>
        <span class="fab" aria-hidden="true"><Icon name="play" /></span>
      </RouterLink>

      <div class="card fm">
        <span class="label">私人 FM</span>
        <p class="fm-line display">
          {{ fmPlaying ? state.track.name : '随便听听，遇见没听过的歌' }}
        </p>
        <div class="fm-row">
          <template v-if="fmPlaying">
            <Cover :url="state.track.al?.picUrl" :size="44" class="fm-cover" />
            <span class="fm-meta">
              <strong>{{ state.track.name }}</strong>
              <span>{{ artists(state.track) }}</span>
            </span>
          </template>
          <button
            class="fm-play"
            :aria-label="fmPlaying && state.playing ? '暂停私人 FM' : '播放私人 FM'"
            @click="playFm"
          >
            <Icon :name="fmPlaying && state.playing ? 'pause' : 'play'" :size="20" />
          </button>
        </div>
      </div>

      <div class="card continue">
        <span class="label">继续播放</span>
        <p v-if="continueList.length === 0" class="empty">播过的歌会出现在这里</p>
        <button
          v-for="track in continueList"
          :key="track.id"
          class="row"
          @click="player.playList([track], 0, 'recent')"
        >
          <Cover :url="track.al?.picUrl" :size="44" />
          <span class="meta">
            <strong>{{ track.name }}</strong>
            <span>{{ artists(track) }}</span>
          </span>
        </button>
      </div>
    </section>

    <p v-if="failed" class="error">内容加载失败，请检查网络后重新打开。</p>

    <section v-if="playlists.length || loading" aria-labelledby="h-lists">
      <h2 id="h-lists" class="display">推荐歌单</h2>
      <div class="grid">
        <RouterLink
          v-for="p in playlists"
          :key="p.id"
          :to="`/playlist/${p.id}`"
          class="tile"
        >
          <Cover :url="p.picUrl" :size="180" radius="12px" />
          <span class="tile-name">{{ p.name }}</span>
        </RouterLink>
      </div>
    </section>

    <div class="split">
      <section v-if="newSongs.length" aria-labelledby="h-new" class="new">
        <h2 id="h-new" class="display">新歌速递</h2>
        <div class="songs">
          <button
            v-for="(song, i) in newSongs"
            :key="song.id"
            class="row song"
            :class="{ playing: state.track?.id === song.id }"
            @click="player.playList(newSongs, i, 'new-songs')"
          >
            <Cover :url="song.al?.picUrl" :size="48" />
            <span class="meta">
              <strong>{{ song.name }}</strong>
              <span>{{ artists(song) }}</span>
            </span>
            <span class="time">{{ clock(song.dt) }}</span>
          </button>
        </div>
      </section>

      <section v-if="charts.length" aria-labelledby="h-charts" class="charts">
        <h2 id="h-charts" class="display">排行榜</h2>
        <div class="chart-grid">
          <RouterLink
            v-for="c in charts"
            :key="c.id"
            :to="`/playlist/${c.id}`"
            class="chart"
          >
            <Cover :url="c.coverImgUrl" :size="72" radius="10px" />
            <span class="meta">
              <strong>{{ c.name }}</strong>
              <span>{{ c.updateFrequency }}</span>
            </span>
          </RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 36px;
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px clamp(16px, 3vw, 40px) 48px;
}

.search {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 460px;
  height: 44px;
  padding: 0 16px;
  border-radius: 22px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text-dim);
}
.search:focus-within {
  border-color: var(--accent);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 15px;
}

.hello {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  /* 公仔比文字高，往上下多占一点，不把下面的卡片推太远 */
  margin: -24px 0 -20px;
}
.hello-text {
  min-width: 0;
  padding-bottom: 28px;
}
.hello-figure {
  flex: none;
  width: 170px;
  height: 210px;
}
.mobile-settings {
  display: none;
  position: absolute;
  top: 0;
  right: 0;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-dim);
}
@media (max-width: 899px) {
  .mobile-settings {
    display: grid;
  }
  .hello {
    margin: 0;
  }
  .hello-text {
    padding-bottom: 8px;
  }
  .hello-figure {
    width: 96px;
    height: 128px;
    margin-right: 44px;
  }
}
.hello h1 {
  margin: 0;
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.15;
}
.hello p {
  margin: 6px 0 0;
  color: var(--text-dim);
}

h2 {
  margin: 0 0 16px;
  font-size: 26px;
}

/* 三张大卡片 */
.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
@media (max-width: 1100px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 230px;
  padding: 22px;
  border-radius: 20px;
  overflow: hidden;
}
.label {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.daily {
  color: #fff;
  background: linear-gradient(140deg, #ff3b5c 0%, #b4235a 45%, #3b1c4a 100%);
}
.day {
  font-size: 88px;
  line-height: 1;
}
.daily .sub {
  font-size: 14px;
  opacity: 0.9;
}
.hint {
  margin-top: auto;
  font-size: 13px;
  opacity: 0.9;
}
.fab {
  position: absolute;
  right: 20px;
  bottom: 20px;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #fff;
  color: #111;
}

.fm {
  justify-content: space-between;
  color: #e3e9e5;
  background: radial-gradient(ellipse at 30% 30%, #3e4b46, #141917 75%);
}
:global([data-theme='light']) .fm {
  color: #1f2a24;
  background: linear-gradient(150deg, #e6eeea, #c8d6ce);
}
@media (prefers-color-scheme: light) {
  :global(:root:not([data-theme='dark'])) .fm {
    color: #1f2a24;
    background: linear-gradient(150deg, #e6eeea, #c8d6ce);
  }
}
.fm-line {
  margin: 0;
  font-size: 30px;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fm-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fm-cover {
  width: 44px;
}
.fm-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
}
.fm-meta span {
  opacity: 0.7;
}
.fm-play {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: currentColor;
}
.fm-play :deep(svg) {
  color: var(--bg);
}

.continue {
  background: var(--surface);
  border: 1px solid var(--line);
}
.empty {
  margin: auto 0;
  color: var(--text-dim);
  font-size: 14px;
}

/* 列表行（继续播放、新歌） */
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: none;
  text-align: left;
}
.row:hover {
  background: var(--surface-hover);
}
.row :deep(.cover) {
  width: 44px;
}
.song :deep(.cover) {
  width: 48px;
}
.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.meta strong,
.meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta strong {
  font-size: 15px;
}
.meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.song.playing strong {
  color: var(--accent);
}
.time {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

/* 歌单网格 */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 20px 18px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.tile :deep(.cover) {
  width: 100%;
  transition: transform 0.2s;
}
.tile:hover :deep(.cover) {
  transform: translateY(-3px);
}
.tile-name {
  font-size: 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.split {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
}
.new {
  flex: 2 1 480px;
  min-width: 0;
}
.songs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 20px;
}
@media (max-width: 640px) {
  .songs {
    grid-template-columns: minmax(0, 1fr);
  }
}
.charts {
  flex: 1 1 280px;
  min-width: 0;
}
.chart-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chart {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px;
  border-radius: 12px;
}
.chart:hover {
  background: var(--surface-hover);
}
.chart :deep(.cover) {
  width: 64px;
}

.error {
  margin: 0;
  color: var(--danger);
}
</style>
