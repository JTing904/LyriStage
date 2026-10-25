<script setup>
// 自己的歌单：播放、移除歌曲、改名、删除；共同歌单（邀请别人一起编辑、看谁加了哪首）
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onPullRefresh } from '../composables/usePullRefresh';
import { useRoute, useRouter } from 'vue-router';
import { getPlaylist, leaveSharedPlaylist, listPlaylistPeople, sharePlaylist, unsharePlaylist } from '@core/data';
import { useAuthStore } from '../stores/auth';
import { applyPrivileges, fetchPrivileges } from '../services';
import { useLibraryStore } from '../stores/library';
import { useNoticeStore } from '../stores/notice';
import { usePlayCollection } from '../composables/usePlayCollection';
import { totalLength } from '../utils/format';
import { t } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import SaveAsPlaylistButton from '../components/SaveAsPlaylistButton.vue';
import OfflineButton from '../components/OfflineButton.vue';
import Icon from '../components/Icon.vue';
import TrackList from '../components/TrackList.vue';
import SongPicker from '../components/SongPicker.vue';
import Cover from '../components/Cover.vue';
import PlaylistCover from '../components/PlaylistCover.vue';
import { squareCover } from '../utils/image';
import { getPalette } from '../lyric-stage/palette';
import { canShareImage, saveImage, shareImage } from '../platform';
import { canvasToBlob, renderPlaylistCard } from '../utils/shareCard';
import LoadError from '../components/LoadError.vue';
import { showError } from '../friendlyError';
import { shareLink as shareText } from '../platform';

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();
const { playAll, shuffleAll } = usePlayCollection();

const playlist = ref(null);
const loading = ref(true);
const error = ref('');

