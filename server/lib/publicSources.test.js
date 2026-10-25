import { describe, it, expect } from 'vitest';
import { audioUrlFrom } from './publicSources';

const response = (body, headers = {}) => new Response(body, { headers });

describe('audioUrlFrom：各家音源回的格式', () => {
  it('302 跳转', async () => {
    expect(await audioUrlFrom(response(null, { location: 'http://m701.music.126.net/a.mp3' }))).toBe(
      'http://m701.music.126.net/a.mp3'
    );
  });
  it('直接一行网址', async () => {
    expect(await audioUrlFrom(response('https://x.cn/a.mp3\n'))).toBe('https://x.cn/a.mp3');
  });
  it('JSON：url、data.url、data[0].url', async () => {
    expect(await audioUrlFrom(response('{"url":"https://a/1.mp3"}'))).toBe('https://a/1.mp3');
    expect(await audioUrlFrom(response('{"data":{"url":"https://a/2.mp3"}}'))).toBe('https://a/2.mp3');
    expect(await audioUrlFrom(response('{"code":0,"data":[{"url":"https://a/3.mp3"}]}'))).toBe('https://a/3.mp3');
  });
  it('拿不到：错误讯息、空字符串', async () => {
    expect(await audioUrlFrom(response('{"msg":"获取失败","code":500}'))).toBeNull();
    expect(await audioUrlFrom(response(''))).toBeNull();
  });
});
