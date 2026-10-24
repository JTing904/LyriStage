import { describe, it, expect, vi } from 'vitest';
import { findLrclibLyrics, hasTimedLyrics } from './lrclib';

/** 假的 fetch：按网址回传设定好的 JSON（没设定的回 404） */
function fakeFetch(routes) {
  return vi.fn(async url => {
    const key = Object.keys(routes).find(k => url.includes(k));
    const body = key ? routes[key] : null;
    return { ok: Boolean(body), json: async () => body };
  });
}
const song = { name: 'Hacking to the Gate', artists: ['いとうかなこ'], durationMs: 250000 };
const lrc = '[00:01.00]Hacking to the Gate';

describe('findLrclibLyrics', () => {
  it('精确查到就用', async () => {
    const fetch = fakeFetch({ '/get?': { syncedLyrics: lrc, duration: 250 } });
    expect(await findLrclibLyrics(song, fetch)).toBe(lrc);
  });

  it('歌手名写法不一样：退一步只用歌名搜，按时长挑（差 2 秒内）', async () => {
    const fetch = fakeFetch({
      'artist_name=': [],
      '/search?track_name=Hacking': [
        { duration: 89, syncedLyrics: '[00:00.00]TV size' },
        { duration: 249, syncedLyrics: lrc },
      ],
    });
    // 第一个 '/get?' 和带歌手的搜索都会对到 'artist_name='（空结果）
    expect(await findLrclibLyrics(song, fetch)).toBe(lrc);
  });

  it('只有纯文字（没时间轴）、纯音乐、时长对不上：都不要', async () => {
    const fetch = fakeFetch({
      '/get?': { duration: 250, syncedLyrics: null, plainLyrics: 'no timing' },
      '/search?': [
        { duration: 250, instrumental: true, syncedLyrics: lrc },
        { duration: 200, syncedLyrics: lrc },
      ],
    });
    expect(await findLrclibLyrics(song, fetch)).toBeNull();
  });
});

describe('hasTimedLyrics', () => {
  it('有逐字歌词或带时间的 LRC 才算', () => {
    expect(hasTimedLyrics({ lrc: '[00:12.34]hi', yrc: '' })).toBe(true);
    expect(hasTimedLyrics({ lrc: '', yrc: '[1000,200](1000,200,0)hi' })).toBe(true);
    expect(hasTimedLyrics({ lrc: '只有文字没有时间', yrc: '' })).toBe(false);
    expect(hasTimedLyrics({ lrc: '', yrc: '' })).toBe(false);
  });
});
