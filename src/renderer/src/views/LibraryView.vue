<script setup>
// 我的音乐库：我喜欢的音乐（大卡片）、听歌排行（本周 / 全部）、我的歌单
import { computed, ref, watch } from 'vue';
import { onPullRefresh } from '../composables/usePullRefresh';
import { joinSharedPlaylist, listLikedTracks, playRanking } from '@core/data';
import { useRouter } from 'vue-router';
import { useLibraryStore } from '../stores/library';
import { useFriendsStore } from '../stores/friends';
import { useAuthStore } from '../stores/auth';
import { usePlayer } from '../composables/usePlayer';
import { usePlayCollection } from '../composables/usePlayCollection';
import { artistNames } from '../utils/format';
import { t } from '../i18n';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import TileGrid from '../components/TileGrid.vue';
import { offlineSupported, offlineTracks } from '../offline';
import { showError } from '../friendlyError';

const library = useLibraryStore();
const friendsStore = useFriendsStore();
const auth = useAuthStore();
const { state, player } = usePlayer();
const { playAll } = usePlayCollection();

// 我喜欢的音乐
const likedRows = ref([]);
/** 第一次载入完之前不显示「0 首」，不然会先闪一下「还没有喜欢的歌」 */
const likedReady = ref(false);
async function loadLiked() {
  try {
    likedRows.value = await listLikedTracks();
  } catch (err) {
    showError(err, t('载不出来'));
  } finally {
    likedReady.value = true;
  }
}
// 数据库写好之后（version 变了）才重新载入；取消喜欢的先从画面上拿掉
watch(() => library.version, loadLiked, { immediate: true });
const liked = computed(() => likedRows.value.filter(t => library.isLiked(t.id)));

// 听歌排行
const range = ref('week');
const ranking = ref([]);
const rankingLoading = ref(true);
async function loadRanking() {
  rankingLoading.value = true;
  try {
    ranking.value = await playRanking(range.value, 50);
  } catch (err) {
    ranking.value = [];
  } finally {
    rankingLoading.value = false;
  }
}
watch(range, loadRanking, { immediate: true });
// 下拉刷新：歌单、我喜欢、排行、好友邀请
onPullRefresh(() =>
  Promise.all([library.refreshPlaylists(), loadLiked(), loadRanking(), friendsStore.refresh()])
);
const rankingShown = computed(() => ranking.value.slice(0, 6));
const playRanked = i => player.playList(ranking.value, i, `ranking:${range.value}`);

// 我的歌单
const sort = ref('updated');
const tiles = computed(() =>
  [...library.playlists]
    .sort((a, b) =>
      sort.value === 'name'
        ? a.name.localeCompare(b.name, 'zh-CN')
        : String(b.updated_at).localeCompare(String(a.updated_at))
    )
    .map(p => ({
      key: p.id,
      to: `/my/${p.id}`,
      cover: p.cover_url,
      covers: p.covers ?? [],
      title: p.name,
      // 共同歌单：自己开放共享的、或加入别人的
      sub:
        p.shareCode || (p.userId && p.userId !== auth.user?.id)
          ? t('共同歌单 · {n} 首', { n: p.trackCount })
          : t('{n} 首', { n: p.trackCount }),
    }))
);

// 用邀请码加入别人的共同歌单
const router = useRouter();
const joining = ref(false);
const joinCode = ref('');
async function join() {
  const code = joinCode.value.trim();
  if (!code) return;
  try {
    const id = await joinSharedPlaylist(code);
    if (!id) {
      library.say(t('找不到这个邀请码，检查一下有没有打错'));
      return;
    }
    joinCode.value = '';
    joining.value = false;
    await library.refreshPlaylists();
    router.push(`/my/${id}`);
  } catch (err) {
    showError(err, t('没加进去'));
  }
}

// 新建歌单
const creating = ref(false);
const newName = ref('');
async function create() {
  const name = newName.value.trim();
  if (!name) return;
  try {
    await library.createPlaylist(name);
    newName.value = '';
    creating.value = false;
  } catch (err) {
    showError(err, t('没建立成功'));
  }
}
</script>

