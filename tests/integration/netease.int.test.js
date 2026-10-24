// 集成测试：用真实的网易云 API 验证 core（需要网络和本地 API）
// 先启动 API（npm run dev 会在 10754 启动；或 npm run api:dev 在 3001），再运行：
//   npm run test:integration
//   API_BASE=http://127.0.0.1:3001 npm run test:integration
import { describe, it, expect } from 'vitest';
import { createHttp } from '@core/http/client';
import { createNetease } from '@core/netease';
import { buildLyrics, findLineIndex } from '@core/lyrics';
import { gatherCandidates } from '@core/recommend';
import {
  computeArtistAffinity,
  pickSeeds,
  rankCandidates,
  createRng,
} from '@core/recommend/engine';

const netease = createNetease(
  createHttp({ baseURL: process.env.API_BASE || 'http://127.0.0.1:10754' })
);

// 测试用歌曲（2026-10 在马来西亚验证过的情况）
const SONG = {
  plain: 3445595679, // 有你爱就明媚：只有普通歌词，不登录能播 320k
  wordTimed: 1901371647, // 孤勇者：有逐字歌词
  translated: 1409311773, // 夜に駆ける：有翻译和罗马音
  blocked: 186016, // 晴天：网易云拿不到链接
};

describe('网易云接口', () => {
  it('搜索歌曲 / 歌手 / 歌单', async () => {
    const [song] = await netease.searchSongs('有你爱就明媚 fozik', {
      limit: 1,
    });
    expect(song).toMatchObject({
      id: SONG.plain,
      ar: [{ name: 'Fozik佛子克' }],
    });
    expect(
      (await netease.search('周杰伦', { type: 'artist', limit: 1 }))[0].id
    ).toBe(6452);
    expect(
      await netease.search('周杰伦', { type: 'playlist', limit: 3 })
    ).toHaveLength(3);
  });

  it('播放链接：能播的是 https；拿不到的返回 null', async () => {
    const source = await netease.songUrl(SONG.plain);
    expect(source.url).toMatch(/^https:\/\//);
    expect(await netease.songUrl(SONG.blocked)).toBeNull();
  });

  it('歌曲详情、歌单、专辑、歌手', async () => {
    const [detail] = await netease.songDetails([SONG.plain]);
    expect(detail.name).toBe('有你爱就明媚');

    const [playlist] = await netease.similarPlaylists(SONG.blocked);
    const tracks = await netease.playlistTracks(playlist.id, 5);
    expect(tracks.length).toBeGreaterThan(0);
    expect((await netease.playlist(playlist.id)).id).toBe(playlist.id);

    const { album, songs } = await netease.album(detail.al.id);
    expect(album.id).toBe(detail.al.id);
    expect(songs.some(s => s.id === SONG.plain)).toBe(true);

    const { artist, hotSongs } = await netease.artist(6452);
    expect(artist.name).toBe('周杰伦');
    expect(hotSongs.length).toBeGreaterThan(10);
    expect((await netease.artistAlbums(6452, { limit: 3 })).length).toBe(3);
    expect((await netease.artistTopSongs(6452)).length).toBeGreaterThan(10);
  });

  it('发现页：排行榜、推荐歌单、新歌、匿名推荐', async () => {
    expect((await netease.toplists()).length).toBeGreaterThan(5);
    expect((await netease.recommendedPlaylists(6)).length).toBe(6);
    const [newSong] = await netease.newSongs(3);
    expect(newSong).toHaveProperty('ar');
    expect((await netease.genericRecommendations()).length).toBeGreaterThan(10);
  });
});

describe('歌词（真实数据）', () => {
  it('只有普通歌词：版权声明分出去，逐字时间是估算的', async () => {
    const lyrics = buildLyrics(await netease.lyric(SONG.plain), {
      durationMs: 160000,
    });
    expect(lyrics.hasWordTiming).toBe(false);
    expect(lyrics.notices.length).toBeGreaterThan(0);
    expect(lyrics.lines[0].text).toBe('有你爱就明媚');
    expect(lyrics.lines[0].words.map(w => w.text).join('')).toBe(
      '有你爱就明媚'
    );
  });

  it('逐字歌词：正文从真正的歌词开始（作词作曲、版权方都分出去）', async () => {
    const lyrics = buildLyrics(await netease.lyric(SONG.wordTimed));
    expect(lyrics.hasWordTiming).toBe(true);
    expect(lyrics.lines[0].text).not.toMatch(/[:：]/);
    expect(lyrics.credits.some(c => c.role.includes('作词'))).toBe(true);
    const index = findLineIndex(lyrics.lines, lyrics.lines[3].start + 10);
    expect(index).toBe(3);
  });

  it('翻译和罗马音挂到对应的行', async () => {
    const lyrics = buildLyrics(await netease.lyric(SONG.translated));
    expect(lyrics.hasTranslation).toBe(true);
    expect(lyrics.hasRomaji).toBe(true);
    const translated = lyrics.lines.filter(l => l.translation).length;
    expect(translated / lyrics.lines.length).toBeGreaterThan(0.8);
  });
});

describe('推荐算法（真实数据）', () => {
  it('喜欢周杰伦 → 推荐 30 首，歌手多样', async () => {
    const liked = [{ id: SONG.blocked, ar: [{ id: 6452, name: '周杰伦' }] }];
    const affinity = computeArtistAffinity([], liked);
    const seeds = pickSeeds(affinity, [], liked);
    const candidates = await gatherCandidates(seeds, netease);
    const result = rankCandidates(candidates, {
      affinity,
      excludeIds: new Set([String(SONG.blocked)]),
      rng: createRng('integration'),
      count: 30,
    });
    expect(result).toHaveLength(30);
    const artists = new Set(result.map(s => s.ar[0].id));
    expect(artists.size).toBeGreaterThan(15);
  });
});
