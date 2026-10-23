import { describe, it, expect, vi } from 'vitest';
import { createNetease, isUnavailable, lyricMatch, toHttps } from './index';
import { ApiError } from '../http/client';

/** 假的 http：按路径返回预设数据，记录请求参数 */
function fakeHttp(routes) {
  return {
    get: vi.fn(async (path, params) => {
      const handler = routes[path];
      if (!handler) throw new ApiError('not found', { status: 404, url: path });
      return typeof handler === 'function' ? handler(params) : handler;
    }),
  };
}

describe('songUrl', () => {
  it('链接改成 https', async () => {
    const netease = createNetease(
      fakeHttp({
        '/song/url/v1': {
          data: [{ url: 'http://m7.music.126.net/a.mp3', br: 320000 }],
        },
      })
    );
    expect(await netease.songUrl(1)).toEqual({
      url: 'https://m7.music.126.net/a.mp3',
      br: 320000,
      source: 'netease',
    });
  });

  it('没有链接或只能试听 30 秒时返回 null', async () => {
    const empty = createNetease(
      fakeHttp({ '/song/url/v1': { data: [{ url: null }] } })
    );
    const trial = createNetease(
      fakeHttp({
        '/song/url/v1': {
          data: [{ url: 'http://x', freeTrialInfo: { start: 0, end: 30 } }],
        },
      })
    );
    expect(await empty.songUrl(1)).toBeNull();
    expect(await trial.songUrl(1)).toBeNull();
  });
});

describe('unblockUrl', () => {
  it('找到时返回音源，找不到（404）时返回 null 而不是抛错', async () => {
    const found = createNetease(
      fakeHttp({
        '/song/url/match': {
          data: { url: 'https://x/a.mp3', br: 320000, source: 'pyncmd' },
        },
      })
    );
    const missing = createNetease(fakeHttp({}));
    expect(await found.unblockUrl(1)).toMatchObject({ source: 'pyncmd' });
    expect(await missing.unblockUrl(1)).toBeNull();
  });
});

describe('search', () => {
  it('按类型取对应的结果，类型转成网易云的数字', async () => {
    const http = fakeHttp({
      '/cloudsearch': params =>
        params.type === 100
          ? { result: { artists: [{ id: 6452 }] } }
          : { result: { songs: [{ id: 1 }] } },
    });
    const netease = createNetease(http);
    expect(await netease.search('周杰伦', { type: 'artist' })).toEqual([
      { id: 6452 },
    ]);
    expect(await netease.searchSongs('晴天')).toEqual([{ id: 1 }]);
    expect(http.get).toHaveBeenLastCalledWith('/cloudsearch', {
      keywords: '晴天',
      type: 1,
      limit: 30,
      offset: 0,
    });
  });

  it('没有结果时返回空数组', async () => {
    const netease = createNetease(fakeHttp({ '/cloudsearch': { result: {} } }));
    expect(await netease.search('zzzz', { type: 'playlist' })).toEqual([]);
  });
});

it('newSongs 取出包装里的 song，旧格式字段统一成 ar / al / dt', async () => {
  const oldFormat = {
    id: 1,
    name: 'a',
    artists: [{ id: 2, name: '歌手' }],
    album: { id: 3, name: '专辑' },
    duration: 200000,
  };
  const netease = createNetease(
    fakeHttp({
      '/personalized/newsong': { result: [{ id: 9, song: oldFormat }] },
    })
  );
  const [song] = await netease.newSongs();
  expect(song).toMatchObject({
    id: 1,
    ar: [{ id: 2, name: '歌手' }],
    al: { id: 3, name: '专辑' },
    dt: 200000,
  });
});

it('songDetails 空数组时不发请求', async () => {
  const http = fakeHttp({});
  expect(await createNetease(http).songDetails([])).toEqual([]);
  expect(http.get).not.toHaveBeenCalled();
});

it('toHttps', () => {
  expect(toHttps('http://a/b')).toBe('https://a/b');
  expect(toHttps('https://a/b')).toBe('https://a/b');
});

it('personalFm 统一成新格式', async () => {
  const netease = createNetease(
    fakeHttp({
      '/personal_fm': {
        data: [{ id: 7, name: 'x', artists: [{ id: 1, name: 'a' }], album: { id: 2 }, duration: 1000 }],
      },
    })
  );
  const [song] = await netease.personalFm();
  expect(song).toMatchObject({ id: 7, ar: [{ id: 1 }], al: { id: 2 }, dt: 1000 });
});

it('songDetails / playlistTracks 把 privileges 挂回每首歌，isUnavailable 看 st', async () => {
  const http = {
    get: async path =>
      path === '/song/detail'
        ? { songs: [{ id: 1 }, { id: 2 }], privileges: [{ id: 1, st: -200 }, { id: 2, st: 0 }] }
        : { songs: [{ id: 3 }], privileges: [{ id: 3, st: 0 }] },
  };
  const netease = createNetease(http);
  const [removed, ok] = await netease.songDetails([1, 2]);
  expect(removed.privilege.st).toBe(-200);
  expect(isUnavailable(removed)).toBe(true);
  expect(isUnavailable(ok)).toBe(false);
  expect(isUnavailable({ id: 9 })).toBe(false); // 没有版权资料的当成可以播
  const [track] = await netease.playlistTracks(7);
  expect(track.privilege.st).toBe(0);
});

it('lyricMatch：切出歌词搜索命中的那一句，<b> 的字标成 hit，其他标签去掉', () => {
  expect(lyricMatch(['第一句', '故事的<b>小黄花</b>啊<i>x</i>'])).toEqual([
    { text: '故事的', hit: false },
    { text: '小黄花', hit: true },
    { text: '啊x', hit: false },
  ]);
  expect(lyricMatch(['没有命中'])).toBeNull();
  expect(lyricMatch(undefined)).toBeNull();
});

it('originalArtistIn：从翻唱歌名认出原唱（各种括号、冒号写法），取最常出现的', async () => {
  const { originalArtistIn } = await import('./index');
  expect(
    originalArtistIn([
      { name: '告白气球 (原唱：周杰伦)' },
      { name: '告白气球 [原唱: 周杰伦]' },
      { name: '告白气球（钢琴版）' },
      { name: '晴天 (原唱 周杰伦)' },
      { name: '某首歌 (原唱：别人)' },
    ])
  ).toBe('周杰伦');
  expect(originalArtistIn([{ name: '告白气球' }, {}])).toBeNull();
});

describe('hiddenSongs（网易云下架、搜不到的原唱）', () => {
  const qingtian = { id: 186016, name: '晴天', ar: [{ id: 6452, name: '周杰伦' }], privilege: { st: -200 } };

  it('先问服务器的 /search/originals（Apple 的目录 + 网易云的专辑）', async () => {
    const http = fakeHttp({ '/search/originals': { songs: [qingtian] } });
    const netease = createNetease(http);
    expect((await netease.hiddenSongs('晴天')).map(s => s.id)).toEqual([186016]);
    expect(http.get).toHaveBeenCalledWith('/search/originals', { keywords: '晴天' });
  });

  it('服务器是旧版（没有这个路径）就用老方法：关键词里的歌手 → 他的歌', async () => {
    const http = fakeHttp({
      '/cloudsearch': { result: { artists: [{ id: 6452, name: '周杰伦' }] } },
      '/artist/songs': { songs: [qingtian, { id: 1, name: '晴天', privilege: { st: 0 } }] },
    });
    const songs = await createNetease(http).hiddenSongs('晴天 周杰伦');
    expect(songs.map(s => s.id)).toEqual([186016]);
  });
});
