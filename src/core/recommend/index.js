// 每日推荐 + 私人 FM：从数据库和网易云收集数据，交给 engine.js 计算
//
// netease 参数：core/netease 的 createNetease(http) 返回值，
// 用到 artistTopSongs / similarPlaylists / playlistTracks / genericRecommendations
import { requireSupabase, unwrap } from '../data/supabase';
import { getCurrentUser } from '../data/auth';
import { listLikedTracks } from '../data/library';
import { listDislikedTrackIds, listRecentHistory } from '../data/history';
import { localDay, toSnapshot, fromRow } from '../data/track';
import {
  computeArtistAffinity,
  createRng,
  pickSeeds,
  rankCandidates,
} from './engine';

/**
 * @typedef {Pick<ReturnType<typeof import('../netease').createNetease>,
 *   'artistTopSongs' | 'similarPlaylists' | 'playlistTracks' | 'genericRecommendations'>} NeteaseForRecommend
 */

const DAY_MS = 86400 * 1000;

/** 读取推荐需要的用户数据 */
async function loadUserSignals() {
  const [history, liked, disliked] = await Promise.all([
    listRecentHistory({ days: 30 }),
    listLikedTracks({ limit: 200 }),
    listDislikedTrackIds(),
  ]);
  return { history, liked, disliked };
}

/**
 * 用种子去网易云收集候选歌曲。单个接口失败不影响其他来源。
 * @param {{ artistIds: number[], trackIds: number[] }} seeds
 * @param {NeteaseForRecommend} netease
 * @returns {Promise<Array<{ track: object, origin: string }>>}
 */
