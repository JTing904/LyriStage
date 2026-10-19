// 网页版 / 手机版构建：和电脑版用同一份 src/renderer
// 开发时先 `npm run api:dev` 启动本地 API（3001 端口），/api 会转发过去；
// 部署到 Vercel 后由 rewrite 把 /api/* 转到 server/ 那个项目
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { alias } from './electron.vite.config.mjs';

export default defineConfig({
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
    outDir: resolve('dist-web'),
    emptyOutDir: true,
  },
});
