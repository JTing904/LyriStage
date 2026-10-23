// 离线听歌（手机 App）：听过的歌存在手机里，下次直接从手机播——秒开、省流量、没网络也能听
// - 什么时候存：一首歌听了 30 秒以上（短歌听一半），在背景下载一次；默认只在 Wi-Fi 时存（不重复花行动数据）
// - 存在哪：App 自己的资料夹（offline/<歌曲 id>.<副档名>），歌词另外存一个 .lyrics.json，没网络也看得到歌词
// - 播放时：播放器找链接前先问这里，有存就用手机里的档案（services.js 的 resolveSource）
// - 空间：有上限（默认 1 GB），满了就删最久没听的
// - 只是缓存，不是「下载」：档案只有 LyriStage 自己读得到
// 电脑版、网页版没有这个功能
import { computed, reactive, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { toSnapshot } from '@core/data';
import { isNativeApp } from './platform';

export const offlineSupported = isNativeApp;

const INDEX_KEY = 'lyristage:offline';
const SETTINGS_KEY = 'lyristage:offline-settings';
const DIR = 'offline';
/** 听多久才存（秒）；短歌听一半就存 */
const MIN_LISTEN_SECONDS = 30;
/** 可以选的空间上限（MB） */
export const OFFLINE_LIMITS = [500, 1024, 2048, 5120];

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就只在这次生效
  }
}

/** 设置：要不要存、行动网络也存、上限 */
export const offlineSettings = reactive({ enabled: true, cellular: false, limitMb: 1024, ...read(SETTINGS_KEY, {}) });
export function saveOfflineSettings(patch) {
  Object.assign(offlineSettings, patch);
  write(SETTINGS_KEY, { ...offlineSettings });
  if (patch.limitMb) trim().catch(() => {});
}

/**
 * 存了哪些歌：歌曲 id → { file, lyricsFile, size, savedAt, lastPlayed, br, track }
 * @type {Record<string, { file: string, lyricsFile: string | null, size: number, savedAt: number, lastPlayed: number, br?: number, track: object }>}
 */
const index = reactive(read(INDEX_KEY, {}));
const persist = () => write(INDEX_KEY, index);

/** 存在手机里的歌（最近听的在前） */
export const offlineTracks = computed(() =>
  Object.values(index)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .map(e => e.track)
);
export const offlineBytes = computed(() => Object.values(index).reduce((sum, e) => sum + (e.size || 0), 0));
export const isOffline = id => Boolean(index[id]);
/** 正在下载的歌 id（界面可以显示「存进手机中」） */
export const saving = ref(new Set());

let fs = null;
async function plugins() {
  if (!fs) {
    const [{ Filesystem, Directory, Encoding }, { FileTransfer }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/file-transfer'),
    ]);
    fs = { Filesystem, Directory, Encoding, FileTransfer };
  }
  return fs;
}

/** 播放器用：这首有存在手机里就回传手机里的档案（可以直接给 <audio> 播），没有就是 null */
export async function offlineSource(track) {
  const entry = isNativeApp ? index[track?.id] : null;
  if (!entry) return null;
  const { Filesystem, Directory } = await plugins();
  try {
    const { uri } = await Filesystem.getUri({ path: entry.file, directory: Directory.Data });
    await Filesystem.stat({ path: entry.file, directory: Directory.Data });
    entry.lastPlayed = Date.now();
    persist();
    return { url: Capacitor.convertFileSrc(uri), br: entry.br, source: 'offline' };
  } catch {
    // 档案不见了（被清掉）：从清单拿掉，改从网络播
    delete index[track.id];
    persist();
    return null;
  }
}

