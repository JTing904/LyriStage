// Vercel 函数：把 @neteasecloudmusicapienhanced/api 包装成一个请求处理函数。
// vercel.json 把所有路径都转发到这里，req.url 保持原样（例如 /search?keywords=…）。
const fs = require('fs');
const os = require('os');
const path = require('path');

// 海外机房请求网易云会被限制版权，默认带上大陆 IP（前端传了 realIP 就用前端的）
const DEFAULT_REAL_IP = process.env.DEFAULT_REAL_IP || '211.161.244.70';

// API 的 util/request.js 在加载时就会读这个文件，必须先建好
const tokenPath = path.join(os.tmpdir(), 'anonymous_token');
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');

let appPromise = null;

/** 冷启动时初始化一次，同一个函数实例后续请求复用 */
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

// 解灰：网易云拿不到播放链接时，去其他平台找同一首歌。
// 新版 API 自带的 /song/url/match 用的第三方网站在马来西亚全部失效，
// 这里改用 @unblockneteasemusic/server。2026-10 在马来西亚实测：
//   pyncmd ✓（320k，部分歌曲）
//   kuwo   ✗ 海外 IP 不管搜什么都返回同一个 2.6 秒的占位音频，而且返回得快，
//            会抢在 pyncmd 前面，所以默认不用
//   其他（qq、migu、kugou、bilibili、youtube…）全部失败
const UNM_SOURCES = (process.env.UNM_SOURCES || 'pyncmd').split(',');
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

async function unblock(req, res, url) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  const id = url.searchParams.get('id');
  if (!id) return send(400, { code: 400, msg: '缺少 id' });
  const sources = url.searchParams.get('source')?.split(',') ?? UNM_SOURCES;
  try {
    const match = require('@unblockneteasemusic/server');
    const result = await match(Number(id), sources);
    // 音源给的大多是 http 链接，HTTPS 网页里会被当成混合内容拦截
    const audioUrl = result.url.replace(/^http:\/\//, 'https://');
    if (!(await looksLikeRealAudio(audioUrl))) {
      return send(404, { code: 404, msg: '找到的音频是占位文件' });
    }
    send(200, {
      code: 200,
      data: { url: audioUrl, br: result.br, source: result.source ?? null },
    });
  } catch (err) {
    send(404, {
      code: 404,
      msg: '其他平台也没找到这首歌',
      detail: String(err),
    });
  }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/song/url/match') return unblock(req, res, url);
  if (!url.searchParams.has('realIP')) {
    url.searchParams.set('realIP', DEFAULT_REAL_IP);
    req.url = url.pathname + url.search;
  }
  const app = await getApp();
  app(req, res);
};
