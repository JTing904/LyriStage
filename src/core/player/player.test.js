import { describe, it, expect, vi } from 'vitest';
import { createPlayer } from './player';
import { Emitter } from './emitter';

/** 假的音频后端：可以手动"播放 n 秒"、"播完" */
function fakeAudio() {
  const events = new Emitter();
  let time = 0;
  let paused = true;
  const audio = {
    src: null,
    load: vi.fn(url => {
      audio.src = url;
      time = 0;
    }),
    play: vi.fn(async () => {
      paused = false;
      events.emit('playing');
    }),
    pause: vi.fn(() => {
      if (paused) return;
      paused = true;
      events.emit('pause');
    }),
    seek: vi.fn(seconds => {
      time = seconds;
    }),
    setVolume: vi.fn(),
    currentTime: () => time,
    duration: () => NaN,
    on: (event, fn) => events.on(event, fn),
    // 测试用 ------------------------------------------------
    /** 正常播放 seconds 秒（每秒一次 timeupdate） */
    tick(seconds) {
      for (let i = 0; i < seconds; i++) {
        time += 1;
        events.emit('timeupdate');
      }
    },
    /** 只发 timeupdate，时间不变（浏览器暂停时会补发一次） */
    timeupdate: () => events.emit('timeupdate'),
    end: () => events.emit('ended'),
    /** 音频加载失败（例如链接过期） */
    fail: () => events.emit('error'),
  };
  return audio;
}

const tracks = [1, 2, 3, 4].map(id => ({ id, name: `歌${id}`, dt: 200000 }));
const urlOf = id => `https://audio/${id}.mp3`;
const allPlayable = async track => ({
  url: urlOf(track.id),
  source: 'netease',
});

