import { describe, it, expect } from 'vitest';
import { pickVideo, parseDuration } from './bilibili';

// 2026-10 在 B 站搜到的真实结果（只留用得到的字段）
const v = (bvid, duration, play, author, title) => ({ bvid, duration, play, author, title });

describe('parseDuration', () => {
  it('分:秒、时:分:秒，格式不对是 NaN', () => {
    expect(parseDuration('4:24')).toBe(264);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('')).toBeNaN();
    expect(parseDuration('abc')).toBeNaN();
  });
});

describe('pickVideo', () => {
  it('晴天：跳过 5:17 的 MV（前面有剧情），选时长对得上、播放量最高的', () => {
    const results = [
      v('BV1', '5:17', 17636310, 'zyl2012_音乐无限', '【4K修复】周杰伦 - <em class="keyword">晴天</em>MV 2160P修复版'),
      v('BV2', '4:30', 3278843, 'VV音乐局', '【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《晴天》- 周杰伦 -‘故事的小黄花’'),
      v('BV3', '', 33886, '梦露piano', '《晴天》周杰伦-钢琴教程（4/5级）'),
      v('BV4', '4:29', 106, '阿忆octer', '【日推歌单】｜《晴天》“刮风这天我试过握着你手”'),
      v('BV5', '4:30', 1147328, '如歌如梦', '【4K Hi-Res】晴天-周杰伦'),
    ];
    const picked = pickVideo(results, { name: '晴天', artists: ['周杰伦'], durationMs: 269000 });
    expect(picked.bvid).toBe('BV2');
  });

  it('Die For You：排除翻唱、巡演现场、30 秒弹唱', () => {
    const results = [
      v('BV1', '4:24', 8067473, 'JLRS日落fm', '用百万级豪华装备试听The Weeknd《Die For You》【Hi-Res】'),
      v('BV2', '4:46', 35, 'Yahwwww', '【The Weeknd 盆栽】Die For You【2026巡演首尔站】'),
      v('BV3', '3:43', 215, '毫米教学', '【欧美翻唱】吉他男孩深情翻唱The Weeknd &amp; Ariana Grande 的《Die'),
      v('BV4', '0:30', 290, '山田武de卡拉OK', '【音乐 】吉他弹唱die for you - the weeknd'),
    ];
    const picked = pickVideo(results, { name: 'Die For You', artists: ['The Weeknd'], durationMs: 260000 });
    expect(picked.bvid).toBe('BV1');
  });

  it('伴奏、扒谱的时长再接近也不选', () => {
    const results = [
      v('BV1', '3:15', 1380, '打拳伴奏工作室', 'Gareth.T《国际孤独等级》高质量纯伴奏'),
      v('BV2', '3:14', 147955, 'VV音乐局', '【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《国际孤独等级》- Gareth.T'),
      v('BV3', '3:13', 122, '卡拉king', 'Gareth.T_汤令山 国际孤独等级 伴奏 原版伴奏 高音质 欣赏'),
    ];
    const picked = pickVideo(results, { name: '国际孤独等级', artists: ['Gareth.T'], durationMs: 194000 });
    expect(picked.bvid).toBe('BV2');
  });

  it('歌名本身有 Live / Remix 之类的字眼，不会被当成非原曲', () => {
    const results = [v('BV1', '3:00', 10, 'x', 'Live Forever - Oasis')];
    expect(pickVideo(results, { name: 'Live Forever', artists: ['Oasis'], durationMs: 180000 })?.bvid).toBe('BV1');
  });

  it('同样像原曲时，标题或 UP 主有歌手名的优先', () => {
    const results = [
      v('BV1', '4:00', 9999, 'a', '孤勇者 无损音质'),
      v('BV2', '4:01', 100, 'b', '孤勇者 - 陈奕迅'),
    ];
    expect(pickVideo(results, { name: '孤勇者', artists: ['陈奕迅'], durationMs: 240000 }).bvid).toBe('BV2');
  });

  it('时长几乎一样的优先，就算播放量比较少（歌词才对得准）', () => {
    const results = [
      v('BV1', '4:35', 900000, 'a', '孤勇者 - 陈奕迅 无损'),
      v('BV2', '4:31', 20000, 'b', '孤勇者 - 陈奕迅'),
    ];
    expect(pickVideo(results, { name: '孤勇者', artists: ['陈奕迅'], durationMs: 270000 }).bvid).toBe('BV2');
  });

  it('没有一个像原曲就返回 null（宁可不播也不要播错歌）', () => {
    const results = [v('BV1', '5:17', 100, 'a', '晴天 MV'), v('BV2', '4:30', 100, 'b', '雨天 - 周杰伦')];
    expect(pickVideo(results, { name: '晴天', artists: ['周杰伦'], durationMs: 269000 })).toBeNull();
  });
});
