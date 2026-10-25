// 最近播放：首页"继续播放"用
// - 登录的成员：用账号的播放记录（数据库里本来就有，听歌报告也用它），每台设备看到的都一样；
//   播放记录要切歌后才写进去，所以这台设备正在播的那首先放最前面
// - 没登录：只记在这台设备（最近 20 首）
import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { listRecentTracks, toSnapshot } from '@core/data';
import { player } from '../services';
import { useAuthStore } from './auth';

const KEY = 'lyristage:recent';
const MAX = 20;
/** 回到 App 时重新拿账号的播放记录，最多这么久一次 */
const REFRESH_MS = 30_000;

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export const useRecentStore = defineStore('recent', () => {
  const auth = useAuthStore();
  /** 没登录时这台设备自己记的 */
  const local = ref(load());
  /** 登录时：账号的播放记录 */
  const remote = ref(null);
  /** 这台设备这次播过、还没写进播放记录的（最新的在前） */
  const session = ref([]);
  const tracks = ref(auth.allowed ? [] : local.value);

  const sameTrack = (a, b) => String(a.id) === String(b.id);
  function merge() {
    if (!auth.allowed || !remote.value) {
      tracks.value = local.value;
      return;
    }
    const list = [...session.value];
    for (const track of remote.value) if (!list.some(t => sameTrack(t, track))) list.push(track);
    tracks.value = list.slice(0, MAX);
  }

  let loadedAt = 0;
  async function refresh() {
    if (!auth.allowed) return;
    loadedAt = Date.now();
    try {
      remote.value = await listRecentTracks(MAX);
      // 已经写进播放记录的就不用另外放前面了（但正在播的那首留着）
      session.value = session.value.slice(0, 1);
      merge();
    } catch {
      // 拿不到（断网）：先用这台设备记的
      if (!remote.value) tracks.value = local.value;
    }
  }
  watch(
    () => auth.allowed,
    allowed => {
      remote.value = null;
      session.value = [];
      if (allowed) refresh();
      else merge();
    },
    { immediate: true }
  );
  // 别的设备听了歌：回到 App（手机切回来、电脑窗口被点到）时重新拿
  const refreshIfStale = () => {
    if (document.visibilityState === 'visible' && Date.now() - loadedAt > REFRESH_MS) refresh();
  };
  document.addEventListener('visibilitychange', refreshIfStale);
  window.addEventListener('focus', refreshIfStale);

  function onTrack(track) {
    const snapshot = toSnapshot(track);
    session.value = [snapshot, ...session.value.filter(t => !sameTrack(t, snapshot))].slice(0, MAX);
    local.value = [snapshot, ...local.value.filter(t => !sameTrack(t, snapshot))].slice(0, MAX);
    if (!auth.allowed) {
      try {
        localStorage.setItem(KEY, JSON.stringify(local.value));
      } catch {
        // 存不了就只在这次有效
      }
    }
    merge();
  }
  player.on('track', onTrack);
  // 打开 App 恢复上次那首时不一定有 track 事件：载入的歌一换就放到最前面
  player.on('change', state => {
    if (state.track && !(session.value[0] && sameTrack(session.value[0], state.track))) onTrack(state.track);
  });

  return { tracks, refresh };
});

// 开发时改了这个文件：直接换成新版本（不然页面会继续用旧的 store）
if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useRecentStore, import.meta.hot));
