// Vercel 函数入口：vercel.json 把所有路径都转发到这里，req.url 保持原样（例如 /search?keywords=…）
const { createHandler } = require('../lib/handler');

module.exports = createHandler({
  realIP: process.env.DEFAULT_REAL_IP,
  unmSources: process.env.UNM_SOURCES?.split(','),
});
