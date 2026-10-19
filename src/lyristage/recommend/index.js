// 每日推荐 + 私人 FM：从数据库和网易云收集数据，交给 engine.js 计算
import { requireSupabase, unwrap } from '../supabase';
import { getCurrentUser } from '../auth';
import { listLikedTracks } from '../library';
import { listDislikedTrackIds, listRecentHistory } from '../history';
import { localDay, toSnapshot, fromRow } from '../track';
import {
  computeArtistAffinity,
  createRng,
  pickSeeds,
  rankCandidates,
} from './engine';
import * as defaultNetease from './netease';

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
 * @returns {Promise<Array<{ track: object, origin: string }>>}
 */
export async function gatherCandidates(seeds, netease = defaultNetease) {
  const tagged = origin => tracks => tracks.map(track => ({ track, origin }));

  const jobs = [
    ...seeds.artistIds.map(id =>
      netease.artistTopSongs(id).then(tagged('artist'))
    ),
    ...seeds.trackIds.map(id =>
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
  const results = await Promise.allSettled(jobs);
  return results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
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
 */
export async function buildRecommendations({
  seed,
  count = 30,
  excludeRecentDays = 7,
  extraExcludeIds = [],
  netease = defaultNetease,
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
 * @param {{ force?: boolean }} options force=true 时重新计算
 */
export async function getDailyRecommendations({ force = false } = {}) {
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

  const tracks = await buildRecommendations({ seed: `${user.id}:${day}` });
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
  constructor({ netease = defaultNetease, batchSize = 20 } = {}) {
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
