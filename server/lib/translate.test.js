import { describe, it, expect } from 'vitest';
import { handleTranslate, lrcLines, translateLrc } from './translate';

const LRC = [
  '[00:00.00] 作词 : 米津玄師',
  '[00:12.34]夢ならばどれほどよかったでしょう',
  '[00:18.00]',
  '[00:20.50]未だにあなたのことを夢にみる',
  '[00:30.00]夢ならばどれほどよかったでしょう',
  '[00:40.00]Oh yeah',
].join('\n');

/** 假的 Azure：把每句变成 EN(原文)，记下送了什么 */
function fakeAzure(calls) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    return { ok: true, json: async () => body.map(b => ({ translations: [{ text: `EN(${b.Text})` }] })) };
  };
}

describe('lrcLines', () => {
  it('留时间标签和文字，空行跳过', () => {
    expect(lrcLines(LRC).map(l => l.tags)).toEqual(['[00:00.00]', '[00:12.34]', '[00:20.50]', '[00:30.00]', '[00:40.00]']);
  });
});

describe('translateLrc', () => {
  it('只翻中日韩的句子，重复的副歌只送一次，时间标签照旧', async () => {
    const calls = [];
    const out = await translateLrc(LRC, { key: 'k', region: 'eastasia', to: 'en', fetchImpl: fakeAzure(calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toHaveLength(3); // 作词行、两句不同的歌词（重复那句只送一次），英文的 Oh yeah 不送
    expect(calls[0].headers['Ocp-Apim-Subscription-Region']).toBe('eastasia');
    expect(out.split('\n')).toEqual([
      '[00:00.00]EN(作词 : 米津玄師)',
      '[00:12.34]EN(夢ならばどれほどよかったでしょう)',
      '[00:20.50]EN(未だにあなたのことを夢にみる)',
      '[00:30.00]EN(夢ならばどれほどよかったでしょう)',
    ]);
  });

  it('英文歌不用翻：不叫 Azure，回传空的', async () => {
    const calls = [];
    const out = await translateLrc('[00:01.00]Shape of you\n[00:05.00]I\'m in love', { key: 'k', to: 'en', fetchImpl: fakeAzure(calls) });
    expect(out).toBe('');
    expect(calls).toHaveLength(0);
  });
});

describe('handleTranslate', () => {
  const req = { headers: { authorization: 'Bearer user-token' } };
  const base = { supabaseUrl: 'https://x.supabase.co', anonKey: 'anon', azureKey: 'k', azureRegion: 'eastasia', cacheSecret: 's'.repeat(64) };
  const url = q => new URL(`http://localhost/lyric/translate?${q}`);

  it('参数不对：400', async () => {
    const r = await handleTranslate(req, url('id=abc'), { ...base, fetchLyric: async () => LRC });
    expect(r.status).toBe(400);
    expect((await handleTranslate(req, url('id=1&to=fr'), { ...base, fetchLyric: async () => LRC })).status).toBe(400);
  });

  it('没设置 Azure：503', async () => {
    const r = await handleTranslate(req, url('id=1'), { ...base, azureKey: undefined, fetchLyric: async () => LRC });
    expect(r.status).toBe(503);
  });

  it('翻过了：直接回传缓存，不叫 Azure 也不拿歌词', async () => {
    const seen = [];
    const fetchImpl = async u => {
      seen.push(u);
      return { ok: true, json: async () => [{ lyric: '[00:01.00]cached' }] };
    };
    const r = await handleTranslate(req, url('id=42'), { ...base, fetchImpl, fetchLyric: async () => { throw new Error('不该拿'); } });
    expect(r.body).toMatchObject({ lyric: '[00:01.00]cached', cached: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('song_id=eq.42');
  });

  it('没翻过：翻好、带密码存进缓存、回传', async () => {
    const azureCalls = [];
    const azure = fakeAzure(azureCalls);
    let saved = null;
    const fetchImpl = async (u, init) => {
      if (u.includes('/rest/v1/lyric_translations')) return { ok: true, json: async () => [] };
      if (u.includes('/rpc/save_lyric_translation')) {
        saved = JSON.parse(init.body);
        return { ok: true, json: async () => null };
      }
      return azure(u, init);
    };
    const r = await handleTranslate(req, url('id=42'), { ...base, fetchImpl, fetchLyric: async () => LRC });
    expect(r.status).toBe(200);
    expect(r.body.cached).toBe(false);
    expect(r.body.lyric).toContain('[00:12.34]EN(');
    expect(saved).toMatchObject({ p_song_id: 42, p_lang: 'en', secret: base.cacheSecret });
  });

  it('Azure 免费额度用完（403）：503，不存缓存', async () => {
    let saved = false;
    const fetchImpl = async u => {
      if (u.includes('/rest/v1/lyric_translations')) return { ok: true, json: async () => [] };
      if (u.includes('/rpc/')) saved = true;
      return { ok: false, status: 403 };
    };
    const r = await handleTranslate(req, url('id=42'), { ...base, fetchImpl, fetchLyric: async () => LRC });
    expect(r.status).toBe(503);
    expect(saved).toBe(false);
  });
});
