import { describe, expect, it } from 'vitest';
import { buildMessage, isDeadToken } from './index.ts';

describe('buildMessage', () => {
  it('表情回应：便签和正在听的歌写法不一样', () => {
    expect(buildMessage('reaction', { name: 'Ivy', emoji: '❤️', target: 'note', context: '今天只想听慢歌' }, 'zh-CN')).toEqual({
      title: 'Ivy 回应了你 ❤️',
      body: '你的便签「今天只想听慢歌」',
      url: '#/friends',
    });
    expect(buildMessage('reaction', { name: 'Ivy', emoji: '🔥', target: 'listening', context: '晴天' }, 'en').body).toBe(
      '"晴天", which you were playing'
    );
  });

  it('好友邀请、同意、敲门；敲门点了打开一起听', () => {
    expect(buildMessage('friend_request', { name: 'Bob' }, 'zh-CN').body).toBe('Bob 想加你为好友');
    expect(buildMessage('friend_accepted', { name: 'Bob' }, 'en').title).toBe('Bob accepted your friend request');
    expect(buildMessage('knock', { name: '小明' }, 'zh-CN')).toMatchObject({ title: '小明 想加入你的房间', url: '#/room' });
  });

  it('不认识的语言用中文，不认识的种类不送', () => {
    expect(buildMessage('friend_request', { name: 'A' }, 'fr').title).toBe('新的好友邀请');
    expect(buildMessage('hack', {}, 'zh-CN')).toBeNull();
  });

  it('名字太长会截掉', () => {
    expect(buildMessage('knock', { name: 'x'.repeat(200) }, 'en').title.length).toBeLessThan(120);
  });
});

describe('isDeadToken', () => {
  it('App 删掉了（UNREGISTERED、404）要删代号；其他错误不删', () => {
    expect(isDeadToken(404, null)).toBe(true);
    expect(isDeadToken(400, { error: { status: 'INVALID_ARGUMENT' } })).toBe(true);
    expect(isDeadToken(404, { error: { details: [{ errorCode: 'UNREGISTERED' }] } })).toBe(true);
    expect(isDeadToken(500, { error: { status: 'INTERNAL' } })).toBe(false);
    expect(isDeadToken(429, null)).toBe(false);
  });
});