export async function gatherCandidates(seeds, netease, { jobTimeoutMs = 8000, concurrency = 3 } = {}) {
  const tagged = origin => tracks => tracks.map(track => ({ track, origin }));
  // 每个来源最多等这么久：一个接口卡住（逾时重试最久快一分钟）不要拖住整份推荐，
  // 来不及的就跳过，候选不够时下面的 withColdStart 会补
  const inTime = promise =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), jobTimeoutMs)),
    ]);

  // 每个来源是一个"要做的事"，同时最多做 concurrency 个：
  // 浏览器对同一个服务器最多 6 条连线，全被推荐占满的话，用户这时搜索、点歌都要排队
  const jobs = [
    ...seeds.artistIds.map(id => () =>
      netease.artistTopSongs(id).then(tagged('artist'))
    ),
    ...seeds.trackIds.map(id => () =>
      netease
        .similarPlaylists(id)
        .then(playlists =>
          Promise.all(
            playlists.slice(0, 2).map(p => netease.playlistTracks(p.id, 50))
          )
        )
        .then(lists => tagged('similar')(lists.flat()))
    ),
  ];
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        results.push(...(await inTime(job())));
      } catch {
        // 这个来源失败或太慢，跳过
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

/** 候选太少（新用户、接口失败）时用网易云通用推荐补上 */
async function withColdStart(candidates, minCount, netease) {
  if (candidates.length >= minCount) return candidates;
  const generic = await netease.genericRecommendations().catch(() => []);
  return candidates.concat(
    generic.map(track => ({ track, origin: 'generic' }))
  );
}

/** 最近 days 天播放过的歌曲 ID（包括跳过的） */
function recentlyPlayedIds(history, days) {
  const since = Date.now() - days * DAY_MS;
  return history
    .filter(row => new Date(row.played_at).getTime() >= since)
    .map(row => row.track_id);
}

/**
 * 生成一份推荐（不读写缓存）
 * @param {object} options
 * @param {string|number} options.seed 随机种子
 * @param {number} [options.count]
 * @param {number} [options.excludeRecentDays] 排除最近几天听过的
 * @param {Iterable<string>} [options.extraExcludeIds]
 * @param {NeteaseForRecommend} options.netease
 */
export async function buildRecommendations({
  seed,
  count = 30,
  excludeRecentDays = 7,
  extraExcludeIds = [],
  netease,
}) {
  const { history, liked, disliked } = await loadUserSignals();
  const affinity = computeArtistAffinity(history, liked);
  const seeds = pickSeeds(affinity, history, liked);

  const excludeIds = new Set([
    ...disliked,
    ...liked.map(t => String(t.id)), // 推荐是为了发现新歌，已经喜欢的不再推
    ...recentlyPlayedIds(history, excludeRecentDays),
    ...[...extraExcludeIds].map(String),
  ]);

  let candidates = await gatherCandidates(seeds, netease);
  candidates = await withColdStart(
    candidates.filter(c => !excludeIds.has(String(c.track.id))),
    count,
    netease
  );

  return rankCandidates(candidates, {
    affinity,
    excludeIds,
    rng: createRng(seed),
    count,
  });
}

// 每日推荐 ------------------------------------------------------------------------

/**
 * 今天的每日推荐。当天第一次调用时计算并存进数据库，之后直接读缓存。
 * @param {{ netease: NeteaseForRecommend, force?: boolean }} options force=true 时重新计算
 */
export async function getDailyRecommendations({ netease, force = false }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('需要登录 LyriStage 账号');
  const day = localDay();
  const db = requireSupabase();

  if (!force) {
    const cached = unwrap(
      await db
        .from('daily_recommendations')
        .select('tracks')
        .eq('day', day)
        .maybeSingle()
    );
    if (cached) return cached.tracks.map(track => fromRow({ track }));
  }

  const tracks = await buildRecommendations({
    seed: `${user.id}:${day}`,
    netease,
  });
  const snapshots = tracks.map(toSnapshot);
  unwrap(
    await db
      .from('daily_recommendations')
      .upsert({ day, tracks: snapshots }, { onConflict: 'user_id,day' })
  );
  return snapshots.map(track => fromRow({ track }));
}

// 私人 FM -------------------------------------------------------------------------

/**
 * 私人 FM：维护一个候选队列，快用完时自动补充。
 * 本次会话里跳过和喜欢会即时影响后面的选歌（通过排除 + 重新计算偏好）。
 */
export class PersonalFM {
  /** @param {{ netease: NeteaseForRecommend, batchSize?: number }} options */
  constructor({ netease, batchSize = 20 }) {
    this.netease = netease;
    this.batchSize = batchSize;
    this.queue = [];
    this.served = new Set(); // 本次会话已经出过的歌，不重复
    this.loading = null;
  }

  async _refill() {
    // 同一时间只补一次
    if (!this.loading) {
      this.loading = buildRecommendations({
        seed: Date.now(), // FM 每次都不一样
        count: this.batchSize,
        excludeRecentDays: 1,
        extraExcludeIds: this.served,
        netease: this.netease,
      })
        .then(tracks => {
          this.queue.push(
            ...tracks.filter(t => !this.served.has(String(t.id)))
          );
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** 取接下来的 n 首（和网易云 /personal_fm 一样一次给几首） */
  async next(n = 1) {
    if (this.queue.length < n + 3) await this._refill();
    const tracks = this.queue.splice(0, n);
    tracks.forEach(t => this.served.add(String(t.id)));
    // 补货放后台，下次取的时候就不用等
    if (this.queue.length < 5) this._refill().catch(() => {});
    return tracks;
  }

  /**
   * 用户反馈后清空队列，让后面的歌用新的偏好重新计算
   * （跳过 / 喜欢 / 不喜欢 已经由 history.js / library.js 写进数据库）
   */
  invalidate() {
    this.queue = [];
  }
}

// 相似歌曲电台 ----------------------------------------------------------------------

/**
 * 从一首歌开始的电台（参考 Spotify 的歌曲电台）：先播这首，再播网易云算的相似歌曲，
 * 按你的口味排序（常听的歌手优先、跳过不喜欢的）。之后从播过的歌里随机挑一首继续找相似的，
 * 一路"走"下去，不会只在原地打转。用私人 FM 的播放模式（没有上一首、可以按不喜欢）
 */
export class SongRadio {
  /** @param {{ netease: NeteaseForRecommend & { similarSongs: (id: number) => Promise<object[]> }, seed: object, batchSize?: number }} options */
  constructor({ netease, seed, batchSize = 15 }) {
    this.netease = netease;
    this.seed = seed;
    this.batchSize = batchSize;
    this.queue = [];
    this.served = new Set(); // 播过的不重复
    this.walk = [seed]; // 下一批相似歌曲从这些歌出发
    this.started = false;
    this.loading = null;
    this.signals = null;
  }

  /** 你的口味（没登录、读不到就当没有，照样能播） */
  _taste() {
    if (!this.signals) {
      this.signals = loadUserSignals()
        .then(s => ({ affinity: computeArtistAffinity(s.history, s.liked), disliked: s.disliked }))
        .catch(() => ({ affinity: new Map(), disliked: [] }));
    }
    return this.signals;
  }

  async _refill() {
    if (!this.loading) {
      this.loading = (async () => {
        const { affinity, disliked } = await this._taste();
        // 随机挑一首当这次的出发点；都用完了就回到起点那首
        const from = this.walk.length
          ? this.walk.splice(Math.floor(Math.random() * this.walk.length), 1)[0]
          : this.seed;
        let candidates = await this.netease.similarSongs(from.id).catch(() => []);
        // 冷门歌没有相似歌曲：用同一个歌手的热门歌补
        const artistId = from.ar?.[0]?.id;
        if (candidates.length < 5 && artistId) {
          candidates = candidates.concat(await this.netease.artistTopSongs(artistId).catch(() => []));
        }
        const exclude = new Set([
          ...disliked,
          ...this.served,
          ...this.queue.map(t => String(t.id)),
        ]);
        const picked = rankCandidates(
          candidates.map(track => ({ track, origin: /** @type {const} */ ('similar') })),
          { affinity, excludeIds: exclude, rng: createRng(Date.now()), count: this.batchSize }
        );
        this.queue.push(...picked);
        this.walk.push(...picked.slice(0, 3));
      })().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  /** 取接下来的 n 首（第一次会先给起点那首） */
  async next(n = 1) {
    const out = [];
    if (!this.started) {
      this.started = true;
      out.push(this.seed);
      this.served.add(String(this.seed.id));
    }
    for (let tries = 0; this.queue.length < n - out.length && tries < 4; tries++) {
      await this._refill();
    }
    const more = this.queue.splice(0, Math.max(0, n - out.length));
    more.forEach(t => this.served.add(String(t.id)));
    out.push(...more);
    // 补货放后台，下次取的时候就不用等
    if (this.queue.length < 5) this._refill().catch(() => {});
    return out;
  }

  /** 按了不喜欢：清掉已经挑好的，下一批用新的口味重挑 */
  invalidate() {
    this.queue = [];
    this.signals = null;
  }
}
