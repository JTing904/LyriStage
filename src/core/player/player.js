// @ts-check
// 播放控制：队列 + 音频 + 找音源 + 听歌统计。
// 不依赖 Vue / store / Electron：界面通过事件拿状态，需要的功能都从参数传进来。
import { Emitter } from './emitter';
import { Queue } from './queue';

/**
 * @typedef {import('./queue').Track} Track
 * @typedef {import('./queue').RepeatMode} RepeatMode
 * @typedef {import('./audio').AudioBackend} AudioBackend
 * @typedef {{ url: string, br?: number, source?: string }} Source
 * @typedef {{ next: (count?: number) => Promise<Track[]> }} FmSource 私人 FM（recommend/index.js 的 PersonalFM）
 *
 * @typedef {object} PlayerState
 * @property {Track | null} track
 * @property {Source | null} source
 * @property {boolean} playing
 * @property {boolean} loading
 * @property {number} time 秒
 * @property {number} duration 秒
 * @property {number} volume 0 到 1
 * @property {RepeatMode} repeat
 * @property {boolean} shuffle
 * @property {'list' | 'fm'} mode
 * @property {string | null} context 从哪里播放的：'daily' / 'playlist:123' …（写进听歌记录）
 */

// 连续几首拿不到音源就停下来，避免整个歌单都播不了时一直跳
const MAX_CONSECUTIVE_FAILURES = 3;
// 播放超过这么多秒时，按"上一首"是回到这首开头
const RESTART_THRESHOLD = 3;
// 网易云的播放链接大约 20 分钟后失效；拿到超过这么久就先换新的再播
const SOURCE_TTL_MS = 10 * 60 * 1000;

/**
 * @param {object} deps
 * @param {AudioBackend} deps.audio
 * @param {(track: Track) => Promise<Source | null>} deps.resolveSource 找播放链接（网易云 → 解灰）
 * @param {() => number} [deps.rng] 随机播放用
 */
