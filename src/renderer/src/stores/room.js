// 和朋友一起听歌（Supabase Realtime 私有频道 room:房间码，权限见 supabase/migrations/20261020010000_listen_together.sql）
//
// - 房主：播放状态有变化就广播（歌、播放 / 暂停、进度），另外每 3 秒广播一次让大家校正
// - 成员：收到就照着播；差超过 1.2 秒才跳进度，避免一直卡
// - presence：谁在房间里；房主离开时成员会收到通知
// - 谁是房主记在数据库的 rooms 表（开房间时写入）；Realtime 的权限只让房主广播，
//   成员改了 App 也没办法控制别人的播放
// 每个人自己拿音频（手机 App 也会自己解灰），不占房主的流量
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { getSupabase, toSnapshot } from '@core/data';
import { player, sharedSources } from '../services';
import { useAuthStore } from './auth';
import { t } from '../i18n';

/** 房间码：6 个字，去掉了容易看错的 0 O 1 I L */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join('');
export const normalizeCode = code => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const HEARTBEAT_MS = 3000;

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
  /** 成员收到的提示（例如房主离开了） */
  const notice = ref('');

  const inRoom = computed(() => status.value === 'joined');
  const host = computed(() => members.value.find(m => m.id === hostId.value) ?? null);

  let channel = null;
  let heartbeat = 0;
  let offPlayer = [];

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
  }

  async function connect(roomCode, asRole) {
    const supabase = getSupabase();
    if (!supabase || !auth.allowed) throw new Error(t('要先登录 LyriStage 才能一起听'));
    await leave();
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
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (role.value === 'guest' && leftPresences.some(p => p.id === hostId.value)) {
          notice.value = t('房主离开了房间');
        }
      });

    await new Promise((resolve, reject) => {
      channel.subscribe(async (state, err) => {
        if (state === 'SUBSCRIBED') {
          await channel.track(me());
          resolve();
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          reject(err ?? new Error(t('连不上房间')));
        }
      });
    });

    status.value = 'joined';
    if (asRole === 'host') {
      offPlayer = [player.on('change', broadcast), player.on('track', broadcast)];
      heartbeat = setInterval(broadcast, HEARTBEAT_MS);
      broadcast();
    }
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
      const { data: row } = await getSupabase()
        .from('rooms')
        .select('host_id')
        .eq('code', roomCode)
        .maybeSingle();
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

  function fail(err) {
    const message = err?.message || String(err);
    error.value = /unauthorized|permission|denied/i.test(message)
      ? t('没有权限加入（要是 LyriStage 成员）')
      : t('连不上房间：{error}', { error: message });
    leave();
  }

  async function leave() {
    clearInterval(heartbeat);
    // 房主关房间：数据库里的房间也删掉
    if (role.value === 'host' && code.value) {
      const { error: err } = await getSupabase()?.from('rooms').delete().eq('code', code.value) ?? {};
      if (err) console.warn('[LyriStage] 删除房间失败', err);
    }
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
  }

  // 退出登录就离开房间
  watch(
    () => auth.allowed,
    allowed => !allowed && leave()
  );

  return {
    code,
    role,
    status,
    error,
    notice,
    members,
    hostId,
    host,
    inRoom,
    createRoom,
    joinRoom,
    leave,
  };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useRoomStore, import.meta.hot));
