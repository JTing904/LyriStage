// 打包并运行 supabase.test.js：@/ 指向 src/，Supabase 配置从 .env 读取
// 用法：node scripts/smoke/run.js
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '../..');

function readEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf-8')
      .split(/\r?\n/)
      .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^['"]|['"]$/g, '')])
  );
}

const env = { ...readEnv(), ...process.env };
const url = env.VUE_APP_SUPABASE_URL;
const key = env.VUE_APP_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error(
    '请先在 .env 填写 VUE_APP_SUPABASE_URL 和 VUE_APP_SUPABASE_ANON_KEY'
  );
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
    define: {
      'process.env.VUE_APP_SUPABASE_URL': JSON.stringify(url),
      'process.env.VUE_APP_SUPABASE_ANON_KEY': JSON.stringify(key),
    },
    plugins: [
      {
        name: 'alias',
        setup(build) {
          build.onResolve({ filter: /^@\// }, args => ({
            path: require.resolve(path.join(root, 'src', args.path.slice(2))),
          }));
        },
      },
    ],
  })
  .then(() => require(outfile));
