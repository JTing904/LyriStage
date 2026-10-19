// 把 core 里的模块按当前平台的配置组装好，界面直接 import 这里
import { createHttp } from '@core/http/client';
import { createNetease } from '@core/netease';
import { buildLyrics } from '@core/lyrics';
import { createPlayer } from '@core/player/player';
import { createHtmlAudio } from '@core/player/audio';
import { createCache } from '@core/cache';
import { createDexieStore } from '@core/cache/dexie';
import {
  configureSupabase,
  getAccessToken,
  getCurrentUser,
  recordPlay,
} from '@core/data';
import { PersonalFM } from '@core/recommend';
import { apiBase, isElectron, isNativeApp } from './platform';
import { connectMediaSession } from './mediaSession';

configureSupabase({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

/** 网页版的 API 在 Vercel 上，只让成员用，要带登录 token；电脑版连本机的 API，不用带 */
async function authHeaders() {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const http = createHttp({
  baseURL: apiBase,
  getHeaders: isElectron ? undefined : authHeaders,
});
export const netease = createNetease(http);

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

// 歌词很少变，缓存 7 天、最多 500 首
const DAY = 86400 * 1000;
const lyricCache = createCache(createDexieStore('lyristage-lyrics'), {
  ttlMs: 7 * DAY,
  maxEntries: 500,
});

/**
 * 整理好的歌词（core/lyrics 的 Lyrics 格式）
 * @param {{ id: number, dt?: number }} track
 */
export async function getLyrics(track) {
  const raw = await lyricCache.getOrLoad(`lyric:${track.id}`, () =>
    netease.lyric(track.id)
  );
  return buildLyrics(raw, { durationMs: track.dt });
}

/**
 * 播放链接：先找网易云，拿不到再解灰
 * - 电脑版：本机的 API 解灰
 * - 手机 App：手机自己去找（Vercel 上的 API 解灰连不上音源）
 */
async function resolveSource(track) {
  const official = await netease.songUrl(track.id);
  if (official) return official;
  if (isNativeApp) {
    const { unblockOnDevice } = await import('./unblockOnDevice');
    return unblockOnDevice(track.id);
  }
  return netease.unblockUrl(track.id);
}

const audio = createHtmlAudio();
export const player = createPlayer({ audio, resolveSource });
connectMediaSession(player);

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
player.on('change', () => savePlayer(true));
window.addEventListener('beforeunload', () => savePlayer(true));
// 手机切到后台、锁屏时网页常被系统直接关掉，不会触发 beforeunload，切走时就先存
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') savePlayer(true);
});
