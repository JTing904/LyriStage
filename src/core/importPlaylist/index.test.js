import { describe, expect, it, vi } from 'vitest';
import { baseTitle, judge, matchAll, matchTrack, parseTextList, variantOf } from './index';

const song = (id, name, artist, dt = 200000, extra = {}) => ({ id, name, ar: [{ id: 1, name: artist }], dt, ...extra });
const src = (name, artists, durationMs = 200000, extra = {}) => ({ name, artists, durationMs, ...extra });

describe('比对', () => {
  it('歌名本体：括号里的、Remastered 拿掉', () => {
    expect(baseTitle('Say Yes (Live)')).toBe('sayyes');
    expect(baseTitle('晴天（钢琴版）')).toBe('晴天');
    expect(baseTitle('Here Comes The Sun - Remastered 2009')).toBe('herecomesthesun');
  });

  it('认出版本', () => {
    expect(variantOf('Say Yes (Live)')).toBe('live');
    expect(variantOf('晴天 翻自 周杰伦')).toBe('cover');
    expect(variantOf('说好不哭 (伴奏)')).toBe('instrumental');
    expect(variantOf('Housewife (Sped Up)')).toBe('remix');
    expect(variantOf('稻香(治愈版)')).toBe('other-version');
    expect(variantOf('Say Yes (Acoustic Ver.)')).toBe('other-version');
    expect(variantOf('晴天')).toBeNull();
    expect(variantOf('海阔天空')).toBeNull();
  });

  it('歌名、歌手对得上、长度差不多：ok', () => {
    const r = judge(src('晴天', ['周杰伦'], 269000), [song(1, '晴天', '周杰伦', 269500)]);
    expect(r).toMatchObject({ status: 'ok', reason: null });
    expect(r.pick.id).toBe(1);
  });

  it('同名有原版也有 Live、翻唱：挑原版', () => {
    const r = judge(src('Say Yes', ['Loco'], 209000), [
      song(1, 'Say Yes (Live)', 'Loco', 252000),
      song(2, 'Say Yes', '某某', 209000, { originCoverType: 2 }),
      song(3, 'Say Yes', 'Loco', 208000),
    ]);
    expect(r.status).toBe('ok');
    expect(r.pick.id).toBe(3);
    expect(r.candidates[0].id).toBe(3);
    expect(r.candidates).toHaveLength(3);
  });

  it('只找到 Live 版、翻唱、长度差很多、歌手不一样：version，说是哪一种', () => {
    expect(judge(src('Say Yes', ['Loco']), [song(1, 'Say Yes (Live)', 'Loco')])).toMatchObject({ status: 'version', reason: 'live' });
    expect(judge(src('晴天', ['周杰伦']), [song(1, '晴天', '周杰伦', 200000, { alia: ['翻自 周杰伦'] })])).toMatchObject({ status: 'version', reason: 'cover' });
    expect(judge(src('说好不哭', ['周杰伦'], 222000), [song(1, '说好不哭', '周杰伦', 262000)])).toMatchObject({ status: 'version', reason: 'duration', diffSec: 40 });
    expect(judge(src('晴天', ['周杰伦']), [song(1, '晴天', '别人')])).toMatchObject({ status: 'version', reason: 'artist' });
  });

  it('原本就是 Live 版：配到 Live 版不算错', () => {
    expect(judge(src('Say Yes (Live)', ['Loco']), [song(1, 'Say Yes (Live)', 'Loco')]).status).toBe('ok');
  });

  it('繁体歌名用服务器给的简体比', () => {
    const r = judge(src('說好不哭', ['周杰倫'], 222000, { match: { name: '说好不哭', artists: ['周杰伦'] } }), [song(1, '说好不哭', '周杰伦', 222000)]);
    expect(r.status).toBe('ok');
  });

  it('歌手的英文名写在网易云的别名里（长度也对得上）', () => {
    const r = judge(src('Sunny Day', ['Jay Chou']), [{ id: 1, name: '晴天', tns: ['Sunny Day'], ar: [{ name: '周杰伦', alias: ['Jay Chou'] }], dt: 200000 }]);
    expect(r.status).toBe('ok');
  });

  it('乱上传的：别名填了周杰伦、又没有长度可以对：不算对上，原唱排前面', () => {
    const fake = { id: 9, name: '晴天', ar: [{ name: 'Jay', alias: ['周杰伦', '林俊杰'] }], dt: 112000 };
    expect(judge(src('晴天', ['周杰伦'], 0), [fake]).status).toBe('version');
    const real = song(186016, '晴天', '周杰伦', 269000);
    const r = judge(src('晴天', ['周杰伦'], 0), [fake, real]);
    expect(r).toMatchObject({ status: 'ok' });
    expect(r.pick.id).toBe(186016);
  });

  it('歌名对不上：none', () => {
    expect(judge(src('完全不一样', ['某某']), [song(1, '晴天', '周杰伦')])).toMatchObject({ status: 'none', pick: null });
    expect(judge(src('晴天', ['周杰伦']), [])).toMatchObject({ status: 'none' });
  });
});

