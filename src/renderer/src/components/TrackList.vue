<script setup>
// 歌曲列表（歌单、专辑、歌手热门、每日推荐、搜索结果共用）：
// 点一首就从这首开始播放整个列表；正在播放的那首标红。
// 每首右边：红心、加到歌单（自己的歌单里还有「移除」）
import { usePlayer } from '../composables/usePlayer';
import { useLibraryStore } from '../stores/library';
import LikeButton from './LikeButton.vue';
import { artistNames, clock } from '../utils/format';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const props = defineProps({
  tracks: { type: Array, required: true },
  /** 听歌记录里的来源，例如 'playlist:123' */
  context: { type: String, default: null },
  /** 显示小封面（专辑页不用，因为每首都一样） */
  showCover: { type: Boolean, default: true },
  showAlbum: { type: Boolean, default: true },
  /** 显示表头（# 标题 专辑 时长） */
  showHeader: { type: Boolean, default: true },
  /** 自己的歌单：每首多一个「从歌单移除」 */
  removable: { type: Boolean, default: false },
});
const emit = defineEmits(['remove']);
const library = useLibraryStore();

const { state, player } = usePlayer();
const isCurrent = track => state.track?.id === track.id;

function play(index) {
  const track = props.tracks[index];
  if (isCurrent(track)) return player.toggle();
  player.playList(props.tracks, index, props.context);
}
</script>

<template>
  <div class="track-list" :class="{ 'no-album': !showAlbum }">
    <div v-if="showHeader" class="track head" aria-hidden="true">
      <span class="no">#</span>
      <span>标题</span>
      <span v-if="showAlbum" class="album">专辑</span>
      <span />
      <span class="time">时长</span>
    </div>
    <div
      v-for="(t, i) in tracks"
      :key="`${t.id}-${i}`"
      class="track"
      :class="{ current: isCurrent(t) }"
      @click="play(i)"
    >
      <span class="no">
        <Icon v-if="isCurrent(t) && state.playing" name="volume" :size="16" />
        <template v-else>{{ i + 1 }}</template>
      </span>
      <span class="main">
        <Cover v-if="showCover" class="cover" :url="t.al?.picUrl" :size="44" radius="6px" />
        <span class="meta">
          <button class="name" :aria-label="`播放 ${t.name}`" @click.stop="play(i)">
            {{ t.name }}
          </button>
          <span class="artists">
            <template v-for="(a, j) in t.ar ?? []" :key="a.id || j">
              <template v-if="j"> / </template>
              <RouterLink v-if="a.id" :to="`/artist/${a.id}`" @click.stop>{{ a.name }}</RouterLink>
              <template v-else>{{ a.name }}</template>
            </template>
            <template v-if="!t.ar?.length">{{ artistNames(t) }}</template>
          </span>
        </span>
      </span>
      <span v-if="showAlbum" class="album">
        <RouterLink v-if="t.al?.id" :to="`/album/${t.al.id}`" @click.stop>{{ t.al.name }}</RouterLink>
      </span>
      <span class="actions" :class="{ pinned: library.isLiked(t.id) }">
        <LikeButton :track="t" :size="18" />
        <button
          class="act"
          title="加到歌单"
          aria-label="加到歌单"
          @click.stop="library.openAddDialog([t])"
        >
          <Icon name="plus" :size="18" />
        </button>
        <button
          v-if="removable"
          class="act"
          title="从歌单移除"
          aria-label="从歌单移除"
          @click.stop="emit('remove', t)"
        >
          <Icon name="trash" :size="17" />
        </button>
      </span>
      <span class="time">{{ clock(t.dt) }}</span>
    </div>
  </div>
</template>

<style scoped>
.track-list {
  display: flex;
  flex-direction: column;
}
.track {
  display: grid;
  grid-template-columns: 40px minmax(0, 1.6fr) minmax(0, 1fr) auto 56px;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 10px;
  cursor: pointer;
}
.no-album .track {
  grid-template-columns: 40px minmax(0, 1fr) auto 56px;
}
.track:not(.head):hover {
  background: var(--surface-hover);
}
.head {
  padding-bottom: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  font-size: 13px;
  color: var(--text-faint);
  cursor: default;
}
.no {
  display: grid;
  place-items: center;
  font-size: 14px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.current .no,
.current .name {
  color: var(--accent);
}
.main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.cover {
  flex: none;
  width: 44px;
}
.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.name,
.artists,
.album {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artists,
.album {
  font-size: 13px;
  color: var(--text-dim);
}
.artists a:hover,
.album a:hover {
  color: var(--text);
  text-decoration: underline;
}
.actions {
  display: flex;
  align-items: center;
  color: var(--text-dim);
}
/* 电脑：滑到那一行才显示（已经喜欢的红心一直显示） */
@media (hover: hover) {
  .actions .act,
  .actions:not(.pinned) .like {
    visibility: hidden;
  }
  .track:hover .actions .act,
  .track:hover .actions .like,
  .actions:focus-within .act,
  .actions:focus-within .like {
    visibility: visible;
  }
}
.act {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: pointer;
}
.act:hover {
  color: var(--text);
  background: var(--surface-hover);
}
.time {
  font-size: 13px;
  color: var(--text-dim);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 手机：只留封面、歌名、时长 */
@media (max-width: 640px) {
  .track,
  .no-album .track {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 6px 4px;
  }
  .head,
  .no,
  .album,
  .time {
    display: none;
  }
}
</style>
