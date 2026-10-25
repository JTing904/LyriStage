// 一起听的语音（每个人直接连每个人：WebRTC mesh，5 个人以内很稳）
//
// - 连线资料（offer / answer / ICE）走 Realtime 私有频道 voice:房间码（权限见 20261031000000_voice_chat.sql）；
//   两台设备之间只由连线 ID 比较小的那个发 offer，不会两边同时发
// - 认设备用每次加入时新产生的连线 ID（同一个账号用手机和电脑同时进来也能互相连）；
//   画面上的头像、讲话亮圈还是照账号
// - 连不上时经过 Cloudflare 的中转（TURN）：短期帐密跟我们的服务器拿（server/lib/voice.js）
// - presence 记谁在语音里、有没有静音；谁在讲话是每个人自己听声音大小判断的
// - 有人讲话时把音乐调小（duckMusic）；默认关麦克风，要按「加入语音」才会开
// - Android：语音中开一个前台服务（VoiceCallService.java），关掉屏幕、切到别的 App 时麦克风和连线继续
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { registerPlugin } from '@capacitor/core';
import { createHttp } from '@core/http/client';
import { getAccessToken, getSupabase } from '@core/data';
import { duckMusic, setRoomMix } from '../services';
import { DUCK_LEVELS, roomVolume } from '../roomVolume';
import { isNativeApp, translateApiBase } from '../platform';
import { useAuthStore } from './auth';
import { useRoomStore } from './room';
import { t } from '../i18n';
import { humanMessage } from '../friendlyError';

/** 声音大小超过这个就算在讲话（0~1 的 RMS） */
const SPEAKING_LEVEL = 0.035;
/** 停下来多久才算讲完（不然一个字一个字闪） */
const SPEAKING_HOLD_MS = 450;

const NativeVoice = isNativeApp ? registerPlugin('Voice') : null;
// 页面重新载入时语音已经断了：上次开着的前台服务也关掉
NativeVoice?.stop().catch(() => {});

const api = createHttp({
  baseURL: translateApiBase,
  getHeaders: async () => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});