describe('matchTrack', () => {
  it('一般搜索就找到：不用多问', async () => {
    const netease = { searchSongs: vi.fn(async () => [song(1, '晴天', '周杰伦')]), hiddenSongs: vi.fn(async () => []) };
    expect((await matchTrack(src('晴天', ['周杰伦']), netease)).status).toBe('ok');
    expect(netease.hiddenSongs).not.toHaveBeenCalled();
  });

  it('搜索只有翻唱：问被藏起来的原唱', async () => {
    const netease = {
      searchSongs: vi.fn(async () => [song(9, '晴天', '翻唱的人', 200000, { originCoverType: 2 })]),
      hiddenSongs: vi.fn(async () => [song(186016, '晴天', '周杰伦', 200000, { privilege: { st: -200 } })]),
    };
    const r = await matchTrack(src('晴天', ['周杰伦']), netease);
    expect(r).toMatchObject({ status: 'ok' });
    expect(r.pick.id).toBe(186016);
  });

  it('搜索出错：当作找不到，不会整个停掉', async () => {
    const netease = { searchSongs: async () => { throw new Error('offline'); }, hiddenSongs: async () => { throw new Error('offline'); } };
    expect((await matchTrack(src('晴天', ['周杰伦']), netease)).status).toBe('none');
  });
});

describe('贴上的歌名清单', () => {
  it('一行一首，拿掉编号；「A - B」两种顺序都试', () => {
    const list = parseTextList('1. 晴天 - 周杰伦\n周杰伦 - 稻香\n\n• Housewife\nhttps://example.com');
    expect(list.map(t => [t.name, t.artists])).toEqual([
      ['晴天', ['周杰伦']],
      ['周杰伦', ['稻香']],
      ['Housewife', []],
    ]);
    // 「歌手 - 歌名」也配得到
    const r = judge(list[1], [song(1, '稻香', '周杰伦')]);
    expect(r.status).toBe('ok');
  });
});

describe('matchAll', () => {
  it('每首的结果都回报，同时最多几首', async () => {
    let running = 0;
    let most = 0;
    const netease = {
      searchSongs: async q => {
        running++;
        most = Math.max(most, running);
        await new Promise(r => setTimeout(r, 5));
        running--;
        return [song(q.length, q.split(' ')[0], q.split(' ')[1])];
      },
      hiddenSongs: async () => [],
    };
    const tracks = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map(n => src(n, ['x'], 0));
    const got = [];
    await matchAll(tracks, netease, (i, r) => got.push([i, r.status]), { concurrency: 2 });
    expect(got.map(g => g[0]).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(got.every(g => g[1] === 'ok')).toBe(true);
    expect(most).toBe(2);
  });
});
