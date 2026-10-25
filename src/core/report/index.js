// @ts-check
// 听歌报告（月 / 年）：从听歌记录算出总时数、最常听的歌和歌手、最常听的时段。
// 纯函数，资料由 data/history.js 的 listHistoryBetween 提供

/**
 * @typedef {{ track_id: string, track: Record<string, any>, played_at: string, listened_seconds: number, skipped: boolean }} HistoryRow
 */

/**
 * 这个月 / 今年的起讫（本地时间）
 * @param {'month' | 'year'} period
 * @param {Date} [now]
 */
export function periodRange(period, now = new Date()) {
  const from =
    period === 'year'
      ? new Date(now.getFullYear(), 0, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
  const to =
    period === 'year'
      ? new Date(now.getFullYear() + 1, 0, 1)
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from, to };
}

/**
 * @param {HistoryRow[]} rows
 * @param {{ top?: number }} [options]
 */
export function buildReport(rows, { top = 5 } = {}) {
  let totalSeconds = 0;
  let plays = 0;
  /** @type {Map<string, { track: any, plays: number, seconds: number }>} */
  const tracks = new Map();
  /** @type {Map<string, { name: string, id: any, seconds: number, plays: number, cover: string }>} */
  const artists = new Map();
  const hours = new Array(24).fill(0);
  /** @type {Map<string, number>} */
  const days = new Map();

  for (const row of rows) {
    const seconds = Math.max(0, Number(row.listened_seconds) || 0);
    totalSeconds += seconds;
    const at = new Date(row.played_at);
    hours[at.getHours()] += seconds;
    const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    days.set(day, (days.get(day) ?? 0) + seconds);

    const entry = tracks.get(row.track_id) ?? { track: row.track, plays: 0, seconds: 0 };
    entry.seconds += seconds;
    if (!row.skipped) {
      entry.plays += 1;
      plays += 1;
    }
    tracks.set(row.track_id, entry);

    for (const a of row.track?.ar ?? []) {
      if (!a?.name) continue;
      const key = a.id ? `id:${a.id}` : `name:${a.name}`;
      const artist = artists.get(key) ?? { name: a.name, id: a.id, seconds: 0, plays: 0, cover: row.track?.al?.picUrl ?? '' };
      artist.seconds += seconds;
      if (!row.skipped) artist.plays += 1;
      artists.set(key, artist);
    }
  }

  const topTracks = [...tracks.values()]
    .filter(t => t.plays > 0)
    .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
    .slice(0, top);
  const topArtists = [...artists.values()]
    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
    .slice(0, top);
  const peakHour = totalSeconds > 0 ? hours.indexOf(Math.max(...hours)) : null;
  const busiestDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  return {
    totalMinutes: Math.round(totalSeconds / 60),
    plays,
    distinctTracks: [...tracks.values()].filter(t => t.plays > 0).length,
    distinctArtists: artists.size,
    topTracks,
    topArtists,
    peakHour,
    busiestDay: busiestDay ? { day: busiestDay[0], minutes: Math.round(busiestDay[1] / 60) } : null,
    activeDays: days.size,
  };
}

/**
 * 歌词里重复最多次的一句（通常就是副歌），年度回顾的「今年最常听到的一句」用。
 * 太短的（"Oh"、"啦啦"）不算；一样多就取先出现的
 * @param {Array<{ text: string, translation?: string | null }>} lines
 * @returns {{ text: string, translation: string | null } | null}
 */
export function mostRepeatedLine(lines) {
  const normalize = s => s.toLowerCase().replace(/[\s\p{P}]/gu, '');
  const counts = new Map();
  for (const line of lines) {
    const key = normalize(line.text ?? '');
    if ([...key].length < 4) continue;
    const entry = counts.get(key) ?? { line, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best ? { text: best.line.text.trim(), translation: best.line.translation ?? null } : null;
}

/**
 * 今年比去年多听了百分之几（去年没听过就是 null）
 * @returns {number | null} 例如 23 = 多 23%，-10 = 少 10%
 */
export function minutesChange(thisYear, lastYear) {
  if (!lastYear) return null;
  return Math.round(((thisYear - lastYear) / lastYear) * 100);
}
