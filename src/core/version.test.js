import { describe, it, expect } from 'vitest';
import { isNewerVersion } from './version';

describe('isNewerVersion', () => {
  it('逐段比数字，不是比字符串', () => {
    expect(isNewerVersion('2.1.10', '2.1.9')).toBe(true);
    expect(isNewerVersion('2.2.0', '2.1.9')).toBe(true);
    expect(isNewerVersion('3.0', '2.9.9')).toBe(true);
  });
  it('一样或比较旧：false', () => {
    expect(isNewerVersion('2.1.1', '2.1.1')).toBe(false);
    expect(isNewerVersion('2.1.0', '2.1.1')).toBe(false);
    expect(isNewerVersion('2.1', '2.1.0')).toBe(false);
  });
  it('GitHub 的 tag 前面有 v', () => {
    expect(isNewerVersion('v2.1.2', '2.1.1')).toBe(true);
  });
  it('乱七八糟的输入不会当成新版本', () => {
    expect(isNewerVersion('', '2.1.1')).toBe(false);
    expect(isNewerVersion(undefined, '2.1.1')).toBe(false);
  });
});
