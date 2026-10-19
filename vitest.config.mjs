// 单元测试：只测 src/core（不依赖 Vue / Electron 的核心逻辑）
import { defineConfig } from 'vitest/config';
import { alias } from './electron.vite.config.mjs';

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['src/core/**/*.test.js'],
    environment: 'node',
  },
});
