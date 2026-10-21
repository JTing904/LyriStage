// 网易云没有歌词（或只有没时间轴的纯文字）时，去 LRCLIB（https://lrclib.net）找。
// LRCLIB 是免费、开放的歌词库，英文、日文歌比较多。只用有逐行时间的歌词（syncedLyrics），
// 没有时间的歌词没办法跟着播放走。
//
// LRCLIB 的歌手名常常是罗马拼音（网易云的 いとうかなこ，LRCLIB 是 Itou Kanako），
// 所以精确查不到时，退一步只用歌名搜，再按时长挑（差 2 秒内才算同一个版本）。

const API = 'https://lrclib.net/api';
/** LRCLIB 请大家标明是哪个 App 在用（浏览器改不了 User-Agent，用这个 header） */
const HEADERS = { 'Lrclib-Client': 'LyriStage (https://github.com/JTing904/LyriStage)' };
const MAX_DURATION_DIFF_S = 2;

/**
 * @param {{ name: string, artists: string[], album?: string, durationMs?: number }} song
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string | null>} LRC 格式的歌词，找不到是 null
 */
export async function findLrclibLyrics(song, fetchImpl = fetch) {
  const duration = song.durationMs ? Math.round(song.durationMs / 1000) : 0;
  const artist = song.artists[0] ?? '';
  const get = async path => {
    const res = await fetchImpl(`${API}${path}`, { headers: HEADERS });
    return res.ok ? res.json() : null;
  };
  const usable = hit =>
    hit?.syncedLyrics &&
    !hit.instrumental &&
    (!duration || Math.abs(hit.duration - duration) <= MAX_DURATION_DIFF_S);

  // 1. 精确查（歌名 + 歌手 + 专辑 + 时长）
  const exact = new URLSearchParams({ track_name: song.name, artist_name: artist });
  if (song.album) exact.set('album_name', song.album);
  if (duration) exact.set('duration', String(duration));
  const found = await get(`/get?${exact}`);
  if (usable(found)) return found.syncedLyrics;

  // 2. 搜：先带歌手，再只用歌名（歌手名的写法常常不一样）
  for (const params of [
    { track_name: song.name, artist_name: artist },
    { track_name: song.name },
  ]) {
    const list = await get(`/search?${new URLSearchParams(params)}`);
    const hit = Array.isArray(list) ? list.find(usable) : null;
    if (hit) return hit.syncedLyrics;
  }
  return null;
}

/** 网易云的歌词有没有时间轴（逐字或逐行） */
export function hasTimedLyrics(raw) {
  return Boolean(raw?.yrc?.trim()) || /\[\d{1,3}:\d{2}/.test(raw?.lrc ?? '');
}
