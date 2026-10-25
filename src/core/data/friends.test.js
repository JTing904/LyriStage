import { describe, expect, it } from 'vitest';
import { firstEmoji, isEmoji } from './friends';

describe('isEmoji（跟数据库 friend_reactions 的检查一样）', () => {
  it('什么表情都可以：肤色、组合表情、国旗、旧的符号表情', () => {
    for (const e of ['😍', '👍🏽', '❤️‍🔥', '🇲🇾', '👨‍👩‍👧', '✨', '☕', '❤️']) expect(isEmoji(e)).toBe(true);
  });

  it('文字、网址、空的都不行', () => {
    for (const s of ['hi', '好', 'https://x.co', '😀 hi', '', null]) expect(isEmoji(s)).toBe(false);
  });
});

describe('firstEmoji', () => {
  it('拿出第一个完整的表情（组合表情不会被切开）', () => {
    expect(firstEmoji('❤️‍🔥😂')).toBe('❤️‍🔥');
    expect(firstEmoji('👍🏽')).toBe('👍🏽');
  });

  it('前面有字就跳过，没有表情就是空的', () => {
    expect(firstEmoji('好 😭')).toBe('😭');
    expect(firstEmoji('hello')).toBe('');
  });
});