let loadCount = 0;
async function load(id) {
  const thisLoad = ++loadCount;
  // 同一张歌单重新拿（别的设备改过）：照样显示，不要整页闪成载入中
  loading.value = String(playlist.value?.id) !== String(id);
  error.value = '';
  try {
    const data = await getPlaylist(id);
    if (id !== route.params.id) return;
    playlist.value = data;
    loadPeople();
    // 先显示，再补上哪些歌已经下架
    fetchPrivileges(data.tracks ?? []).then(privileges => {
      // 这段时间里换了歌单、重新载入过就不要了
      if (thisLoad !== loadCount || !playlist.value || !privileges.size) return;
      playlist.value.tracks = applyPrivileges(playlist.value.tracks, privileges);
    });
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}
watch(() => route.params.id, id => id && load(id), { immediate: true });
// 在别的设备改了这张歌单：回到 App 时重新载入
watch(() => library.synced, () => route.params.id && load(route.params.id));
onPullRefresh(() => load(route.params.id));

const tracks = computed(() => playlist.value?.tracks ?? []);
const context = computed(() => `my:${route.params.id}`);
const meta = computed(() =>
  tracks.value.length
    ? `${t('{n} 首', { n: tracks.value.length })} · ${totalLength(tracks.value)}`
    : t('还没有歌')
);

/** 从歌单移除（一首或多选的好几首）；6 秒内可以按「复原」放回原位 */
async function remove(list) {
  const ids = new Set(list.map(t => t.id));
  const before = playlist.value.tracks;
  const removed = before.filter(t => ids.has(t.id));
  const playlistId = playlist.value.id;
  playlist.value.tracks = before.filter(t => !ids.has(t.id));
  try {
    await library.removeFromPlaylist(playlistId, [...ids]);
  } catch (err) {
    playlist.value.tracks = before;
    showError(err, t('没移除成功'));
    return;
  }
  useNoticeStore().undo(
    removed.length === 1 ? t('已移除《{name}》', { name: removed[0].name }) : t('已移除 {n} 首', { n: removed.length }),
    () => restore(playlistId, removed)
  );
}
// 没有 position 的（刚加进来、还没重新载入）排在最后
const order = track => track.position ?? Number.MAX_SAFE_INTEGER;
async function restore(playlistId, removed) {
  const showing = () => playlist.value?.id === playlistId;
  if (showing()) playlist.value.tracks = [...playlist.value.tracks, ...removed].sort((a, b) => order(a) - order(b));
  try {
    await library.restoreToPlaylist(playlistId, removed);
  } catch (err) {
    const ids = new Set(removed.map(t => t.id));
    if (showing()) playlist.value.tracks = playlist.value.tracks.filter(t => !ids.has(t.id));
    showError(err, t('没复原成功'));
  }
}

// ---- 共同歌单 ----
const auth = useAuthStore();
/** 我是主人（加入别人的共同歌单时不是：不能改名、删除） */
const isOwner = computed(() => !playlist.value?.userId || playlist.value.userId === auth.user?.id);
const isShared = computed(() => Boolean(playlist.value?.shareCode) || !isOwner.value);
/** 一起编辑的人（主人 + 加入的） */
const people = ref([]);
async function loadPeople() {
  if (!isShared.value) {
    people.value = [];
    return;
  }
  try {
    people.value = await listPlaylistPeople(playlist.value);
  } catch {
    people.value = [];
  }
}
/** 每首歌是谁加的（只有一个人时不用显示） */
const adders = computed(() =>
  people.value.length > 1 ? new Map(people.value.map(p => [p.id, p])) : null
);
const shareBox = ref(null);
const shareBusy = ref(false);
const shareLink = computed(() =>
  playlist.value?.shareCode ? `https://lyristage.vercel.app/#/join/${playlist.value.shareCode}` : ''
);
async function startSharing() {
  shareBusy.value = true;
  try {
    playlist.value.shareCode = await sharePlaylist(playlist.value.id);
    await loadPeople();
    library.refreshPlaylists();
  } catch (err) {
    showError(err, t('没改成功'));
  } finally {
    shareBusy.value = false;
  }
}
async function stopSharing() {
  shareBusy.value = true;
  try {
    await unsharePlaylist(playlist.value.id);
    playlist.value.shareCode = null;
    people.value = [];
    library.refreshPlaylists();
  } catch (err) {
    showError(err, t('没改成功'));
  } finally {
    shareBusy.value = false;
  }
}
/** 「分享」：手机跳出系统分享（附共享歌单码和链接），电脑复制 */
async function shareInvite() {
  try {
    const result = await shareText({
      title: t('一起编辑歌单'),
      text: t('来 LyriStage 一起编辑歌单「{name}」，共享歌单码 {code}', { name: playlist.value.name, code: playlist.value.shareCode }),
      url: shareLink.value,
    });
    if (result === 'copied') library.say(t('邀请链接已复制，传给朋友就好'));
  } catch {
    library.say(t('分享不了，把上面的共享歌单码传给朋友吧'));
  }
}
async function leave() {
  shareBox.value.close();
  try {
    await leaveSharedPlaylist(playlist.value.id);
    await library.refreshPlaylists();
    router.replace('/library');
  } catch (err) {
    showError(err, t('没改成功'));
  }
}

// ---- 分享海报：封面 + 歌单名 + 前几首歌，做成一张图 ----
const posterBusy = ref(false);
async function sharePoster() {
  if (posterBusy.value || !tracks.value.length) return;
  posterBusy.value = true;
  try {
    const list = tracks.value;
    const owner = people.value.find(p => p.owner)?.name ?? auth.displayName;
    const cover = playlist.value.cover_url || null;
    const palette = await getPalette(cover || list[0]?.al?.picUrl);
    const canvas = await renderPlaylistCard({
      name: playlist.value.name,
      owner,
      cover,
      tracks: list,
      palette,
      labels: {
        byline: `${t('{name} 的歌单', { name: owner })} · ${t('{n} 首', { n: list.length })}`,
        more: n => t('还有 {n} 首', { n }),
      },
    });
    const blob = await canvasToBlob(canvas);
    const fileName = 'LyriStage-playlist.png';
    if (canShareImage()) await shareImage(blob, fileName);
    else await saveImage(blob, fileName);
  } catch (err) {
    if (err?.name !== 'AbortError' && !/cancel/i.test(err?.message ?? '')) {
      showError(err, t('没分享出去'));
    }
  } finally {
    posterBusy.value = false;
  }
}

// 添加歌曲（搜索 / 我喜欢的 / 最近播放里勾选好几首）
const picker = ref(null);
const adding = ref(false);
async function addSongs(list) {
  adding.value = true;
  try {
    await library.addToPlaylist(playlist.value.id, list);
    playlist.value = await getPlaylist(playlist.value.id);
  } catch (err) {
    showError(err, t('没加进去'));
  } finally {
    adding.value = false;
  }
}

// 编辑：封面、名字、介绍（参考 Spotify 的「编辑详细信息」：封面在上面，点了换照片）
const editor = ref(null);
const name = ref('');
const description = ref('');
/** 换封面：选了新照片（File）、要换回歌曲封面（null）、没动（undefined） */
const newCover = ref(undefined);
const newCoverPreview = ref('');
const saving = ref(false);
const coverInput = ref(null);
const songCovers = computed(() => tracks.value.slice(0, 4).map(track => track.al?.picUrl).filter(Boolean));
/** 对话框里预览的封面网址（空的 = 用歌曲封面拼） */
const previewCover = computed(() =>
  newCover.value === undefined ? playlist.value?.cover_url ?? '' : newCoverPreview.value
);
function resetCoverChoice() {
  if (newCoverPreview.value) URL.revokeObjectURL(newCoverPreview.value);
  newCover.value = undefined;
  newCoverPreview.value = '';
}
function openEditor() {
  name.value = playlist.value.name;
  description.value = playlist.value.description ?? '';
  resetCoverChoice();
  editor.value.showModal();
}
function pickCover(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  resetCoverChoice();
  newCover.value = file;
  newCoverPreview.value = URL.createObjectURL(file);
}
function useSongCovers() {
  resetCoverChoice();
  newCover.value = null;
}
async function save() {
  if (!name.value.trim() || saving.value) return;
  saving.value = true;
  try {
    if (newCover.value !== undefined) {
      const image = newCover.value ? await squareCover(newCover.value) : null;
      playlist.value.cover_url = await library.setPlaylistCover(playlist.value.id, image);
    }
    await library.renamePlaylist(playlist.value.id, name.value, description.value.trim() || null);
    playlist.value.name = name.value.trim();
    playlist.value.description = description.value.trim() || null;
    resetCoverChoice();
    editor.value.close();
  } catch (err) {
    showError(err, t('没保存成功'));
  } finally {
    saving.value = false;
  }
}

// 「⋯」选单：编辑、删除歌单（按钮太多一行放不下，这两个不常用）
/** @type {import('vue').Ref<{ x: number, y: number } | null>} */
const moreMenu = ref(null);
function toggleMore(event) {
  if (moreMenu.value) {
    moreMenu.value = null;
    return;
  }
  const r = event.currentTarget.getBoundingClientRect();
  // 菜单宽 200、高约 100：靠左对齐按钮，右边放不下就往左
  moreMenu.value = {
    x: Math.max(8, Math.min(r.left, window.innerWidth - 208)),
    y: r.bottom + 110 > window.innerHeight ? r.top - 104 : r.bottom + 6,
  };
}
const closeMore = () => (moreMenu.value = null);
function moreAction(fn) {
  closeMore();
  fn();
}
const onOutside = event => {
  if (moreMenu.value && !event.target.closest?.('.track-menu, .more-btn')) closeMore();
};
const onKey = event => event.key === 'Escape' && closeMore();
window.addEventListener('pointerdown', onOutside, true);
window.addEventListener('keydown', onKey);
window.addEventListener('scroll', closeMore, true);
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', closeMore, true);
});

