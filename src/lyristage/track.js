// 歌曲快照：存进数据库的歌曲信息。
// 沿用网易云的字段名（ar / al / dt），现有的 TrackList 等组件可以直接渲染。

export const DEFAULT_SOURCE = 'netease';

/**
 * 从网易云的歌曲对象里挑出需要保存的字段，丢掉 privilege 等会过期的信息
 * @param {Record<string, any>} track
 */
export function toSnapshot(track) {
  return {
    id: track.id,
    name: track.name,
    alia: track.alia ?? [],
    ar: (track.ar ?? []).map(({ id, name }) => ({ id, name })),
    al: track.al
      ? { id: track.al.id, name: track.al.name, picUrl: track.al.picUrl }
      : null,
    dt: track.dt ?? 0,
    fee: track.fee ?? 0,
    mv: track.mv ?? 0,
  };
}

/** 数据库行 → 前端使用的歌曲对象（能不能播由播放时再判断，先当作可播放） */
export function fromRow(row) {
  return { ...row.track, playable: true, reason: '' };
}

/** 快照 → 数据库行的公共字段 */
export function toRow(track, source = DEFAULT_SOURCE) {
  return {
    source,
    track_id: String(track.id),
    track: toSnapshot(track),
  };
}

/** 本地日期 YYYY-MM-DD（马来西亚 UTC+8，不能直接用 toISOString 的 UTC 日期） */
export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