/** 没网络时的歌词（存歌时一起存的原始歌词） */
export async function offlineLyrics(id) {
  const entry = index[id];
  if (!entry?.lyricsFile) return null;
  const { Filesystem, Directory, Encoding } = await plugins();
  try {
    const { data } = await Filesystem.readFile({ path: entry.lyricsFile, directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(String(data));
  } catch {
    return null;
  }
}

/** 现在可以存吗：开着、而且不是用行动网络（除非设置允许） */
function allowedNow() {
  if (!isNativeApp || !offlineSettings.enabled || !navigator.onLine) return false;
  const type = navigator.connection?.type;
  return offlineSettings.cellular || type !== 'cellular';
}

/** 听够久了就存（services.js 在 played 事件叫） */
export function shouldSave(track, listenedSeconds) {
  if (!track?.id || index[track.id]) return false;
  const enough = Math.min(MIN_LISTEN_SECONDS, (track.dt || 0) / 2000 || MIN_LISTEN_SECONDS);
  return listenedSeconds >= enough && allowedNow();
}

const extensionOf = url => {
  const match = /\.(mp3|flac|m4a|aac|ogg|wav)(?:\?|$)/i.exec(String(url));
  return match ? match[1].toLowerCase() : 'mp3';
};

/**
 * 下载一首存进手机
 * @param {object} track
 * @param {{ url: string, br?: number, source?: string }} source 刚才播的链接
 * @param {object | null} lyrics 原始歌词（getLyrics 用的那份），一起存
 */
export async function saveOffline(track, source, lyrics) {
  if (!source?.url || source.source === 'offline' || index[track.id] || saving.value.has(track.id)) return;
  saving.value = new Set(saving.value).add(track.id);
  const { Filesystem, Directory, Encoding, FileTransfer } = await plugins();
  const file = `${DIR}/${track.id}.${extensionOf(source.url)}`;
  try {
    await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
    const { uri } = await Filesystem.getUri({ path: file, directory: Directory.Data });
    await FileTransfer.downloadFile({
      url: source.url,
      path: uri,
      // B 站的音频要带 B 站的网址才给下载
      headers: source.source === 'bilibili' ? { Referer: 'https://www.bilibili.com/' } : {},
    });
    const { size } = await Filesystem.stat({ path: file, directory: Directory.Data });
    // 太小的多半是错误页面，不是音乐
    if (size < 100 * 1024) throw new Error('too small');
    let lyricsFile = null;
    if (lyrics) {
      lyricsFile = `${DIR}/${track.id}.lyrics.json`;
      await Filesystem.writeFile({ path: lyricsFile, directory: Directory.Data, data: JSON.stringify(lyrics), encoding: Encoding.UTF8 }).catch(() => (lyricsFile = null));
    }
    index[track.id] = { file, lyricsFile, size, savedAt: Date.now(), lastPlayed: Date.now(), br: source.br, track: toSnapshot(track) };
    persist();
    await trim();
  } catch (err) {
    await Filesystem.deleteFile({ path: file, directory: Directory.Data }).catch(() => {});
    console.warn('[LyriStage] 存进手机失败', track.id, err?.message ?? err);
  } finally {
    const next = new Set(saving.value);
    next.delete(track.id);
    saving.value = next;
  }
}

/** 从手机删掉一首 */
export async function removeOffline(id) {
  const entry = index[id];
  if (!entry) return;
  delete index[id];
  persist();
  const { Filesystem, Directory } = await plugins();
  await Filesystem.deleteFile({ path: entry.file, directory: Directory.Data }).catch(() => {});
  if (entry.lyricsFile) await Filesystem.deleteFile({ path: entry.lyricsFile, directory: Directory.Data }).catch(() => {});
}

/** 超过上限：删最久没听的，直到放得下 */
async function trim() {
  const limit = offlineSettings.limitMb * 1024 * 1024;
  const oldest = Object.entries(index).sort(([, a], [, b]) => a.lastPlayed - b.lastPlayed);
  let total = offlineBytes.value;
  for (const [id, entry] of oldest) {
    if (total <= limit) break;
    total -= entry.size || 0;
    await removeOffline(id);
  }
}

/** 全部清掉 */
export async function clearOffline() {
  for (const id of Object.keys(index)) await removeOffline(id);
  if (!isNativeApp) return;
  const { Filesystem, Directory } = await plugins();
  await Filesystem.rmdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
}
