import { describe, it, expect } from 'vitest';
import {
  parseLrc,
  parseYrc,
  splitWords,
  estimateWords,
  buildLyrics,
  findLineIndex,
  wordProgress,
} from './index';
import { classifyInfoLine, parseJsonCredits } from './credits';

// 测试用歌词都是编的，只模仿网易云的格式
const CREDIT_JSON = [
  '{"t":0,"c":[{"tx":"作词: "},{"tx":"小明"}]}',
  '{"t":1000,"c":[{"tx":"作曲: "},{"tx":"小红","li":"http://x/y.jpg"}]}',
].join('\n');

describe('parseLrc', () => {
  it('[offset:] 整体调整时间：正数是歌词提早出现', () => {
    expect(parseLrc('[offset:+500]\n[00:02.00]a\n[00:00.20]b').map(l => l.time)).toEqual([0, 1500]);
    expect(parseLrc('[offset:-300]\n[00:01.00]a').map(l => l.time)).toEqual([1300]);
  });

  it('毫秒按实际位数换算（修正 v1 把 .5 当成 50 毫秒的问题）', () => {
    const lines = parseLrc('[00:01.5]a\n[00:02.50]b\n[00:03.500]c\n[01:04]d');
    expect(lines.map(l => l.time)).toEqual([1500, 2500, 3500, 64000]);
  });

  it('一行多个时间戳会展开，结果按时间排序', () => {
    const lines = parseLrc('[00:10.00][00:30.00]副歌\n[00:20.00]主歌');
    expect(lines).toEqual([
      { time: 10000, text: '副歌' },
      { time: 20000, text: '主歌' },
      { time: 30000, text: '副歌' },
    ]);
  });

  it('保留空行（间奏），忽略 [by:] 标签和 JSON 信息行', () => {
    const lines = parseLrc(
      `${CREDIT_JSON}\n[by:someone]\n[00:01.00]一\n[00:05.00]\n[00:09.00]二`
    );
    expect(lines).toEqual([
      { time: 1000, text: '一' },
      { time: 5000, text: '' },
      { time: 9000, text: '二' },
    ]);
  });
});

describe('parseYrc', () => {
  it('解析行和每个字的时间（字的时间是整首歌的绝对时间）', () => {
    const [line] = parseYrc(
      '[1000,900](1000,300,0)你(1300,300,0)好(1600,300,0)呀'
    );
    expect(line).toEqual({
      start: 1000,
      duration: 900,
      words: [
        { text: '你', start: 1000, duration: 300 },
        { text: '好', start: 1300, duration: 300 },
        { text: '呀', start: 1600, duration: 300 },
      ],
    });
  });

  it('保留英文词后面的空格，跳过 JSON 信息行', () => {
    const lines = parseYrc(
      `${CREDIT_JSON}\n[0,1000](0,500,0)Hello (500,500,0)world`
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].words.map(w => w.text)).toEqual(['Hello ', 'world']);
  });

  it('字里有括号不会被截掉', () => {
    const [line] = parseYrc(
      '[0,1500](0,500,0)Baby (500,500,0)(Oh) (1000,500,0)yeah(ah)'
    );
    expect(line.words.map(w => w.text)).toEqual(['Baby ', '(Oh) ', 'yeah(ah)']);
  });
});

describe('作词作曲和版权声明', () => {
  it('解析 JSON 信息行', () => {
    expect(parseJsonCredits(CREDIT_JSON)).toEqual([
      { role: '作词', names: '小明' },
      { role: '作曲', names: '小红' },
    ]);
  });

  it.each([
    ['词版权管理方：某某传媒有限公司', 'credit'],
    ['作词 / 作曲 : 小明', 'credit'],
    ['Produced by: Someone', 'credit'],
    ['录音作品及MV版权：某某 LTD', 'credit'],
    ['联合出品：甲公司/乙公司', 'credit'],
    ['出品监制：张三 李四', 'credit'],
    ['未经著作权人书面许可，严禁以任何方式使用', 'notice'],
    ['我说：今天的风好大', null], // 普通歌词里也会有冒号
    ['Speak: hello', null], // 不能因为开头像 "SP" 就当成信息
    ['不用再怕天黑', null],
  ])('%s → %s', (text, kind) => {
    expect(classifyInfoLine(text)).toBe(kind);
  });
});

describe('splitWords', () => {
  it.each([
    ['不用再怕天黑', ['不', '用', '再', '怕', '天', '黑']],
    ['Hello, 世界!', ['Hello, ', '世', '界!']],
    ['「再见」只有一句', ['「再', '见」', '只', '有', '一', '句']],
    ["don't stop me now", ["don't ", 'stop ', 'me ', 'now']],
    ['夜に駆ける', ['夜', 'に', '駆', 'け', 'る']],
    ['……', ['……']],
  ])('%s', (text, expected) => {
    const tokens = splitWords(text);
    expect(tokens).toEqual(expected);
    expect(tokens.join('')).toBe(text); // 拼回去和原文一样
  });
});

