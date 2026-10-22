// 一起听的语音（每个人直接连每个人：WebRTC mesh，5 个人以内很稳）
//
// - 连线资料（offer / answer / ICE）走 Realtime 私有频道 voice:房间码（权限见 20261031000000_voice_chat.sql）；
//   两个人之间只由 id 比较小的那个发 offer，不会两边同时发
// - 连不上时经过 Cloudflare 的中转（TURN）：短期帐密跟我们的服务器拿（server/lib/voice.js）
// - presence 记谁在语音里、有没有静音；谁在讲话是每个人自己听声音大小判断的
// - 有人讲话时把音乐调小（duckMusic）；默认关麦克风，要按「加入语音」才会开
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { createHttp } from '@core/http/client';
import { getAccessToken, getSupabase } from '@core/data';
import { duckMusic } from '../services';
import { translateApiBase } from '../platform';
import { useAuthStore } from './auth';
import { useRoomStore } from './room';
import { t } from '../i18n';

/** 声音大小超过这个就算在讲话（0~1 的 RMS） */
const SPEAKING_LEVEL = 0.035;
/** 停下来多久才算讲完（不然一个字一个字闪） */
const SPEAKING_HOLD_MS = 450;

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
  /** 在语音里的人：[{ id, muted }] */
  const participants = ref([]);
  /** 正在讲话的人的 id（包括自己） */
  const speaking = ref(new Set());

  const inVoice = computed(() => status.value === 'on');
  const selfId = () => auth.user?.id;

  let channel = null;
  let localStream = null;
  let iceServers = [];
  let audioCtx = null;
  let meterTimer = 0;
  /** id → { pc, audio, analyser, pendingIce, lastLoud } */
  const peers = new Map();
  const self = { analyser: null, lastLoud: 0 };

  // ---- 交换连线资料 ----
  function send(to, kind, data) {
    channel?.send({ type: 'broadcast', event: 'signal', payload: { from: selfId(), to, kind, data } });
  }
  const description = d => ({ type: d.type, sdp: d.sdp });

  function meterFor(stream) {
    if (!audioCtx) return null;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  function createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers });
    const peer = { pc, audio: null, analyser: null, pendingIce: [], lastLoud: 0 };
    peers.set(id, peer);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.onicecandidate = ({ candidate }) => candidate && send(id, 'ice', candidate.toJSON());
    pc.ontrack = ({ streams: [stream] }) => {
      if (!stream || peer.audio) return;
      // 远端的声音：放进一个看不到的 <audio> 播出来（Chrome 要接到元素上，分析音量才有数字）
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      audio.play().catch(() => {});
      peer.audio = audio;
      peer.analyser = meterFor(stream);
    };
    pc.onconnectionstatechange = async () => {
      // 网络换了（Wi-Fi ↔ 行动网络）连线断掉：发 offer 的那边重新协商一次
      if (pc.connectionState === 'failed' && selfId() < id) {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        send(id, 'offer', description(pc.localDescription));
      }
    };
    if (selfId() < id) {
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
    if (to !== selfId() || !from || !localStream) return;
    const peer = peers.get(from) ?? createPeer(from);
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

  function onPresence() {
    const seen = new Map();
    for (const p of Object.values(channel.presenceState()).flat()) if (p.id) seen.set(p.id, p);
    participants.value = [...seen.values()].map(p => ({ id: p.id, muted: Boolean(p.muted) }));
    const me = selfId();
    for (const id of seen.keys()) if (id !== me && !peers.has(id)) createPeer(id);
    for (const id of [...peers.keys()]) if (!seen.has(id)) closePeer(id);
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
    const check = (id, entry, silent) => {
      if (!silent && level(entry.analyser) > SPEAKING_LEVEL) entry.lastLoud = now;
      if (now - entry.lastLoud < SPEAKING_HOLD_MS) next.add(id);
    };
    check(selfId(), self, muted.value);
    for (const [id, peer] of peers) check(id, peer, false);
    const changed = next.size !== speaking.value.size || [...next].some(id => !speaking.value.has(id));
    if (changed) speaking.value = next;
    // 别人在讲话：音乐小声一点
    const othersTalking = [...next].some(id => id !== selfId());
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
      muted.value = false;
      audioCtx = new AudioContext();
      self.analyser = meterFor(localStream);

      const ice = await api.get('/voice/ice').catch(() => null);
      iceServers = ice?.iceServers ?? [{ urls: ['stun:stun.cloudflare.com:3478'] }];

      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      supabase.realtime.setAuth(data.session?.access_token);
      channel = supabase.channel(`voice:${code}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: selfId() } },
      });
      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload))
        .on('presence', { event: 'sync' }, onPresence);
      await new Promise((resolve, reject) => {
        channel.subscribe(async (state, err) => {
          if (state === 'SUBSCRIBED') {
            await channel.track({ id: selfId(), muted: false });
            resolve();
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
            reject(err ?? new Error(t('连不上语音')));
          }
        });
      });
      meterTimer = setInterval(measure, 120);
      status.value = 'on';
    } catch (err) {
      error.value = err.message || String(err);
      await leave();
    }
  }

  async function leave() {
    clearInterval(meterTimer);
    meterTimer = 0;
    for (const id of [...peers.keys()]) closePeer(id);
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
    participants.value = [];
    speaking.value = new Set();
    status.value = 'off';
  }

  function toggleMute() {
    if (!localStream) return;
    muted.value = !muted.value;
    localStream.getAudioTracks().forEach(track => (track.enabled = !muted.value));
    channel?.track({ id: selfId(), muted: muted.value });
  }

  // 离开房间就离开语音
  watch(
    () => room.inRoom,
    inRoom => !inRoom && status.value !== 'off' && leave()
  );

  return { status, muted, error, participants, speaking, inVoice, join, leave, toggleMute };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useVoiceStore, import.meta.hot));
