// LyriStage 的网易云 API 请求处理（Vercel 和电脑版主进程共用）
//
// - 其他路径交给 @neteasecloudmusicapienhanced/api，默认带上大陆 realIP
// - /song/url/match（解灰）自己实现，见下面 unblock()
const fs = require('fs');
const os = require('os');
const path = require('path');

// 海外请求网易云会被限制版权，默认带上大陆 IP（请求里已有 realIP 就用请求的）
const DEFAULT_REAL_IP = '211.161.244.70';

// 解灰：网易云拿不到播放链接时，去其他平台找同一首歌。
// 新版 API 自带的 /song/url/match 用的第三方网站在马来西亚全部失效，
// 这里改用 @unblockneteasemusic/server。2026-10 在马来西亚实测：
//   pyncmd ✓（320k，部分歌曲）
//   kuwo   ✗ 海外 IP 不管搜什么都返回同一个 2.6 秒的占位音频，而且返回得快，
//            会抢在 pyncmd 前面，所以默认不用
//   其他（qq、migu、kugou、bilibili、youtube…）全部失败
const DEFAULT_UNM_SOURCES = ['pyncmd'];
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

async function unblock(res, url, sources) {
  const id = url.searchParams.get('id');
  if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
  const requested = url.searchParams.get('source');
  try {
    const match = require('@unblockneteasemusic/server');
    const result = await match(
      Number(id),
      requested ? requested.split(',') : sources
    );
    // 音源给的大多是 http 链接，HTTPS 网页里会被当成混合内容拦截
    const audioUrl = result.url.replace(/^http:\/\//, 'https://');
    if (!(await looksLikeRealAudio(audioUrl))) {
      return sendJson(res, 404, { code: 404, msg: '找到的音频是占位文件' });
    }
    sendJson(res, 200, {
      code: 200,
      data: { url: audioUrl, br: result.br, source: result.source ?? null },
    });
  } catch (err) {
    sendJson(res, 404, {
      code: 404,
      msg: '其他平台也没找到这首歌',
      detail: String(err),
    });
  }
}

/**
 * 创建请求处理函数 (req, res) => Promise<void>
 * @param {{ realIP?: string, unmSources?: string[] }} [options]
 */
function createHandler(options = {}) {
  const realIP = options.realIP || DEFAULT_REAL_IP;
  const unmSources = options.unmSources || DEFAULT_UNM_SOURCES;

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

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/song/url/match') {
      return unblock(res, url, unmSources);
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