<template>
  <div class="page">
    <div class="title-row">
      <span class="title-main">
        <!-- 手机：按自己的头像进设置（电脑、平板横放有侧边栏的账号卡片） -->
        <RouterLink to="/settings" class="me" :aria-label="$t('设置')" :title="$t('设置')">
          <Cover v-if="auth.avatarUrl" :url="auth.avatarUrl" :size="40" round />
          <span v-else class="me-initial">{{ auth.displayName.slice(0, 1).toUpperCase() }}</span>
        </RouterLink>
        <h1 class="display title">{{ $t('我的音乐库') }}</h1>
      </span>
      <span class="title-links">
        <!-- 离线听歌：存在手机里的歌 -->
        <RouterLink v-if="offlineSupported" to="/offline" class="report-link">
          <Icon name="offline" :size="18" />{{ $t('存在手机') }}<span v-if="offlineTracks.length" class="link-count">{{ offlineTracks.length }}</span>
        </RouterLink>
        <RouterLink to="/report" class="report-link">
          <Icon name="chart" :size="18" />{{ $t('听歌报告') }}
        </RouterLink>
      </span>
    </div>

    <div class="top">
      <!-- 我喜欢的音乐 -->
      <RouterLink to="/liked" class="liked-card">
        <span class="liked-label"><Icon name="heart-fill" :size="18" />{{ $t('我喜欢的音乐') }}</span>
        <p class="names display">
          <template v-if="!likedReady">&nbsp;</template>
          <template v-else-if="liked.length">
            {{ liked.slice(0, 3).map(t => t.name).join(' · ') }}
          </template>
          <template v-else>{{ $t('按 ♡ 收藏喜欢的歌') }}</template>
        </p>
        <span v-if="likedReady" class="count">
          {{ $t('{n} 首', { n: liked.length }) }}<template v-if="liked[0]"> · {{ $t('最近喜欢：{name}', { name: liked[0].name }) }}</template>
        </span>
        <button
          class="play"
          :aria-label="$t('播放我喜欢的音乐')"
          :disabled="!liked.length"
          @click.prevent="playAll(liked, 'liked')"
        >
          <Icon name="play" :size="26" />
        </button>
      </RouterLink>

      <!-- 听歌排行 -->
      <section class="ranking">
        <div class="ranking-head">
          <h2 class="section-title">{{ $t('听歌排行') }}</h2>
          <div class="segmented" role="radiogroup" :aria-label="$t('排行范围')">
            <button role="radio" :aria-checked="range === 'week'" :class="{ on: range === 'week' }" @click="range = 'week'">{{ $t('本周') }}</button>
            <button role="radio" :aria-checked="range === 'all'" :class="{ on: range === 'all' }" @click="range = 'all'">{{ $t('全部') }}</button>
          </div>
        </div>
        <p v-if="rankingLoading" class="hint">{{ $t('载入中…') }}</p>
        <p v-else-if="!ranking.length" class="hint">
          {{
            range === 'week'
              ? $t('这周还没有听歌记录，听完一首歌就会出现在这里。')
              : $t('还没有听歌记录，听完一首歌就会出现在这里。')
          }}
        </p>
        <ol v-else class="rank-list">
          <li v-for="(t, i) in rankingShown" :key="t.id">
            <button class="rank" :class="{ current: state.track?.id === t.id }" @click="playRanked(i)">
              <span class="no">{{ i + 1 }}</span>
              <Cover :url="t.al?.picUrl" :size="40" radius="6px" class="cover" />
              <span class="meta">
                <strong>{{ t.name }}</strong>
                <span>{{ artistNames(t) }}</span>
              </span>
              <span class="plays">{{ $t('{n} 次', { n: t.playCount }) }}</span>
            </button>
          </li>
        </ol>
      </section>
    </div>

    <!-- 我的歌单 -->
    <section>
      <div class="lists-head">
        <h2 class="section-title">{{ $t('我的歌单') }}</h2>
        <div class="segmented" role="radiogroup" :aria-label="$t('排序')">
          <button role="radio" :aria-checked="sort === 'updated'" :class="{ on: sort === 'updated' }" @click="sort = 'updated'">{{ $t('最近更新') }}</button>
          <button role="radio" :aria-checked="sort === 'name'" :class="{ on: sort === 'name' }" @click="sort = 'name'">{{ $t('名称') }}</button>
        </div>
        <button
          v-if="friendsStore.available"
          class="new-btn"
          :aria-label="$t('加入共同歌单')"
          :title="$t('加入共同歌单')"
          @click="joining = !joining"
        >
          <Icon name="friends" :size="18" /><span class="label">{{ $t('加入共同歌单') }}</span>
        </button>
        <button class="new-btn" :aria-label="$t('新建歌单')" :title="$t('新建歌单')" @click="creating = !creating">
          <Icon name="plus" :size="18" /><span class="label">{{ $t('新建歌单') }}</span>
        </button>
      </div>
      <form v-if="joining" class="create" @submit.prevent="join">
        <input v-model="joinCode" :placeholder="$t('朋友给你的邀请码')" maxlength="12" required autofocus />
        <button class="primary" :disabled="!joinCode.trim()">{{ $t('加入') }}</button>
        <button type="button" class="ghost" @click="joining = false">{{ $t('取消') }}</button>
      </form>
      <form v-if="creating" class="create" @submit.prevent="create">
        <input v-model="newName" :placeholder="$t('歌单名字')" maxlength="60" required autofocus />
        <button class="primary" :disabled="!newName.trim()">{{ $t('新建') }}</button>
        <button type="button" class="ghost" @click="creating = false">{{ $t('取消') }}</button>
      </form>
      <TileGrid v-if="tiles.length" :items="tiles" />
      <p v-else-if="!creating" class="hint">{{ $t('还没有歌单。在任何一首歌旁边按 ＋ 就能加进歌单。') }}</p>
    </section>
  </div>
