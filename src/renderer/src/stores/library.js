// 我的音乐库：喜欢的歌（红心）、自己的歌单。
// 登录（成为成员）后自动载入；按红心、加歌时先改画面再写数据库，失败就改回来
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  addTracksToPlaylist,
  createPlaylist as createPlaylistRow,
  deletePlaylist as deletePlaylistRow,
  likeTrack,
  listLikedTrackIds,
  listPlaylists,
  removeTracksFromPlaylist,
  unlikeTrack,
  updatePlaylist,
} from '@core/data';
import { useAuthStore } from './auth';

export const useLibraryStore = defineStore('library', () => {
  const auth = useAuthStore();

  /** 喜欢的歌 ID（按喜欢时间倒序） */
  const likedIds = ref([]);
  const likedSet = computed(() => new Set(likedIds.value));
  /** 自己的歌单（id, name, description, cover_url, trackCount, updated_at …） */
  const playlists = ref([]);
  /** 喜欢 / 歌单有变动时加一，页面用来知道要重新载入 */
  const version = ref(0);
  /** 出错时的提示（App 外框会显示一下） */
  const notice = ref('');

  function say(message) {
    notice.value = message;
    setTimeout(() => {
      if (notice.value === message) notice.value = '';
    }, 2600);
  }

  async function load() {
    try {
      const [ids, lists] = await Promise.all([listLikedTrackIds(), listPlaylists()]);
      likedIds.value = ids;
      playlists.value = lists;
    } catch (err) {
      console.warn('[LyriStage] 音乐库载入失败', err);
    }
  }
  watch(
    () => auth.allowed,
    allowed => {
      if (allowed) load();
      else {
        likedIds.value = [];
        playlists.value = [];
      }
    },
    { immediate: true }
  );

  // ---- 喜欢 ----
  const isLiked = id => likedSet.value.has(Number(id));

  async function toggleLike(track) {
    const id = Number(track.id);
    const liked = isLiked(id);
    const before = likedIds.value;
    likedIds.value = liked ? before.filter(x => x !== id) : [id, ...before];
    try {
      if (liked) await unlikeTrack(id);
      else await likeTrack(track);
      version.value++;
    } catch (err) {
      likedIds.value = before;
      say(`操作失败：${err.message || err}`);
    }
  }

  // ---- 歌单 ----
  async function refreshPlaylists() {
    try {
      playlists.value = await listPlaylists();
    } catch (err) {
      say(`歌单载入失败：${err.message || err}`);
    }
  }

  async function createPlaylist(name) {
    const row = await createPlaylistRow({ name: name.trim() });
    await refreshPlaylists();
    return row;
  }

  async function renamePlaylist(id, name, description = null) {
    await updatePlaylist(id, { name: name.trim(), description });
    await refreshPlaylists();
    version.value++;
  }

  async function deletePlaylist(id) {
    await deletePlaylistRow(id);
    playlists.value = playlists.value.filter(p => p.id !== id);
    version.value++;
  }

  /** 把歌加到一个或好几个歌单 */
  async function addToPlaylists(playlistIds, tracks) {
    for (const id of playlistIds) await addTracksToPlaylist(id, tracks);
    const what = tracks.length > 1 ? `${tracks.length} 首歌` : `「${tracks[0].name}」`;
    const where =
      playlistIds.length > 1
        ? `${playlistIds.length} 个歌单`
        : `「${playlists.value.find(p => p.id === playlistIds[0])?.name ?? '歌单'}」`;
    say(`已把${what}加到${where}`);
    await refreshPlaylists();
    version.value++;
  }
  const addToPlaylist = (playlistId, tracks) => addToPlaylists([playlistId], tracks);

  async function removeFromPlaylist(playlistId, trackIds) {
    await removeTracksFromPlaylist(playlistId, trackIds);
    await refreshPlaylists();
    version.value++;
  }

  // ---- 「加到歌单」对话框（App 外框里只有一个，哪里都能叫出来）----
  /** 要加的歌；null = 对话框关着 */
  const pendingTracks = ref(null);
  const openAddDialog = tracks => (pendingTracks.value = tracks);
  const closeAddDialog = () => (pendingTracks.value = null);

  return {
    likedIds,
    playlists,
    version,
    notice,
    say,
    load,
    isLiked,
    toggleLike,
    refreshPlaylists,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    addToPlaylists,
    removeFromPlaylist,
    pendingTracks,
    openAddDialog,
    closeAddDialog,
  };
});

// 开发时改了这个文件：直接换成新版本（不然页面会继续用旧的 store）
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useLibraryStore, import.meta.hot));