// 删除（用 App 自己的确认框，不用系统弹窗）
const confirmBox = ref(null);
async function removePlaylist() {
  confirmBox.value.close();
  try {
    await library.deletePlaylist(playlist.value.id);
    router.replace('/library');
  } catch (err) {
    showError(err, t('没删掉'));
  }
}
</script>

<template>
  <div class="page">
    <p v-if="loading && !playlist" class="page-state">{{ $t('加载中…') }}</p>
    <LoadError v-else-if="error" :error="error" :what="$t('歌单')" @retry="load(route.params.id)" />
    <template v-else-if="playlist">
      <CollectionHeader
        :kind="isShared ? $t('共同歌单') : $t('我的歌单')"
        :cover="playlist.cover_url || tracks[0]?.al?.picUrl || ''"
        :title="playlist.name"
        :description="playlist.description || ''"
        :meta="meta"
        :playable="tracks.length > 0"
        @play="playAll(tracks, context)"
        @shuffle="shuffleAll(tracks, context)"
      >
        <template #actions>
          <!-- 手机：只留图标（CollectionHeader 的 .icon-action），文字给读屏用 aria-label -->
          <button class="icon-action" :aria-label="$t('添加歌曲')" @click="picker.open()">
            <Icon name="plus" :size="18" /><span class="label">{{ $t('添加歌曲') }}</span>
          </button>
          <!-- 别人开的共同歌单：可以复制一份成自己的 -->
          <SaveAsPlaylistButton v-if="!isOwner" :name="playlist.name" :tracks="tracks" />
          <OfflineButton
            :tracks="tracks"
            :collection="{ key: `mine:${playlist.id}`, kind: 'mine', id: playlist.id, name: playlist.name }"
          />
          <button
            class="icon-action"
            :aria-label="isShared ? $t('一起编辑的人') : $t('邀请一起编辑')"
            @click="shareBox.showModal()"
          >
            <Icon name="friends" :size="18" /><span class="label">{{ isShared ? $t('一起编辑的人') : $t('邀请一起编辑') }}</span>
          </button>
          <button
            v-if="tracks.length"
            class="icon-action"
            :aria-label="$t('分享海报')"
            :disabled="posterBusy"
            @click="sharePoster"
          >
            <Icon name="share" :size="17" /><span class="label">{{ $t('分享海报') }}</span>
          </button>
          <button
            v-if="isOwner"
            class="icon-action more-btn"
            :aria-label="$t('更多')"
            aria-haspopup="menu"
            :aria-expanded="Boolean(moreMenu)"
            @click="toggleMore"
          >
            <Icon name="more" :size="18" />
          </button>
        </template>
      </CollectionHeader>

      <p v-if="!tracks.length" class="page-state">
        {{ $t('歌单还是空的。按上面的「＋ 添加歌曲」一次挑好几首，') }}<br />
        {{ $t('或者按播放条红心旁边的 ＋ 把正在播的歌加进来。') }}
      </p>
      <TrackList v-else :tracks="tracks" :context="context" removable :adders="adders" @remove="remove" />
    </template>

    <!-- 「⋯」选单：编辑、删除歌单 -->
    <Teleport to="body">
      <div
        v-if="moreMenu"
        class="track-menu"
        role="menu"
        :style="{ left: `${moreMenu.x}px`, top: `${moreMenu.y}px` }"
      >
        <button role="menuitem" @click="moreAction(openEditor)">
          <Icon name="edit" :size="18" />{{ $t('编辑') }}
        </button>
        <button role="menuitem" @click="moreAction(() => confirmBox.showModal())">
          <Icon name="trash" :size="18" />{{ $t('删除歌单') }}
        </button>
      </div>
    </Teleport>

    <SongPicker
      ref="picker"
      :existing-ids="tracks.map(t => t.id)"
      :busy="adding"
      @add="addSongs"
    />

    <!-- 共同歌单：邀请、一起编辑的人、停止共享 / 退出 -->
    <dialog ref="shareBox" class="editor" @click.self="shareBox.close()">
      <div v-if="playlist" class="box">
        <h2>{{ $t('一起编辑') }}</h2>
        <template v-if="isOwner && !playlist.shareCode">
          <p class="note">{{ $t('开始共享后，拿到邀请链接的 LyriStage 成员都能加歌、删歌，每首歌会显示是谁加的。改名和删除歌单只有你能做。') }}</p>
          <div class="buttons">
            <button type="button" class="ghost" @click="shareBox.close()">{{ $t('取消') }}</button>
            <button type="button" class="primary" :disabled="shareBusy" @click="startSharing">{{ $t('开始共享') }}</button>
          </div>
        </template>
        <template v-else>
          <div v-if="isOwner" class="share-code">
            <span class="share-label">{{ $t('共享歌单码') }}</span>
            <code>{{ playlist.shareCode }}</code>
            <button type="button" class="ghost" @click="shareInvite"><Icon name="share" :size="16" />{{ $t('分享') }}</button>
          </div>
          <ul class="people">
            <li v-for="p in people" :key="p.id">
              <Cover :url="p.avatar" :size="32" round class="person-avatar" />
              <span class="person-name">{{ p.name }}</span>
              <span v-if="p.owner" class="owner">{{ $t('主人') }}</span>
            </li>
          </ul>
          <div class="buttons">
            <button v-if="isOwner" type="button" class="ghost" :disabled="shareBusy" @click="stopSharing">{{ $t('停止共享') }}</button>
            <button v-else type="button" class="ghost" @click="leave">{{ $t('退出这个歌单') }}</button>
            <button type="button" class="primary" @click="shareBox.close()">{{ $t('完成') }}</button>
          </div>
        </template>
      </div>
    </dialog>

    <dialog ref="confirmBox" class="editor" @click.self="confirmBox.close()">
      <div v-if="playlist" class="box">
        <h2>{{ $t('删除歌单「{name}」？', { name: playlist.name }) }}</h2>
        <p class="note">{{ $t('只删除这个歌单，里面的歌不会受影响。删除后不能复原。') }}</p>
        <div class="buttons">
          <button type="button" class="ghost" @click="confirmBox.close()">{{ $t('取消') }}</button>
          <button type="button" class="primary" @click="removePlaylist">{{ $t('删除') }}</button>
        </div>
      </div>
    </dialog>

    <dialog ref="editor" class="editor" @click.self="editor.close()">
      <form class="box" @submit.prevent="save">
        <h2>{{ $t('编辑歌单') }}</h2>
        <div class="cover-edit">
          <button type="button" class="cover-pick" :aria-label="$t('换照片')" @click="coverInput.click()">
            <PlaylistCover :cover="previewCover" :covers="songCovers" :name="name" :size="120" radius="12px" />
            <span class="cover-hover"><Icon name="camera" :size="22" /></span>
          </button>
          <div class="cover-actions">
            <button type="button" class="ghost" @click="coverInput.click()">{{ $t('换照片') }}</button>
            <button v-if="previewCover" type="button" class="ghost" @click="useSongCovers">{{ $t('用歌曲封面') }}</button>
          </div>
          <input ref="coverInput" type="file" accept="image/*" hidden @change="pickCover" />
        </div>
        <label>
          {{ $t('名字') }}
          <input v-model="name" maxlength="60" required />
        </label>
        <label>
          {{ $t('介绍') }}
          <textarea v-model="description" rows="3" maxlength="300" :placeholder="$t('写点什么（可以不写）')" />
        </label>
        <div class="buttons">
          <button type="button" class="ghost" @click="editor.close()">{{ $t('取消') }}</button>
          <button class="primary" :disabled="!name.trim() || saving">{{ saving ? $t('保存中…') : $t('保存') }}</button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
/* 「⋯」只有图标：圆的 */
.icon-action.more-btn {
  width: 44px;
  padding: 0;
  justify-content: center;
}
.editor {
  width: min(440px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
}
.editor::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
}
h2 {
  margin: 0;
  font-size: 18px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
}
input,
textarea {
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-weight: 400;
  resize: vertical;
}
input:focus,
textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.note {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.buttons button {
  padding: 10px 18px;
  border-radius: 999px;
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

/* 编辑：封面 */
.cover-edit {
  display: flex;
  align-items: center;
  gap: 16px;
}
.cover-pick {
  position: relative;
  flex: none;
  width: 120px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: none;
  cursor: pointer;
}
.cover-hover {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s;
}
.cover-pick:hover .cover-hover,
.cover-pick:focus-visible .cover-hover {
  opacity: 1;
}
.cover-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.cover-actions button {
  padding: 8px 14px;
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* 一起编辑 */
.share-code {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.share-label {
  flex-basis: 100%;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.share-code .ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.share-code code {
  font: 800 26px/1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.12em;
}
.people {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.people li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.person-avatar {
  flex: none;
  width: 32px;
}
.person-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
.owner {
  padding: 2px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}
</style>
