import { describe, expect, it } from 'vitest';
import { errorKind } from './errorKind';
import { ApiError } from './client';

describe('errorKind', () => {
  it('没有网络', () => {
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('offline');
    expect(errorKind({ message: 'TypeError: NetworkError when attempting to fetch resource.' })).toBe('offline');
    expect(errorKind(new TypeError('Load failed'))).toBe('offline');
  });

  it('服务器忙', () => {
    expect(errorKind(new ApiError('HTTP 502', { status: 502, url: '/x' }))).toBe('busy');
    expect(errorKind({ message: 'Gateway Timeout' })).toBe('busy');
    expect(errorKind({ message: 'request timed out' })).toBe('busy');
  });

  it('太多次', () => {
    expect(errorKind(new ApiError('HTTP 429', { status: 429, url: '/x' }))).toBe('limit');
    expect(errorKind({ code: '54000', message: '太多次了' })).toBe('limit');
    expect(errorKind({ message: 'Email rate limit exceeded' })).toBe('limit');
  });

  it('登录过期', () => {
    expect(errorKind({ message: 'JWT expired', code: 'PGRST301' })).toBe('auth');
    expect(errorKind(new ApiError('Unauthorized', { status: 401, url: '/x' }))).toBe('auth');
    expect(errorKind({ message: 'Invalid Refresh Token: Refresh Token Not Found' })).toBe('auth');
  });

  it('用户自己取消（分享面板按返回）', () => {
    expect(errorKind(new DOMException('Share canceled', 'AbortError'))).toBe('cancel');
    expect(errorKind({ message: 'Share canceled' })).toBe('cancel');
  });

  it('其他', () => {
    expect(errorKind(new SyntaxError('Unexpected token < in JSON at position 0'))).toBe('other');
    expect(errorKind({ message: 'duplicate key value violates unique constraint', code: '23505' })).toBe('other');
    expect(errorKind('奇怪的字串')).toBe('other');
    expect(errorKind(null)).toBe('other');
  });
});