describe('estimateWords', () => {
  it('时间连续、不重叠，从行开始算起', () => {
    const words = estimateWords('不用再怕天黑', 10000, 12000);
    expect(words[0].start).toBe(10000);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].start).toBe(words[i - 1].start + words[i - 1].duration);
    }
  });

  it('下一行隔很久时，不会把停顿也平均分进去（按每字约 0.32 秒估算）', () => {
    const words = estimateWords('不用再怕天黑', 0, 20000);
    const total = words.reduce((sum, w) => sum + w.duration, 0);
    expect(total).toBe(6 * 320);
  });

  it('两行很近时，最多用到间隔的 85%，最后一个字不会拖到下一行', () => {
    const words = estimateWords('有你爱就明媚', 0, 1000);
    const last = words[words.length - 1];
    expect(last.start + last.duration).toBeLessThanOrEqual(850);
  });

  it('长英文词比短词分到的时间多', () => {
    const [long, short] = estimateWords('beautiful me', 0, 3000);
    expect(long.duration).toBeGreaterThan(short.duration);
  });
});

describe('buildLyrics', () => {
  const lrc = [
    CREDIT_JSON,
    '[00:01.00]词版权管理方：某某传媒',
    '[00:02.00]未经著作权人书面许可，严禁翻唱',
    '[00:10.00]第一句',
    '[00:14.00]第二句',
    '[00:18.00]',
    '[00:30.00]第三句',
  ].join('\n');

  it('只有普通歌词：作词作曲 / 版权声明分出去，逐字时间按字数估算', () => {
    const lyrics = buildLyrics({ lrc }, { durationMs: 40000 });
    expect(lyrics.lines.map(l => l.text)).toEqual([
      '第一句',
      '第二句',
      '第三句',
    ]);
    expect(lyrics.credits.map(c => c.role)).toEqual([
      '作词',
      '作曲',
      '词版权管理方',
    ]);
    expect(lyrics.notices).toHaveLength(1);
    expect(lyrics.hasWordTiming).toBe(false);
    expect(lyrics.lines[0].timing).toBe('estimated');
    // 第二句在空行（间奏）处结束，不会拖到第三句
    expect(lyrics.lines[1].end).toBe(18000);
    // 最后一行用歌曲时长当结束时间
    expect(lyrics.lines[2].end).toBe(40000);
  });

  it('有逐字歌词时优先用逐字歌词', () => {
    const yrc = '[10050,1500](10050,500,0)第(10550,500,0)一(11050,500,0)句';
    const lyrics = buildLyrics({ lrc, yrc });
    expect(lyrics.hasWordTiming).toBe(true);
    expect(lyrics.lines[0]).toMatchObject({
      start: 10050,
      end: 11550,
      text: '第一句',
      timing: 'word',
    });
  });

  it('翻译按最接近的时间挂上（允许和逐字歌词差几百毫秒），空翻译忽略', () => {
    const yrc = [
      '[10300,1000](10300,1000,0)Hi',
      '[14200,1000](14200,1000,0)Bye',
    ].join('\n');
    const translation = '[00:10.00]你好\n[00:14.00]\n[00:30.00]用不到';
    const lyrics = buildLyrics({ lrc, yrc, translation });
    expect(lyrics.lines.map(l => l.translation)).toEqual(['你好', null]);
    expect(lyrics.hasTranslation).toBe(true);
  });

  it('翻译全是空行时 hasTranslation 为 false（有的歌 tlyric 只有时间戳）', () => {
    const lyrics = buildLyrics({ lrc, translation: '[00:10.00]\n[00:14.00]' });
    expect(lyrics.hasTranslation).toBe(false);
  });

  it('和原文一样的"翻译"不显示', () => {
    const lyrics = buildLyrics({ lrc, translation: '[00:10.00]第一句' });
    expect(lyrics.lines[0].translation).toBeNull();
  });

  it('纯音乐', () => {
    const lyrics = buildLyrics({ lrc: '[00:00.00]纯音乐，请欣赏' });
    expect(lyrics.instrumental).toBe(true);
  });
});

describe('findLineIndex / wordProgress', () => {
  const lines = [{ start: 1000 }, { start: 5000 }, { start: 9000 }];

  it.each([
    [0, -1],
    [1000, 0],
    [4999, 0],
    [5000, 1],
    [100000, 2],
  ])('%i 毫秒 → 第 %i 行', (time, index) => {
    expect(findLineIndex(lines, time)).toBe(index);
  });

  it('空数组', () => {
    expect(findLineIndex([], 1000)).toBe(-1);
  });

  it('wordProgress 限制在 0 到 1 之间', () => {
    const word = { text: '字', start: 1000, duration: 400 };
    expect(wordProgress(word, 500)).toBe(0);
    expect(wordProgress(word, 1200)).toBe(0.5);
    expect(wordProgress(word, 9999)).toBe(1);
  });
});
