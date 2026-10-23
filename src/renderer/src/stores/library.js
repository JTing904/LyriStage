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
  restoreTracksToPlaylist,
  unlikeTrack,
  updatePlaylist,
  uploadPlaylistCover,
  removePlaylistCovers,
} from '@core/data';
import { useAuthStore } from './auth';
import { useNoticeStore } from './notice';
import { t } from '../i18n';

export const useLibraryStore = defineStore('library', () => {
  const auth = useAuthStore();

  /** 喜欢的歌 ID（按喜欢时间倒序） */
  const likedIds = ref([]);
  const likedSet = computed(() => new Set(likedIds.value));
  /** 自己的歌单（id, name, description, cover_url, trackCount, updated_at …） */
  const playlists = ref([]);
  /** 喜欢 / 歌单有变动时加一，页面用来知道要重新载入 */
  const version = ref(0);
  /** 提示一句话（画面下方显示一下） */
  const say = message => useNoticeStore().show(message);

  async function load() {
    try {
      const [ids, lists] = await Promise.all([listLikedTrackIds(), listPlaylists()]);
      likedIds.value = ids;
      playlists.value = lists;
    } catch (err) {
      console.warn('[LyriStage] 音乐库载入失败', err);
      // 多半是断网：网络恢复后再载入一次
      window.addEventListener('online', () => auth.allowed && load(), { once: true });
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
    if (!auth.requireMember('收藏喜欢的歌')) return;
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
      say(t('操作失败：{error}', { error: err.message || err }));
      return;
    }
    // 在「我喜欢的音乐」里取消（歌会从列表消失）：可以复原，用原本喜欢的时间放回原位
    if (liked && track.likedAt) {
      useNoticeStore().undo(t('已取消喜欢《{name}》', { name: track.name }), () => relike(track));
    }
  }
  async function relike(track) {
    const id = Number(track.id);
    if (!isLiked(id)) likedIds.value = [id, ...likedIds.value];
    try {
      await likeTrack(track, undefined, track.likedAt);
      version.value++;
    } catch (err) {
      likedIds.value = likedIds.value.filter(x => x !== id);
      say(t('操作失败：{error}', { error: err.message || err }));
    }
  }

  // ---- 歌单 ----
  async function refreshPlaylists() {
    try {
      playlists.value = await listPlaylists();
    } catch (err) {
      say(t('歌单载入失败：{error}', { error: err.message || err }));
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

  /**
   * 换歌单封面：image 是裁好的图片；null = 换回用歌曲封面拼的
   * @param {string} id
   * @param {Blob | null} image
   */
  async function setPlaylistCover(id, image) {
    const url = image ? await uploadPlaylistCover(id, image) : null;
    await updatePlaylist(id, { cover_url: url });
    if (!image) await removePlaylistCovers(id);
    await refreshPlaylists();
    version.value++;
    return url;
  }

  async function deletePlaylist(id) {
    await deletePlaylistRow(id);
    removePlaylistCovers(id);
    playlists.value = playlists.value.filter(p => p.id !== id);
    version.value++;
  }

  /** 把歌加到一个或好几个歌单 */
  async function addToPlaylists(playlistIds, tracks) {
    for (const id of playlistIds) await addTracksToPlaylist(id, tracks);
    const what =
      tracks.length > 1
        ? t('{n} 首歌', { n: tracks.length })
        : t('「{name}」', { name: tracks[0].name });
    const where =
      playlistIds.length > 1
        ? t('{n} 个歌单', { n: playlistIds.length })
        : t('「{name}」', {
            name: playlists.value.find(p => p.id === playlistIds[0])?.name ?? t('歌单'),
          });
    say(t('已把{what}加到{where}', { what, where }));
    await refreshPlaylists();
    version.value++;
  }
  const addToPlaylist = (playlistId, tracks) => addToPlaylists([playlistId], tracks);

  async function removeFromPlaylist(playlistId, trackIds) {
    await removeTracksFromPlaylist(playlistId, trackIds);
    await refreshPlaylists();
    version.value++;
  }

  /** 按「复原」：刚移除的歌放回原位（tracks 要带 position） */
  async function restoreToPlaylist(playlistId, tracks) {
    await restoreTracksToPlaylist(playlistId, tracks);
    await refreshPlaylists();
    version.value++;
  }

  // ---- 「加到歌单」对话框（App 外框里只有一个，哪里都能叫出来）----
  /** 要加的歌；null = 对话框关着 */
  const pendingTracks = ref(null);
  const openAddDialog = tracks => {
    if (auth.requireMember('建立自己的歌单')) pendingTracks.value = tracks;
  };
  const closeAddDialog = () => (pendingTracks.value = null);

  return {
    likedIds,
    playlists,
    version,
    say,
    load,
    isLiked,
    toggleLike,
    refreshPlaylists,
    createPlaylist,
    renamePlaylist,
    setPlaylistCover,
    deletePlaylist,
    addToPlaylist,
    addToPlaylists,
    removeFromPlaylist,
    restoreToPlaylist,
    pendingTracks,
    openAddDialog,
    closeAddDialog,
  };
});

// 开发时改了这个文件：直接换成新版本（不然页面会继续用旧的 store）
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useLibraryStore, import.meta.hot));
