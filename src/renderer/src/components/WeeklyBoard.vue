<script setup>
// 好友周榜：我和好友这一周听了多久，最常听的歌手和歌（参考 Last.fm、stats.fm 的好友排行）
// - 完整版（好友页）：这周 / 上周、每个人一行
// - 精简版（首页）：这周前三名，按"全部"进好友页
import { computed, ref, watch } from 'vue';
import { friendsWeeklyBoard } from '@core/data';
import { usePlayer } from '../composables/usePlayer';
import { t } from '../i18n';
import Cover from './Cover.vue';

const props = defineProps({
  compact: { type: Boolean, default: false },
});

const { player } = usePlayer();
const weeksAgo = ref(0);
/** null：还没载入或数据库没有这个功能 */
const rows = ref(null);

async function load() {
  try {
    rows.value = await friendsWeeklyBoard({ weeksAgo: weeksAgo.value });
  } catch {
    rows.value = null;
  }
}
watch(weeksAgo, load, { immediate: true });

const shown = computed(() => (props.compact ? rows.value?.slice(0, 3) : rows.value) ?? []);
const top = computed(() => Math.max(1, ...(rows.value ?? []).map(r => r.minutes)));
/** 首页只在有好友、而且这周有人听过时显示 */
const worthShowing = computed(
  () => (rows.value?.length ?? 0) > 1 && rows.value.some(r => r.minutes > 0)
);

function duration(minutes) {
  if (minutes < 60) return t('{m} 分钟', { m: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t('{h} 小时 {m} 分钟', { h, m }) : t('{h} 小时', { h });
}
const nameOf = row => (row.isMe ? t('我') : row.name || t('好友'));
</script>

<template>
  <section v-if="compact ? worthShowing : rows" class="weekly-board" :class="{ compact }">
    <div class="head">
      <h2 :class="compact ? 'display' : 'section-title'">{{ $t('好友周榜') }}</h2>
      <RouterLink v-if="compact" to="/friends" class="see-all">{{ $t('全部') }}</RouterLink>
      <div v-else class="tabs" role="radiogroup" :aria-label="$t('好友周榜')">
        <button
          v-for="w in [0, 1]"
          :key="w"
          role="radio"
          :aria-checked="weeksAgo === w"
          :class="{ on: weeksAgo === w }"
          @click="weeksAgo = w"
        >
          {{ w === 0 ? $t('这周') : $t('上周') }}
        </button>
      </div>
    </div>

    <ol class="list">
      <li v-for="(row, i) in shown" :key="row.id" class="row" :class="{ me: row.isMe }">
        <span class="rank" :class="`r${i + 1}`">{{ i + 1 }}</span>
        <Cover :url="row.avatar" :size="40" round class="avatar">{{ nameOf(row).slice(0, 1) }}</Cover>
        <span class="body">
          <span class="line">
            <strong class="name">{{ nameOf(row) }}</strong>
            <span class="time">{{ duration(row.minutes) }}</span>
          </span>
          <span class="bar"><span :style="{ width: `${(row.minutes / top) * 100}%` }" /></span>
          <span v-if="row.topArtist" class="taste">
            {{ $t('最常听 {artist}', { artist: row.topArtist }) }}
            <template v-if="row.topTrack">
              ·
              <button class="song" :title="$t('播放 {name}', { name: row.topTrack.name })" @click="player.playList([row.topTrack], 0, `board:${row.id}`)">
                {{ row.topTrack.name }}
              </button>
            </template>
          </span>
          <span v-else class="taste quiet">{{ $t('这周还没听歌') }}</span>
        </span>
      </li>
    </ol>
    <p v-if="!compact && rows.length === 1" class="hint">{{ $t('加了好友就能一起比') }}</p>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.head h2 {
  margin: 0;
}
/* 首页：和首页其他区块的标题一样大 */
.compact .head h2 {
  font-size: 26px;
}
.see-all {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
}
.tabs {
  display: flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-hover);
}
.tabs button {
  padding: 5px 12px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.tabs button.on {
  background: var(--bg);
  color: var(--text);
  font-weight: 700;
}

.list {
  display: grid;
  gap: 4px;
  margin: 10px 0 0;
  padding: 8px;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 12px;
}
.row.me {
  background: var(--surface-hover);
}
.rank {
  flex: none;
  width: 24px;
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--text-faint);
}
.rank.r1 {
  color: #f5b301;
}
.rank.r2 {
  color: #a8b3bd;
}
.rank.r3 {
  color: #cd7f4b;
}
.avatar {
  flex: none;
  width: 40px;
}
.body {
  display: grid;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.name {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.me .name {
  color: var(--accent);
}
.time {
  flex: none;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.bar {
  height: 4px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.4s;
}
.taste {
  overflow: hidden;
  font-size: 12px;
  color: var(--text-dim);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.taste.quiet {
  color: var(--text-faint);
}
.song {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.song:hover {
  text-decoration: underline;
}
.hint {
  margin: 8px 4px 0;
  font-size: 13px;
  color: var(--text-dim);
}
</style>
