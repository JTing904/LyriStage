import { describe, expect, it } from 'vitest';
import { BANDS, MAX_DB, PRESETS, headroomDb, matchPreset, normalizeEqSettings } from './equalizer';

describe('均衡器预设', () => {
  it('每个预设都是 10 个频段，而且在范围内', () => {
    for (const p of PRESETS) {
      expect(p.gains).toHaveLength(BANDS.length);
      for (const g of p.gains) expect(Math.abs(g)).toBeLessThanOrEqual(MAX_DB);
    }
  });

  it('认得出预设，自己调过的是自定义', () => {
    expect(matchPreset(PRESETS[3].gains)).toBe('bass');
    expect(matchPreset([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe('flat');
    expect(matchPreset([6, 5, 4, 2, 0, 0, 0, 0, 0, 1])).toBeNull();
  });
});

describe('headroomDb', () => {
  it('加大最多的频段加多少，整体就先调小多少', () => {
    expect(headroomDb([6, 5, 4, 2, 0, 0, 0, 0, 0, 0])).toBe(-6);
  });
  it('只有调小的时候不用衰减', () => {
    expect(headroomDb([0, -3, -5, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });
});

describe('normalizeEqSettings', () => {
  it('没有设定：关闭、全部 0', () => {
    expect(normalizeEqSettings(null)).toEqual({
      enabled: false,
      gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      leveler: false,
    });
  });

  it('坏掉的数值修正回范围内', () => {
    const s = normalizeEqSettings({ enabled: true, gains: [99, -99, 'x', 2.6], leveler: 'yes' });
    expect(s.enabled).toBe(true);
    expect(s.gains.slice(0, 5)).toEqual([12, -12, 0, 3, 0]);
    expect(s.gains).toHaveLength(10);
    expect(s.leveler).toBe(false);
  });
});
