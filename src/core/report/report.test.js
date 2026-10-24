import { describe, it, expect } from 'vitest';
import { buildReport, periodRange } from './index';

const song = (id, artist, cover = `c${id}`) => ({ id, name: `歌${id}`, ar: [{ id: artist, name: `歌手${artist}` }], al: { picUrl: cover } });
const row = (id, artist, at, seconds, skipped = false) => ({
  track_id: String(id), track: song(id, artist), played_at: at, listened_seconds: seconds, skipped,
});

describe('buildReport', () => {
  it('算总时数、最常听的歌和歌手、最常听的时段', () => {
    const rows = [
      row(1, 'a', '2026-10-01T23:10:00', 200),
      row(1, 'a', '2026-10-02T23:20:00', 200),
      row(2, 'b', '2026-10-02T09:00:00', 100),
      row(3, 'b', '2026-10-03T09:30:00', 100),
      row(4, 'c', '2026-10-03T23:40:00', 10, true), // 跳过的不算播放次数
    ];
    const r = buildReport(rows);
    expect(r.totalMinutes).toBe(10);
    expect(r.plays).toBe(4);
    expect(r.distinctTracks).toBe(3);
    expect(r.topTracks.map(t => [t.track.id, t.plays])).toEqual([[1, 2], [2, 1], [3, 1]]);
    expect(r.topArtists.map(a => a.name)).toEqual(['歌手a', '歌手b', '歌手c']);
    expect(r.peakHour).toBe(23);
    expect(r.busiestDay).toEqual({ day: '2026-10-02', minutes: 5 });
    expect(r.activeDays).toBe(3);
  });

  it('没有记录时不会出错', () => {
    const r = buildReport([]);
    expect(r).toMatchObject({ totalMinutes: 0, plays: 0, topTracks: [], peakHour: null, busiestDay: null });
  });
});

describe('periodRange', () => {
  it('这个月、今年', () => {
    const now = new Date(2026, 9, 21, 15);
    expect(periodRange('month', now)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 10, 1) });
    expect(periodRange('year', now)).toEqual({ from: new Date(2026, 0, 1), to: new Date(2027, 0, 1) });
  });
});

describe('mostRepeatedLine', () => {
  it('挑重复最多的一句（副歌），标点和大小写不影响', async () => {
    const { mostRepeatedLine } = await import('./index');
    const lines = [
      { text: 'I just can’t say I don’t love you' },
      { text: "'Cause I love you, yeah" },
      { text: 'I would die for you' },
      { text: 'I would die for you!' },
      { text: "'Cause I love you, yeah" },
      { text: 'i would DIE for you' },
    ];
    expect(mostRepeatedLine(lines).text).toBe('I would die for you');
  });
  it('太短的不算；没有歌词就是 null', async () => {
    const { mostRepeatedLine } = await import('./index');
    expect(mostRepeatedLine([{ text: 'Oh' }, { text: 'Oh' }, { text: '晴天里的故事' }]).text).toBe('晴天里的故事');
    expect(mostRepeatedLine([])).toBeNull();
  });
});

describe('minutesChange', () => {
  it('比去年多 / 少几 %，去年没听是 null', async () => {
    const { minutesChange } = await import('./index');
    expect(minutesChange(1230, 1000)).toBe(23);
    expect(minutesChange(900, 1000)).toBe(-10);
    expect(minutesChange(500, 0)).toBeNull();
  });
});
