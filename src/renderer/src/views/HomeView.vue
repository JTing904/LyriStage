<script setup>
// 首页：问候、每日推荐 / 私人 FM / 继续播放、推荐歌单、新歌速递、排行榜
import { computed, onMounted, ref } from 'vue';
import { onPullRefresh } from '../composables/usePullRefresh';
import { useRouter } from 'vue-router';
import { netease, createFmSource } from '../services';
import { usePlayer } from '../composables/usePlayer';
import { useAuthStore } from '../stores/auth';
import { useRecentStore } from '../stores/recent';
import { useAvatarStore } from '../stores/avatar';
import { useFriendsStore } from '../stores/friends';
import FriendRooms from '../components/FriendRooms.vue';
import { t, locale } from '../i18n';
import AvatarFigure from '../components/AvatarFigure.vue';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';

const router = useRouter();
const { state, player } = usePlayer();
const auth = useAuthStore();
const avatar = useAvatarStore();
const recent = useRecentStore();
const friendsStore = useFriendsStore();

const now = new Date();
const greeting = computed(() => {
  const h = now.getHours();
  if (h < 5) return t('夜深了');
  if (h < 12) return t('早上好');
  if (h < 18) return t('下午好');
  return t('晚上好');
});
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 每日推荐卡片上的「十月 · 星期一」
const dateLine = computed(() =>
  locale.value === 'en'
    ? `${EN_MONTHS[now.getMonth()]} · ${EN_WEEKDAYS[now.getDay()]}`
    : `${MONTHS[now.getMonth()]}月 · 星期${WEEKDAYS[now.getDay()]}`
);

const keywords = ref('');
function search() {
  const q = keywords.value.trim();
  if (q) router.push({ path: '/search', query: { q } });
}

// 上次的推荐歌单、新歌、排行榜：打开 App 时先显示这份（马上有内容），背景再拿新的
const HOME_KEY = 'lyristage:home';
function cachedHome() {
  try {
    return JSON.parse(localStorage.getItem(HOME_KEY) || 'null');
  } catch {
    return null;
  }
}
const cached = cachedHome();
const playlists = ref(cached?.playlists ?? []);
const newSongs = ref(cached?.newSongs ?? []);
const charts = ref(cached?.charts ?? []);
const loading = ref(!cached);
const failed = ref(false);

