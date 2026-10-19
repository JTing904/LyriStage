// 把 core 里的模块按当前平台的配置组装好，界面直接 import 这里
import { createHttp } from '@core/http/client';
import { createNetease } from '@core/netease';
import { buildLyrics } from '@core/lyrics';
import { createPlayer } from '@core/player/player';
import { createHtmlAudio } from '@core/player/audio';
import { createCache } from '@core/cache';
import { createDexieStore } from '@core/cache/dexie';
import { configureSupabase, getCurrentUser, recordPlay } from '@core/data';
import { apiBase } from './platform';

export const http = createHttp({ baseURL: apiBase });
export const netease = createNetease(http);

configureSupabase({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

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

/** 播放链接：先找网易云，拿不到再解灰 */
async function resolveSource(track) {
  return (
    (await netease.songUrl(track.id)) ?? (await netease.unblockUrl(track.id))
  );
}

const audio = createHtmlAudio();
export const player = createPlayer({ audio, resolveSource });

// 开发时改了这个文件，Vite 会重新执行它、建一个新的播放器；
// 旧的那个如果正在播放会继续响，变成两首歌一起播，所以先停掉
if (import.meta.hot) {
  import.meta.hot.dispose(() => audio.dispose());
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