export function createPlayer({ audio, resolveSource, rng = Math.random }) {
  const events = new Emitter();
  const queue = new Queue({ rng });

  /** @type {PlayerState} */
  const state = {
    track: null,
    source: null,
    playing: false,
    loading: false,
    time: 0,
    duration: 0,
    volume: 1,
    repeat: 'off',
    shuffle: false,
    mode: 'list',
    context: null,
  };

  /** @type {FmSource | null} */
  let fm = null;
  let loadToken = 0; // 切歌很快时，丢弃已经过时的音源结果
  let failures = 0;
  let sourceAt = 0; // 什么时候拿到 state.source 的（判断链接是不是过期了）
  let retried = false; // 音频出错后已经换过一次链接（再错就不重试，避免一直重来）

  // 听歌统计：只累计真正播放过的时间（拖动进度条跳过去的不算）
  let listened = 0;
  let lastTime = 0;

  const changed = () => events.emit('change', { ...state });

  /** 离开一首歌时汇报听了多久（界面拿去写听歌记录） */
  function reportPlayed() {
    if (state.track && listened >= 1) {
      events.emit('played', {
        track: state.track,
        listenedSeconds: Math.round(listened),
        context: state.context,
      });
    }
    listened = 0;
    lastTime = 0;
  }

  /**
   * @param {Track | null} track
   * @param {{ autoplay?: boolean, startAt?: number }} [options]
   */
  async function load(track, { autoplay = true, startAt = 0 } = {}) {
    reportPlayed();
    const token = ++loadToken;
    audio.pause();
    Object.assign(state, {
      track,
      source: null,
      playing: false,
      loading: Boolean(track),
      time: startAt,
      duration: track?.dt ? track.dt / 1000 : 0,
    });
    changed();
    if (!track) return;
    events.emit('track', track);

    let source = null;
    let requestFailed = false;
    try {
      source = await resolveSource(track);
    } catch (err) {
      requestFailed = true;
      if (token === loadToken) events.emit('error', { track, error: err });
    }
    if (token !== loadToken) return; // 已经切到别的歌了

    if (requestFailed) {
      // 网络断了、服务器出错：不是这首歌没有音源，不要跳歌，停在这首（按播放会再试一次）
      state.loading = false;
      changed();
      return;
    }
    if (!source) {
      state.loading = false;
      changed();
      events.emit('unplayable', { track });
      failures += 1;
      // 拿不到就自动跳下一首，连续失败太多次就停下
      if (autoplay && failures < MAX_CONSECUTIVE_FAILURES) await next();
      return;
    }
    failures = 0;
    retried = false;
    // 用 state.time 而不是 startAt：找音源的时候用户可能已经拖了进度条
    await useSource(source, { autoplay, startAt: state.time });
  }

  /** 把找到的音源交给 audio，从 startAt 开始 */
  async function useSource(source, { autoplay, startAt }) {
    state.source = source;
    sourceAt = Date.now();
    audio.load(source.url);
    if (startAt > 0) audio.seek(startAt);
    lastTime = startAt;
    if (autoplay) await play();
    else {
      state.loading = false;
      changed();
    }
  }

  /**
   * 同一首歌重新拿播放链接，从目前的位置接着播（链接过期、音频出错时用）。
   * 不算换歌：不汇报听歌记录，已经听的时间继续累计
   */
  async function refreshSource({ autoplay }) {
    const track = state.track;
    if (!track) return;
    const startAt = audio.currentTime() || state.time;
    const token = ++loadToken;
    state.loading = true;
    changed();
    let source = null;
    let requestFailed = false;
    try {
      source = await resolveSource(track);
    } catch (err) {
      requestFailed = true;
      if (token === loadToken) events.emit('error', { track, error: err });
    }
    if (token !== loadToken) return;
    if (!source) {
      Object.assign(state, { source: null, playing: false, loading: false });
      changed();
      if (!requestFailed) events.emit('unplayable', { track });
      return;
    }
    await useSource(source, { autoplay, startAt });
  }

  /** 列表播完了（没开循环）：停在最后一首的开头，按播放可以再听一次 */
  function stopAtEnd() {
    reportPlayed();
    audio.pause();
    audio.seek(0);
    Object.assign(state, { playing: false, loading: false, time: 0 });
    changed();
  }

  async function play() {
    if (!state.source) {
      if (state.track) await load(state.track, { startAt: state.time });
      return;
    }
    if (Date.now() - sourceAt > SOURCE_TTL_MS) {
      await refreshSource({ autoplay: true });
      return;
    }
    try {
      await audio.play();
    } catch (err) {
      // 浏览器不允许自动播放（用户还没点过页面）等
      state.playing = false;
      state.loading = false;
      changed();
      events.emit('error', { track: state.track, error: err });
    }
  }

  function pause() {
    audio.pause();
  }

  async function next() {
    const track = state.mode === 'fm' ? await nextFmTrack() : queue.next();
    // 已经是最后一首（或 FM 暂时拿不到歌）：不要把播放器清空，留在这首
    if (!track) return;
    return load(track);
  }

  async function prev() {
    if (audio.currentTime() > RESTART_THRESHOLD) {
      seek(0);
      return;
    }
    if (state.mode === 'fm') return; // FM 没有上一首
    await load(queue.prev());
  }

  function seek(seconds) {
    audio.seek(seconds);
    state.time = seconds;
    lastTime = seconds; // 跳过去的时间不算"听过"
    changed();
  }

  function setVolume(volume) {
    state.volume = Math.min(1, Math.max(0, volume));
    audio.setVolume(state.volume);
    changed();
  }

  /** 用户主动换歌时，"连续失败"重新计算 */
  function userLoad(track) {
    failures = 0;
    return load(track);
  }

  /** @returns {Promise<Track | null>} */
  async function nextFmTrack() {
    if (!fm) return null;
    try {
      const [track] = await fm.next(1);
      return track ?? null;
    } catch (err) {
      events.emit('error', { track: null, error: err });
      return null;
    }
  }

  // 音频事件 → 状态 ----------------------------------------------------------------
  audio.on('playing', () => {
    state.playing = true;
    state.loading = false;
    retried = false;
    changed();
  });
  audio.on('pause', () => {
    state.playing = false;
    changed();
  });
  audio.on('waiting', () => {
    state.loading = true;
    changed();
  });
  audio.on('loadedmetadata', () => {
    const duration = audio.duration();
    if (Number.isFinite(duration) && duration > 0) {
      state.duration = duration;
      changed();
    }
  });
  audio.on('timeupdate', () => {
    const time = audio.currentTime();
    const delta = time - lastTime;
    // 正常播放时两次 timeupdate 间隔不到 1 秒；超过 2 秒或倒退就是拖动了进度条
    if (state.playing && delta > 0 && delta < 2) listened += delta;
    lastTime = time;
    state.time = time;
    events.emit('time', time);
  });
  audio.on('ended', async () => {
    state.playing = false;
    const track =
      state.mode === 'fm' ? await nextFmTrack() : queue.next({ auto: true });
    if (!track) {
      stopAtEnd();
    } else if (track === state.track) {
      // 单曲循环：同一首从头播，也算一次新的播放
      reportPlayed();
      audio.seek(0);
      await play();
    } else {
      await load(track);
    }
  });
  audio.on('error', async () => {
    // 多半是链接过期了：换一次新链接，从原来的位置接着播
    if (state.track && state.source && !retried) {
      retried = true;
      await refreshSource({ autoplay: state.playing || state.loading });
      return;
    }
    state.playing = false;
    state.loading = false;
    changed();
    events.emit('error', {
      track: state.track,
      error: new Error('音频加载失败'),
    });
  });

  return {
    on: events.on.bind(events),
    /** 当前状态的副本 */
    getState: () => ({ ...state }),
    /** 精确的播放时间（秒）：歌词逐字动画在每一帧读它，比 time 事件更准 */
    currentTime: () => audio.currentTime(),
    queue,

    /**
     * 播放一个列表
     * @param {Track[]} tracks
     * @param {number} [startIndex]
     * @param {string | null} [context]
     */
    async playList(tracks, startIndex = 0, context = null) {
      state.mode = 'list';
      state.context = context;
      fm = null;
      await userLoad(queue.setTracks(tracks, startIndex));
    },
    /** 播放当前列表里的第 index 首 */
    async playIndex(index) {
      await userLoad(queue.jumpTo(index));
    },
    /**
     * 私人 FM：歌曲由 fmSource 一首一首提供
     * @param {FmSource} fmSource
     */
    async playFm(fmSource) {
      fm = fmSource;
      state.mode = 'fm';
      state.context = 'fm';
      await userLoad(await nextFmTrack());
    },
    play,
    pause,
    async toggle() {
      if (state.playing) pause();
      else await play();
    },
    next,
    prev,
    seek,
    setVolume,
    /** @param {RepeatMode} mode */
    setRepeat(mode) {
      queue.setRepeat(mode);
      state.repeat = mode;
      changed();
    },
    setShuffle(on) {
      queue.setShuffle(on);
      state.shuffle = on;
      changed();
    },
    playNext: track => queue.playNext(track),
    addToQueue: track => queue.addToQueue(track),

    /** 保存播放进度（界面存进 localStorage） */
    snapshot() {
      return {
        queue: queue.toJSON(),
        time: state.time,
        volume: state.volume,
        context: state.context,
        mode: state.mode,
        // FM 的歌不在列表里，要另外存
        fmTrack: state.mode === 'fm' ? state.track : null,
      };
    },
    /**
     * 恢复上次的播放进度（不自动播放）
     * @param {ReturnType<ReturnType<typeof createPlayer>['snapshot']> | null} data
     */
    async restore(data) {
      if (!data?.queue) return;
      queue.restore(data.queue);
      state.repeat = queue.repeat;
      state.shuffle = queue.shuffle;
      state.context = data.context ?? null;
      if (typeof data.volume === 'number') setVolume(data.volume);
      if (data.mode === 'fm' && data.fmTrack) {
        // 上次在听私人 FM：恢复那首。FM 的来源要等知道登录状态才能建，界面之后用 setFmSource 补上
        state.mode = 'fm';
        state.context = 'fm';
        await load(data.fmTrack, { autoplay: false, startAt: data.time ?? 0 });
        return;
      }
      await load(queue.current, { autoplay: false, startAt: data.time ?? 0 });
    },
    /** 恢复成 FM 模式后，还没有 FM 来源（按下一首时要用） */
    needsFmSource: () => state.mode === 'fm' && !fm,
    /** @param {FmSource} fmSource */
    setFmSource(fmSource) {
      fm = fmSource;
    },
  };
}
