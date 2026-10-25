import { describe, expect, it } from 'vitest';
import { romanizeKorean } from './korean';

describe('romanizeKorean', () => {
  it('基本：一个字一个字拼', () => {
    expect(romanizeKorean('사랑해')).toBe('saranghae');
    expect(romanizeKorean('안녕하세요')).toBe('annyeonghaseyo');
    expect(romanizeKorean('너무 보고 싶어')).toBe('neomu bogo sipeo');
  });

  it('连音：받침接 ㅇ 移到下一字', () => {
    expect(romanizeKorean('밤에')).toBe('bame');
    expect(romanizeKorean('밤편지')).toBe('bampyeonji');
    expect(romanizeKorean('음악')).toBe('eumak');
  });

  it('鼻音化、流音化', () => {
    expect(romanizeKorean('입니다')).toBe('imnida');
    expect(romanizeKorean('국물')).toBe('gungmul');
    expect(romanizeKorean('신라')).toBe('silla');
    expect(romanizeKorean('설날')).toBe('seollal');
  });

  it('ㅎ 接 ㄱ/ㄷ/ㅈ 送气', () => {
    expect(romanizeKorean('좋고')).toBe('joko');
  });

  it('英文、标点原样；没有韩文回传空的', () => {
    expect(romanizeKorean('Love wins all 사랑')).toBe('Love wins all sarang');
    expect(romanizeKorean('Hello')).toBe('');
    expect(romanizeKorean('你好')).toBe('');
  });
});