/** 等所有已排队的 Promise 跑完 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(resolveSource = allPlayable) {
  const audio = fakeAudio();
  const player = createPlayer({ audio, resolveSource });
  const played = [];
  const unplayable = [];
  player.on('played', e => played.push(e));
  player.on('unplayable', e => unplayable.push(e.track.id));
  return { audio, player, played, unplayable };
}

describe('player 基本播放', () => {
  it('playList 找到音源后开始播放', async () => {
    const { audio, player } = setup();
    await player.playList(tracks, 1, 'playlist:9');
    const state = player.getState();
    expect(state.track.id).toBe(2);
    expect(state.playing).toBe(true);
    expect(state.context).toBe('playlist:9');
    expect(audio.src).toBe(urlOf(2));
  });

  it('歌曲播完自动下一首，最后一首播完停在那首的开头', async () => {
    const { audio, player } = setup();
    await player.playList(tracks, 2);
    audio.end();
    await flush();
    expect(player.getState().track.id).toBe(4);
    audio.tick(30);
    audio.end();
    await flush();
    expect(player.getState()).toMatchObject({ track: { id: 4 }, playing: false, time: 0 });
    expect(audio.currentTime()).toBe(0);
    // 按播放可以再听一次，不会没反应
    await player.play();
    expect(player.getState().playing).toBe(true);
  });

  it('最后一首按下一首：留在这首，不会清空播放器', async () => {
    const { audio, player } = setup();
    await player.playList(tracks, 3);
    await player.next();
    expect(player.getState().track.id).toBe(4);
    expect(audio.src).toBe(urlOf(4));
  });

  it('上一首：播放超过 3 秒回到开头，否则切到上一首', async () => {
    const { audio, player } = setup();
    await player.playList(tracks, 2);
    audio.tick(10);
    await player.prev();
    expect(player.getState().track.id).toBe(3);
    expect(audio.currentTime()).toBe(0);
    await player.prev();
    expect(player.getState().track.id).toBe(2);
  });
});

describe('player 拿不到音源', () => {
  it('自动跳到下一首能播的歌', async () => {
    const { player, unplayable } = setup(async t =>
      t.id === 1 ? null : { url: urlOf(t.id) }
    );
    await player.playList(tracks, 0);
    expect(unplayable).toEqual([1]);
    expect(player.getState().track.id).toBe(2);
  });

  it('连续 3 首都播不了就停下，不会一直跳', async () => {
    const { player, unplayable } = setup(async () => null);
    await player.playList([...tracks, { id: 5 }, { id: 6 }], 0);
    expect(unplayable).toEqual([1, 2, 3]);
    expect(player.getState().playing).toBe(false);
  });

  it('网络出错（拿音源时抛错）不跳歌，停在这首；按播放会再试一次', async () => {
    let online = false;
    const { audio, player, unplayable } = setup(async t => {
      if (!online) throw new Error('network down');
      return { url: urlOf(t.id) };
    });
    const errors = [];
    player.on('error', e => errors.push(e.track.id));
    await player.playList(tracks, 0);
    expect(player.getState()).toMatchObject({ track: { id: 1 }, playing: false, loading: false });
    expect(unplayable).toEqual([]);
    expect(errors).toEqual([1]);
    online = true;
    await player.play();
    expect(player.getState()).toMatchObject({ track: { id: 1 }, playing: true });
    expect(audio.src).toBe(urlOf(1));
  });

  it('找音源时已经切到别的歌：旧结果被丢弃', async () => {
    let releaseFirst;
    const { audio, player } = setup(t =>
      t.id === 1
        ? new Promise(
            resolve => (releaseFirst = () => resolve({ url: urlOf(1) }))
          )
        : Promise.resolve({ url: urlOf(t.id) })
    );
    const first = player.playList(tracks, 0); // 第 1 首的音源还没回来
    await player.playIndex(2); // 用户马上点了第 3 首
    releaseFirst();
    await first;
    expect(player.getState().track.id).toBe(3);
    expect(audio.src).toBe(urlOf(3));
  });
});

describe('player 听歌统计（写听歌记录用）', () => {
  it('切歌时汇报实际听了多久', async () => {
    const { audio, player, played } = setup();
    await player.playList(tracks, 0, 'daily');
    audio.tick(42);
    await player.next();
    expect(played).toEqual([
      { track: tracks[0], listenedSeconds: 42, context: 'daily' },
    ]);
  });

  it('拖动进度条跳过去的时间不算', async () => {
    const { audio, player, played } = setup();
    await player.playList(tracks, 0);
    audio.tick(5);
    player.seek(150);
    audio.tick(3);
    await player.next();
    expect(played[0].listenedSeconds).toBe(8);
  });

  it('暂停期间不算，不到 1 秒不汇报', async () => {
    const { audio, player, played } = setup();
    await player.playList(tracks, 0);
    player.pause();
    audio.tick(30); // 暂停时不应该有 timeupdate，就算有也不算
    await player.next();
    expect(played).toEqual([]);
  });

  it('单曲循环：重播同一首，每一遍各汇报一次', async () => {
    const { audio, player, played } = setup();
    await player.playList(tracks, 0);
    player.setRepeat('one');
    audio.tick(20);
    audio.end();
    await flush();
    audio.tick(10);
    await player.next();
    expect(played.map(p => [p.track.id, p.listenedSeconds])).toEqual([
      [1, 20],
      [1, 10],
    ]);
  });
});

describe('player 播放链接过期', () => {
  it('链接拿到超过 10 分钟，按播放时先换新链接，从原来的位置接着播', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let version = 0;
      const { audio, player, played } = setup(async t => ({ url: `${urlOf(t.id)}?v=${++version}` }));
      await player.playList(tracks, 0);
      audio.tick(40);
      player.pause();
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      await player.play();
      expect(audio.src).toBe(`${urlOf(1)}?v=2`);
      expect(audio.seek).toHaveBeenLastCalledWith(40);
      expect(player.getState()).toMatchObject({ track: { id: 1 }, playing: true });
      expect(played).toEqual([]); // 同一首歌，不算换歌
    } finally {
      vi.useRealTimers();
    }
  });

  it('播放中音频出错：换一次链接接着播；换了还错就停下并报错', async () => {
    let version = 0;
    const { audio, player } = setup(async t => ({ url: `${urlOf(t.id)}?v=${++version}` }));
    const errors = [];
    player.on('error', e => errors.push(e));
    await player.playList(tracks, 0);
    audio.tick(25);
    // 之后的链接都播不出来（不会再有 playing 事件）
    audio.play.mockImplementation(async () => {});
    audio.fail();
    await flush();
    expect(audio.src).toBe(`${urlOf(1)}?v=2`);
    expect(audio.seek).toHaveBeenLastCalledWith(25);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([]);

    // 换完还是出错：不再重试
    audio.fail();
    await flush();
    expect(audio.src).toBe(`${urlOf(1)}?v=2`);
    expect(errors.length).toBe(1);
    expect(player.getState().playing).toBe(false);
  });
});

describe('player 载入中拖进度条', () => {
  it('还在找音源时拖了进度条：音源回来后从拖到的位置开始', async () => {
    let release;
    const { audio, player } = setup(t => new Promise(r => (release = () => r({ url: urlOf(t.id) }))));
    const loading = player.playList(tracks, 0);
    player.seek(42);
    release();
    await loading;
    expect(audio.seek).toHaveBeenLastCalledWith(42);
    expect(player.getState()).toMatchObject({ track: { id: 1 }, playing: true });
  });

  it('播到一半按下一首：上一首暂停时补发的时间不会带到新歌，新歌从 0 开始', async () => {
    let release = () => {};
    let slow = false;
    const { audio, player } = setup(t =>
      slow ? new Promise(r => (release = () => r({ url: urlOf(t.id) }))) : allPlayable(t)
    );
    await player.playList(tracks, 0);
    audio.tick(90);
    slow = true;
    const loading = player.next();
    audio.timeupdate(); // 上一首还在 audio 里，时间是 90
    expect(player.getState().time).toBe(0);
    release();
    await loading;
    expect(audio.src).toBe(urlOf(2));
    expect(audio.seek).not.toHaveBeenCalled();
    expect(player.getState().time).toBe(0);
  });
});

describe('player 私人 FM', () => {
  it('歌曲由 FM 一首一首提供；FM 模式没有上一首', async () => {
    const { audio, player } = setup();
    const fmTracks = [{ id: 'f1' }, { id: 'f2' }];
    const fm = { next: vi.fn(async () => [fmTracks.shift()].filter(Boolean)) };
    await player.playFm(fm);
    expect(player.getState()).toMatchObject({
      mode: 'fm',
      context: 'fm',
      track: { id: 'f1' },
    });
    audio.end();
    await flush();
    expect(player.getState().track.id).toBe('f2');
    await player.prev();
    expect(player.getState().track.id).toBe('f2');
  });
});

describe('player 保存 / 恢复', () => {
  it('恢复到上次的歌和进度，不自动播放', async () => {
    const first = setup();
    await first.player.playList(tracks, 1, 'playlist:1');
    first.audio.tick(30);
    first.player.setVolume(0.4);
    const saved = JSON.parse(JSON.stringify(first.player.snapshot()));

    const second = setup();
    await second.player.restore(saved);
    expect(second.player.getState()).toMatchObject({
      track: { id: 2 },
      time: 30,
      volume: 0.4,
      playing: false,
      context: 'playlist:1',
    });
    expect(second.audio.seek).toHaveBeenCalledWith(30);
    expect(second.audio.play).not.toHaveBeenCalled();
  });

  it('恢复的那首拿不到音源：打开 App 时不报错，按播放才报', async () => {
    const first = setup();
    await first.player.playList(tracks, 1);
    const saved = JSON.parse(JSON.stringify(first.player.snapshot()));

    const second = setup(async () => null);
    await second.player.restore(saved);
    expect(second.unplayable).toEqual([]);
    await second.player.play();
    expect(second.unplayable[0]).toBe(2); // 之后会自动跳下一首再试
  });

  it('上次在听私人 FM：恢复成 FM 的那首；补上 FM 来源后下一首照样是 FM 的歌', async () => {
    const first = setup();
    await first.player.playList(tracks, 2);
    await first.player.playFm({ next: async () => [{ id: 'f1' }] });
    first.audio.tick(12);
    const saved = JSON.parse(JSON.stringify(first.player.snapshot()));

    const second = setup();
    await second.player.restore(saved);
    expect(second.player.getState()).toMatchObject({ mode: 'fm', track: { id: 'f1' }, time: 12, playing: false });
    expect(second.player.needsFmSource()).toBe(true);
    second.player.setFmSource({ next: async () => [{ id: 'f2' }] });
    expect(second.player.needsFmSource()).toBe(false);
    await second.player.next();
    expect(second.player.getState().track.id).toBe('f2');
  });
});

describe('player 睡眠定时：这首播完就停', () => {
  it('播完不换下一首，发出 sleep；之后恢复正常', async () => {
    const { audio, player } = setup();
    const slept = [];
    player.on('sleep', () => slept.push(true));
    await player.playList(tracks, 0);
    player.setStopAfterCurrent(true);
    audio.end();
    await flush();
    expect(player.getState()).toMatchObject({ track: { id: 1 }, playing: false });
    expect(slept).toEqual([true]);
    await player.play();
    audio.end();
    await flush();
    expect(player.getState().track.id).toBe(2);
  });
});

describe('player 预先载入下一首', () => {
  it('播过一半就先拿下一首的链接，切过去时直接用，不用再拿一次', async () => {
    const resolve = vi.fn(async t => ({ url: urlOf(t.id) }));
    const { audio, player } = setup(resolve);
    const prefetched = [];
    player.on('prefetch', t => prefetched.push(t.id));
    await player.playList(tracks, 0); // 每首 200 秒
    audio.tick(99);
    expect(prefetched).toEqual([]);
    audio.tick(1);
    await flush();
    expect(prefetched).toEqual([2]);
    expect(resolve).toHaveBeenCalledTimes(2); // 第 1 首 + 预先载入第 2 首
    audio.tick(10); // 同一首不会重复载入
    await player.next();
    expect(player.getState().track.id).toBe(2);
    expect(audio.src).toBe(urlOf(2));
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
