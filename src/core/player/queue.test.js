import { describe, it, expect } from 'vitest';
import { Queue } from './queue';
import { createRng } from '../recommend/engine';

const tracks = [1, 2, 3, 4, 5].map(id => ({ id }));
const ids = list => list.map(t => t?.id ?? null);

function playAll(queue, { auto = true, max = 20 } = {}) {
  const played = [queue.current?.id];
  for (let i = 0; i < max; i++) {
    const t = queue.next({ auto });
    if (!t) break;
    played.push(t.id);
  }
  return played;
}

describe('Queue 顺序播放', () => {
  it('从指定位置开始，播完停止', () => {
    const q = new Queue();
    q.setTracks(tracks, 2);
    expect(playAll(q)).toEqual([3, 4, 5]);
    expect(q.next({ auto: true })).toBeNull();
  });

  it('列表循环会回到第一首', () => {
    const q = new Queue();
    q.setTracks(tracks, 3);
    q.setRepeat('all');
    expect(playAll(q, { max: 4 })).toEqual([4, 5, 1, 2, 3]);
  });

  it('单曲循环：自然播完重播；手动点下一首照常切歌', () => {
    const q = new Queue();
    q.setTracks(tracks, 0);
    q.setRepeat('one');
    expect(q.next({ auto: true }).id).toBe(1);
    expect(q.next({ auto: false }).id).toBe(2);
  });

  it('上一首：第一首时没开循环停在第一首，开了循环到最后一首（修正 v1 的 bug）', () => {
    const q = new Queue();
    q.setTracks(tracks, 0);
    expect(q.prev().id).toBe(1);
    q.setRepeat('all');
    expect(q.prev().id).toBe(5);
    expect(q.prev().id).toBe(4);
  });

  it('jumpTo 跳到列表里的某一首', () => {
    const q = new Queue();
    q.setTracks(tracks, 0);
    expect(q.jumpTo(3).id).toBe(4);
    expect(q.next().id).toBe(5);
  });
});

describe('Queue 随机播放', () => {
  it('开启随机后当前这首不变，每首都会播到且不重复', () => {
    const q = new Queue({ rng: createRng('test') });
    q.setTracks(tracks, 2);
    q.setShuffle(true);
    expect(q.current.id).toBe(3);
    const played = playAll(q);
    expect(played).toHaveLength(5);
    expect([...played].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('关闭随机后回到原本顺序，从当前这首继续', () => {
    const q = new Queue({ rng: createRng('test') });
    q.setTracks(tracks, 0);
    q.setShuffle(true);
    q.next();
    const now = q.current.id;
    q.setShuffle(false);
    expect(q.current.id).toBe(now);
    expect(playAll(q)).toEqual(tracks.map(t => t.id).slice(now - 1));
  });

  it('同一个种子打乱结果相同（方便测试和重现）', () => {
    const a = new Queue({ rng: createRng(1) });
    const b = new Queue({ rng: createRng(1) });
    a.shuffle = b.shuffle = true;
    a.setTracks(tracks, 0);
    b.setTracks(tracks, 0);
    expect(a.order).toEqual(b.order);
  });
});

describe('Queue 下一首播放 / 加入队列', () => {
  it('"下一首播放"插到最前面，"加入队列"排到后面，然后继续原列表', () => {
    const q = new Queue();
    q.setTracks(tracks, 0);
    q.addToQueue({ id: 'a' }); // v1 这里会因为 list.append 不存在而报错
    q.playNext({ id: 'b' });
    expect(ids(q.upcoming(4))).toEqual(['b', 'a', 2, 3]);
    expect(playAll(q)).toEqual([1, 'b', 'a', 2, 3, 4, 5]);
  });

  it('播放插队歌曲时按上一首，回到插队前那首', () => {
    const q = new Queue();
    q.setTracks(tracks, 1);
    q.playNext({ id: 'x' });
    expect(q.next().id).toBe('x');
    expect(q.prev().id).toBe(2);
    expect(q.next().id).toBe(3);
  });
});

describe('Queue 保存 / 恢复', () => {
  it('toJSON → restore 后状态相同', () => {
    const q = new Queue({ rng: createRng(5) });
    q.setTracks(tracks, 1);
    q.setShuffle(true);
    q.setRepeat('all');
    q.addToQueue({ id: 'z' });
    const copy = new Queue();
    copy.restore(JSON.parse(JSON.stringify(q)));
    expect(copy.current).toEqual(q.current);
    expect(ids(copy.upcoming())).toEqual(ids(q.upcoming()));
    expect(copy.repeat).toBe('all');
  });

  it('坏数据不会弄坏队列', () => {
    const q = new Queue();
    q.setTracks(tracks, 0);
    q.restore({ tracks: [{ id: 1 }], order: [] });
    q.restore(null);
    expect(q.current.id).toBe(1);
    expect(q.tracks).toHaveLength(5);
  });

  it('空列表', () => {
    const q = new Queue();
    q.setTracks([]);
    expect(q.current).toBeNull();
    expect(q.next()).toBeNull();
    expect(q.prev()).toBeNull();
  });
});
