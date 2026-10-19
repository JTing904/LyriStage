// Vercel 函数入口：vercel.json 把所有路径都转发到这里，req.url 保持原样（例如 /search?keywords=…）
const { createHandler } = require('../lib/handler');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

// Vercel 上一定要上锁（只让 LyriStage 成员用）；忘了设环境变量就整个拒绝，不会变成谁都能用。
// 本地 node dev.js 没设就不上锁，方便开发
const locked = Boolean(supabaseUrl && anonKey);
const misconfigured = Boolean(process.env.VERCEL) && !locked;

const handler = createHandler({
  realIP: process.env.DEFAULT_REAL_IP,
  unmSources: process.env.UNM_SOURCES?.split(','),
  requireMember: locked ? { supabaseUrl, anonKey } : undefined,
});

module.exports = misconfigured
  ? (_req, res) => {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          code: 503,
          msg: 'API 还没设置 SUPABASE_URL / SUPABASE_ANON_KEY',
        })
      );
    }
  : handler;