</template>

<style scoped>
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.me {
  display: none;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
}
.me-initial {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  color: #fff;
  font-weight: 800;
  font-size: 17px;
}
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .me {
    display: block;
  }
}
.report-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
}
/* 存在手机里几首（不要叫 .count：「我喜欢的音乐」卡片已经用了） */
.link-count {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--surface-hover);
  font-size: 12px;
}
.title-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.report-link:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.title {
  margin: 8px 0 -8px;
  font-size: clamp(30px, 4vw, 44px);
}
.top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 24px;
}

.liked-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 10px;
  min-height: 260px;
  padding: 26px;
  border-radius: 20px;
  background: linear-gradient(135deg, #ff3b5c, #7b2ff7);
  color: #fff;
  overflow: hidden;
}
.liked-label {
  position: absolute;
  top: 24px;
  left: 26px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}
.names {
  margin: 0;
  padding-right: 64px;
  font-size: clamp(22px, 2.4vw, 32px);
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.count {
  font-size: 14px;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 64px;
}
.play {
  position: absolute;
  right: 22px;
  bottom: 22px;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #111;
  cursor: pointer;
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.25);
  transition: transform 0.15s;
}
.play:hover:not(:disabled) {
  transform: scale(1.06);
}
.play:disabled {
  opacity: 0.5;
}

.ranking {
  min-width: 0;
}
.ranking-head,
.lists-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.ranking-head .section-title,
.lists-head .section-title {
  margin: 0;
  flex: 1;
  /* 中文可以一个字一个字换行：右边按钮一多，标题会被挤成竖排 */
  white-space: nowrap;
}
.segmented {
  display: flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-hover);
}
.segmented button {
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.segmented button.on {
  background: var(--bg);
  color: var(--text);
  font-weight: 700;
}
.rank-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rank {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rank:hover {
  background: var(--surface-hover);
}
.rank .no {
  width: 22px;
  text-align: center;
  font-weight: 700;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.rank-list li:nth-child(-n + 3) .no {
  color: var(--accent);
}
.rank .cover {
  width: 40px;
  flex: none;
}
.rank .meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rank .meta strong,
.rank .meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank .meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.rank.current strong {
  color: var(--accent);
}
.plays {
  font-size: 13px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 8px 0;
  font-size: 14px;
  color: var(--text-dim);
}

.new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.new-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.create {
  display: flex;
  gap: 8px;
  max-width: 480px;
  margin-bottom: 18px;
}
.create input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.create input:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.create button {
  padding: 0 16px;
  border-radius: 10px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.primary {
  border: 0;
  background: var(--accent);
  color: var(--on-accent);
}
.primary:disabled {
  opacity: 0.5;
}
.ghost {
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--text);
}

@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .top {
    grid-template-columns: minmax(0, 1fr);
  }
  .liked-card {
    min-height: 200px;
  }
  .lists-head {
    flex-wrap: wrap;
  }
  /* 手机：「我的歌单」自己一排，排序和按钮放下一排 */
  .lists-head .section-title {
    flex-basis: 100%;
  }
  /* 「加入共同歌单」「新建歌单」只留图标（圆的），和排序排成一排 */
  .segmented {
    margin-right: auto;
  }
  .new-btn {
    width: 40px;
    height: 40px;
    padding: 0;
    justify-content: center;
  }
  .new-btn .label {
    display: none;
  }
}

@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .title {
    font-size: 28px;
  }
}
</style>
