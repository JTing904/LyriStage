// @ts-check
// 播放队列（纯逻辑，不碰音频）
//
// - tracks：歌单原本的顺序
// - order：实际播放顺序（tracks 的下标）；随机播放时是打乱后的
// - upNext："下一首播放 / 加入队列"插进来的歌，优先于 order 播放
//
// 顺带修掉 v1 的两个 bug：
// - 上一首在第一首时的首尾循环逻辑错误（v1 Player.js _getPrevTrack）
// - "加入队列"调用了不存在的 list.append（v1 appendTrack）

/**
 * @typedef {{ id: number | string, [key: string]: any }} Track
 * @typedef {'off' | 'all' | 'one'} RepeatMode
 */

/** Fisher–Yates 洗牌，rng 可以换成固定种子方便测试 */
function shuffled(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class Queue {
  /**
   * @param {{ rng?: () => number }} [options]
   */
  constructor({ rng = Math.random } = {}) {
    this.rng = rng;
    /** @type {Track[]} */
    this.tracks = [];
    /** @type {number[]} */
    this.order = [];
    this.pos = -1;
    /** @type {Track[]} */
    this.upNext = [];
    /** 正在播放的是不是 upNext 里拿出来的歌（不在 tracks 里） */
    /** @type {Track | null} */
    this.extra = null;
    /** @type {RepeatMode} */
    this.repeat = 'off';
    this.shuffle = false;
  }

  /** @returns {Track | null} */
  get current() {
    if (this.extra) return this.extra;
    return this.pos >= 0 ? this.tracks[this.order[this.pos]] ?? null : null;
  }

  /**
   * 换一个歌单，从第 startIndex 首开始
   * @param {Track[]} tracks
   * @param {number} [startIndex]
   */
  setTracks(tracks, startIndex = 0) {
    this.tracks = [...tracks];
    this.extra = null;
    this.#rebuildOrder(startIndex);
    return this.current;
  }

  /** 跳到歌单里的第 index 首（点了列表里的某一首） */
  jumpTo(index) {
    if (index < 0 || index >= this.tracks.length) return this.current;
    this.extra = null;
    this.pos = this.order.indexOf(index);
    return this.current;
  }

  /**
   * 下一首
   * @param {{ auto?: boolean }} [options] auto：歌曲自然播完（单曲循环只在这种情况下重播）
   * @returns {Track | null} 没有下一首时返回 null（列表播完且没开循环）
   */
  next({ auto = false } = {}) {
    if (auto && this.repeat === 'one' && this.current) return this.current;
    if (this.upNext.length > 0) {
      this.extra = /** @type {Track} */ (this.upNext.shift());
      return this.extra;
    }
    this.extra = null;
    if (this.order.length === 0) return null;
    if (this.pos + 1 < this.order.length) {
      this.pos += 1;
    } else if (this.repeat === 'off') {
      return null; // 列表播完了
    } else {
      // 循环：回到开头；随机播放时每一轮重新洗牌
      if (this.shuffle) this.order = shuffled(this.order, this.rng);
      this.pos = 0;
    }
    return this.current;
  }

  /** 上一首：第一首时，开了循环就到最后一首，没开就停在第一首 */
  prev() {
    if (this.extra) {
      // 正在播"下一首播放"插进来的歌：上一首就是插队前在播的那首
      this.extra = null;
      return this.current;
    }
    if (this.order.length === 0) return null;
    if (this.pos > 0) this.pos -= 1;
    else if (this.repeat !== 'off') this.pos = this.order.length - 1;
    else this.pos = 0;
    return this.current;
  }

  /** "下一首播放"：插到最前面 */
  playNext(track) {
    this.upNext.unshift(track);
  }

  /** "加入队列"：排到 upNext 最后 */
  addToQueue(track) {
    this.upNext.push(track);
  }

  /** @param {RepeatMode} mode */
  setRepeat(mode) {
    this.repeat = mode;
  }

  /** 开关随机播放；当前这首保持不变 */
  setShuffle(on) {
    if (this.shuffle === on) return;
    this.shuffle = on;
    const currentIndex = this.extra ? -1 : this.order[this.pos] ?? -1;
    this.#rebuildOrder(currentIndex);
  }

  /** 接下来会播放的歌（upNext + 剩下的列表），给"播放队列"界面用 */
  upcoming(limit = 50) {
    const rest = this.order.slice(this.pos + 1).map(i => this.tracks[i]);
    return [...this.upNext, ...rest].slice(0, limit);
  }

  /** 保存到 localStorage 用 */
  toJSON() {
    return {
      tracks: this.tracks,
      order: this.order,
      pos: this.pos,
      upNext: this.upNext,
      extra: this.extra,
      repeat: this.repeat,
      shuffle: this.shuffle,
    };
  }

  /** @param {ReturnType<Queue['toJSON']>} data */
  restore(data) {
    const valid =
      Array.isArray(data?.tracks) &&
      Array.isArray(data.order) &&
      data.order.length === data.tracks.length;
    if (!valid) return;
    Object.assign(this, {
      tracks: data.tracks,
      order: data.order,
      pos: Math.min(data.pos, data.order.length - 1),
      upNext: data.upNext ?? [],
      extra: data.extra ?? null,
      repeat: data.repeat ?? 'off',
      shuffle: Boolean(data.shuffle),
    });
  }

  /** 重建播放顺序，让 tracks[startIndex] 成为当前这首 */
  #rebuildOrder(startIndex) {
    const indices = this.tracks.map((_, i) => i);
    if (indices.length === 0) {
      this.order = [];
      this.pos = -1;
      return;
    }
    const start =
      startIndex >= 0 && startIndex < indices.length ? startIndex : 0;
    if (this.shuffle) {
      // 随机时当前这首放第一个，其他打乱
      this.order = [
        start,
        ...shuffled(
          indices.filter(i => i !== start),
          this.rng
        ),
      ];
      this.pos = 0;
    } else {
      this.order = indices;
      this.pos = start;
    }
  }
}
