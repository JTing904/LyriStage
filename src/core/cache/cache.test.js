import { describe, it, expect, vi } from 'vitest';
import { createCache, createMemoryStore } from './index';

function setup(options = {}) {
  let time = 0;
  const cache = createCache(createMemoryStore(), {
    ...options,
    now: () => time,
  });
  return { cache, advance: ms => (time += ms) };
}

describe('createCache', () => {
  it('存了就能读', async () => {
    const { cache } = setup();
    await cache.set('a', { x: 1 });
    expect(await cache.get('a')).toEqual({ x: 1 });
    expect(await cache.get('b')).toBeUndefined();
  });

  it('过期后读不到', async () => {
    const { cache, advance } = setup({ ttlMs: 1000 });
    await cache.set('a', 1);
    advance(999);
    expect(await cache.get('a')).toBe(1);
    advance(2);
    expect(await cache.get('a')).toBeUndefined();
  });

  it('超过数量上限时删掉最旧的', async () => {
    const { cache, advance } = setup({ maxEntries: 2 });
    await cache.set('a', 1);
    advance(1);
    await cache.set('b', 2);
    advance(1);
    await cache.set('c', 3);
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('c')).toBe(3);
  });

  it('getOrLoad：命中缓存就不再请求；同时请求同一个 key 只请求一次', async () => {
    const { cache } = setup();
    const loader = vi.fn(async () => '歌词');
    const [a, b] = await Promise.all([
      cache.getOrLoad('lyric:1', loader),
      cache.getOrLoad('lyric:1', loader),
    ]);
    expect([a, b]).toEqual(['歌词', '歌词']);
    expect(await cache.getOrLoad('lyric:1', loader)).toBe('歌词');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('getOrLoad：请求失败不缓存，下次重新请求', async () => {
    const { cache } = setup();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce('ok');
    await expect(cache.getOrLoad('k', loader)).rejects.toThrow('网络错误');
    expect(await cache.getOrLoad('k', loader)).toBe('ok');
  });
});
