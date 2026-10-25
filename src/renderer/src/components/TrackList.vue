<script setup>
// 歌曲列表（歌单、专辑、歌手热门、每日推荐、搜索结果共用）：
// 点一首就从这首开始播放整个列表；正在播放的那首标红。
// 每首右边：红心、加到歌单（自己的歌单里还有「移除」）。
// 「多选」：勾选好几首，一次加到歌单 / 从歌单移除 / 存到手机
// 手机 App：存在手机的歌，歌手前面有绿色小箭头（排队中是灰色）
// 在网易云已经下架的歌变灰、标「已下架」（还是可以点，播不了会提示去搜其他版本）
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { isUnavailable } from '@core/netease';
import { useNoticeStore } from '../stores/notice';
import { useAuthStore } from '../stores/auth';
import { useRoomStore } from '../stores/room';
import { t as tr } from '../i18n';
import { usePlayer } from '../composables/usePlayer';
import { useRoomLocked } from '../composables/useRoomLock';
import { useLibraryStore } from '../stores/library';
import { createSongRadio } from '../services';
import { cancelOffline, isOffline, isQueued, offlineSupported, removeOffline, requestOffline, waitingForWifi } from '../offline';
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
  /** 共同歌单：用户 ID → { name, avatar }，每首歌下面显示是谁加的（参考 Spotify） */
  adders: { type: Map, default: null },
  /** 可以多选（搜索综合页那种只显示几首的就不用） */
  selectable: { type: Boolean, default: true },
});
const emit = defineEmits(['remove']);
const library = useLibraryStore();

// ---- 多选 ----
const selecting = ref(false);
/** 选中的是第几首（同一首歌可能出现两次，所以用位置） */
const selected = ref(new Set());
const selectedTracks = computed(() =>
  [...selected.value].sort((a, b) => a - b).map(i => props.tracks[i]).filter(Boolean)
);
const allSelected = computed(
  () => props.tracks.length > 0 && selected.value.size === props.tracks.length
);
function toggleSelect(i) {
  const next = new Set(selected.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  selected.value = next;
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(props.tracks.map((_, i) => i));
}
function stopSelecting() {
  selecting.value = false;
  selected.value = new Set();
}
function addSelected() {
  if (selectedTracks.value.length) library.openAddDialog(selectedTracks.value);
}
function saveSelected() {
  if (!selectedTracks.value.length) return;
  requestOffline(selectedTracks.value);
  notice.show(waitingForWifi() ? tr('连上 Wi-Fi 后开始存到手机') : tr('开始存到手机'));
  stopSelecting();
}
function removeSelected() {
  if (!selectedTracks.value.length) return;
  emit('remove', selectedTracks.value);
  stopSelecting();
}
// 列表换了（换页面、移除了歌）就清掉选择
watch(() => props.tracks, stopSelecting);

function onRowClick(i) {
  if (selecting.value) toggleSelect(i);
  else play(i);
}

const { state, player } = usePlayer();
const isCurrent = track => state.track?.id === track.id;

function play(index) {
  const track = props.tracks[index];
  if (isCurrent(track)) return player.toggle();
  player.playList(props.tracks, index, props.context);
}

// ---- 每首右边的「⋯」：下一首播放、加入播放队列、相似歌曲电台、加到歌单（在别人的房间里多一个「点歌给房主」）----
const notice = useNoticeStore();
const explainSource = () =>
  notice.show(tr('网易云没有这首的版权，会改用 B 站等其他来源播放，音质可能不一样'), { duration: 6000 });
const room = useRoomStore();
const roomLocked = useRoomLocked();
/** @type {import('vue').Ref<{ track: any, x: number, y: number } | null>} */
const menu = ref(null);
function openMenu(event, track) {
  const r = event.currentTarget.getBoundingClientRect();
  // 菜单宽 200、每项约 50 高：靠右对齐按钮，下面放不下就往上开
  const height = (4 + (room.role === 'guest' ? 1 : 0) + (props.removable ? 1 : 0) + (offlineSupported ? 1 : 0)) * 50 + 10;
  const x = Math.max(8, Math.min(r.right - 200, window.innerWidth - 208));
  const y = r.bottom + height + 6 > window.innerHeight ? r.top - height : r.bottom + 4;
  menu.value = { track, x, y };
}
const closeMenu = () => (menu.value = null);
async function menuAction(action) {
  const track = menu.value?.track;
  closeMenu();
  if (!track) return;
  // 没登录时 player 会弹出登录提示、一起听的成员会问要不要点给房主，就不要再说"已加入"
  const allowed = useAuthStore().allowed && !roomLocked();
  if (action === 'request') {
    if (await room.sendRequest(track)) notice.show(tr('点了《{name}》，等房主加进队列', { name: track.name }));
  } else if (action === 'next') {
    player.playNext(track);
    if (allowed) notice.show(tr('下一首播放：{name}', { name: track.name }));
  } else if (action === 'queue') {
    player.addToQueue(track);
    if (allowed) notice.show(tr('已加入播放队列：{name}', { name: track.name }));
  } else if (action === 'remove') {
    emit('remove', [track]);
  } else if (action === 'offline') {
    if (isOffline(track.id)) {
      await removeOffline(track.id);
      notice.show(tr('已从手机删除《{name}》', { name: track.name }));
    } else if (isQueued(track.id)) {
      cancelOffline([track.id]);
    } else {
      requestOffline([track]);
      notice.show(waitingForWifi() ? tr('连上 Wi-Fi 后开始存到手机') : tr('开始存《{name}》到手机', { name: track.name }));
    }
  } else if (action === 'radio') {
    player.playFm(createSongRadio(track), { context: `radio:${track.id}` });
    if (allowed) notice.show(tr('开始《{name}》的电台：接下来是相似的歌', { name: track.name }));
  } else {
    library.openAddDialog([track]);
  }
}
const onOutside = event => {
  if (menu.value && !event.target.closest?.('.track-menu')) closeMenu();
};
const onKey = event => event.key === 'Escape' && closeMenu();
window.addEventListener('pointerdown', onOutside, true);
window.addEventListener('keydown', onKey);
window.addEventListener('scroll', closeMenu, true);
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', closeMenu, true);
});
</script>

