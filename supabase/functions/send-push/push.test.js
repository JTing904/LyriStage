import { describe, expect, it } from 'vitest';
import { buildMessage, fcmMessage, isDeadToken, safeAvatar } from './index.ts';

const SUPABASE = 'https://abc.supabase.co';

describe('safeAvatar（通知右边的头像）', () => {
  it('只放 Supabase 上传的、GitHub、Google 的头像', () => {
    expect(safeAvatar(`${SUPABASE}/storage/v1/object/public/avatars/u1.jpg`, SUPABASE)).not.toBe('');
    expect(safeAvatar('https://avatars.githubusercontent.com/u/1', SUPABASE)).not.toBe('');
    expect(safeAvatar('https://lh3.googleusercontent.com/a/x', SUPABASE)).not.toBe('');
  });
  it('其他网站、http、乱写的都不放', () => {
    expect(safeAvatar('https://evil.example/track.png', SUPABASE)).toBe('');
    expect(safeAvatar(`${SUPABASE}/storage/v1/object/public/other/x.jpg`, SUPABASE)).toBe('');
    expect(safeAvatar('http://avatars.githubusercontent.com/u/1', SUPABASE)).toBe('');
    expect(safeAvatar(null, SUPABASE)).toBe('');
  });
});

describe('fcmMessage', () => {
  it('只送资料（App 自己显示通知），高优先；不安全的头像拿掉', () => {
    const m = fcmMessage('tok', 'reaction', { from: 'u2', avatar: 'https://evil.example/a.png' }, { title: 'T', body: 'B', url: '#/friends' }, SUPABASE);
    expect(m.notification).toBeUndefined();
    expect(m.android.priority).toBe('high');
    expect(m.data).toEqual({ title: 'T', body: 'B', url: '#/friends', kind: 'reaction', sender: 'u2', avatar: '' });
    // FCM 保留的 key 不能出现
    expect(Object.keys(m.data).some(k => k === 'from' || k.startsWith('google.') || k.startsWith('gcm.'))).toBe(false);
  });
});

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
    expect(isDeadToken(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } })).toBe(true);
    // 内容格式不对（例如用了保留的 key）：不是手机的问题，不能删
    expect(isDeadToken(400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid data payload key: from' } })).toBe(false);
    expect(isDeadToken(404, { error: { details: [{ errorCode: 'UNREGISTERED' }] } })).toBe(true);
    expect(isDeadToken(500, { error: { status: 'INTERNAL' } })).toBe(false);
    expect(isDeadToken(429, null)).toBe(false);
  });
});
