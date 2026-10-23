// 好友：好友名单、收到 / 送出的邀请、好友在听什么，还有把自己在听什么告诉好友。
// 便签（像 IG：一句话、可以附歌、24 小时后消失）和表情回应（收到时跳出提示，好友分页有红点）
// 数据库还没执行 2026-10-25 那份 SQL 时（表不存在），整个功能安静地藏起来
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  PRIVATE_MODE_MS,
  answerFriendRequest,
  clearMyNote,
  clearNowPlaying,
  getMyProfile,
  getSupabase,
  isMissingTable,
  listFriendNotes,
  listFriends,
  listFriendsNowPlaying,
  listReactionsToMe,
  markReactionsSeen,
  reactToFriend,
  removeFriend,
  sendFriendRequest,
  sendFriendRequestTo,
  searchMembers,
  setMyNote,
  setNowPlaying,
  syncMyProfile,
  toReaction,
  updateSharing,
  watchFriends,
} from '@core/data';
import { usePlayer } from '../composables/usePlayer';
import { useAuthStore } from './auth';
import { useNoticeStore } from './notice';
import { t } from '../i18n';

/** 播放中每隔这么久告诉好友"我还在听"（App 被关掉时数据库不会知道，靠这个判断） */
const HEARTBEAT_MS = 2 * 60 * 1000;
/** 超过这么久没收到"还在听"就不算正在听，改说"x 分钟前听过" */
const STALE_MS = 5 * 60 * 1000;
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
  /** 开着「一起听」房间的好友：[{ id, name, avatar, startedAt }]（不会拿到房间码，要敲门） */
  const rooms = ref([]);

  async function loadRooms() {
    const { data, error } = (await getSupabase()?.rpc('friends_rooms')) ?? {};
    // 还没执行 2026-11-01 的 SQL（没有这个函数）就当没有
    if (error || !data) return;
    rooms.value = data
      .map(r => {
        const friend = friends.value.find(f => f.id === r.host_id);
        return friend && { ...friend, startedAt: r.started_at };
      })
      .filter(Boolean);
  }

  // ---- 便签、表情回应 ----
  /** 数据库有便签功能（执行过 2026-11-03 的 SQL） */
  const notesAvailable = ref(false);
  /** userId → { body, track, createdAt, expiresAt }（自己的也在里面） */
  const notes = ref(new Map());
  /** 别人送给我的表情（新的在前） */
  const reactions = ref([]);

  async function loadNotes() {
    try {
      const [list, received] = await Promise.all([listFriendNotes(), listReactionsToMe()]);
      notes.value = new Map(list.map(n => [n.userId, n]));
      reactions.value = received;
      notesAvailable.value = true;
    } catch (err) {
      if (isMissingTable(err)) notesAvailable.value = false;
    }
  }

  async function refresh() {
    try {
      const [list, now] = await Promise.all([listFriends(), listFriendsNowPlaying()]);
      friends.value = list.friends;
      incoming.value = list.incoming;
      outgoing.value = list.outgoing;
      listening.value = new Map(now.map(n => [n.userId, n]));
      available.value = true;
      await Promise.all([loadRooms(), loadNotes()]);
    } catch (err) {
      // 42P01：表不存在（还没执行 SQL）
      if (err?.code === '42P01' || /does not exist|schema cache/.test(err?.message ?? '')) available.value = false;
    }
  }

  /** 数据库有没有「搜名字」（没有就只能用好友码） */
  const searchAvailable = ref(true);
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
        // 数据库还没加「搜名字」：好友页照旧只能用好友码
        searchAvailable.value = profile.value?.searchable !== null;
      } catch {
        // 表不存在：refresh 会把功能藏起来
      }
      await refresh();
      // 打开 App 时：有还没看的回应就说一声
      const unseen = reactions.value.filter(r => !r.seen).length;
      if (unseen) {
        useNoticeStore().show(t('你收到 {n} 个好友的回应', { n: unseen }), {
          action: { label: t('查看'), run: () => (location.hash = '#/friends') },
        });
      }
      const me = auth.user?.id;
      if (available.value) {
        stopWatching = watchFriends(change => {
          const row = change?.new ?? {};
          // 自己的「正在听」变了（我刚换歌）不用重新读好友资料
          if (change?.table === 'now_playing' && (row.user_id ?? change.old?.user_id) === me) return;
          if (change?.table === 'friend_notes') return void loadNotes();
          if (change?.table === 'friend_reactions') {
            if (change.eventType === 'INSERT' && row.to_user === me) onReaction(toReaction(row));
            return;
          }
          refresh();
        });
      }
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
  // 播放中定时再送一次（只更新时间），好友那边才知道我还开着 App
  setInterval(() => {
    if (available.value && sharing.value && state.track && state.playing) {
      setNowPlaying(state.track, true).catch(() => {});
    }
  }, HEARTBEAT_MS);

  // "正在听"会随时间过期：每 30 秒重新算一次（不然好友关掉 App 后会一直显示正在听）
  const now = ref(Date.now());
  setInterval(() => (now.value = Date.now()), 30 * 1000);
  // 好友开房间、关房间不会推过来：App 在前面时每分钟看一次
  setInterval(() => {
    if (available.value && friends.value.length && document.visibilityState === 'visible') loadRooms();
  }, 60 * 1000);

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

  /** 朋友的名字（不在名单里就叫「朋友」） */
  const nameOf = id => friends.value.find(f => f.id === id)?.name || t('朋友');

  /** 有人送表情给我：马上跳出来（在好友页的话就直接看得到，不用跳） */
  function onReaction(reaction) {
    if (reactions.value.some(r => r.id === reaction.id)) return;
    reactions.value = [reaction, ...reactions.value].slice(0, 50);
    if (location.hash.startsWith('#/friends')) return;
    const message =
      reaction.target === 'note'
        ? t('{name} 回应了你的便签 {emoji}', { name: nameOf(reaction.from), emoji: reaction.emoji })
        : t('{name} 回应了你在听的《{song}》 {emoji}', {
            name: nameOf(reaction.from),
            song: reaction.context,
            emoji: reaction.emoji,
          });
    useNoticeStore().show(message, { action: { label: t('查看'), run: () => (location.hash = '#/friends') } });
  }

  /** 还没看的回应 */
  const unseenReactions = computed(() => reactions.value.filter(r => !r.seen));
  /** 好友分页上的红点：新的好友邀请 + 还没看的回应 */
  const badge = computed(() => incoming.value.length + unseenReactions.value.length);

  async function markSeen() {
    if (!unseenReactions.value.length) return;
    reactions.value = reactions.value.map(r => ({ ...r, seen: true }));
    await markReactionsSeen().catch(() => {});
  }

  /** 写便签；attachSong 就附上正在听的歌 */
  async function saveNote(body, attachSong) {
    await setMyNote(body, attachSong ? state.track : null);
    await loadNotes();
  }
  async function deleteNote() {
    await clearMyNote();
    await loadNotes();
  }
  /** 送表情给好友：回应他的便签，或他正在听的歌 */
  async function react(friendId, emoji, target, context) {
    await reactToFriend({ friendId, emoji, target, context });
  }

  async function send(code) {
    const result = await sendFriendRequest(code);
    await refresh();
    return result;
  }
  /** 对搜到的人送邀请 */
  async function sendTo(id) {
    const result = await sendFriendRequestTo(id);
    await refresh();
    return result;
  }
  /** 搜名字或好友码；数据库还没加这个功能就回传 null（画面改用只有好友码的旧样子） */
  async function search(text) {
    try {
      return await searchMembers(text);
    } catch (err) {
      if (err?.code === 'PGRST202' || /search_members/.test(err?.message ?? '')) {
        searchAvailable.value = false;
        return null;
      }
      throw err;
    }
  }
  /** 让别人用名字搜到我 */
  async function setSearchable(on) {
    await updateSharing({ searchable: on });
    profile.value = { ...profile.value, searchable: on };
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
        const age = now.value - new Date(n.updatedAt).getTime();
        if (age > RECENT_MS) return null;
        return { ...f, track: n.track, updatedAt: n.updatedAt, live: n.playing && age < STALE_MS };
      })
      .filter(Boolean)
      .sort((a, b) => b.live - a.live || new Date(b.updatedAt) - new Date(a.updatedAt))
  );

  /** 现在有好友正在听（首页标题用"正在听"还是"最近在听"） */
  const anyLive = computed(() => activity.value.some(a => a.live));

  return {
    available,
    searchAvailable,
    search,
    sendTo,
    setSearchable,
    anyLive,
    profile,
    friends,
    incoming,
    outgoing,
    activity,
    listening,
    rooms,
    notesAvailable,
    notes,
    reactions,
    unseenReactions,
    badge,
    nameOf,
    markSeen,
    saveNote,
    deleteNote,
    react,
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