export const useVoiceStore = defineStore('voice', () => {
  const auth = useAuthStore();
  const room = useRoomStore();

  /** 'off' | 'connecting' | 'on' */
  const status = ref('off');
  const muted = ref(false);
  const error = ref('');
  /** 在语音里的人（照账号）：[{ id, muted }] */
  const participants = ref([]);
  /** 正在讲话的人的账号 id（包括自己） */
  const speaking = ref(new Set());

  const inVoice = computed(() => status.value === 'on');
  const selfId = () => auth.user?.id;
  /** 这次加入语音的连线 ID（每台设备、每次加入都不一样） */
  let session = '';

  let channel = null;
  let localStream = null;
  let iceServers = [];
  let audioCtx = null;
  let meterTimer = 0;
  /** 对方的连线 ID → { userId, pc, audio, analyser, pendingIce, lastLoud } */
  const peers = new Map();
  const self = { analyser: null, lastLoud: 0 };

  // ---- 交换连线资料 ----
  function send(to, kind, data) {
    channel?.send({ type: 'broadcast', event: 'signal', payload: { from: session, to, kind, data } });
  }
  const description = d => ({ type: d.type, sdp: d.sdp });

  function meterFor(stream) {
    if (!audioCtx) return null;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  function createPeer(id, userId) {
    const pc = new RTCPeerConnection({ iceServers });
    const peer = { userId, pc, audio: null, analyser: null, pendingIce: [], lastLoud: 0 };
    peers.set(id, peer);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.onicecandidate = ({ candidate }) => candidate && send(id, 'ice', candidate.toJSON());
    pc.ontrack = ({ streams: [stream] }) => {
      if (!stream || peer.audio) return;
      // 远端的声音：放进一个看不到的 <audio> 播出来（Chrome 要接到元素上，分析音量才有数字）
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      audio.volume = roomVolume.voice;
      audio.play().catch(() => {});
      peer.audio = audio;
      peer.analyser = meterFor(stream);
    };
    pc.onconnectionstatechange = async () => {
      // 网络换了（Wi-Fi ↔ 行动网络）连线断掉：发 offer 的那边重新协商一次
      if (pc.connectionState === 'failed' && session < id) {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        send(id, 'offer', description(pc.localDescription));
      }
    };
    if (session < id) {
      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send(id, 'offer', description(pc.localDescription));
      })().catch(() => {});
    }
    return peer;
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    peer.pc.close();
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
  }

  async function flushIce(peer) {
    for (const candidate of peer.pendingIce.splice(0)) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  async function onSignal({ from, to, kind, data }) {
    if (to !== session || !from || !localStream) return;
    const peer = peers.get(from) ?? createPeer(from, sessions.get(from)?.userId ?? null);
    const { pc } = peer;
    try {
      if (kind === 'offer') {
        await pc.setRemoteDescription(data);
        await flushIce(peer);
        await pc.setLocalDescription(await pc.createAnswer());
        send(from, 'answer', description(pc.localDescription));
      } else if (kind === 'answer') {
        await pc.setRemoteDescription(data);
        await flushIce(peer);
      } else if (kind === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(data).catch(() => {});
        else peer.pendingIce.push(data);
      }
    } catch (err) {
      console.warn('[LyriStage] 语音连线资料处理失败', err);
    }
  }

  /** 连线 ID → { userId, muted }（语音频道 presence 里的每台设备） */
  const sessions = new Map();
  function onPresence() {
    // 离开语音后还可能慢一步收到通知，那时频道已经关了
    if (!channel) return;
    sessions.clear();
    for (const p of Object.values(channel.presenceState()).flat()) {
      if (p.session && p.id) sessions.set(p.session, { userId: p.id, muted: Boolean(p.muted) });
    }
    // 画面照账号：同一个人两台设备，只要有一台没静音就算没静音
    const byUser = new Map();
    for (const { userId, muted: m } of sessions.values()) byUser.set(userId, (byUser.get(userId) ?? true) && m);
    participants.value = [...byUser].map(([id, m]) => ({ id, muted: m }));
    for (const [id, info] of sessions) if (id !== session && !peers.has(id)) createPeer(id, info.userId);
    for (const id of [...peers.keys()]) if (!sessions.has(id)) closePeer(id);
  }

  // ---- 谁在讲话、讲话时把音乐调小 ----
  const buffer = new Float32Array(512);
  function level(analyser) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const v of buffer) sum += v * v;
    return Math.sqrt(sum / buffer.length);
  }
  let ducked = false;
  function measure() {
    const now = Date.now();
    const next = new Set();
    /** 这个人（这台设备）现在算不算在讲话 */
    const talking = (entry, silent) => {
      if (!silent && level(entry.analyser) > SPEAKING_LEVEL) entry.lastLoud = now;
      return now - entry.lastLoud < SPEAKING_HOLD_MS;
    };
    if (talking(self, muted.value)) next.add(selfId());
    let othersTalking = false;
    for (const peer of peers.values()) {
      if (!talking(peer, false)) continue;
      othersTalking = true;
      if (peer.userId) next.add(peer.userId);
    }
    const changed = next.size !== speaking.value.size || [...next].some(id => !speaking.value.has(id));
    if (changed) speaking.value = next;
    // 别人（别的设备）在讲话：音乐小声一点
    if (othersTalking !== ducked) {
      ducked = othersTalking;
      duckMusic(ducked);
    }
  }

  // ---- 加入、离开、静音 ----
  async function join() {
    if (status.value !== 'off' || !room.inRoom) return;
    status.value = 'connecting';
    error.value = '';
    const code = room.code;
    try {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        throw new Error(t('没有麦克风权限，到系统设置里允许 LyriStage 使用麦克风'));
      }
      // 拿到麦克风了（App 正显示着）：开前台服务。开不了（旧版 App）语音照样能用，只是关屏幕会断
      NativeVoice?.start().catch(() => {});
      muted.value = false;
      session = crypto.randomUUID();
      audioCtx = new AudioContext();
      // 有的浏览器建好时是暂停的（没有直接的点击）：叫醒它，不然听不出谁在讲话
      await audioCtx.resume().catch(() => {});
      self.analyser = meterFor(localStream);

      const ice = await api.get('/voice/ice').catch(() => null);
      iceServers = ice?.iceServers ?? [{ urls: ['stun:stun.cloudflare.com:3478'] }];

      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      supabase.realtime.setAuth(data.session?.access_token);
      channel = supabase.channel(`voice:${code}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: session } },
      });
      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload))
        .on('presence', { event: 'sync' }, onPresence);
      await new Promise((resolve, reject) => {
        channel.subscribe(async (state, err) => {
          if (state === 'SUBSCRIBED') {
            await channel.track({ id: selfId(), session, muted: false });
            resolve();
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
            reject(err ?? new Error(t('连不上语音')));
          }
        });
      });
      meterTimer = setInterval(measure, 120);
      status.value = 'on';
    } catch (err) {
      error.value = humanMessage(err, t('没加入语音'));
      await leave();
    }
  }

  async function leave() {
    clearInterval(meterTimer);
    meterTimer = 0;
    for (const id of [...peers.keys()]) closePeer(id);
    if (localStream) NativeVoice?.stop().catch(() => {});
    localStream?.getTracks().forEach(track => track.stop());
    localStream = null;
    if (channel) {
      const old = channel;
      channel = null;
      await old.untrack().catch(() => {});
      await getSupabase()?.removeChannel(old);
    }
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    self.analyser = null;
    if (ducked) duckMusic(false);
    ducked = false;
    sessions.clear();
    session = '';
    participants.value = [];
    speaking.value = new Set();
    status.value = 'off';
  }

  function toggleMute() {
    if (!localStream) return;
    muted.value = !muted.value;
    localStream.getAudioTracks().forEach(track => (track.enabled = !muted.value));
    channel?.track({ id: selfId(), session, muted: muted.value });
  }

  // 离开房间就离开语音
  watch(
    () => room.inRoom,
    inRoom => !inRoom && status.value !== 'off' && leave()
  );

  // ---- 房间音量（RoomVolumeSheet）----
  // 音乐：在房间里才乘上房间的音乐大小；有人讲话时变多小。语音：每个人的声音都套上
  watch(
    () => [room.inRoom, roomVolume.music, roomVolume.duck],
    ([inRoom]) => setRoomMix({ music: inRoom ? roomVolume.music : 1, duck: DUCK_LEVELS[roomVolume.duck] ?? DUCK_LEVELS.some }),
    { immediate: true }
  );
  watch(
    () => roomVolume.voice,
    volume => {
      for (const peer of peers.values()) if (peer.audio) peer.audio.volume = volume;
    }
  );

  return { status, muted, error, participants, speaking, inVoice, join, leave, toggleMute };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useVoiceStore, import.meta.hot));
