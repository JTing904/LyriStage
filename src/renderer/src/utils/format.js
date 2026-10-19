// 页面上常用的显示格式
import { locale, t } from '../i18n';

/** 歌手名：A / B */
export const artistNames = track =>
  (track?.ar ?? track?.artists ?? []).map(a => a.name).join(' / ');

/** 时长：毫秒 → 3:21 */
export function clock(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 一串歌的总长：「1 小时 12 分钟」或「31 分钟」 */
export function totalLength(tracks) {
  const minutes = Math.round(tracks.reduce((sum, t) => sum + (t.dt || 0), 0) / 60000);
  if (minutes < 60) return t('{m} 分钟', { m: minutes });
  return t('{h} 小时 {m} 分钟', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** 时间戳（毫秒）→ 年份 */
export const year = ms => (ms ? new Date(ms).getFullYear() : '');

/** 播放次数等大数字：12345 → 1.2 万（英文：12.3K / 1.2M / 1.2B） */
export function count(n) {
  if (!n) return '0';
  if (locale.value === 'en') {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  }
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
  return String(n);
}
