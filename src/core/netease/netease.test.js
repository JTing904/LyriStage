import { describe, it, expect, vi } from 'vitest';
import { createNetease, toHttps } from './index';
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
