// 网页版 / 手机 App 构建：和电脑版用同一份 src/renderer
// - 开发：先 `npm run api:dev` 启动本地 API（3001 端口），/api 会转发过去
// - --mode app：Android App（Capacitor），输出到 dist-web，API 用 .env.app 的 Vercel 网址
// - --mode web：部署到 Vercel 的网页版（iPhone 用），输出到 deploy/lyristage，API 同样走 Vercel
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { alias } from './electron.vite.config.mjs';

export default defineConfig(({ mode }) => ({
  root: resolve('src/renderer'),
  envDir: resolve('.'),
  resolve: { alias },
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    // 部署用的文件夹名字就是 Vercel 上的项目名
    outDir: resolve(mode === 'web' ? 'deploy/lyristage' : 'dist-web'),
    emptyOutDir: true,
  },
}));
