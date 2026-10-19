// 本地测试 Vercel 函数：node dev.js，然后访问 http://localhost:3001/search?keywords=晴天
const http = require('http');
const handler = require('./api');

const port = Number(process.env.PORT || 3001);
http
  .createServer((req, res) => {
    handler(req, res).catch(err => {
      console.error(err);
      res.statusCode = 500;
      res.end(String(err));
    });
  })
  .listen(port, () =>
    console.log(`LyriStage API (Vercel 模拟) http://localhost:${port}`)
  );
