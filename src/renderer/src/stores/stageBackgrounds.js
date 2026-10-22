// 歌词舞台自定义背景：设过哪些（存在数据库，电脑和手机同步），
// 照片下载过一次就存在这台设备（Cache Storage），之后不用再下载。
// 数据库还没执行 2026-10-29 那份 SQL 时，整个功能安静地藏起来
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  ALL_SONGS,
  downloadStageBackground,
  listStageBackgrounds,
  removeStageBackground,
  setAllSongsBackgroundEnabled,
  setStageBackground,
  trackKey,
} from '@core/data';
import { fitImage } from '../utils/image';
import { useAuthStore } from './auth';

const CACHE = 'lyristage-stage-backgrounds';
const cacheKey = path => `https://lyristage.local/stage-backgrounds/${path}`;

/** 先找这台设备存的，没有才下载（下载后存起来） @param {string} path */
async function loadBlob(path) {
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(cacheKey(path));
    if (hit) return await hit.blob();
    const blob = await downloadStageBackground(path);
    await cache.put(cacheKey(path), new Response(blob));
    return blob;
  } catch {
    // 不能用 Cache Storage（例如隐私模式）：每次下载
    return downloadStageBackground(path);
  }
}

/** 刚上传的照片直接存进这台设备，不用再下载一次 */
async function remember(path, blob) {
  try {
    await (await caches.open(CACHE)).put(cacheKey(path), new Response(blob));
  } catch {
    // 存不了就之后再下载
  }
}

/** 模糊用的小图：缩到 32px 宽，浏览器放大时自然变模糊（比实时模糊滤镜省电） @param {Blob} blob */
async function tinyUrl(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = Math.max(1, Math.round((32 * bitmap.height) / bitmap.width));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const small = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(small);
}

export const useStageBackgroundsStore = defineStore('stageBackgrounds', () => {
  const auth = useAuthStore();
  /** 数据库有这个功能 */
  const available = ref(false);
  /** 键（'*' 或 'netease:<id>'）→ { path, enabled } */
  const rows = ref(new Map());
  /** 照片网址（同一张只做一次）：path → Promise<{ full, blur }> */
  const images = new Map();

  async function refresh() {
    try {
      const list = await listStageBackgrounds();
      available.value = list !== null;
      rows.value = new Map((list ?? []).map(r => [r.key, r]));
    } catch {
      // 网络问题：保留原本的
    }
  }
  watch(
    () => auth.allowed,
    allowed => {
      if (allowed) refresh();
      else {
        available.value = false;
        rows.value = new Map();
      }
    },
    { immediate: true }
  );

  /** 全部歌那张（没设过是 null） */
  const allSongs = computed(() => rows.value.get(ALL_SONGS) ?? null);
  /** 这首歌有没有专属照片 */
  const hasOwn = track => Boolean(track && rows.value.get(trackKey(track)));

  /** 这首歌要用哪张：专属 > 全部歌（开着时）> null（用封面） */
  function pathFor(track) {
    if (!track) return null;
    const own = rows.value.get(trackKey(track));
    if (own) return own.path;
    return allSongs.value?.enabled ? allSongs.value.path : null;
  }

  /** @param {string} path @returns {Promise<{ full: string, blur: string }>} */
  function image(path) {
    if (!images.has(path)) {
      const task = (async () => {
        const blob = await loadBlob(path);
        return { full: URL.createObjectURL(blob), blur: await tinyUrl(blob) };
      })();
      task.catch(() => images.delete(path)); // 下载失败下次再试
      images.set(path, task);
    }
    return images.get(path);
  }

  async function upload(key, file) {
    const blob = await fitImage(file);
    const path = await setStageBackground(key, blob);
    await remember(path, blob);
    await refresh();
  }

  return {
    available,
    allSongs,
    hasOwn,
    pathFor,
    image,
    refresh,
    /** 全部歌换成这张 @param {File} file */
    setForAll: file => upload(ALL_SONGS, file),
    /** 这首歌专属 @param {object} track @param {File} file */
    setForSong: (track, file) => upload(trackKey(track), file),
    /** 全部歌：用照片 / 用封面 @param {boolean} on */
    async useAllSongs(on) {
      await setAllSongsBackgroundEnabled(on);
      await refresh();
    },
    /** 这首歌换回封面（或全部歌那张） @param {object} track */
    async removeForSong(track) {
      await removeStageBackground(trackKey(track));
      await refresh();
    },
  };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useStageBackgroundsStore, import.meta.hot));
