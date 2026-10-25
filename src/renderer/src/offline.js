// 离线听歌（手机 App）：自己选的歌存在手机里，下次直接从手机播——秒开、省流量、没网络也能听
// - 什么时候存：用户按「存到手机」（整张歌单、单首）才存，不会自动存；先排队，一首一首下载。
//   默认只用 Wi-Fi 下载：用行动网络时先排着，连上 Wi-Fi 再接着存（关掉 App 也记得）
// - 存在哪：App 自己的资料夹（offline/<歌曲 id>.<副档名>），歌词另外存一个 .lyrics.json，没网络也看得到歌词
// - 播放时：播放器找链接前先问这里，有存就用手机里的档案（services.js 的 resolveSource）
// - 不会自动删：用户自己选的，只有用户自己删
// - 只是缓存，不是「下载」：档案只有 LyriStage 自己读得到
// 电脑版、网页版没有这个功能
import { computed, reactive, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { toSnapshot } from '@core/data';
import { isNativeApp } from './platform';

export const offlineSupported = isNativeApp;

const INDEX_KEY = 'lyristage:offline';
const SETTINGS_KEY = 'lyristage:offline-settings';
const QUEUE_KEY = 'lyristage:offline-queue';
const DIR = 'offline';

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

/** 设置：行动网络也下载（默认不要：只用 Wi-Fi） */
export const offlineSettings = reactive({ cellular: false, ...read(SETTINGS_KEY, {}) });
export function saveOfflineSettings(patch) {
  Object.assign(offlineSettings, patch);
  write(SETTINGS_KEY, { cellular: offlineSettings.cellular });
  work();
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

/** 现在可以下载吗：有网络，而且不是用行动网络（除非设置允许） */
function allowedNow() {
  if (!isNativeApp || !navigator.onLine) return false;
  const type = navigator.connection?.type;
  return offlineSettings.cellular || type !== 'cellular';
}
/** 用行动网络、设置只用 Wi-Fi：排队的歌要等连上 Wi-Fi */
export const waitingForWifi = () => isNativeApp && navigator.onLine && !allowedNow();

// ---- 排队下载 ----
/** 等着存的歌（歌曲快照，最先按的在前）；关掉 App 也记得，下次打开接着存 */
const queue = ref(read(QUEUE_KEY, []));
const persistQueue = () => write(QUEUE_KEY, queue.value);
/** 排队中的歌 id（界面显示灰色圈） */
export const queuedIds = computed(() => new Set(queue.value.map(t => String(t.id))));
export const isQueued = id => queuedIds.value.has(String(id)) || saving.value.has(id);

/** services.js 给：找播放链接（不问手机里的）、拿原始歌词 */
let deps = null;
export function connectOfflineDownloads(options) {
  deps = options;
  work();
}

/** 按了「存到手机」：没存过、没在排队的放进队列 */
export function requestOffline(tracks) {
  if (!isNativeApp) return;
  const adding = tracks.filter(t => t?.id && !index[t.id] && !isQueued(t.id)).map(toSnapshot);
  if (!adding.length) return;
  queue.value = [...queue.value, ...adding];
  persistQueue();
  work();
}
/** 不存了：从队列拿掉（正在下载的那首会下载完） */
export function cancelOffline(ids) {
  const drop = new Set(ids.map(String));
  queue.value = queue.value.filter(t => !drop.has(String(t.id)));
  persistQueue();
}

let working = false;
async function work() {
  if (working || !deps) return;
  working = true;
  try {
    while (queue.value.length && allowedNow()) {
      const track = queue.value[0];
      try {
        const source = await deps.resolveOnline(track);
        if (source) await saveOffline(track, source, await deps.rawLyrics(track).catch(() => null));
      } catch (err) {
        console.warn('[LyriStage] 存进手机失败', track.id, err?.message ?? err);
      }
      // 存不了的（没有音源、下载失败）也拿掉，不要一直重试；用户可以再按一次
      queue.value = queue.value.filter(t => String(t.id) !== String(track.id));
      persistQueue();
    }
  } finally {
    working = false;
  }
}
if (isNativeApp) {
  window.addEventListener('online', () => work());
  navigator.connection?.addEventListener?.('change', () => work());
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

/** 全部清掉（排队的也不存了） */
export async function clearOffline() {
  cancelOffline(queue.value.map(t => t.id));
  for (const id of Object.keys(index)) await removeOffline(id);
  if (!isNativeApp) return;
  const { Filesystem, Directory } = await plugins();
  await Filesystem.rmdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
}
