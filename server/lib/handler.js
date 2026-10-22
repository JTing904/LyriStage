// LyriStage 的网易云 API 请求处理（Vercel 和电脑版主进程共用）
//
// - 其他路径交给 @neteasecloudmusicapienhanced/api，默认带上大陆 realIP
// - /song/url/match（解灰）自己实现，见下面 unblock()
const crypto = require('crypto');
const { findOnBilibili, checkBilibili, BilibiliRateLimited } = require('./bilibili');
const { findOnPublicSources, checkPublicSources } = require('./publicSources');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 网易云 API 允许调用的人用这些参数改请求的去向（domain、proxy）或夹带 cookie、header。
// LyriStage 自己用不到，转发前一律删掉，免得别人借我们的服务器 / 电脑去打别的地方
const BLOCKED_PARAMS = ['proxy', 'domain', 'headers', 'cookie', 'ua'];

/** 删掉危险参数和 Cookie 请求头（网址里的、Vercel 预先解析好的 req.query 都要删） */
function stripBlockedParams(req, url) {
  let changed = false;
  for (const key of BLOCKED_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
    if (req.query && typeof req.query === 'object') delete req.query[key];
  }
  delete req.headers.cookie;
  if (changed) req.url = url.pathname + url.search;
}

// 限流（Vercel 上用）：同一个 IP 每分钟最多这么多次。
// 正常使用（包括一次发几十个请求的每日推荐）远远用不到；Vercel 可能同时开好几台机器，
// 每台各算各的，所以只挡得住明显乱刷，不是精准的限流
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 60 * 1000;

function createRateLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const hits = new Map();
  /** @returns {number} 0 = 放行；否则是要等几秒 */
  return key => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (hits.size > 10000) hits.clear();
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  };
}

/** 请求的来源 IP（Vercel 会设 x-real-ip / x-forwarded-for） */
const clientIp = req =>
  String(
    req.headers['x-real-ip'] ||
      String(req.headers['x-forwarded-for'] || '').split(',')[0] ||
      req.socket?.remoteAddress ||
      ''
  ).trim();

