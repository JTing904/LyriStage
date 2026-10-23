// 和朋友一起听歌（Supabase Realtime 私有频道 room:房间码，权限见 supabase/migrations/20261020010000_listen_together.sql）
//
// - 房主：播放状态有变化就广播（歌、播放 / 暂停、进度），另外每 3 秒广播一次让大家校正
// - 成员：收到就照着播；差超过 1.2 秒才跳进度，避免一直卡
// - presence：谁在房间里
// - 房主按「关闭房间」：先广播 closed，成员马上离开；房主没关就不见了（App 被关掉、断线）：
//   等 HOST_GONE_MS 还没回来，成员也离开（交给别人当房主的话房间照样继续）
// - 谁是房主记在数据库的 rooms 表（开房间时写入）；Realtime 的权限只让房主广播，
//   成员改了 App 也没办法控制别人的播放
// - 点歌：成员点的歌写进聊天（kind = 'request'），房主按「下一首播放 / 加入队列」后发一则 'accept'
// - 房主每分钟更新 rooms.last_seen_at：好友首页靠它知道你还在房间；超过一小时没更新的房间每小时清一次
// - 敲门：好友在首页按「请求加入」，房主同意后对方才拿得到房间码（20261101000000_room_requests_and_listing.sql）
// 每个人自己拿音频（手机 App 也会自己解灰），不占房主的流量
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { getSupabase, toSnapshot } from '@core/data';
import { player, sharedSources } from '../services';
import { useAuthStore } from './auth';
import { useNoticeStore } from './notice';
import { useFriendsStore } from './friends';
import { t } from '../i18n';

/** 可以点的表情（数据库也只接受这几个） */
export const REACTIONS = ['❤️', '🔥', '😭', '😂', '👏', '🎶'];

/** 房间码：6 个字，去掉了容易看错的 0 O 1 I L */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join('');
export const normalizeCode = code => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const HEARTBEAT_MS = 3000;
/** 房主多久告诉数据库一次"我还在"（好友首页超过两分钟没更新就不显示） */
const SEEN_MS = 60 * 1000;
/** 敲门后最多等多久 */
const KNOCK_WAIT_MS = 2 * 60 * 1000;
/** 房主不见了多久就把房间当成关了（网络闪断、换房主重连都比这个快很多） */
const HOST_GONE_MS = 45000;

// 别人的头像只从这几个地方载入：头像网址是用户自己填的资料，
// 随便一个网址会让房间里其他人的 App 去连那个网站（对方就知道你的 IP）
const SUPABASE_HOST = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).host;
  } catch {
    return '';
  }
})();
export function safeAvatar(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return '';
    if (u.host === SUPABASE_HOST && u.pathname.startsWith('/storage/v1/object/public/avatars/')) return url;
    if (u.host === 'avatars.githubusercontent.com') return url;
    if (/^lh\d\.googleusercontent\.com$/.test(u.host)) return url;
  } catch {
    // 不是网址
  }
  return '';
}
/** 差多少秒以上才跳进度 */
const DRIFT_SECONDS = 1.2;
/** 估计的网络延迟（秒），收到时补上 */
const LATENCY_SECONDS = 0.15;

