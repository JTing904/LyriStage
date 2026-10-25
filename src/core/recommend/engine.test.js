import { describe, it, expect, vi } from 'vitest';
import {
  computeArtistAffinity,
  createRng,
  pickSeeds,
  rankCandidates,
  normalizeTitle,
} from './engine';
import { gatherCandidates } from './index';

const now = Date.parse('2026-10-19T12:00:00+08:00');
const daysAgo = d => new Date(now - d * 86400000).toISOString();
const t = (id, artistId, name = `song${id}`, extra = {}) => ({
  id,
  name,
  ar: [{ id: artistId, name: `artist${artistId}` }],
  ...extra,
});
const play = (track, days, listened, skipped = false) => ({
  track,
  played_at: daysAgo(days),
  listened_seconds: listened,
  duration_seconds: 200,
  skipped,
});

describe('createRng', () => {
  it('同一个种子结果相同，不同种子结果不同（每日推荐同一天不变）', () => {
    const seq = rng => [rng(), rng(), rng()];
    const a = seq(createRng('user:2026-10-19'));
    expect(seq(createRng('user:2026-10-19'))).toEqual(a);
    expect(seq(createRng('user:2026-10-20'))).not.toEqual(a);
    expect(a.every(x => x >= 0 && x < 1)).toBe(true);
  });
});

describe('computeArtistAffinity', () => {
  const history = [
    play(t(1, 100), 1, 200),
    play(t(2, 100), 2, 190),
    play(t(3, 200), 1, 60),
    play(t(4, 300), 1, 5, true),
    play(t(5, 400), 28, 200),
  ];
  const aff = computeArtistAffinity(history, [t(6, 500)], now);

  it('喜欢 > 听完 > 听一部分 > 跳过（负分）', () => {
    expect(aff.get(500)).toBeGreaterThan(aff.get(100));
    expect(aff.get(100)).toBeGreaterThan(aff.get(200));
    expect(aff.get(300)).toBeLessThan(0);
  });

  it('14 天半衰期：28 天前的播放只剩 1/4', () => {
    expect(aff.get(400)).toBeCloseTo(0.25, 2);
  });

  it('合唱平分给每个歌手', () => {
    const duet = { id: 9, ar: [{ id: 1 }, { id: 2 }] };
    const a = computeArtistAffinity([play(duet, 0, 200)], [], now);
    expect(a.get(1)).toBeCloseTo(0.5);
    expect(a.get(2)).toBeCloseTo(0.5);
  });

  it('pickSeeds：负分歌手不当种子，种子歌曲优先用喜欢的', () => {
    const seeds = pickSeeds(aff, history, [t(6, 500)]);
    expect(seeds.artistIds.slice(0, 2)).toEqual([500, 100]);
    expect(seeds.artistIds).not.toContain(300);
    expect(seeds.trackIds).toEqual([6, 1, 2]);
  });
});

describe('rankCandidates', () => {
  const rank = (candidates, options = {}) =>
    rankCandidates(candidates, {
      affinity: new Map(),
      excludeIds: new Set(),
      rng: createRng(1),
      count: 10,
      ...options,
    }).map(x => x.id);

  it('排除、去重', () => {
    const ids = rank(
      [
        { track: t(1, 1), origin: 'artist' },
        { track: t(2, 2), origin: 'similar' },
        { track: t(2, 2), origin: 'generic' },
      ],
      { excludeIds: new Set(['1']) }
    );
    expect(ids).toEqual([2]);
  });

  it('合唱也计入歌手上限；同名不同版本只留一首；串烧降权', () => {
    const c = (id, name, artists) => ({
      track: { id, name, ar: artists.map(a => ({ id: a })), pop: 100 },
      origin: 'artist',
    });
    const candidates = [
      c(30, '歌A', [500]),
      c(31, '歌B', [500]),
      c(32, '合唱', [700, 500]),
      c(33, '歌A (Live)', [500]), // 和 30 同名
      c(35, '歌C', [900]),
    ];
    const ids = rank(candidates, { count: 5 });
    // 哪两首胜出取决于随机扰动，但含歌手 500 的歌（包括合唱）最多 2 首
    const with500 = ids.filter(id =>
      candidates.find(x => x.track.id === id).track.ar.some(a => a.id === 500)
    );
    expect(with500).toHaveLength(2);
    expect(ids).not.toContain(33);
    expect(ids).toContain(35);

    const crowded = rank(
      [c(34, 'X + Y + Z', [800]), c(36, '歌D', [901]), c(37, '歌E', [902])],
      { count: 2 }
    );
    expect(crowded).not.toContain(34);
  });

  it('名额少时，相似歌单（发现新歌）有保留名额', () => {
    const affinity = new Map([[1, 10]]);
    const ids = rank(
      [
        ...[1, 2, 3].map(i => ({
          track: t(i, 1, `fav${i}`),
          origin: 'artist',
        })),
        { track: t(9, 99, 'new'), origin: 'similar' },
      ],
      { affinity, count: 2, maxPerArtist: 5 }
    );
    expect(ids).toContain(9);
  });

  it('normalizeTitle 去掉括号和空格', () => {
    expect(normalizeTitle('晴天 (Live)')).toBe(normalizeTitle('晴天'));
    expect(normalizeTitle('Love Story【Taylor’s Version】')).toBe('lovestory');
  });
});

describe('gatherCandidates', () => {
  it('歌手热门歌 + 相似歌单里的歌；某个接口失败不影响其他来源', async () => {
    const netease = {
      artistTopSongs: vi.fn(async id => {
        if (id === 2) throw new Error('网络错误');
        return [t(100 + id, id)];
      }),
      similarPlaylists: vi.fn(async () => [{ id: 7 }, { id: 8 }, { id: 9 }]),
      playlistTracks: vi.fn(async pid => [t(pid * 10, 50)]),
    };
    const candidates = await gatherCandidates(
      { artistIds: [1, 2], trackIds: [5] },
      netease
    );
    expect(candidates.map(c => [c.track.id, c.origin])).toEqual([
      [101, 'artist'],
      [70, 'similar'],
      [80, 'similar'],
    ]);
    // 每首种子歌只取前 2 个相似歌单，避免请求太多
    expect(netease.playlistTracks).toHaveBeenCalledTimes(2);
  });
});
describe('gatherCandidates 不会被卡住的接口拖住', () => {
  it('超过时间的来源跳过，其他照样回来', async () => {
    const netease = {
      artistTopSongs: id => (id === 1 ? new Promise(() => {}) : Promise.resolve([{ id: `a${id}` }])),
      similarPlaylists: () => Promise.resolve([]),
      playlistTracks: () => Promise.resolve([]),
    };
    const started = Date.now();
    const result = await gatherCandidates({ artistIds: [1, 2], trackIds: [] }, netease, { jobTimeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.map(c => c.track.id)).toEqual(['a2']);
  });
});
