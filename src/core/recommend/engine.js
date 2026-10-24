// LyriStage 推荐算法（纯函数，不依赖网络和数据库，方便测试和调参）
//
// 思路：
// 1. 从听歌记录和"我喜欢"算出每个歌手的偏好分（artist affinity）
// 2. 偏好分最高的歌手 + 最近爱听的歌 = 种子
// 3. 用种子去网易云拿候选歌曲（歌手热门歌、相似歌单）
// 4. 过滤掉听过的、不喜欢的，打分排序，限制同一歌手的数量

const DAY_MS = 86400 * 1000;

/** 可调参数集中放这里 */
export const WEIGHTS = {
  halfLifeDays: 14, // 偏好的半衰期：14 天前的播放只算一半
  completedPlay: 1, // 听完（≥ 80%）
  partialPlay: 0.5, // 听了一部分
  skippedPlay: -1, // 跳过
  likedTrack: 2, // 喜欢的歌，每首给它的歌手加分（不衰减）
  score: {
    affinity: 0.5, // 歌手偏好
    origin: { similar: 0.3, artist: 0.2, generic: 0.1 }, // 候选来源
    popularity: 0.2, // 网易云热度 pop（0-100）
    random: 0.3, // 随机扰动，避免每天都一样
    live: -0.15, // Live 版
    medley: -0.6, // 串烧（歌名里有多个 +）
    crowd: -0.4, // 超过 4 个歌手的大合唱
  },
  // 至少这么多比例留给"相似歌单"里的歌，保证能发现新歌手
  discoveryRatio: 0.5,
};

/** 歌名归一化：去掉括号内容和空格，用来识别同一首歌的不同版本 */
export function normalizeTitle(name = '') {
  return name
    .toLowerCase()
    .replace(/[(（[【].*?[)）\]】]/g, '')
    .replace(/\s+/g, '');
}

function qualityPenalty(track) {
  const { score: W } = WEIGHTS;
  const name = track.name ?? '';
  let penalty = 0;
  if (/live|现场|演唱会/i.test(name)) penalty += W.live;
  if ((name.match(/\+/g) ?? []).length >= 2) penalty += W.medley;
  if ((track.ar ?? []).length > 4) penalty += W.crowd;
  return penalty;
}

// 随机数 --------------------------------------------------------------------------

/** 字符串 → 32 位整数种子（cyrb53 的简化版） */
export function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

/**
 * 可复现的随机数生成器（mulberry32）。
 * 每日推荐用"用户 ID + 日期"当种子：同一天结果固定，第二天自动变。
 * @returns {() => number} 返回 [0, 1) 的随机数
 */
