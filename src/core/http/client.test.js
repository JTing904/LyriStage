import { describe, it, expect, vi } from 'vitest';
import { createHttp, ApiError, isRetryable } from './client';

/** 假的 fetch：按顺序返回预设的回应 */
function fakeFetch(...responses) {
  const calls = [];
  const fn = vi.fn(async url => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new SyntaxError('not json');
        return next.body;
      },
    };
  });
  fn.calls = calls;
  return fn;
}

const ok = body => ({ status: 200, body });

describe('createHttp', () => {
  it('拼接网址和参数，忽略 null / undefined', async () => {
    const fetch = fakeFetch(ok({ code: 200, x: 1 }));
    const http = createHttp({
      baseURL: '/api/',
      fetch,
      defaultParams: { realIP: '1.2.3.4' },
    });
    expect(
      await http.get('/search', {
        keywords: '晴天',
        limit: 2,
        a: null,
        b: undefined,
      })
    ).toEqual({ code: 200, x: 1 });
    expect(fetch.calls[0]).toBe(
      '/api/search?realIP=1.2.3.4&keywords=%E6%99%B4%E5%A4%A9&limit=2'
    );
  });

  it('body.code >= 400 时抛出 ApiError（网易云有时 HTTP 200 但 code 是错误码）', async () => {
    const http = createHttp({
      baseURL: 'http://x',
      fetch: fakeFetch(ok({ code: 404, message: '找不到' })),
    });
    const err = await http.get('/song').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('找不到');
    expect(err.code).toBe(404);
  });

  it('5xx 和网络错误会重试，最后成功', async () => {
    const fetch = fakeFetch(
      new TypeError('fetch failed'),
      { status: 502, body: undefined },
      ok({ code: 200, ok: true })
    );
    const http = createHttp({
      baseURL: 'http://x',
      fetch,
      retryDelays: [0, 0],
    });
    expect(await http.get('/a')).toEqual({ code: 200, ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('重试次数用完就抛出最后一次的错误', async () => {
    const fetch = fakeFetch(
      { status: 500, body: { msg: '1' } },
      { status: 500, body: { msg: '2' } }
    );
    const http = createHttp({ baseURL: 'http://x', fetch, retryDelays: [0] });
    await expect(http.get('/a')).rejects.toMatchObject({
      message: '2',
      status: 500,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('4xx 不重试', async () => {
    const fetch = fakeFetch({
      status: 400,
      body: { code: 400, msg: '参数错误' },
    });
    const http = createHttp({
      baseURL: 'http://x',
      fetch,
      retryDelays: [0, 0],
    });
    await expect(http.get('/a')).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('超时会中止请求并当成可重试的错误', async () => {
    const fetch = vi.fn(
      (_url, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const http = createHttp({
      baseURL: 'http://x',
      fetch,
      timeout: 10,
      retryDelays: [],
    });
    const err = await http.get('/slow').catch(e => e);
    expect(err.message).toContain('超时');
    expect(isRetryable(err)).toBe(true);
  });
});
