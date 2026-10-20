<div align="center">

<img src="docs/images/icon-256.png" width="96" alt="LyriStage 图标">

# LyriStage

**让歌词站上舞台。**

以歌词为主角的音乐播放器，支持 Windows、Android 和 iPhone。<br>
九种全屏歌词舞台、按你口味每天更新的推荐，还能开房间和朋友同一秒听同一句。

[官网](https://jting904.github.io/LyriStage/) · [下载](https://github.com/JTing904/LyriStage/releases/latest) · [网页版](https://lyristage.vercel.app) · [English](README.md)

![版本](https://img.shields.io/badge/version-2.0.0-ff3b5c) ![许可证](https://img.shields.io/badge/code-MIT-blue) ![平台](https://img.shields.io/badge/platforms-Windows%20%7C%20Android%20%7C%20iPhone-555)

<a href="https://jting904.github.io/LyriStage/"><img src="docs/images/trailer-poster.webp" width="760" alt="LyriStage 宣传片：到官网观看"></a>

</div>

## 功能

- **九种歌词舞台**：唱到哪个字就亮哪个字，每句下面有翻译。播放中随时切换风格。
- **每日推荐、私人 FM**：每天早上一份新歌单，由 LyriStage 自己的推荐算法根据你的听歌记录挑选，不需要网易云账号。
- **一起听**：开一个房间，把六位房间码发给朋友，大家同一时间听同一首。房主播放、暂停、切歌，所有人都会同步。
- **自己的音乐库**：我喜欢、歌单、听歌记录、个人名字和头像，电脑和手机同步。
- **Windows**：托盘、最小化时的桌面歌词、首页的 3D 公仔。
- **Android**：后台播放、锁屏和通知栏控制。
- **iPhone**：网页版，可以加到主屏幕。
- **中文 / English**，深色、浅色主题。

目前是**邀请制**：谁都可以先逛逛；要听歌、收藏、建歌单，需要登录并输入成员给你的邀请码。

## 歌词舞台

| | | |
|:-:|:-:|:-:|
| <img src="docs/images/stage-perspective.webp" width="260" alt="3D 透视"><br>**3D 透视**<br>清晰封面做背景，整列歌词立体倾斜 | <img src="docs/images/stage-scroll.webp" width="260" alt="滚动歌词"><br>**滚动歌词**<br>逐字点亮，背景是流动的封面色 | <img src="docs/images/stage-karaoke.webp" width="260" alt="卡拉OK"><br>**卡拉OK**<br>KTV 双行交替，逐字填色 |
| <img src="docs/images/stage-vertical.webp" width="260" alt="竖排诗词"><br>**竖排诗词**<br>宣纸书法，红色印章 | <img src="docs/images/stage-mv.webp" width="260" alt="动态 MV"><br>**动态 MV**<br>每段不同大小、角度和颜色 | <img src="docs/images/stage-vinyl.webp" width="260" alt="黑胶唱片"><br>**黑胶唱片**<br>转动的黑胶和唱臂 |
| <img src="docs/images/stage-block.webp" width="260" alt="色块"><br>**色块**<br>整片封面主色，大号粗体 | <img src="docs/images/stage-typewriter.webp" width="260" alt="打字机"><br>**打字机**<br>复古终端，一个字一个字打出来 | <img src="docs/images/stage-kinetic.webp" width="260" alt="单行大字"><br>**单行大字**<br>一次一句，超大做旧字体 |

## 截图

<img src="docs/images/shot-desktop.webp" width="640" alt="Windows 版首页"> <img src="docs/images/phone-home.webp" width="150" alt="手机版首页"> <img src="docs/images/phone-playlist.webp" width="150" alt="手机版歌单">

## 下载

| 平台 | 方法 |
|---|---|
| Windows 10 / 11（64 位） | [LyriStage-Setup.exe](https://github.com/JTing904/LyriStage/releases/latest/download/LyriStage-Setup.exe)。安装包还没有代码签名，如果出现"Windows 已保护你的电脑"，点**更多信息 → 仍要运行**。 |
| Android 7.0+ | [LyriStage.apk](https://github.com/JTing904/LyriStage/releases/latest/download/LyriStage.apk)。手机问的时候，允许浏览器安装应用。 |
| iPhone | 用 Safari 打开 [lyristage.vercel.app](https://lyristage.vercel.app)，再点**分享 → 添加到主屏幕**。 |

## 架构

| 部分 | 用到的技术 |
|---|---|
| App 界面（电脑、Android、网页共用） | Vue 3、Pinia、Vue Router、vue-i18n、three.js |
| 电脑版 | Electron + electron-vite，electron-builder（NSIS 安装包） |
| Android | Capacitor |
| 账号和用户数据 | Supabase：Auth（邮箱、GitHub、Google）、带 RLS 的 Postgres、Realtime（一起听）、Storage（头像） |
| 网页版和 Android 的音乐 API | 部署在 Vercel 的网易云音乐 API，只让成员使用 |
| 测试 | Vitest |

歌曲信息、音频和歌词来自网易云音乐（通过社区维护的 API）。"我喜欢、歌单、听歌记录、每日推荐、私人 FM"都存在 LyriStage 自己的 Supabase 数据库，不需要网易云账号。

```
src/main/       Electron 主进程：窗口、托盘、桌面歌词、本地音乐 API
src/preload/    页面和 Electron 之间的桥梁（window.lyristage）
src/renderer/   Vue 界面，电脑版、Android、网页版共用
src/core/       不依赖界面的核心逻辑：请求、网易云接口、歌词、用户数据、推荐算法
server/         部署到 Vercel 的音乐 API（每个请求都先检查是不是成员）
supabase/       数据库迁移
android/        Capacitor 的 Android 项目
```

## 开发

需要 Node.js（开发时用的是 24），做 Android 还需要 Android Studio。

```bash
npm install
cp .env.example .env      # 再填入 Supabase 的网址和 anon key

npm run dev               # 电脑版，会在 127.0.0.1:10754 启动本地音乐 API
npm test                  # 单元测试

npm run api:dev           # 网页版：先开本地音乐 API（3001 端口）
npm run web:dev           # 网页版：http://localhost:5173（同一个 Wi-Fi 的手机也能打开）
```

在 VS Code 的终端启动 Electron，如果报 `Cannot read properties of undefined`，是继承了 `ELECTRON_RUN_AS_NODE=1`，改用 `env -u ELECTRON_RUN_AS_NODE npm run dev`。

### 自己架后端

1. 在 [Supabase](https://supabase.com) 新建项目。
2. 在 SQL Editor 里按顺序执行 [supabase/migrations](supabase/migrations) 的文件：
   `init`（用户数据）、`invites`（邀请制）、`listen_together`、`avatars`、
   `security`（一起听只有房主能广播、更安全的邀请码）、`room_chat` 和 `room_chat_fix`（一起听聊天）、
   `room_handover`（房主转让）、`delete_account`（在设置页删除账号）。
3. Authentication → Providers：打开 Email（要 GitHub / Google 登录的话也打开）。
   在 URL Configuration 的 Redirect URLs 加上 `lyristage://auth/callback`（电脑版登录）和 `http://localhost:5173/**`（网页版开发）。
4. 把项目网址和 anon key 填进 `.env`（`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`）。
5. 把 `server/` 部署到 Vercel，环境变量设 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`，再把 `.env.web`、`.env.app` 的 `VITE_API_BASE` 改成它的网址。

邀请码可以在 App 的**设置 → 邀请朋友**生成（管理员才看得到），也可以在 SQL Editor 里：

```sql
select public.create_invite();               -- 一次性邀请码
select public.create_invite(5, '大学同学');    -- 可以用 5 次
update public.members set is_admin = true where user_id = '…';  -- 设别人当管理员
```

### 打包

```bash
npm run dist:win     # Windows 安装包，输出在 release/
npm run app:apk      # Android debug 版 APK
npm run web:deploy   # 网页版部署到 Vercel
```

正式版 APK 用 `android/keystore.properties` 里写的金钥签名（`storeFile`、`storePassword`、`keyAlias`、`keyPassword`）。这个文件不在仓库里，没有它只能打 debug 版。

## 许可证

- **代码**：[MIT](LICENSE)。
- **3D 公仔模型**（`src/renderer/public/models/`）：© JTing904，保留所有权利，**不适用** MIT 许可证，请勿使用或转载。详见[模型说明](src/renderer/public/models/NOTICE.md)。

## 致谢

- [YesPlayMusic](https://github.com/qier222/YesPlayMusic)，作者 qier222（MIT）。LyriStage 从它分支出来，原 README 见 [README.upstream.md](README.upstream.md)。
- [NeteaseCloudMusicApi Enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 提供音乐 API。
- [Supabase](https://supabase.com)、[Electron](https://www.electronjs.org)、[Capacitor](https://capacitorjs.com)、[Vue](https://vuejs.org)、[three.js](https://threejs.org)。

## 声明

LyriStage 是个人学习项目，与网易云音乐没有任何关系，也没有得到其认可。歌曲和歌词的版权属于原权利人。禁止用于商业用途。

---

作者 [JTing904](https://github.com/JTing904) · Instagram [@jtinnnng](https://www.instagram.com/jtinnnng/)
