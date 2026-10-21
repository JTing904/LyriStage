// 好友：好友名单、收到 / 送出的邀请、好友在听什么，还有把自己在听什么告诉好友。
// 数据库还没执行 2026-10-25 那份 SQL 时（表不存在），整个功能安静地藏起来
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  PRIVATE_MODE_MS,
  answerFriendRequest,
  clearNowPlaying,
  getMyProfile,
  listFriends,
  listFriendsNowPlaying,
  removeFriend,
  sendFriendRequest,
  setNowPlaying,
  syncMyProfile,
  updateSharing,
  watchFriends,
} from '@core/data';
import { usePlayer } from '../composables/usePlayer';
import { useAuthStore } from './auth';

/** 超过这么久没更新就不算"正在听"，改说"x 分钟前听过"（App 关掉时数据库不会知道） */
const STALE_MS = 15 * 60 * 1000;
/** 超过 7 天没听的好友，首页就不显示（参考 Spotify 的好友动态） */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export const useFriendsStore = defineStore('friends', () => {
  const auth = useAuthStore();
  const { state } = usePlayer();

  /** 数据库有好友功能（表存在） */
  const available = ref(false);
  const profile = ref(null);
  const friends = ref([]);
  const incoming = ref([]);
  const outgoing = ref([]);
  /** userId → { track, playing, updatedAt } */
  const listening = ref(new Map());

  async function refresh() {
    try {
      const [list, now] = await Promise.all([listFriends(), listFriendsNowPlaying()]);
      friends.value = list.friends;
      incoming.value = list.incoming;
      outgoing.value = list.outgoing;
      listening.value = new Map(now.map(n => [n.userId, n]));
      available.value = true;
    } catch (err) {
      // 42P01：表不存在（还没执行 SQL）
      if (err?.code === '42P01' || /does not exist|schema cache/.test(err?.message ?? '')) available.value = false;
    }
  }

  // 登录成为成员：同步自己的名字头像（好友看到的那份）、读好友、开始即时更新
  let stopWatching = null;
  watch(
    () => auth.allowed,
    async allowed => {
      stopWatching?.();
      stopWatching = null;
      if (!allowed) {
        available.value = false;
        return;
      }
      try {
        await syncMyProfile({ displayName: auth.displayName, avatarUrl: auth.avatarUrl });
        profile.value = await getMyProfile();
      } catch {
        // 表不存在：refresh 会把功能藏起来
      }
      await refresh();
      if (available.value) stopWatching = watchFriends(() => refresh());
    },
    { immediate: true }
  );
  // 改了名字、头像也要同步
  watch(
    () => [auth.displayName, auth.avatarUrl],
    ([displayName, avatarUrl]) => {
      if (available.value) syncMyProfile({ displayName, avatarUrl }).catch(() => {});
    }
  );

  const privateUntil = computed(() => profile.value?.privateUntil ?? null);
  const inPrivateMode = computed(() => Boolean(privateUntil.value) && new Date(privateUntil.value) > new Date());
  const sharing = computed(() => Boolean(profile.value?.shareListening) && !inPrivateMode.value);

  // ---- 告诉好友我在听什么：换歌、播放 / 暂停时（等 3 秒再送，快速切歌时不要一直写）----
  let timer = 0;
  watch(
    () => [state.track?.id, state.playing, sharing.value, available.value],
    () => {
      clearTimeout(timer);
      if (!available.value || !sharing.value || !state.track) return;
      const track = state.track;
      const playing = state.playing;
      timer = setTimeout(() => setNowPlaying(track, playing).catch(() => {}), 3000);
    }
  );

  async function setShareListening(on) {
    await updateSharing({ shareListening: on });
    profile.value = { ...profile.value, shareListening: on };
    if (!on) await clearNowPlaying().catch(() => {});
  }
  /** 私人模式：6 小时内不让好友看到（再按一次提前结束） */
  async function setPrivateMode(on) {
    const until = on ? new Date(Date.now() + PRIVATE_MODE_MS).toISOString() : null;
    await updateSharing({ privateUntil: until });
    profile.value = { ...profile.value, privateUntil: until };
    if (on) await clearNowPlaying().catch(() => {});
  }

  async function send(code) {
    const result = await sendFriendRequest(code);
    await refresh();
    return result;
  }
  async function answer(id, accept) {
    await answerFriendRequest(id, accept);
    await refresh();
  }
  async function remove(id) {
    await removeFriend(id);
    await refresh();
  }

  /** 好友 + 他在听什么，正在听的排前面、再按时间；超过 7 天没听的不算 */
  const activity = computed(() =>
    friends.value
      .map(f => {
        const n = listening.value.get(f.id);
        if (!n) return null;
        const age = Date.now() - new Date(n.updatedAt).getTime();
        if (age > RECENT_MS) return null;
        return { ...f, track: n.track, updatedAt: n.updatedAt, live: n.playing && age < STALE_MS };
      })
      .filter(Boolean)
      .sort((a, b) => b.live - a.live || new Date(b.updatedAt) - new Date(a.updatedAt))
  );

  return {
    available,
    profile,
    friends,
    incoming,
    outgoing,
    activity,
    sharing,
    inPrivateMode,
    privateUntil,
    refresh,
    send,
    answer,
    remove,
    setShareListening,
    setPrivateMode,
  };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useFriendsStore, import.meta.hot));
