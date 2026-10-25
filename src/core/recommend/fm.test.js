import { describe, it, expect, vi } from 'vitest';

// 私人 FM 不需要真的读数据库：当作新用户（没有记录），候选全部来自网易云的通用推荐
vi.mock('../data/library', () => ({ listLikedTracks: async () => [] }));
vi.mock('../data/history', () => ({
  listRecentHistory: async () => [],
  listDislikedTrackIds: async () => [],
}));

const { PersonalFM } = await import('./index');

const song = (id, privilege = { st: 0, pl: 320000 }) => ({ id, name: `歌${id}`, ar: [{ id: 100 + id, name: `歌手${id}` }], privilege });
const noCopyright = { st: -200, pl: 0 };
const vipOnly = { st: 0, pl: 0 };

function fakeNetease(tracks) {
  return {
    artistTopSongs: vi.fn(async () => []),
    similarPlaylists: vi.fn(async () => []),
    playlistTracks: vi.fn(async () => []),
    genericRecommendations: vi.fn(async () => tracks),
  };
}

describe('PersonalFM', () => {
  it('第一首挑网易云能直接播的（不用等找其他音源）', async () => {
    // 大部分都要找其他音源，只有一首能直接播：不管推荐怎么排，第一首都是它
    const tracks = [
      ...Array.from({ length: 8 }, (_, i) => song(i + 1, i % 2 ? noCopyright : vipOnly)),
      song(42),
    ];
    for (let round = 0; round < 5; round++) {
      const fm = new PersonalFM({ netease: fakeNetease(tracks) });
      const [first] = await fm.next(1);
      expect(first.id).toBe(42);
    }
  });

  it('后面的歌照推荐的顺序，要找其他音源的也会出', async () => {
    const tracks = [song(1, noCopyright), song(2, vipOnly), song(3)];
    const fm = new PersonalFM({ netease: fakeNetease(tracks) });
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(...(await fm.next(1)).map(t => t.id));
    expect(ids[0]).toBe(3);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });

  it('全部都要找其他音源：照样给第一首', async () => {
    const fm = new PersonalFM({ netease: fakeNetease([song(1, noCopyright), song(2, vipOnly)]) });
    const [first] = await fm.next(1);
    expect([1, 2]).toContain(first.id);
  });
});