/** 比较通行证（固定时间比较，避免用回应时间猜出内容） */
function sameToken(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 海外请求网易云会被限制版权，默认带上大陆 IP（请求里已有 realIP 就用请求的）
const DEFAULT_REAL_IP = '211.161.244.70';

// 解灰：网易云拿不到播放链接时，去其他地方找同一首歌。
// 新版 API 自带的 /song/url/match 用的第三方网站在马来西亚全部失效。2026-10 在马来西亚实测：
//   公开音源 ✓ 5 个"歌曲 ID → 链接"接口（publicSources.js），VIP 歌拿得到网易云的完整文件，最先问
//   B 站    ✓ 网易云完全没有版权的歌（例如周杰伦）靠这个（bilibili.js）
//   以下是 @unblockneteasemusic/server 的音源：
//   pyncmd ✗ GD Studio 9 月起要求加密签名，不带一律 400
//   kuwo   ✗ 海外 IP 不管搜什么都返回同一个 2.6 秒的占位音频
//   其他（qq、migu、kugou、joox、youtube…）全部失败；ytdlp 要另外装 yt-dlp
// 所以默认不用它；环境变量 UNM_SOURCES 可以再加 @unblockneteasemusic/server 的音源
const DEFAULT_UNM_SOURCES = [];
// 小于这个大小的音频当成占位文件（正常歌曲 128k 码率 1 分钟就有约 1MB）
const MIN_AUDIO_BYTES = 300 * 1024;

/** 有的音源对海外 IP 返回很短的占位音频，用文件大小判断 */
async function looksLikeRealAudio(audioUrl) {
  try {
    const res = await fetch(audioUrl, { method: 'HEAD' });
    const size = Number(res.headers.get('content-length'));
    return res.ok && (!size || size >= MIN_AUDIO_BYTES);
  } catch {
    return false;
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

// 网页版请求时会带 Authorization（登录 token），浏览器会先发 OPTIONS 预检。
// 网易云 API 自己的预检回应不允许 Authorization，所以这里先回应
function sendPreflight(req, res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-LyriStage-Token'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  res.end();
}

/**
 * 不用登录也能用的接口：浏览（首页推荐、排行榜、搜索、歌单、专辑、歌手）。
 * 其他（播放链接、解灰、歌词、私人 FM、推荐算法用的接口…）只给成员。
 */
const PUBLIC_PATHS = new Set([
  '/personalized',
  '/personalized/newsong',
  '/toplist',
  '/cloudsearch',
  '/search',
  '/playlist/detail',
  '/playlist/track/all',
  '/album',
  '/artists',
  '/artist/album',
  '/song/detail',
]);

/**
 * 只让 LyriStage 成员（兑换过邀请码的账号）使用 API：
 * 拿请求里的登录 token 去调 Supabase 的 is_member()，token 无效或不是成员都会被拒绝。
 * 结果缓存一会儿，不用每个请求都去问 Supabase。
 * @param {{ supabaseUrl: string, anonKey: string }} options
 */
function createMemberCheck({ supabaseUrl, anonKey }) {
  const cache = new Map(); // token -> { ok, until }
  const MEMBER_TTL = 10 * 60 * 1000;
  const REJECT_TTL = 30 * 1000;

  /** token 自己的过期时间（毫秒），读不出来就当作马上过期 */
  function tokenExpiry(token) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf-8')
      );
      return payload.exp * 1000;
    } catch {
      return 0;
    }
  }

  return async function isMember(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return false;
    const cached = cache.get(token);
    if (cached && cached.until > Date.now()) return cached.ok;

    let ok = false;
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/is_member`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      ok = res.ok && (await res.json()) === true;
    } catch {
      // Supabase 连不上：这次先拒绝，也不缓存
      return false;
    }
    if (cache.size > 1000) cache.clear();
    const ttl = ok ? MEMBER_TTL : REJECT_TTL;
    cache.set(token, {
      ok,
      until: Math.min(Date.now() + ttl, ok ? tokenExpiry(token) : Infinity),
    });
    return ok;
  };
}

async function unblock(res, url, sources, { addsBilibiliReferer = false } = {}) {
  const id = url.searchParams.get('id');
  if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
  const requested = url.searchParams.get('source');
  const list = requested ? requested.split(',') : ['public', 'bilibili', ...sources];
  const errors = [];
  let info = null;
  /** @type {Error | null} B 站要求人机验证（其他音源也都没有时，让 App 说清楚） */
  let rateLimited = null;
  try {
    // 歌名、歌手、时长（用 @unblockneteasemusic/server 的 find，直接问网易云）
    info = await require('@unblockneteasemusic/server/src/provider/find')(Number(id));
  } catch (err) {
    errors.push(`find: ${err}`);
  }

  const others = list.filter(s => s !== 'bilibili' && s !== 'public');
  const hint = url.searchParams.get('bvid') || undefined;

  // 公开音源：网易云自己的完整文件，音质最好，不用搜索
  async function tryPublic() {
    if (!list.includes('public')) return null;
    const found = await findOnPublicSources(id, { durationMs: info?.duration });
    if (!found) errors.push('public: 都没有');
    return found;
  }
  // 网易云完全没有的歌（例如周杰伦）：去 B 站找有人上传的
  async function tryBilibili() {
    if (!info || !list.includes('bilibili')) return null;
    const found = await findOnBilibili({
      name: info.name,
      artists: info.artists.map(a => a.name),
      durationMs: info.duration,
    }, {
      needsNoReferer: !addsBilibiliReferer,
      // App 从大家共用的 bilibili_picks 表查到的视频（服务器会再检查）
      hint,
    });
    if (!found) errors.push('bilibili: 没有像原曲的视频');
    return found;
  }

  // 以前在 B 站找到过这首（App 带了 bvid）：表示公开音源没有它，先直接检查那个视频，
  // 省掉问公开音源的那几秒；那个视频不行了才回头问公开音源
  const order = hint ? [tryBilibili, tryPublic] : [tryPublic, tryBilibili];
  for (const attempt of order) {
    try {
      const found = await attempt();
      if (found) return sendJson(res, 200, { code: 200, data: found });
    } catch (err) {
      errors.push(String(err));
      if (err instanceof BilibiliRateLimited) rateLimited = err;
    }
  }
  // B 站要求人机验证（而且其他地方也没有）：不是这首歌没有，过一会儿再试就好，让 App 说清楚（不要跳歌）
  if (rateLimited && !others.length) {
    return sendJson(res, 503, { code: 503, reason: 'rate-limited', msg: rateLimited.message });
  }

  if (others.length) {
    try {
      const match = require('@unblockneteasemusic/server');
      const result = await match(Number(id), others);
      // 音源给的大多是 http 链接，HTTPS 网页里会被当成混合内容拦截
      const audioUrl = result.url.replace(/^http:\/\//, 'https://');
      if (await looksLikeRealAudio(audioUrl)) {
        return sendJson(res, 200, {
          code: 200,
          data: { url: audioUrl, br: result.br, source: result.source ?? null },
        });
      }
      errors.push('找到的音频是占位文件');
    } catch (err) {
      errors.push(String(err));
    }
  }

  sendJson(res, 404, {
    code: 404,
    msg: '其他平台也没找到这首歌',
    detail: errors.join('; '),
  });
}

// 音源状态用的测试歌：网易云要 VIP 的歌（国际孤独等级，3:14），
// 和网易云没有版权、要靠 B 站的歌在 B 站挑好的视频（晴天）
const STATUS_SONG = { id: 2026303431, durationMs: 194000 };
const STATUS_BVID = 'BV1BZbSzZEGT';

/** 解灰的每个音源现在能不能用（设置页的「音源状态」，界面上只给管理员看） */
async function unblockStatus(res) {
  const [publicSources, bilibili] = await Promise.all([
    checkPublicSources(STATUS_SONG.id, STATUS_SONG.durationMs),
    checkBilibili(STATUS_BVID),
  ]);
  sendJson(res, 200, { code: 200, data: { sources: [...publicSources, bilibili], checkedAt: Date.now() } });
}

/**
 * 创建请求处理函数 (req, res) => Promise<void>
 * @param {object} [options]
 * @param {string} [options.realIP]
 * @param {string[]} [options.unmSources]
 * @param {{ supabaseUrl: string, anonKey: string }} [options.requireMember]
 *   设了就只让 LyriStage 成员使用（Vercel 上用）
 * @param {boolean} [options.addsBilibiliReferer]
 *   电脑版：主进程会替 B 站音频请求补上 Referer，解灰可以用需要 Referer 的链接
 * @param {string} [options.localToken]
 *   电脑版本机 API 用：每次启动随机产生的通行证，只有 App 自己的页面知道。
 *   请求没带对的 X-LyriStage-Token 就拒绝，浏览器里其他网站就调不了这个 API
 */
function createHandler(options = {}) {
  const realIP = options.realIP || DEFAULT_REAL_IP;
  const unmSources = options.unmSources || DEFAULT_UNM_SOURCES;
  const isMember = options.requireMember
    ? createMemberCheck(options.requireMember)
    : null;

  // API 的 util/request.js 在加载时就会读这个文件，必须先建好
  const tokenPath = path.join(os.tmpdir(), 'anonymous_token');
  if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');

  let appPromise = null;

  /** 第一次请求时初始化，之后复用 */
  function getApp() {
    if (!appPromise) {
      appPromise = (async () => {
        // 注册网易云匿名账号（不登录也能用私人 FM、推荐）并生成随机大陆 IP
        await require('@neteasecloudmusicapienhanced/api/generateConfig')();
        const {
          serveNcmApi,
        } = require('@neteasecloudmusicapienhanced/api/server');
        // serveNcmApi 一定会 listen；返回的 express app 本身就是请求处理函数，
        // 这里随便监听一个本地端口，实际请求直接交给 app 处理
        return serveNcmApi({
          port: 30000 + Math.floor(Math.random() * 20000),
          host: '127.0.0.1',
        });
      })().catch(err => {
        appPromise = null; // 初始化失败时下次请求重试
        throw err;
      });
    }
    return appPromise;
  }

  const { localToken } = options;
  // 只有 Vercel（要检查成员的那个）需要限流；电脑版本机 API 只有自己在用
  const rateLimit = options.requireMember ? createRateLimiter() : null;

  const handler = async (req, res) => {
    if (req.method === 'OPTIONS') return sendPreflight(req, res);
    // LyriStage 只用 GET；不收 POST，免得参数从请求内容里夹带进来
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { code: 405, msg: 'Method Not Allowed' });
    }
    if (localToken) {
      // Host 必须是本机：挡住 DNS rebinding（别的网域临时指到 127.0.0.1）
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      const fromThisApp = sameToken(req.headers['x-lyristage-token'], localToken);
      if (!['127.0.0.1', 'localhost'].includes(host) || !fromThisApp) {
        return sendJson(res, 403, { code: 403, msg: 'Forbidden' });
      }
    }
    if (rateLimit) {
      const wait = rateLimit(clientIp(req));
      if (wait) {
        res.setHeader('Retry-After', String(wait));
        return sendJson(res, 429, { code: 429, msg: '请求太多了，请稍后再试' });
      }
    }
    const url = new URL(req.url, 'http://localhost');
    if (isMember && !PUBLIC_PATHS.has(url.pathname) && !(await isMember(req))) {
      return sendJson(res, 401, {
        code: 401,
        msg: '请先登录 LyriStage（需要邀请码）',
      });
    }
    stripBlockedParams(req, url);
    if (url.pathname === '/song/url/match') {
      return unblock(res, url, unmSources, { addsBilibiliReferer: options.addsBilibiliReferer });
    }
    if (url.pathname === '/unblock/status') {
      return unblockStatus(res);
    }
    if (!url.searchParams.has('realIP')) {
      url.searchParams.set('realIP', realIP);
      req.url = url.pathname + url.search;
      // Vercel 的 Node 运行时会预先把参数解析进 req.query，网易云 API 读的是它，
      // 只改 req.url 不会生效（本地 node dev.js 没有这一步，所以本地测不出来）
      if (req.query && typeof req.query === 'object') req.query.realIP = realIP;
    }
    const app = await getApp();
    app(req, res);
  };
  // 提前初始化（电脑版启动时调用，第一次请求就不用等）
  handler.warmUp = () => getApp();
  return handler;
}

module.exports = { createHandler };
