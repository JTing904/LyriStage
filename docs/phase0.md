# 阶段 0 验证结果（2026-10-19，马来西亚）

## 网易云 API

- `@neteaseapireborn/api` 已在 npm 上标记为**不再维护**；`server/` 改用后继项目
  `@neteasecloudmusicapienhanced/api@4.41.1`（MIT，NeteaseCloudMusicApiEnhanced/api-enhanced）。
  入口结构相同（`server.serveNcmApi`、`generateConfig`），v2 桌面版也用它。
- 不登录、带 `realIP=211.161.244.70` 时可用：搜索、`song/url/v1`（很多歌 320k）、`lyric/new`、
  `recommend/songs`（匿名推荐）、`personal_fm`、`artist/top/song`、`simi/playlist`。
  `simi/song` 返回空，`simi/artist` 需要登录。
- 匿名能用推荐和 FM，是因为启动时 `generateConfig()` 注册了网易云匿名账号（`anonymous_token`）。
- 新包启动时日志会报 `xeapi public key is missing`，目前测过的接口都不受影响，先观察。

## 三项技术检查

| 检查 | 结果 | 处理 |
|---|---|---|
| 音频链接是不是 https | API 返回 `http://`；换成 `https://` 后同一地址返回 206，`Access-Control-Allow-Origin: *` | core 统一改成 https |
| 封面能不能被 canvas 读取 | `p*.music.126.net` 返回 `Access-Control-Allow-Origin: *` | 前端直接取色，不需要代理 |
| 有没有逐字歌词 yrc | 只有部分歌有：孤勇者有；起风了、晴天、有你爱就明媚没有 | 必须做"按字分配时长"的退路 |

yrc 格式：`[行开始ms,行时长ms](字开始ms,字时长ms,0)字(…)字…`，前面几行是 JSON 格式的作词作曲信息。

## 解灰（找其他平台的同一首歌）

- 新包自带的 `/song/url/match` 走的 7 个第三方网站在马来西亚**全部失败**。
- 改用 `@unblockneteasemusic/server@0.28.0`，逐个音源测试：

| 音源 | 结果 |
|---|---|
| pyncmd | ✓ 部分歌曲，320k，约 1 秒 |
| kuwo | ✗ **海外 IP 不管搜什么都返回同一个 2.6 秒、16KB 的占位音频**（搜索本身是对的） |
| bodian、qq、migu、kugou、bilibili、youtube、ytdlp | ✗ |

- 因此 `server/` 默认只用 pyncmd，并加了占位检查（小于 300KB 的音频视为占位）。
- 结论：**海外服务端解灰能力有限**，晴天这类歌在手机端暂时播不了。
  桌面版可以在阶段 1 测试 ytdlp（需要本机安装 yt-dlp，YouTube 在马来西亚可用）。

## 本地模拟 Vercel（server/）

`cd server && npm install && node dev.js`，然后访问 `http://localhost:3001/...`。
冷启动首个请求约 5.5 秒，之后单个请求 0.7–1.3 秒。

## 还需要你操作的

1. **Supabase**：建项目（Singapore）→ SQL Editor 执行 `supabase/migrations/20261019000000_init.sql`
   → 关闭 Email 的 "Confirm email" → 把 URL 和 anon key 填进 `.env` → 运行 `node scripts/smoke/run.js`。
2. **Vercel**：登录 vercel.com → Add New Project → 导入 LyriStage 仓库 → Root Directory 选 `server`
   → Deploy。部署完用手机流量打开 `https://<项目名>.vercel.app/search?keywords=晴天` 看能不能返回结果。
