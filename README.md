# LyriStage

以歌词为核心的网易云音乐第三方播放器，目标是电脑（Windows / macOS / Linux）和手机都能用。

> 本项目仅用于个人学习研究，禁止用于商业及非法用途。

## 致谢

本项目基于 [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic)（MIT License）改造，原项目的版权声明见 [LICENSE](LICENSE)，原 README 见 [README.upstream.md](README.upstream.md)。

## 开发

需要 Node.js（项目原本要求 14/16，Node 18+ 需设置 `NODE_OPTIONS=--openssl-legacy-provider`）。

```bash
# 安装依赖
npx yarn@1 install --ignore-engines

# 复制环境变量
cp .env.example .env

# 启动桌面端（Electron，会自动启动内置的网易云 API 服务）
npx yarn@1 electron:serve

# 打包 Windows 安装包
npx yarn@1 electron:build-win
```

## 用户数据（Supabase）

LyriStage 不需要网易云账号：网易云只提供歌曲、音频和歌词，"我喜欢 / 歌单 / 听歌记录 / 每日推荐 / 私人 FM" 存在自己的 Supabase 数据库里。

1. 在 [supabase.com](https://supabase.com) 新建项目（Region 选 Singapore）
   - 数据库密码（Database Password）保存在本机 `.env` 的 `SUPABASE_DB_PASSWORD`，
     `.env` 不会提交到 git；换电脑时要自己带过去，忘了可以在 Project Settings → Database 重置
2. 打开 SQL Editor，执行 [supabase/migrations/20261019000000_init.sql](supabase/migrations/20261019000000_init.sql)
3. Authentication → Sign In / Providers → Email，学习阶段可以关闭 "Confirm email"
4. 把 Project Settings → API 里的 URL 和 anon key 填进 `.env` 的 `VUE_APP_SUPABASE_URL` / `VUE_APP_SUPABASE_ANON_KEY`

代码在 [src/lyristage/](src/lyristage/)，和界面无关：

| 文件 | 内容 |
|---|---|
| `auth.js` | LyriStage 账号（邮箱 + 密码） |
| `library.js` | 我喜欢的音乐、歌单 |
| `history.js` | 听歌记录、听歌排行、不喜欢 |
| `recommend/engine.js` | 推荐算法（纯函数，参数在 `WEIGHTS`） |
| `recommend/index.js` | 每日推荐、私人 FM |

## 路线图

- [x] 基于 YesPlayMusic 改名为 LyriStage
- [x] 自有用户数据 + 推荐算法（数据层）
- [ ] 用户数据接入界面
- [ ] 更换 LyriStage 图标
- [ ] UI 大改版（考虑升级 Vue 3 + Vite）
- [ ] 手机端（响应式界面，API 部署到 Vercel）
- [ ] 歌词展示增强
