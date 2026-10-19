// 集成测试：连真实的网易云 API，需要网络，所以和 npm test 分开
import { defineConfig } from 'vitest/config';
import { alias } from './electron.vite.config.mjs';

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/integration/**/*.int.test.js'],
    environment: 'node',
    testTimeout: 30000,
  },
});
