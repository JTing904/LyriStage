# LyriStage

以歌词为核心的网易云音乐第三方播放器，目标是电脑（Windows / macOS / Linux）和手机都能用。

> 本项目仅用于个人学习研究，禁止用于商业及非法用途。

## 致谢

本项目基于 [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic)（MIT License）改造，原项目的版权声明见 [LICENSE](LICENSE)，原 README 见 [README.upstream.md](README.upstream.md)。

## 开发

v2：Vue 3 + Vite + Electron（electron-vite）。v1（YesPlayMusic 改名版）保留在 tag `v1-legacy`。

```bash
npm install            # 安装依赖（会自动下载 Electron）
cp .env.example .env   # 第一次：复制环境变量

npm run dev            # 电脑版（会自动在 127.0.0.1:10754 启动网易云 API）

npm run api:dev        # 网页版要先开本地 API（3001 端口）
npm run web:dev        # 再开网页版 http://localhost:5173，手机连同一个 Wi-Fi 也能访问

npm test               # 单元测试
npm run smoke          # Supabase 冒烟测试
```

在 VS Code 的扩展环境里启动 Electron 时，如果报 `Cannot read properties of undefined`，
是继承了 `ELECTRON_RUN_AS_NODE=1`，用 `env -u ELECTRON_RUN_AS_NODE npm run dev` 启动。

| 目录 | 内容 |
|---|---|
| `src/main/` | Electron 主进程：窗口、本地网易云 API |
| `src/preload/` | 页面和 Electron 之间的桥梁（`window.lyristage`） |
| `src/renderer/` | Vue 界面，电脑版和网页版共用 |
| `src/core/` | 不依赖 Vue 的核心逻辑：请求、网易云接口、歌词、用户数据、推荐算法 |
| `server/` | 网易云 API 的 Vercel 项目，已部署到 https://lyristage-api.vercel.app |
| `supabase/` | 数据库结构 |

## 用户数据（Supabase）

LyriStage 不需要网易云账号：网易云只提供歌曲、音频和歌词，"我喜欢 / 歌单 / 听歌记录 / 每日推荐 / 私人 FM" 存在自己的 Supabase 数据库里。

1. 在 [supabase.com](https://supabase.com) 新建项目（Region 选 Singapore）
   - 数据库密码（Database Password）保存在本机 `.env` 的 `SUPABASE_DB_PASSWORD`，
     `.env` 不会提交到 git；换电脑时要自己带过去，忘了可以在 Project Settings → Database 重置
2. 打开 SQL Editor，执行 [supabase/migrations/20261019000000_init.sql](supabase/migrations/20261019000000_init.sql)
3. Authentication → Sign In / Providers → Email，学习阶段可以关闭 "Confirm email"
4. 把 Project Settings → API 里的 URL 和 anon key 填进 `.env` 的 `VUE_APP_SUPABASE_URL` / `VUE_APP_SUPABASE_ANON_KEY`

代码在 [src/core/data/](src/core/data/) 和 [src/core/recommend/](src/core/recommend/)，和界面无关：

| 文件 | 内容 |
|---|---|
| `data/auth.js` | LyriStage 账号（邮箱 + 密码，之后加 GitHub / Google） |
| `data/library.js` | 我喜欢的音乐、歌单 |
| `data/history.js` | 听歌记录、听歌排行、不喜欢 |
| `recommend/engine.js` | 推荐算法（纯函数，参数在 `WEIGHTS`） |
| `recommend/index.js` | 每日推荐、私人 FM |

## 路线图（v2）

- [x] 阶段 0：Supabase、Vercel API、技术验证（[docs/phase0.md](docs/phase0.md)）
- [x] 阶段 1：electron-vite 空壳，电脑版和网页版都能搜索播放
- [ ] 阶段 2：移植核心逻辑（播放器、歌词解析含逐字歌词、缓存）+ 单元测试
- [ ] 阶段 3：歌词舞台
- [ ] 阶段 4：主要页面 + 响应式布局 + 登录（邮箱 / GitHub / Google）
- [ ] 阶段 5：手机端上线（Vercel + PWA）
- [ ] 阶段 6：托盘、桌面歌词、安装包、图标等
