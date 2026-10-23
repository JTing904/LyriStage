import { describe, expect, it } from 'vitest';
import { findOnNetease, findOriginals, normalize, pickCandidates } from './originals';

const apple = (trackName, artistName, collectionName, trackTimeMillis = 269747) => ({
  wrapperType: 'track',
  kind: 'song',
  trackName,
  artistName,
  collectionName,
  trackTimeMillis,
});

// 网易云的替身：周杰伦、他的专辑（含已下架的叶惠美）、专辑里的歌
const netease = {
  searchArtists: async name => (name === '周杰伦' ? [{ id: 6452, name: '周杰伦', alias: ['Jay Chou'] }, { id: 1, name: '周杰伦.' }] : []),
  artistAlbums: async id => (id === 6452 ? [{ id: 18915, name: '七里香' }, { id: 18905, name: '叶惠美' }] : []),
  albumSongs: async id =>
    id === 18905
      ? [
          { id: 186014, name: '以父之名', dt: 342000 },
          { id: 186016, name: '晴天', dt: 269000, privilege: { st: -200 } },
        ]
      : [],
};

describe('normalize', () => {
  it('繁体转简体、去掉空白标点、不分大小写', () => {
    expect(normalize('周杰倫')).toBe('周杰伦');
    expect(normalize('葉惠美')).toBe(normalize('叶惠美'));
    expect(normalize('Sunny Day!')).toBe('sunnyday');
  });
});

describe('pickCandidates', () => {
  it('跳过现场版、同一首只留一次，最多 3 首', () => {
    const list = pickCandidates(
      [
        apple('晴天', '周杰倫', '葉惠美'),
        apple('晴天 (Live)', '周杰倫', '2004 無與倫比演唱會 (Live)'),
        apple('晴天', '周杰倫', '葉惠美'),
        apple('晴天', '苏念一', '晴天 - Single'),
        apple('晴天', 'A', 'x'),
        apple('晴天', 'B', 'y'),
      ],
      '晴天'
    );
    expect(list.map(c => c.artist)).toEqual(['周杰倫', '苏念一', 'A']);
  });

  it('关键字有 live 就留现场版', () => {
    expect(pickCandidates([apple('晴天 (Live)', '周杰倫', '演唱會')], '晴天 live')).toHaveLength(1);
  });
});

describe('findOnNetease', () => {
  it('歌手 → 专辑 → 歌：找到下架的晴天（繁体名字也对得上）', async () => {
    const song = await findOnNetease({ track: '晴天', artist: '周杰倫', album: '葉惠美', durationMs: 269747 }, netease);
    expect(song?.id).toBe(186016);
  });

  it('歌手、专辑、歌名对不上就回 null，不乱给', async () => {
    expect(await findOnNetease({ track: '晴天', artist: '某某某', album: '葉惠美', durationMs: 0 }, netease)).toBeNull();
    expect(await findOnNetease({ track: '晴天', artist: '周杰倫', album: '范特西', durationMs: 0 }, netease)).toBeNull();
    expect(await findOnNetease({ track: '稻香', artist: '周杰倫', album: '葉惠美', durationMs: 0 }, netease)).toBeNull();
  });
});

describe('findOriginals', () => {
  it('台湾区没有就问香港区；同一首不重复', async () => {
    const asked = [];
    const itunes = async (term, country) => {
      asked.push(country);
      return country === 'HK' ? [apple('晴天', '周杰倫', '葉惠美'), apple('晴天', '周杰倫', '葉惠美 ')] : [];
    };
    const songs = await findOriginals('晴天', { itunes, netease });
    expect(asked).toEqual(['TW', 'HK']);
    expect(songs.map(s => s.id)).toEqual([186016]);
  });

  it('Apple 连不上就是空的（不会让搜索出错）', async () => {
    const songs = await findOriginals('晴天', { itunes: async () => Promise.reject(new Error('down')), netease });
    expect(songs).toEqual([]);
  });
});
