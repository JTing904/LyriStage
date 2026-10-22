import { describe, expect, it } from 'vitest';
import { buildArchive, containsAll, gunzipJson, gzipJson } from './index.ts';

const month = (m, id, plays) => ({
  user_id: 'u1',
  month: m,
  source: 'netease',
  track_id: String(id),
  track: { id, name: `歌${id}` },
  plays,
  skips: 0,
  listened_seconds: plays * 200,
});
const hour = (m, h, seconds) => ({ user_id: 'u1', month: m, hour: h, seconds });

describe('buildArchive', () => {
  it('第一次：放进这些行，不带 user_id（文件路径已经是这个人的）', () => {
    const a = buildArchive(null, [month('2024-02-01', 1, 3)], [hour('2024-02-01', 22, 600)], { userId: 'u1', year: 2024 });
    expect(a.year).toBe(2024);
    expect(a.months).toHaveLength(1);
    expect(a.months[0].user_id).toBeUndefined();
    expect(a.hours[0]).toEqual({ month: '2024-02-01', hour: 22, seconds: 600 });
  });

  it('同一年下个月再搬：合并进同一个文件，按月份排好', () => {
    const first = buildArchive(null, [month('2024-03-01', 1, 3)], [], { userId: 'u1', year: 2024 });
    const second = buildArchive(first, [month('2024-01-01', 2, 5)], [hour('2024-01-01', 8, 60)], { userId: 'u1', year: 2024 });
    expect(second.months.map(r => r.month)).toEqual(['2024-01-01', '2024-03-01']);
    expect(second.hours).toHaveLength(1);
  });

  it('上次存好了但没删成功、这次重跑：同一行取代，不会算两次', () => {
    const first = buildArchive(null, [month('2024-03-01', 1, 3)], [hour('2024-03-01', 9, 100)], { userId: 'u1', year: 2024 });
    const again = buildArchive(first, [month('2024-03-01', 1, 3)], [hour('2024-03-01', 9, 100)], { userId: 'u1', year: 2024 });
    expect(again.months).toHaveLength(1);
    expect(again.months[0].plays).toBe(3);
    expect(again.hours).toHaveLength(1);
  });
});

describe('containsAll', () => {
  it('存好的文件里都有才算', () => {
    const rows = [month('2024-03-01', 1, 3)];
    const a = buildArchive(null, rows, [], { userId: 'u1', year: 2024 });
    expect(containsAll(a, rows, [])).toBe(true);
    expect(containsAll(a, [month('2024-03-01', 1, 4)], [])).toBe(false);
    expect(containsAll(a, rows, [hour('2024-03-01', 1, 5)])).toBe(false);
  });
});

describe('gzip', () => {
  it('压缩再解压回来一样，而且比较小', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => month('2024-05-01', i, i % 7));
    const a = buildArchive(null, rows, [], { userId: 'u1', year: 2024 });
    const bytes = await gzipJson(a);
    expect(bytes.length).toBeLessThan(JSON.stringify(a).length / 3);
    expect(await gunzipJson(new Blob([bytes]))).toEqual(a);
  });
});
