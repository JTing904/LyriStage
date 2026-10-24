// 打包并运行 supabase.test.js：@core 指向 src/core，Supabase 配置从 .env 读取
// 用法：npm run smoke
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '../..');

/** 把 .env 读进 process.env（已经设了的环境变量优先） */
function loadEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnv();
if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  console.error('请先在 .env 填写 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const outfile = path.join(require('os').tmpdir(), 'lyristage-smoke.js');
esbuild
  .build({
    entryPoints: [path.join(__dirname, 'supabase.test.js')],
    bundle: true,
    platform: 'node',
    outfile,
    logLevel: 'error',
    alias: { '@core': path.join(root, 'src/core') },
  })
  .then(() => require(outfile));
