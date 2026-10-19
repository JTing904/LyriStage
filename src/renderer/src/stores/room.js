// 和朋友一起听歌（Supabase Realtime 私有频道 room:房间码，权限见 supabase/migrations/20261020010000_listen_together.sql）
//
// - 房主：播放状态有变化就广播（歌、播放 / 暂停、进度），另外每 3 秒广播一次让大家校正
// - 成员：收到就照着播；差超过 1.2 秒才跳进度，避免一直卡
// - presence：谁在房间里；房主离开时成员会收到通知
// 每个人自己拿音频（手机 App 也会自己解灰），不占房主的流量
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { getSupabase, toSnapshot } from '@core/data';
import { player } from '../services';
import { useAuthStore } from './auth';

/** 房间码：6 个字，去掉了容易看错的 0 O 1 I L */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join('');
export const normalizeCode = code => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const HEARTBEAT_MS = 3000;
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
  /** 成员收到的提示（例如房主离开了） */
  const notice = ref('');

  const inRoom = computed(() => status.value === 'joined');
  const host = computed(() => members.value.find(m => m.role === 'host') ?? null);

  let channel = null;
  let heartbeat = 0;
  let offPlayer = [];

  function me() {
    return {
      id: auth.user?.id,
      name: auth.displayName || '朋友',
      avatar: auth.avatarUrl,
      role: role.value,
    };
  }

  // ---- 房主：广播播放状态 ----
  function currentState() {
    const s = player.getState();
    return {
      track: s.track ? toSnapshot(s.track) : null,
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
    applying = applying.then(() => apply(payload)).catch(() => {});
  }
  async function apply({ track, playing, position }) {
    if (role.value !== 'guest') return;
    const target = position + (playing ? LATENCY_SECONDS : 0);
    if (!track) {
      player.pause();
      return;
    }
    const s = player.getState();
    if (s.track?.id !== track.id) {
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
    const list = Object.values(channel.presenceState()).flat();
    // 同一个人开了两个装置只算一次
    const seen = new Set();
    members.value = list.filter(m => m.id && !seen.has(m.id) && seen.add(m.id));
  }

  async function connect(roomCode, asRole) {
    const supabase = getSupabase();
    if (!supabase || !auth.allowed) throw new Error('要先登录 LyriStage 才能一起听');
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
      // 新成员进来要求同步：房主马上广播一次
      .on('broadcast', { event: 'hello' }, () => broadcast())
      .on('presence', { event: 'sync' }, onPresence)
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (role.value === 'guest' && leftPresences.some(p => p.role === 'host')) {
          notice.value = '房主离开了房间';
        }
      });

    await new Promise((resolve, reject) => {
      channel.subscribe(async (state, err) => {
        if (state === 'SUBSCRIBED') {
          await channel.track(me());
          resolve();
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          reject(err ?? new Error('连不上房间'));
        }
      });
    });

    status.value = 'joined';
    if (asRole === 'host') {
      offPlayer = [player.on('change', broadcast), player.on('track', broadcast)];
      heartbeat = setInterval(broadcast, HEARTBEAT_MS);
      broadcast();
    } else {
      channel.send({ type: 'broadcast', event: 'hello', payload: {} });
    }
  }

  async function createRoom() {
    try {
      await connect(newCode(), 'host');
    } catch (err) {
      fail(err);
    }
  }

  async function joinRoom(input) {
    const roomCode = normalizeCode(input);
    if (roomCode.length !== 6) {
      error.value = '房间码是 6 个字母和数字';
      return;
    }
    try {
      await connect(roomCode, 'guest');
      // 几秒内都没看到房主：房间可能不存在
      setTimeout(() => {
        if (role.value === 'guest' && inRoom.value && !host.value) {
          notice.value = '这个房间现在没有房主，可能还没开或已经关了';
        }
      }, 4000);
    } catch (err) {
      fail(err);
    }
  }

  function fail(err) {
    const message = err?.message || String(err);
    error.value = /unauthorized|permission|denied/i.test(message)
      ? '没有权限加入（要是 LyriStage 成员）'
      : `连不上房间：${message}`;
    leave();
  }

  async function leave() {
    clearInterval(heartbeat);
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
    host,
    inRoom,
    createRoom,
    joinRoom,
    leave,
  };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useRoomStore, import.meta.hot));
