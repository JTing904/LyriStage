// 单元测试：只测 src/core（不依赖 Vue / Electron 的核心逻辑）
import { defineConfig } from 'vitest/config';
import { alias } from './electron.vite.config.mjs';

export default defineConfig({
  resolve: {
    alias: [
      ...Object.entries(alias).map(([find, replacement]) => ({ find, replacement })),
      // Edge Function 用 Deno 的 npm: 写法，测试时换成项目装好的
      { find: /^npm:@supabase\/supabase-js@2$/, replacement: '@supabase/supabase-js' },
    ],
  },
  test: {
    include: ['src/core/**/*.test.js', 'server/lib/**/*.test.js', 'supabase/functions/**/*.test.js'],
    environment: 'node',
  },
});