/** 推荐歌单、新歌、排行榜；哪一块失败就显示「重试」（Vercel 太久没用时第一次会比较慢） */
async function load() {
  loading.value = !playlists.value.length;
  failed.value = false;
  const [p, s, c] = await Promise.allSettled([
    netease.recommendedPlaylists(12),
    netease.newSongs(10),
    netease.toplists(),
  ]);
  if (p.status === 'fulfilled') playlists.value = p.value.slice(0, 12);
  if (s.status === 'fulfilled') newSongs.value = s.value.slice(0, 8);
  if (c.status === 'fulfilled') charts.value = c.value.slice(0, 4);
  // 有拿到新的才算失败（有上次的内容就不用显示「重试」吓人）
  failed.value = [p, s, c].some(r => r.status === 'rejected') && !cached;
  loading.value = false;
  try {
    localStorage.setItem(
      HOME_KEY,
      JSON.stringify({ playlists: playlists.value, newSongs: newSongs.value, charts: charts.value })
    );
  } catch {
    // 存不了就下次再从网络拿
  }
}
onMounted(load);
// 下拉刷新：推荐、好友
onPullRefresh(() => Promise.all([load(), friendsStore.refresh()]));

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
      <input v-model="keywords" :placeholder="$t('搜索歌曲、歌手、歌单')" :aria-label="$t('搜索')" />
    </form>

    <header class="hello">
      <div class="hello-text">
        <h1 class="display">
          <!-- 放不下时整个名字换到下一行（「晚上好」不要被拆开），名字太长就截短 -->
          <span class="nowrap">{{ greeting }}<template v-if="auth.displayName">{{ $t('，{name}', { name: '' }) }}</template></span><span
            v-if="auth.displayName"
            class="hello-name"
            >{{ auth.displayName }}</span
          >
        </h1>
        <p>{{ $t('今天也有歌想听吗？') }}</p>
      </div>
      <!-- 我的公仔（衣服在设置里换，默认蓝格子） -->
      <AvatarFigure class="hello-figure" :url="avatar.url" />
      <!-- 手机版没有侧边栏，从这里进设置 -->
      <RouterLink to="/settings" class="mobile-settings" :aria-label="$t('设置')">
        <Icon name="settings" />
      </RouterLink>
    </header>

    <section class="cards" :aria-label="$t('为你准备')">
      <RouterLink to="/daily" class="card daily">
        <span class="label">{{ $t('每日推荐') }}</span>
        <span class="day display">{{ now.getDate() }}</span>
        <span class="sub">{{ dateLine }}</span>
        <span class="hint">
          {{ auth.loggedIn ? $t('按你最近的听歌记录挑选') : $t('登录后会按你的口味推荐') }}
        </span>
        <span class="fab" aria-hidden="true"><Icon name="play" /></span>
      </RouterLink>

      <div class="card fm">
        <span class="label">{{ $t('私人 FM') }}</span>
        <p class="fm-line display">
          {{ fmPlaying ? state.track.name : $t('随便听听，遇见没听过的歌') }}
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
            :aria-label="fmPlaying && state.playing ? $t('暂停私人 FM') : $t('播放私人 FM')"
            @click="playFm"
          >
            <Icon :name="fmPlaying && state.playing ? 'pause' : 'play'" :size="20" />
          </button>
        </div>
      </div>

      <div class="card continue">
        <span class="label">{{ $t('继续播放') }}</span>
        <p v-if="continueList.length === 0" class="empty">{{ $t('播过的歌会出现在这里') }}</p>
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

    <!-- 好友开着「一起听」：按「请求加入」，房主同意才进得去（朋友正在听、周榜在好友页） -->
    <FriendRooms />

    <p v-if="failed" class="retry">
      {{ $t('有些内容没有载入成功。') }}
      <button :disabled="loading" @click="load">{{ loading ? $t('载入中…') : $t('重试') }}</button>
    </p>

    <section v-if="playlists.length || loading" aria-labelledby="h-lists">
      <h2 id="h-lists" class="display">{{ $t('推荐歌单') }}</h2>
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
        <h2 id="h-new" class="display">{{ $t('新歌速递') }}</h2>
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
        <h2 id="h-charts" class="display">{{ $t('排行榜') }}</h2>
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
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
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
.hello h1 .nowrap {
  white-space: nowrap;
}
.hello-name {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.hello p {
  margin: 6px 0 0;
  /* 字放大时排成两行：两行差不多长，不要只剩一个字掉到下一行 */
  text-wrap: balance;
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
[data-theme='light'] .fm {
  color: #1f2a24;
  background: linear-gradient(150deg, #e6eeea, #c8d6ce);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']) .fm {
    color: #1f2a24;
    background: linear-gradient(150deg, #e6eeea, #c8d6ce);
  }
}
.fm-line {
  margin: 0;
  font-size: 30px;
  line-height: 1.25;
  word-break: keep-all;
  overflow-wrap: anywhere;
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

.retry {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 14px;
}
.retry button {
  padding: 6px 16px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.retry button:disabled {
  opacity: 0.6;
}

/* 手机：每日推荐和私人 FM 并排成两个方块（参考 Apple Music「为你推荐」），
   继续播放占一整排；不要一张卡就占掉半个画面 */
@media (max-width: 640px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .continue {
    grid-column: 1 / -1;
  }
  .daily,
  .fm {
    min-height: 0;
    aspect-ratio: 1;
    gap: 6px;
    padding: 16px;
    border-radius: 18px;
  }
  .daily .label,
  .fm .label {
    font-size: 12px;
  }
  .day {
    font-size: 52px;
  }
  .daily .sub {
    font-size: 12px;
  }
  .daily .hint {
    display: none;
  }
  .fm-line {
    font-size: 16px;
  }
  .fab {
    right: 12px;
    bottom: 12px;
    width: 42px;
    height: 42px;
  }
  .hello h1 {
    font-size: clamp(22px, 6.6vw, 26px);
  }
  /* 区块标题：英文比较长（Friends recently played），26px 在 360 宽的手机会挤成两行 */
  h2 {
    font-size: 21px;
  }
  /* FM 方块：在播的歌名已经是上面的大字，下面只留播放钮 */
  .fm-cover,
  .fm-meta {
    display: none;
  }
  .fm-row {
    margin-top: auto;
    justify-content: flex-end;
  }
  .fm-play {
    width: 42px;
    height: 42px;
  }
}

</style>
