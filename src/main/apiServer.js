// 本地网易云 API：和 Vercel 用同一份处理逻辑（server/lib/handler.js），
// 所以界面不管跑在电脑还是手机，请求的接口都一样
import http from 'node:http';
import { createHandler } from '../../server/lib/handler';

export const API_PORT = 10754;

export function startApiServer() {
  const handler = createHandler();
  const server = http.createServer((req, res) => {
    handler(req, res).catch(err => {
      console.error('[LyriStage API]', req.url, err);
      res.statusCode = 500;
      res.end(String(err));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // 只监听本机，局域网里的其他设备访问不到
    server.listen(API_PORT, '127.0.0.1', () => {
      console.log(`[LyriStage API] http://127.0.0.1:${API_PORT}`);
      // 启动时就注册网易云匿名账号，第一次搜索不用等
      handler
        .warmUp()
        .catch(err => console.error('[LyriStage API] 初始化失败', err));
      resolve(server);
    });
  });
}
