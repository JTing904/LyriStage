// 把 core 里的模块按当前平台的配置组装好，界面直接 import 这里
import { createHttp } from '@core/http/client';
import { createNetease } from '@core/netease';
import { buildLyrics, findLrclibLyrics, hasTimedLyrics } from '@core/lyrics';
import { createPlayer } from '@core/player/player';
import { createHtmlAudio } from '@core/player/audio';
import { createAudioEffects } from './audioEffects';
import { connectWidget } from './widget';
import { createCache } from '@core/cache';
import { createDexieStore } from '@core/cache/dexie';
import {
  configureSupabase,
  getAccessToken,
  getBilibiliPick,
  getCurrentUser,
  recordPlay,
  saveBilibiliPick,
} from '@core/data';
import { PersonalFM, SongRadio } from '@core/recommend';
import { apiBase, isElectron, localApiHeaders } from './platform';
import { connectMediaSession } from './mediaSession';

configureSupabase({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

/** 网页版的 API 在 Vercel 上，只让成员用，要带登录 token；电脑版连本机的 API，带启动时的通行证 */
async function authHeaders() {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const http = createHttp({
  baseURL: apiBase,
  getHeaders: isElectron ? () => localApiHeaders : authHeaders,
});
export const netease = createNetease(http);

/**
 * 自己的歌单、喜欢的歌存的是快照，没有"下架"这种会变的资料：显示后再查最新的版权状态
 * （列表才能把下架的歌变灰）。回传 歌曲 id → privilege；查不到（例如断网）就是空的
 * @param {Record<string, any>[]} tracks
 * @returns {Promise<Map<number, Record<string, any>>>}
 */
export async function fetchPrivileges(tracks) {
  const ids = [...new Set(tracks.map(t => Number(t.id)).filter(Number.isInteger))];
  const privileges = new Map();
  try {
    for (let i = 0; i < ids.length; i += 500) {
      for (const song of await netease.songDetails(ids.slice(i, i + 500))) {
        if (song.privilege) privileges.set(song.id, song.privilege);
      }
    }
  } catch {
    // 断网等：先不标，不影响显示
  }
  return privileges;
}

/**
 * 把 fetchPrivileges 查到的结果挂到目前的列表上（只加资料，不改列表本身：
 * 等结果的时候用户可能已经移除了几首）
 * @param {Record<string, any>[]} tracks
 * @param {Map<number, Record<string, any>>} privileges
 */
export const applyPrivileges = (tracks, privileges) =>
  tracks.map(t => {
    const privilege = privileges.get(Number(t.id));
    return privilege ? { ...t, privilege } : t;
  });

/**
 * 私人 FM 的歌从哪里来：
 * - 登录了 LyriStage：用自己的推荐算法（按听歌记录、喜欢）
 * - 没登录：用网易云的匿名私人 FM（一次给几首，先存着一首一首给）
 * @param {boolean} loggedIn
 */
export function createFmSource(loggedIn) {
  if (loggedIn) return new PersonalFM({ netease });
  const buffer = [];
  return {
    async next(count = 1) {
      while (buffer.length < count) {
        const more = await netease.personalFm();
        if (more.length === 0) break;
        buffer.push(...more);
      }
      return buffer.splice(0, count);
    },
  };
}

/** 从这首歌开始的电台（相似歌曲，按你的口味排） */
export const createSongRadio = track => new SongRadio({ netease, seed: track });

// 歌词很少变，缓存 7 天、最多 500 首
const DAY = 86400 * 1000;
const lyricCache = createCache(createDexieStore('lyristage-lyrics'), {
  ttlMs: 7 * DAY,
  maxEntries: 500,
});

/**
 * 歌词原文：网易云的；网易云没有带时间的歌词，就去 LRCLIB 找（英文、日文歌常常有）
 * @param {{ id: number, name?: string, ar?: Array<{ name: string }>, al?: { name?: string }, dt?: number }} track
 */
async function loadLyrics(track) {
  const raw = await netease.lyric(track.id);
  if (hasTimedLyrics(raw) || !track.name) return raw;
  const lrc = await findLrclibLyrics({
    name: track.name,
    artists: (track.ar ?? []).map(a => a.name),
    album: track.al?.name,
    durationMs: track.dt,
  }).catch(() => null); // LRCLIB 连不上就当没有
  return lrc ? { ...raw, lrc, source: 'lrclib' } : raw;
}

/**
 * 整理好的歌词（core/lyrics 的 Lyrics 格式）
 * @param {{ id: number, dt?: number }} track
 */
export async function getLyrics(track) {
  // v2：加了 LRCLIB 以后换 key，以前存的"没有歌词"不要再用 7 天
  const raw = await lyricCache.getOrLoad(`lyric:v2:${track.id}`, () => loadLyrics(track));
  return buildLyrics(raw, { durationMs: track.dt });
}

/**
 * 一起听：房主分享的音频链接（歌曲 ID → 链接）。
 * 网页版、手机自己解灰找不到时，用房主（电脑版）找到的
 * @type {Map<number, { url: string, br?: number, source?: string }>}
 */
export const sharedSources = new Map();

/**
 * 播放链接：先找网易云，拿不到再用房主分享的，再拿不到才解灰（去 B 站找，见 server/lib/bilibili.js）
 * - 电脑版：本机的 API 解灰
 * - 手机 App、网页版：Vercel 上的 API 解灰
 */
async function resolveSource(track) {
  const official = await netease.songUrl(track.id);
  if (official) return official;
  const shared = sharedSources.get(track.id);
  // 房主（电脑版）分享的 B 站链接可能要带 B 站的 Referer，手机、网页版播不了，先自己找
  if (shared && (isElectron || shared.source !== 'bilibili')) return shared;
  // 以前有人在 B 站挑过这首的视频，就直接告诉服务器（省掉一次 B 站搜索）；
  // 服务器这次用了新的视频就记下来给大家用
  const pick = await getBilibiliPick(track.id);
  const found = await netease.unblockUrl(track.id, { bvid: pick });
  if (found?.bvid && found.bvid !== pick) saveBilibiliPick(track.id, found.bvid);
  return found ?? shared ?? null;
}

const audio = createHtmlAudio();
export const player = createPlayer({ audio, resolveSource });
/** 均衡器、音量平衡（设置页） */
export const audioEffects = createAudioEffects(audio);

// 预先载入下一首的歌词（存进歌词缓存，切过去时马上有）
player.on('prefetch', track => getLyrics(track).catch(() => {}));
connectMediaSession(player, { getLyrics });
connectWidget(player, { getLyrics });

// 开发时：这个文件或它用到的任何文件（core/ 里的播放器、歌词解析…）改了，
// Vite 会重新执行这个文件、建一个新的播放器，旧的如果正在播放会继续响，变成两首歌一起播。
// 所以让这里成为热更新的边界：先停掉旧的，再整页重新加载（进度会从保存的位置恢复）。
if (import.meta.hot) {
  import.meta.hot.dispose(() => audio.dispose());
  import.meta.hot.accept(() => window.location.reload());
}

// 听完一首（或切歌）时写进听歌记录；没登录 LyriStage 账号就不记
player.on('played', async ({ track, listenedSeconds, context }) => {
  try {
    if (await getCurrentUser()) {
      await recordPlay(track, { listenedSeconds, context });
    }
  } catch (err) {
    console.warn('[LyriStage] 听歌记录写入失败', err);
  }
});

// 记住播放进度，重开 App 时恢复
const PLAYER_KEY = 'lyristage:player';
try {
  player.restore(JSON.parse(localStorage.getItem(PLAYER_KEY) ?? 'null'));
} catch {
  // 存的数据坏了就从头开始
}
// 播放中每秒好几次 time 事件，最多每 5 秒存一次
const SAVE_INTERVAL = 5000;
let lastSaved = 0;
function savePlayer(force = false) {
  const now = Date.now();
  if (!force && now - lastSaved < SAVE_INTERVAL) return;
  lastSaved = now;
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(player.snapshot()));
  } catch {
    // 隐私模式等情况下 localStorage 不能用，不影响播放
  }
}
player.on('time', () => savePlayer());
// 状态一变就要存（换歌、暂停…），但拖音量条时一秒变几十次，
// 每次都把整个播放列表（最多上千首）写进 localStorage 会卡，所以停下来 0.8 秒后才存
let saveTimer = 0;
player.on('change', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => savePlayer(true), 800);
});
window.addEventListener('beforeunload', () => savePlayer(true));
// 手机切到后台、锁屏时网页常被系统直接关掉，不会触发 beforeunload，切走时就先存
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') savePlayer(true);
});
