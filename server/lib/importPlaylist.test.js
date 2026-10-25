import { describe, expect, it } from 'vitest';
import { cleanVideoTitle, handleImport, parseLink, splitVideo } from './importPlaylist';

describe('parseLink', () => {
  it('认出各家的歌单链接', () => {
    expect(parseLink('https://y.qq.com/n/ryqq/playlist/7039500547')).toMatchObject({ source: 'qq', id: '7039500547' });
    expect(parseLink('https://i.y.qq.com/n2/m/share/details/taoge.html?platform=11&id=7039500547&hosteuin=x')).toMatchObject({ source: 'qq', id: '7039500547' });
    expect(parseLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toMatchObject({ source: 'spotify', id: '37i9dQZF1DXcBWIGoYBM5M' });
    expect(parseLink('https://open.spotify.com/intl-zh/playlist/37i9dQZF1DXcBWIGoYBM5M')).toMatchObject({ id: '37i9dQZF1DXcBWIGoYBM5M' });
    expect(parseLink('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb?l=zh')).toMatchObject({
      source: 'apple',
      id: 'pl.f4d106fed2bd41149aaacabb233eb5eb',
      url: 'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',
    });
    expect(parseLink('https://music.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&si=x')).toMatchObject({ source: 'youtube', id: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI' });
    expect(parseLink('https://www.youtube.com/watch?v=abc&list=PL123_-x')).toMatchObject({ source: 'youtube', id: 'PL123_-x' });
    expect(parseLink('https://music.163.com/#/playlist?id=3778678')).toMatchObject({ source: 'netease', id: '3778678' });
    expect(parseLink('https://music.163.com/playlist?id=3778678&userid=1')).toMatchObject({ source: 'netease', id: '3778678' });
  });

  it('分享出来的整段文字：拿里面的网址', () => {
    expect(parseLink('分享歌单：你终会明白的 https://y.qq.com/n/ryqq/playlist/7039500547 (@QQ音乐)')).toMatchObject({ source: 'qq', id: '7039500547' });
    expect(parseLink('Check this out https://spotify.link/AbCdEf')).toMatchObject({ source: 'short' });
  });

  it('不是歌单就不认', () => {
    expect(parseLink('晴天 周杰伦')).toBeNull();
    expect(parseLink('https://open.spotify.com/track/2sFepQNyl1WjpROruP8bJ0')).toBeNull();
    expect(parseLink('https://example.com/playlist/1')).toBeNull();
  });
});

describe('YouTube 标题', () => {
  it('清掉 (Official Music Video) 这种', () => {
    expect(cleanVideoTitle('Tate McRae - Housewife (Official Music Video)')).toBe('Tate McRae - Housewife');
    expect(cleanVideoTitle('周杰倫 Jay Chou【晴天 Sunny Day】Official MV')).toBe('周杰倫 Jay Chou【晴天 Sunny Day】');
    expect(cleanVideoTitle('告白气球 [歌词版] | 周杰伦')).toBe('告白气球');
  });

  it('拆成歌名和歌手', () => {
    expect(splitVideo('Tate McRae - Housewife (Official Video)', 'TateMcRaeVEVO')).toEqual({ name: 'Housewife', artists: ['Tate McRae'] });
    expect(splitVideo('Housewife', 'Tate McRae - Topic')).toEqual({ name: 'Housewife', artists: ['Tate McRae'] });
    expect(splitVideo('Real Boston Richey - The Type (Official Music Video) ft. YTB Fatt', 'RealBostonRichey')).toEqual({ name: 'The Type', artists: ['Real Boston Richey'] });
    expect(splitVideo('Song Title', 'SomeArtistVEVO')).toEqual({ name: 'Song Title', artists: ['SomeArtist'] });
    expect(splitVideo('周杰倫 Jay Chou【晴天 Sunny Day】Official MV', 'JVR Music')).toEqual({ name: '晴天 Sunny Day', artists: ['周杰倫 Jay Chou'] });
    expect(splitVideo('林俊傑《江南》MV', 'JJ Lin')).toEqual({ name: '江南', artists: ['林俊傑'] });
    expect(splitVideo('ITZY "BORN TO BE" M/V @ITZY', 'JYP Entertainment')).toEqual({ name: 'BORN TO BE', artists: ['ITZY'] });
    expect(splitVideo("지민 (Jimin) 'Closer Than This' Official MV", 'HYBE LABELS')).toEqual({ name: 'Closer Than This', artists: ['지민', 'Jimin'] });
    // 撇号不是引号
    expect(splitVideo("Don't Stop Me Now", 'Queen Official').name).toBe("Don't Stop Me Now");
    // 「歌名 - 歌手」：看频道名认出哪一边是歌手
    expect(splitVideo('BELLAKEO (Video Oficial) - Peso Pluma, Anitta', 'Peso Pluma')).toEqual({ name: 'BELLAKEO', artists: ['Peso Pluma', 'Anitta'] });
  });
});

describe('handleImport', () => {
  const ask = (link, readers) => handleImport(new URL(`http://x/import/playlist?url=${encodeURIComponent(link)}`), { readers });
  const playlist = {
    name: 'Today&#39;s Hits',
    cover: 'https://img',
    total: 3,
    tracks: [
      { name: '晴天', artists: ['周杰倫'], durationMs: 269000 },
      { name: 'Housewife', artists: ['Tate McRae', 'X'], durationMs: 208810 },
      { name: '', artists: [], durationMs: 0 },
    ],
  };

  it('回传歌单和每首要搜索的字（繁体转简体）', async () => {
    const { status, body } = await ask('https://y.qq.com/n/ryqq/playlist/1', { qq: async () => playlist });
    expect(status).toBe(200);
    expect(body).toMatchObject({ source: 'qq', name: "Today's Hits", total: 3 });
    expect(body.tracks).toHaveLength(2);
    expect(body.tracks[0]).toMatchObject({ name: '晴天', query: '晴天 周杰伦' });
    expect(body.tracks[1].query).toBe('Housewife Tate McRae');
  });

  it('网易云的歌单：只回传 id（App 自己打开）', async () => {
    const { body } = await ask('https://music.163.com/#/playlist?id=3778678', {});
    expect(body).toMatchObject({ source: 'netease', id: '3778678' });
  });

  it('认不出、读不到、空的：说清楚是哪一种', async () => {
    expect((await ask('随便打的字', {})).body.reason).toBe('unsupported');
    const failing = { spotify: async () => { throw Object.assign(new Error('x'), { status: 500 }); } };
    expect((await ask('https://open.spotify.com/playlist/abc', failing)).body.reason).toBe('failed');
    const missing = { spotify: async () => { throw Object.assign(new Error('x'), { status: 404 }); } };
    expect((await ask('https://open.spotify.com/playlist/abd', missing)).body.reason).toBe('not-found');
    expect((await ask('https://open.spotify.com/playlist/abe', { spotify: async () => ({ ...playlist, tracks: [] }) })).body.reason).toBe('empty');
  });
});