export function createRng(seed) {
  let a = typeof seed === 'number' ? seed : hashString(String(seed));
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 偏好 ----------------------------------------------------------------------------

function playWeight(row) {
  if (row.skipped) return WEIGHTS.skippedPlay;
  const duration = row.duration_seconds;
  if (duration && row.listened_seconds >= duration * 0.8)
    return WEIGHTS.completedPlay;
  return WEIGHTS.partialPlay;
}

/**
 * 歌手偏好分
 * @param {Array} history  play_history 行（含 track、played_at、skipped…）
 * @param {Array} likedTracks 喜欢的歌（歌曲对象）
 * @param {number} now 当前时间戳（测试时可固定）
 * @returns {Map<number, number>} 歌手 ID → 分数（可能为负）
 */
export function computeArtistAffinity(history, likedTracks, now = Date.now()) {
  const affinity = new Map();
  const add = (artistId, value) => {
    if (!artistId) return; // 网易云里没有 ID 的歌手（id 为 0）不计
    affinity.set(artistId, (affinity.get(artistId) ?? 0) + value);
  };

  for (const row of history) {
    const ageDays = (now - new Date(row.played_at).getTime()) / DAY_MS;
    const decay = Math.pow(0.5, ageDays / WEIGHTS.halfLifeDays);
    const artists = row.track?.ar ?? [];
    // 合唱歌曲平分到每个歌手
    for (const ar of artists)
      add(ar.id, (playWeight(row) * decay) / artists.length);
  }
  for (const track of likedTracks) {
    const artists = track.ar ?? [];
    for (const ar of artists) add(ar.id, WEIGHTS.likedTrack / artists.length);
  }
  return affinity;
}

/**
 * 选种子
 * @returns {{ artistIds: number[], trackIds: number[] }}
 */
export function pickSeeds(
  affinity,
  history,
  likedTracks,
  { artists = 5, tracks = 3 } = {}
) {
  const artistIds = [...affinity.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, artists)
    .map(([id]) => id);

  // 种子歌曲：最近喜欢的歌优先，不够再用最近完整听过的歌
  const trackIds = [];
  const pushTrack = id => {
    if (id && !trackIds.includes(id) && trackIds.length < tracks)
      trackIds.push(id);
  };
  likedTracks.slice(0, tracks).forEach(t => pushTrack(t.id));
  history.filter(row => !row.skipped).forEach(row => pushTrack(row.track?.id));

  return { artistIds, trackIds };
}

// 排序 ----------------------------------------------------------------------------

/**
 * 给候选歌曲打分并挑出最终结果
 * @param {Array<{ track: object, origin: 'similar' | 'artist' | 'generic' }>} candidates
 * @param {object} options
 * @param {Map<number, number>} options.affinity
 * @param {Set<string>} options.excludeIds 要排除的歌曲 ID（听过的、喜欢的、不喜欢的）
 * @param {() => number} options.rng
 * @param {number} [options.count]
 * @param {number} [options.maxPerArtist] 同一个歌手最多几首，保证多样性
 */
export function rankCandidates(
  candidates,
  { affinity, excludeIds, rng, count = 30, maxPerArtist = 2 }
) {
  const maxAffinity = Math.max(1, ...affinity.values());
  const { score: W } = WEIGHTS;

  // 去重：同一首歌可能从多个来源出现，保留来源分最高的
  const byId = new Map();
  for (const c of candidates) {
    const id = String(c.track.id);
    if (excludeIds.has(id)) continue;
    const prev = byId.get(id);
    if (!prev || W.origin[c.origin] > W.origin[prev.origin]) byId.set(id, c);
  }

  const scored = [...byId.values()].map(c => {
    const artists = c.track.ar ?? [];
    const artistScore = artists.length
      ? Math.max(...artists.map(ar => affinity.get(ar.id) ?? 0)) / maxAffinity
      : 0;
    const score =
      W.affinity * Math.max(-1, artistScore) +
      W.origin[c.origin] +
      W.popularity * ((c.track.pop ?? 50) / 100) +
      qualityPenalty(c.track) +
      W.random * rng();
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const perArtist = new Map();
  const seenTitles = new Set();
  const artistKeys = track => (track.ar ?? []).map(ar => ar.id || ar.name);

  // 能不能放进结果：合唱歌曲里任何一个歌手满了都不行；同名歌（不同版本）只要一首
  const accept = (track, result) => {
    const keys = artistKeys(track);
    const title = `${normalizeTitle(track.name)}|${keys[0]}`;
    if (seenTitles.has(title)) return false;
    if (keys.some(k => (perArtist.get(k) ?? 0) >= maxPerArtist)) return false;
    seenTitles.add(title);
    keys.forEach(k => perArtist.set(k, (perArtist.get(k) ?? 0) + 1));
    result.push(track);
    return true;
  };

  // 先给"相似歌单"留出名额，再按总分补满
  const result = [];
  const discoverySlots = Math.round(count * WEIGHTS.discoveryRatio);
  for (const c of scored) {
    if (result.length >= discoverySlots) break;
    if (c.origin === 'similar') accept(c.track, result);
  }
  const taken = new Set(result.map(t => t.id));
  for (const c of scored) {
    if (result.length >= count) break;
    if (!taken.has(c.track.id)) accept(c.track, result);
  }

  // 两轮挑出来的顺序打乱一点，别让发现类的歌全挤在前面
  return result
    .map(track => ({ track, key: rng() }))
    .sort((a, b) => a.key - b.key)
    .map(x => x.track);
}
