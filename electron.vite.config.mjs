// 电脑版构建：main（主进程）/ preload / renderer（Vue 界面）
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

export const alias = {
  '@core': resolve('src/core'),
  '@renderer': resolve('src/renderer/src'),
};

export default defineConfig({
  main: {
    // dependencies 里的包（网易云 API、解灰）不打包，运行时从 node_modules 加载：
    // 网易云 API 会在运行时扫描自己的 module 目录，打包进去反而找不到
    plugins: [externalizeDepsPlugin()],
    build: {
      // server/lib/handler.js 是 CommonJS（Vercel 也要直接用），默认只转换 node_modules 里的
      commonjsOptions: { include: [/server[\\/]lib[\\/]/, /node_modules/] },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: { alias },
    plugins: [vue()],
    // 网页版用 5173（Supabase 登录回调白名单里的地址），电脑版错开避免同时开发时冲突
    server: { port: 5174 },
  },
});
