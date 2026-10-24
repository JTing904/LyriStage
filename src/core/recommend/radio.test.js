import { describe, it, expect, vi } from 'vitest';

// 电台不需要真的读数据库：口味读不到就当没有
vi.mock('../data/library', () => ({ listLikedTracks: async () => { throw new Error('offline'); } }));
vi.mock('../data/history', () => ({
  listRecentHistory: async () => [],
  listDislikedTrackIds: async () => [],
}));

const { SongRadio } = await import('./index');

const song = (id, artist = id) => ({ id, name: `歌${id}`, ar: [{ id: artist, name: `歌手${artist}` }] });

function fakeNetease(similar) {
  return {
    similarSongs: vi.fn(async id => similar[id] ?? []),
    artistTopSongs: vi.fn(async () => []),
  };
}

describe('SongRadio', () => {
  it('先播起点那首，再播相似歌曲，不重复', async () => {
    const netease = fakeNetease({ 1: [song(2), song(3), song(4)], 2: [song(1), song(5)] });
    const radio = new SongRadio({ netease, seed: song(1) });
    const first = await radio.next(1);
    expect(first.map(t => t.id)).toEqual([1]);
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(...(await radio.next(1)).map(t => t.id));
    expect(ids).not.toContain(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 3).sort()).toEqual([2, 3, 4]);
  });

  it('冷门歌没有相似歌曲：用同一个歌手的热门歌补', async () => {
    const netease = fakeNetease({});
    netease.artistTopSongs = vi.fn(async () => [song(10, 9), song(11, 9)]);
    const radio = new SongRadio({ netease, seed: song(7, 9) });
    await radio.next(1);
    const next = await radio.next(1);
    expect(netease.artistTopSongs).toHaveBeenCalledWith(9);
    expect([10, 11]).toContain(next[0].id);
  });
});