export const useRoomStore = defineStore('room', () => {
  const auth = useAuthStore();

  const code = ref('');
  /** 'host' 房主 | 'guest' 成员 | '' 不在房间 */
  const role = ref('');
  /** 'idle' | 'connecting' | 'joined' */
  const status = ref('idle');
  const error = ref('');
  /** 房间里的人：[{ id, name, avatar, role }] */
  const members = ref([]);
  /** 房主的账号 id（从数据库的 rooms 表查，不信任每个人自己报的身份） */
  const hostId = ref(null);
  /** 聊天：[{ id, userId, body, at }]（最近 100 则） */
  const messages = ref([]);
  /** 正在画面上飘的表情：[{ id, emoji, x }] */
  const floating = ref([]);
  /** 看过的人的名字（有人离开房间后，他之前说的话还要显示名字） */
  const names = new Map();
  /** 成员收到的提示（例如房主离开了） */
  const notice = ref('');
  /** 房主已经加进队列的点歌（点歌那则消息的 id） */
  const accepted = ref(new Set());
  /** 房主：在门外等的好友 [{ id, userId, name, avatar }] */
  const knocks = ref([]);
  /** 我在敲谁的门（房主的账号 id；没在敲就是 null） */
  const knocking = ref(null);

  const inRoom = computed(() => status.value === 'joined');
  const host = computed(() => members.value.find(m => m.id === hostId.value) ?? null);

  let channel = null;
  let heartbeat = 0;
  let offPlayer = [];
  let hostGoneTimer = 0;
  let seenTimer = 0;

  function me() {
    return {
      id: auth.user?.id,
      name: auth.displayName || t('朋友'),
      avatar: auth.avatarUrl,
      role: role.value,
    };
  }

  // ---- 房主：广播播放状态 ----
  function currentState() {
    const s = player.getState();
    return {
      track: s.track ? toSnapshot(s.track) : null,
      // 房主找到的音频链接也分享出去（网页版的朋友自己找不到 VIP 歌）
      source: s.source?.url ? { url: s.source.url, br: s.source.br, source: 'room' } : null,
      playing: s.playing,
      position: player.currentTime(),
    };
  }
  function broadcast() {
    if (role.value !== 'host' || !channel) return;
    channel.send({ type: 'broadcast', event: 'sync', payload: currentState() });
  }

  // ---- 成员：照着房主的状态播 ----
  let applying = Promise.resolve();
  function applySync(payload) {
    if (payload.track && payload.source?.url) {
      if (sharedSources.size > 50) sharedSources.clear();
      sharedSources.set(payload.track.id, payload.source);
    }
    applying = applying.then(() => apply(payload)).catch(() => {});
  }
  async function apply({ track, source, playing, position }) {
    if (role.value !== 'guest') return;
    const target = position + (playing ? LATENCY_SECONDS : 0);
    if (!track) {
      player.pause();
      return;
    }
    const s = player.getState();
    // 换歌了；或是同一首但刚才自己拿不到音频、现在房主分享了链接，就重新载入
    const needsReload = s.track?.id !== track.id || (!s.source && !s.loading && source);
    if (needsReload) {
      await player.playList([track], 0, `room:${code.value}`);
      player.seek(target);
      if (!playing) player.pause();
      return;
    }
    if (Math.abs(player.currentTime() - target) > DRIFT_SECONDS) player.seek(target);
    if (playing && !s.playing) await player.play();
    else if (!playing && s.playing) player.pause();
  }

  function onPresence() {
    // 刚离开房间时可能还会收到一次更新，频道已经关了就不理它
    if (!channel) return;
    const list = Object.values(channel.presenceState()).flat();
    // 同一个人开了两个装置只算一次
    const seen = new Set();
    members.value = list
      .filter(m => m.id && !seen.has(m.id) && seen.add(m.id))
      .map(m => ({ ...m, avatar: safeAvatar(m.avatar) }));
    for (const m of members.value) names.set(m.id, m.name);
    // 成员：房主在就取消倒数；房主不在就开始倒数
    if (role.value !== 'guest') return;
    if (host.value) {
      clearTimeout(hostGoneTimer);
      hostGoneTimer = 0;
    } else if (!hostGoneTimer) {
      hostGoneTimer = setTimeout(() => {
        hostGoneTimer = 0;
        if (role.value === 'guest' && inRoom.value && !host.value) closedByHost(t('房主离开了，房间已关闭'));
      }, HOST_GONE_MS);
    }
  }

  /** 房主关了房间（或不见了）：成员也离开，画面下方说一声 */
  async function closedByHost(message) {
    if (role.value !== 'guest') return;
    await leave();
    useNoticeStore().show(message, { duration: 6000 });
  }

  /** 连进房间；Realtime 偶尔会第一次连不上，等一秒自动再试一次 */
  async function connect(roomCode, asRole) {
    try {
      await connectOnce(roomCode, asRole);
    } catch (err) {
      if (/unauthorized|permission|denied|登录/i.test(err?.message ?? '')) throw err;
      console.warn('[LyriStage] 连房间失败，再试一次', err);
      role.value = 'guest'; // 重试前会先 leave()：不要把数据库里的房间删掉
      await new Promise(resolve => setTimeout(resolve, 1000));
      await connectOnce(roomCode, asRole);
    }
  }

  async function connectOnce(roomCode, asRole) {
    const supabase = getSupabase();
    if (!supabase || !auth.allowed) throw new Error(t('要先登录 LyriStage 才能一起听'));
    await teardown();
    code.value = roomCode;
    role.value = asRole;
    status.value = 'connecting';
    error.value = '';
    notice.value = '';

    // 私有频道要带登录 token（Realtime 用它检查是不是成员）
    const { data } = await supabase.auth.getSession();
    supabase.realtime.setAuth(data.session?.access_token);

    channel = supabase.channel(`room:${roomCode}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: auth.user.id } },
    });

    channel
      .on('broadcast', { event: 'sync' }, ({ payload }) => applySync(payload))
      .on('presence', { event: 'sync' }, onPresence)
      // 有人进来：房主马上广播一次，新成员不用等心跳（成员不能广播，所以不是成员来要）
      .on('presence', { event: 'join' }, () => broadcast())
      // 聊天和表情：数据库有新消息就推过来（自己发的也会收到）
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_code=eq.${roomCode}` },
        ({ new: row }) => onMessage(row)
      )
      // 房主换人了（房主转让）
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` },
        ({ new: row }) => onHostChanged(row)
      )
      // 有好友敲门（只有房主看得到这个房间的敲门）
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_knocks', filter: `room_code=eq.${roomCode}` },
        ({ new: row }) => onKnock(row)
      )
      // 房主按了「关闭房间」
      .on('broadcast', { event: 'closed' }, () => closedByHost(t('房主关闭了房间')))
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (role.value !== 'guest' || !leftPresences.some(p => p.id === hostId.value)) return;
        // 等几秒再判断：房主转让时新房主会重新连线，一下下不在不代表离开了
        setTimeout(() => {
          if (role.value === 'guest' && inRoom.value && !host.value) notice.value = t('房主离开了，一会儿没回来房间就会关闭');
        }, 3000);
      });

    const thisChannel = channel;
    let joinedOnce = false;
    await new Promise((resolve, reject) => {
      thisChannel.subscribe(async (state, err) => {
        if (state === 'SUBSCRIBED') {
          await thisChannel.track(me());
          if (!joinedOnce) {
            joinedOnce = true;
            resolve();
          } else if (thisChannel === channel) {
            // 网络断了一下、Realtime 自己连回来了：重新报到，房主马上广播一次让大家对齐
            notice.value = '';
            broadcast();
          }
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          if (!joinedOnce) reject(err ?? new Error(t('连不上房间')));
          else if (thisChannel === channel) checkConnection(5000);
        }
      });
    });

    status.value = 'joined';
    rememberRoom();
    loadRecentMessages(roomCode);
    if (asRole === 'host') {
      offPlayer = [player.on('change', broadcast), player.on('track', broadcast)];
      heartbeat = setInterval(broadcast, HEARTBEAT_MS);
      broadcast();
      markSeen();
      seenTimer = setInterval(markSeen, SEEN_MS);
      loadKnocks(roomCode);
    }
  }

  /** 房主：告诉数据库"我还在"（还没执行 2026-11-01 的 SQL 时没有这个栏位，就不管它） */
  function markSeen() {
    if (role.value !== 'host' || !code.value) return;
    getSupabase()
      ?.from('rooms')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('code', code.value)
      .then(
        () => {},
        () => {}
      );
  }

  async function createRoom() {
    try {
      // 先在数据库登记"这个房间的房主是我"，Realtime 才会让我在房间里广播
      const supabase = getSupabase();
      if (!supabase || !auth.allowed) throw new Error(t('要先登录 LyriStage 才能一起听'));
      let roomCode = '';
      for (let attempt = 0; attempt < 5 && !roomCode; attempt++) {
        const candidate = newCode();
        const { error: err } = await supabase.from('rooms').insert({ code: candidate });
        if (!err) roomCode = candidate;
        else if (err.code !== '23505') throw err; // 23505 = 房间码刚好有人在用，换一个
      }
      if (!roomCode) throw new Error(t('连不上房间'));
      await connect(roomCode, 'host');
      hostId.value = auth.user.id;
    } catch (err) {
      fail(err);
    }
  }

  async function joinRoom(input) {
    const roomCode = normalizeCode(input);
    if (roomCode.length !== 6) {
      error.value = t('房间码是 6 个字母和数字');
      return;
    }
    try {
      // 先登记加入（20261102000000_room_members.sql）：不在房间名单里的人看不到房间、进不了频道
      const supabase = getSupabase();
      const { data: joinedHost, error: joinErr } = await supabase.rpc('join_room', { room: roomCode });
      let row;
      if (!joinErr) {
        if (!joinedHost) {
          error.value = t('找不到这个房间，可能已经关了');
          return;
        }
        row = { host_id: joinedHost };
      } else if (joinErr.code === '54000') {
        error.value = t('房间码试太多次了，一小时后再试');
        return;
      } else if (joinErr.code === 'PGRST202') {
        // 数据库还没执行那份 SQL：照旧直接查房间
        ({ data: row } = await supabase.from('rooms').select('host_id').eq('code', roomCode).maybeSingle());
      } else {
        throw joinErr;
      }
      await connect(roomCode, 'guest');
      hostId.value = row?.host_id ?? null;
      if (!row) {
        notice.value = t('这个房间现在没有房主，可能还没开或已经关了');
        return;
      }
      // 几秒内都没看到房主：房间可能不存在
      setTimeout(() => {
        if (role.value === 'guest' && inRoom.value && !host.value) {
          notice.value = t('这个房间现在没有房主，可能还没开或已经关了');
        }
      }, 4000);
    } catch (err) {
      fail(err);
    }
  }

  // ---- 房主转让 ----

  /** 重新连线（换角色时用：Realtime 只在连线时检查能不能广播） */
  async function reconnect(asRole, newHostId) {
    const roomCode = code.value;
    role.value = 'guest'; // leave() 看到是成员就不会把房间删掉
    await connect(roomCode, asRole);
    hostId.value = newHostId;
  }

  /** 房主把房间交给另一个成员；自己变成普通成员继续听 */
  async function transferHost(memberId) {
    if (role.value !== 'host' || !memberId || memberId === auth.user?.id) return;
    const { data, error: err } = await getSupabase()
      .from('rooms')
      .update({ host_id: memberId })
      .eq('code', code.value)
      .select('code');
    if (err || !data?.length) {
      useNoticeStore().show(t('转让失败：{error}', { error: err?.message ?? t('没有权限') }));
      return;
    }
    const name = nameOf(memberId);
    try {
      await reconnect('guest', memberId);
      useNoticeStore().show(t('已经把房主交给 {name}', { name }));
    } catch (e) {
      fail(e);
    }
  }

  /** 收到"房主换人了" */
  async function onHostChanged(row) {
    if (!row || row.code !== code.value || row.host_id === hostId.value) return;
    hostId.value = row.host_id;
    notice.value = '';
    if (row.host_id === auth.user?.id && role.value === 'guest') {
      try {
        await reconnect('host', row.host_id);
        useNoticeStore().show(t('你现在是房主了，你播什么大家就听什么'));
      } catch (e) {
        fail(e);
      }
    } else if (role.value === 'guest') {
      useNoticeStore().show(t('{name} 现在是房主', { name: nameOf(row.host_id) }));
    }
  }

  function fail(err) {
    const message = err?.message || String(err);
    error.value = /unauthorized|permission|denied/i.test(message)
      ? t('没有权限加入（要是 LyriStage 成员）')
      : t('连不上房间：{error}', { error: message });
    leave();
  }

  /** 自己按了「离开 / 关闭房间」（或房间关了）：房主的话把房间关掉；不再提示「回到房间」 */
  async function leave() {
    forgetRoom();
    // 房主关房间：数据库里的房间也删掉
    if (role.value === 'host' && code.value) {
      // 先告诉大家房间关了（换房主时 reconnect 会先把自己改成成员，不会走到这里）
      await channel?.send({ type: 'broadcast', event: 'closed', payload: {} }).catch(() => {});
      const { error: err } = await getSupabase()?.from('rooms').delete().eq('code', code.value) ?? {};
      if (err) console.warn('[LyriStage] 删除房间失败', err);
    }
    await teardown();
  }

  /** 断开这台设备的连线（房间留着：重新连线、换角色时用） */
  async function teardown() {
    clearInterval(heartbeat);
    clearInterval(seenTimer);
    seenTimer = 0;
    clearTimeout(hostGoneTimer);
    hostGoneTimer = 0;
    clearTimeout(checkTimer);
    offPlayer.forEach(off => typeof off === 'function' && off());
    offPlayer = [];
    if (channel) {
      const old = channel;
      channel = null;
      await old.untrack().catch(() => {});
      await getSupabase()?.removeChannel(old);
    }
    status.value = 'idle';
    role.value = '';
    members.value = [];
    hostId.value = null;
    messages.value = [];
    floating.value = [];
    accepted.value = new Set();
    knocks.value = [];
  }

  // ---- 断线自动连回来、App 被关掉后回到房间 ----

  let checkTimer = 0;
  let recovering = false;
  /** 过一下看看连线还在不在；不在就整个重新连（Realtime 自己连得回来就不用） */
  function checkConnection(delay = 0) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      if (status.value === 'joined' && channel?.state !== 'joined') recover();
    }, delay);
  }
  async function recover(attempt = 1) {
    if (recovering || status.value !== 'joined') return;
    recovering = true;
    const roomCode = code.value;
    const asRole = role.value;
    const hostBefore = hostId.value;
    notice.value = t('网络断了，重新连线中…');
    try {
      await connect(roomCode, asRole);
      hostId.value = hostBefore;
      notice.value = '';
    } catch (err) {
      console.warn('[LyriStage] 重新连房间失败', err);
      // 再试几次（每次等久一点）；都不行就放弃，房间留着可以按「回到房间」
      if (attempt < 4) setTimeout(() => recover(attempt + 1), attempt * 5000);
      else {
        await teardown();
        lastRoom.value = { code: roomCode, role: asRole };
        useNoticeStore().show(t('连不回房间 {code}，网络好了再按「回到房间」', { code: roomCode }), { duration: 8000 });
      }
    } finally {
      recovering = false;
    }
  }
  // App 回到前面、网络恢复时：看一下房间连线还在不在
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkConnection(800));
  window.addEventListener('online', () => checkConnection(800));

  /** 上次在的房间（App 被系统关掉、断线连不回来时），可以按「回到房间」 */
  const lastRoom = ref(null);
  const SAVED_KEY = 'lyristage:room';
  /** 回到房间的提示只给几个小时内的（太久的房间早就关了） */
  const SAVED_MS = 6 * 60 * 60 * 1000;
  function rememberRoom() {
    lastRoom.value = null;
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ code: code.value, role: role.value, at: Date.now() }));
    } catch {
      // 存不了就不提示
    }
  }
  function forgetRoom() {
    lastRoom.value = null;
    try {
      localStorage.removeItem(SAVED_KEY);
    } catch {
      // 没关系
    }
  }
  /** 打开 App 时：上次在房间里、而且房间还开着，就问要不要回去 */
  async function offerLastRoom() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
    } catch {
      // 读不到就算了
    }
    if (!saved?.code || inRoom.value || Date.now() - saved.at > SAVED_MS) return forgetRoom();
    const supabase = getSupabase();
    const still =
      saved.role === 'host'
        ? (await supabase.from('rooms').select('code').eq('code', saved.code).eq('host_id', auth.user?.id).maybeSingle()).data
        : (await supabase.rpc('join_room', { room: saved.code })).data;
    if (!still || inRoom.value) return forgetRoom();
    lastRoom.value = { code: saved.code, role: saved.role };
    useNoticeStore().show(t('你刚才在房间 {code}', { code: saved.code }), {
      action: { label: t('回到房间'), run: rejoinLast },
      duration: 15000,
    });
  }
  /** 按「回到房间」：房主就继续当房主（房间还是同一间），成员就重新加入 */
  async function rejoinLast() {
    const last = lastRoom.value;
    if (!last) return;
    location.hash = '#/room';
    if (last.role !== 'host') return joinRoom(last.code);
    try {
      await connect(last.code, 'host');
      hostId.value = auth.user.id;
    } catch (err) {
      fail(err);
    }
  }

  // ---- 聊天、表情 ----
  const nameOf = userId =>
    userId === auth.user?.id ? auth.displayName || t('我') : names.get(userId) || t('朋友');

  /** 已经飘过的表情（自己发的会先显示一次，Realtime 推回来时不要再飘一次） */
  const shownReactions = new Set();

  function onMessage(row) {
    if (!row || row.room_code !== code.value) return;
    if (row.kind === 'react') {
      if (shownReactions.has(row.id)) return;
      if (shownReactions.size > 200) shownReactions.clear();
      shownReactions.add(row.id);
      const item = { id: row.id, emoji: row.body, x: 10 + Math.random() * 80 };
      floating.value = [...floating.value.slice(-20), item];
      setTimeout(() => (floating.value = floating.value.filter(f => f.id !== item.id)), 2600);
      return;
    }
    if (row.kind === 'accept') {
      const requestId = Number(row.body);
      if (accepted.value.has(requestId)) return;
      accepted.value = new Set(accepted.value).add(requestId);
      // 我点的歌被房主加进去了
      const request = messages.value.find(m => m.id === requestId);
      if (request?.userId === auth.user?.id && row.user_id !== auth.user?.id) {
        useNoticeStore().show(t('房主把《{name}》加进队列了', { name: request.track.name }));
      }
      return;
    }
    if (messages.value.some(m => m.id === row.id)) return;
    const message = toMessage(row);
    if (!message) return;
    messages.value = [...messages.value.slice(-99), message];
    // 不在一起听页面时，别人说话、点歌就提示一下
    if (row.user_id === auth.user?.id || location.hash.startsWith('#/room')) return;
    if (message.track) {
      useNoticeStore().show(t('{name} 点了《{song}》', { name: nameOf(row.user_id), song: message.track.name }), {
        action: role.value === 'host' ? { label: t('加入队列'), run: () => acceptRequest(message, 'queue') } : undefined,
        duration: 8000,
      });
    } else {
      useNoticeStore().show(`${nameOf(row.user_id)}：${row.body}`);
    }
  }

  /** 数据库的一行 → 画面上的一则消息；点歌的 body 是歌曲 JSON（坏掉的就不显示） */
  function toMessage(row) {
    const message = { id: row.id, userId: row.user_id, kind: row.kind, body: row.body, at: row.created_at };
    if (row.kind !== 'request') return message;
    try {
      const track = JSON.parse(row.body);
      return track?.id && track.name ? { ...message, body: '', track } : null;
    } catch {
      return null;
    }
  }

  async function loadRecentMessages(roomCode) {
    const { data } = await getSupabase()
      .from('room_messages')
      .select('id, room_code, user_id, kind, body, created_at')
      .eq('room_code', roomCode)
      .in('kind', ['chat', 'request', 'accept'])
      .order('created_at', { ascending: false })
      .limit(40);
    if (code.value !== roomCode || !data) return;
    const rows = data.reverse();
    accepted.value = new Set([...accepted.value, ...rows.filter(r => r.kind === 'accept').map(r => Number(r.body))]);
    const older = rows.filter(r => r.kind !== 'accept').map(toMessage).filter(Boolean);
    const known = new Set(older.map(m => m.id));
    messages.value = [...older, ...messages.value.filter(m => !known.has(m.id))];
  }

  async function send(kind, body) {
    if (!inRoom.value) return false;
    const { data: row, error: err } = await getSupabase()
      .from('room_messages')
      .insert({ room_code: code.value, kind, body })
      .select('id, room_code, user_id, kind, body, created_at')
      .single();
    // 自己发的马上显示，不用等 Realtime 推回来（推回来时会按 id 去掉重复）
    if (!err) onMessage(row);
    if (err) {
      const message = /could not find the table|does not exist/i.test(err.message)
        ? t('聊天还没开通：要先在 Supabase 执行聊天的 SQL')
        : /row-level security|policy/i.test(err.message)
          ? t('发不出去：发得太快了，或房间已经关了')
          : t('发送失败：{error}', { error: err.message });
      // 原始错误记在主控台，方便查问题
      console.warn('[LyriStage] 聊天发送失败', err);
      useNoticeStore().show(message);
      return false;
    }
    return true;
  }
  /** @param {string} text */
  const sendChat = text => {
    const body = text.trim().slice(0, 200);
    return body ? send('chat', body) : Promise.resolve(false);
  };
  /** @param {string} emoji */
  const sendReaction = emoji => (REACTIONS.includes(emoji) ? send('react', emoji) : Promise.resolve(false));

  // ---- 点歌 ----
  /** 成员点歌：歌曲资料放进消息里（数据库最多 1500 字，太长就去掉别名、少放几个歌手） */
  function sendRequest(track) {
    const snapshot = toSnapshot(track);
    let body = JSON.stringify(snapshot);
    if (body.length > 1500) body = JSON.stringify({ ...snapshot, alia: [], ar: snapshot.ar.slice(0, 2) });
    if (body.length > 1500) return Promise.resolve(false);
    return send('request', body);
  }
  /** 房主把点的歌加进队列（'next' 下一首播放 | 'queue' 排到最后），再告诉大家 */
  async function acceptRequest(message, mode) {
    if (role.value !== 'host' || !message?.track || accepted.value.has(message.id)) return;
    if (mode === 'next') player.playNext(message.track);
    else player.addToQueue(message.track);
    accepted.value = new Set(accepted.value).add(message.id);
    await send('accept', String(message.id));
  }

  // ---- 敲门（房主这边）----
  /** 敲门的人不在房间里，名字头像从好友名单拿 */
  function knocker(userId) {
    const friend = useFriendsStore().friends.find(f => f.id === userId);
    return { name: friend?.name || t('朋友'), avatar: safeAvatar(friend?.avatar ?? '') };
  }
  function onKnock(row) {
    if (role.value !== 'host' || !row || row.room_code !== code.value) return;
    knocks.value = knocks.value.filter(k => k.id !== row.id);
    if (row.status !== 'pending') return;
    const who = knocker(row.user_id);
    knocks.value = [...knocks.value, { id: row.id, userId: row.user_id, ...who }];
    if (!location.hash.startsWith('#/room')) {
      useNoticeStore().show(t('{name} 想加入你的房间', { name: who.name }), {
        action: { label: t('同意'), run: () => answerKnock(row.id, true) },
        duration: 15000,
      });
    }
  }
  /** 房主连进房间时：几分钟内还在等的敲门 */
  async function loadKnocks(roomCode) {
    const since = new Date(Date.now() - KNOCK_WAIT_MS).toISOString();
    const { data } = await getSupabase()
      .from('room_knocks')
      .select('id, room_code, user_id, status')
      .eq('room_code', roomCode)
      .eq('status', 'pending')
      .gt('created_at', since);
    for (const row of data ?? []) onKnock(row);
  }
  async function answerKnock(id, accept) {
    knocks.value = knocks.value.filter(k => k.id !== id);
    const { error: err } = await getSupabase().rpc('answer_knock', { knock_id: id, accept });
    if (err) useNoticeStore().show(t('操作失败：{error}', { error: err.message }));
  }

  // ---- 敲门（好友这边）----
  let knockChannel = null;
  let knockPoll = 0;
  let knockTimeout = 0;
  function stopKnocking() {
    clearInterval(knockPoll);
    clearTimeout(knockTimeout);
    if (knockChannel) getSupabase()?.removeChannel(knockChannel);
    knockChannel = null;
    knocking.value = null;
  }
  /** 请求加入好友的房间：房主同意就自动进去；拒绝或两分钟没回应就说一声 */
  async function knock(hostUserId, hostName) {
    if (knocking.value) return;
    const supabase = getSupabase();
    const { data: id, error: err } = await supabase.rpc('knock_room', { host: hostUserId });
    if (err) {
      useNoticeStore().show(
        err.code === 'P0002' ? t('{name} 已经关掉房间了', { name: hostName }) : t('现在没办法请求加入')
      );
      useFriendsStore().refresh();
      return;
    }
    knocking.value = hostUserId;
    let done = false;
    const check = async () => {
      if (done) return;
      const { data: row } = await supabase.from('room_knocks').select('status').eq('id', id).maybeSingle();
      if (done || !row || row.status === 'pending') return;
      done = true;
      stopKnocking();
      if (row.status === 'declined') {
        useNoticeStore().show(t('{name} 没有让你进房间', { name: hostName }));
        return;
      }
      const { data: roomCode } = await supabase.rpc('knock_room_code', { knock_id: id });
      if (!roomCode) return;
      location.hash = '#/room';
      await joinRoom(roomCode);
    };
    // 房主一按就会推过来；Realtime 没推到的话每 4 秒自己查一次
    knockChannel = supabase
      .channel(`knock:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room_knocks', filter: `id=eq.${id}` }, check)
      .subscribe();
    knockPoll = setInterval(check, 4000);
    knockTimeout = setTimeout(() => {
      if (done) return;
      done = true;
      stopKnocking();
      useNoticeStore().show(t('{name} 没有回应，晚点再试试', { name: hostName }));
    }, KNOCK_WAIT_MS);
  }

  // 登录好了：问要不要回到上次的房间；退出登录就离开房间
  watch(
    () => auth.allowed,
    (allowed, before) => {
      if (allowed) offerLastRoom().catch(() => {});
      else if (before) leave();
    },
    { immediate: true }
  );

  return {
    code,
    role,
    status,
    error,
    notice,
    members,
    hostId,
    messages,
    floating,
    selfId: computed(() => auth.user?.id ?? null),
    nameOf,
    sendChat,
    sendReaction,
    sendRequest,
    acceptRequest,
    accepted,
    knocks,
    answerKnock,
    knocking,
    knock,
    stopKnocking,
    lastRoom,
    rejoinLast,
    transferHost,
    host,
    inRoom,
    createRoom,
    joinRoom,
    leave,
  };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useRoomStore, import.meta.hot));