<template>
  <div class="track-list" :class="{ 'no-album': !showAlbum, selecting }">
    <div v-if="selectable && tracks.length > 1" class="toolbar" :class="{ active: selecting }">
      <template v-if="selecting">
        <span class="picked">{{ $t('已选 {n} 首', { n: selected.size }) }}</span>
        <button class="tool" @click="toggleAll">{{ allSelected ? $t('取消全选') : $t('全选') }}</button>
        <span class="grow" />
        <button class="tool primary" :disabled="!selected.size" @click="addSelected">
          <Icon name="plus" :size="16" />{{ $t('加到歌单') }}
        </button>
        <button v-if="offlineSupported" class="tool" :disabled="!selected.size" @click="saveSelected">
          <Icon name="offline" :size="15" />{{ $t('存到手机') }}
        </button>
        <button v-if="removable" class="tool" :disabled="!selected.size" @click="removeSelected">
          <Icon name="trash" :size="15" />{{ $t('移除') }}
        </button>
        <button class="tool done" :aria-label="$t('完成')" @click="stopSelecting">
          <Icon name="check" :size="16" /><span class="label">{{ $t('完成') }}</span>
        </button>
      </template>
      <template v-else>
        <span class="grow" />
        <button class="tool" @click="selecting = true">{{ $t('多选') }}</button>
      </template>
    </div>
    <div v-if="showHeader" class="track head" aria-hidden="true">
      <span class="no">#</span>
      <span>{{ $t('标题') }}</span>
      <span v-if="showAlbum" class="album">{{ $t('专辑') }}</span>
      <span />
      <span class="time">{{ $t('时长') }}</span>
    </div>
    <div
      v-for="(t, i) in tracks"
      :key="`${t.id}-${i}`"
      class="track"
      :class="{ current: isCurrent(t), picked: selected.has(i), unavailable: isUnavailable(t) }"
      @click="onRowClick(i)"
    >
      <span class="no">
        <span v-if="selecting" class="check" :class="{ on: selected.has(i) }" aria-hidden="true">
          <svg v-if="selected.has(i)" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" /></svg>
        </span>
        <Icon v-else-if="isCurrent(t) && state.playing" name="volume" :size="16" />
        <template v-else>{{ i + 1 }}</template>
      </span>
      <span class="main">
        <Cover v-if="showCover" class="cover" :url="t.al?.picUrl" :size="44" radius="6px" />
        <span class="meta">
          <button
            class="name"
            :aria-label="selecting ? $t('选择 {name}', { name: t.name }) : $t('播放 {name}', { name: t.name })"
            :aria-pressed="selecting ? selected.has(i) : undefined"
            @click.stop="onRowClick(i)"
          >
            {{ t.name }}
          </button>
          <span class="artists">
            <!-- 存在手机里（离线也能听）：绿色小箭头；排队等着存：灰色圈 -->
            <span
              v-if="offlineSupported && (isOffline(t.id) || isQueued(t.id))"
              class="saved-mark"
              :class="{ waiting: !isOffline(t.id) }"
              :title="isOffline(t.id) ? $t('已存到手机') : $t('等着存到手机')"
            >
              <Icon name="offline" :size="10" />
            </span>
            <!-- 按了说明是什么意思（手机没有滑鼠提示） -->
            <button
              v-if="isUnavailable(t)"
              type="button"
              class="tag"
              :title="$t('网易云没有这首歌的版权，播放时会改用其他音源（例如 B 站）')"
              @click.stop="explainSource"
            >
              {{ $t('其他音源') }}
            </button>
            <template v-for="(a, j) in t.ar ?? []" :key="a.id || j">
              <template v-if="j"> / </template>
              <RouterLink v-if="a.id" :to="`/artist/${a.id}`" @click.stop>{{ a.name }}</RouterLink>
              <template v-else>{{ a.name }}</template>
            </template>
            <template v-if="!t.ar?.length">{{ artistNames(t) }}</template>
          </span>
          <span v-if="adders && t.addedBy && adders.get(t.addedBy)" class="added-by">
            <Cover :url="adders.get(t.addedBy).avatar" :size="16" round class="adder-avatar" />
            {{ $t('{name} 加的', { name: adders.get(t.addedBy).name }) }}
          </span>
          <!-- 用歌词搜到的：显示搜到的那一句 -->
          <span v-if="t.lyricMatch?.length" class="lyric-match">
            <template v-for="(seg, k) in t.lyricMatch" :key="k">
              <mark v-if="seg.hit">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
        </span>
      </span>
      <span v-if="showAlbum" class="album">
        <RouterLink v-if="t.al?.id" :to="`/album/${t.al.id}`" @click.stop>{{ t.al.name }}</RouterLink>
      </span>
      <span v-show="!selecting" class="actions" :class="{ pinned: library.isLiked(t.id) }">
        <LikeButton :track="t" :size="18" />
        <button
          class="act"
          :title="$t('更多')"
          :aria-label="$t('更多：{name}', { name: t.name })"
          aria-haspopup="menu"
          @click.stop="openMenu($event, t)"
        >
          <Icon name="more" :size="18" />
        </button>
        <!-- 手机收进「⋯」（紧贴着 ⋯ 很容易误按）；电脑版留着 -->
        <button
          v-if="removable"
          class="act remove-btn"
          :title="$t('从歌单移除')"
          :aria-label="$t('从歌单移除')"
          @click.stop="emit('remove', [t])"
        >
          <Icon name="trash" :size="17" />
        </button>
      </span>
      <span class="time">{{ clock(t.dt) }}</span>
    </div>

    <Teleport to="body">
      <div
        v-if="menu"
        class="track-menu"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      >
        <button v-if="room.role === 'guest'" role="menuitem" @click="menuAction('request')">
          <Icon name="users" :size="18" />{{ $t('点歌给房主') }}
        </button>
        <button role="menuitem" @click="menuAction('next')">
          <Icon name="play-next" :size="18" />{{ $t('下一首播放') }}
        </button>
        <button role="menuitem" @click="menuAction('queue')">
          <Icon name="queue" :size="18" />{{ $t('加入播放队列') }}
        </button>
        <button role="menuitem" @click="menuAction('radio')">
          <Icon name="radio" :size="18" />{{ $t('相似歌曲电台') }}
        </button>
        <button role="menuitem" @click="menuAction('playlist')">
          <Icon name="plus" :size="18" />{{ $t('加到歌单') }}
        </button>
        <button v-if="offlineSupported" role="menuitem" @click="menuAction('offline')">
          <Icon :name="isOffline(menu.track.id) ? 'trash' : 'offline'" :size="18" />{{
            isOffline(menu.track.id) ? $t('从手机删除') : isQueued(menu.track.id) ? $t('不存了') : $t('存到手机')
          }}
        </button>
        <button v-if="removable" role="menuitem" class="danger menu-remove" @click="menuAction('remove')">
          <Icon name="trash" :size="18" />{{ $t('从歌单移除') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 存在手机里的小箭头（参考 Spotify：绿色实心 = 存好了，灰色圈 = 排队中） */
.saved-mark {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 14px;
  height: 14px;
  margin-right: 5px;
  border-radius: 50%;
  background: #16a34a;
  color: #fff;
  vertical-align: -2px;
}
.saved-mark.waiting {
  background: none;
  box-shadow: inset 0 0 0 1.5px var(--text-faint);
  color: var(--text-faint);
}
/* 共同歌单：谁加的 */
.added-by {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 12px;
  color: var(--text-faint);
}
.adder-avatar {
  flex: none;
  width: 16px;
}
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
.track.picked {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

/* 多选工具列：选的时候固定在上面 */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  row-gap: 6px;
  min-height: 44px;
  margin-bottom: 4px;
}
.toolbar.active {
  position: sticky;
  z-index: 3;
  top: 0;
  padding: 6px 10px;
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
}
.electron .toolbar.active {
  top: var(--titlebar-height);
}
/* 放不下就整个按钮换到下一排，不要把字挤成两行 */
.picked,
.tool {
  flex-shrink: 0;
  white-space: nowrap;
}
/* 窄的手机：「完成」只留勾勾，按钮紧一点，一排放得下 */
@media (max-width: 420px) {
  .toolbar {
    gap: 6px;
  }
  .tool {
    padding: 7px 11px;
  }
  .tool.done {
    padding: 7px 9px;
  }
  .tool.done .label {
    display: none;
  }
}
.picked {
  font-size: 14px;
  font-weight: 700;
}
.grow {
  flex: 1;
}
.tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.tool:hover:not(:disabled) {
  border-color: var(--text-dim);
}
.tool.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.tool:disabled {
  opacity: 0.45;
  cursor: default;
}
.check {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 2px solid var(--line-strong);
  border-radius: 6px;
}
.check.on {
  border-color: var(--accent);
  background: var(--accent);
}
.check svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--on-accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
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
.lyric-match {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-dim);
}
.lyric-match mark {
  background: none;
  color: var(--accent);
  font-weight: 700;
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

/* 网易云已经下架的歌 */
/* 网易云没版权的歌：以前整行变淡，现在会改用其他音源播，所以照常显示，只加一个小标签 */
.tag {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  vertical-align: 1px;
  cursor: help;
}
/* 手指：标签很小，往上下多一点感应范围 */
@media (pointer: coarse) {
  .tag {
    position: relative;
  }
  .tag::after {
    content: '';
    position: absolute;
    inset: -10px -6px;
  }
}

/* 「从歌单移除」：电脑版是每首右边的按钮；手机、平板收进「⋯」选单（紧贴着 ⋯ 很容易误按，一按就没了） */
.menu-remove {
  display: none;
}
.track-menu .menu-remove {
  color: var(--accent);
}
@media (max-width: 899px), (pointer: coarse) {
  .remove-btn {
    display: none;
  }
  .track-menu .menu-remove {
    display: flex;
  }
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
  /* 「多选」那一列不要占太多位置；多选时固定在顶部，让出返回列 */
  .toolbar {
    min-height: 32px;
    margin-bottom: 0;
  }
  .toolbar:not(.active) .tool {
    padding: 4px 12px;
    font-size: 12px;
  }
  .toolbar.active {
    top: 56px;
  }
  /* 手机多选：勾选框要看得到 */
  .selecting .track:not(.head) {
    grid-template-columns: 28px minmax(0, 1fr);
  }
  .selecting .no {
    display: grid;
  }
}
</style>
