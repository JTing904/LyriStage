// Electron 13 用 extract-zip（底层是 yauzl）解压，在 Node 22+ 上会静默退出，
// 只留下空的 dist/locales，启动时报 "Electron failed to install correctly"。
// 这里在 postinstall 时检查一遍，没装好就用系统自带的解压工具重新解压。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.dirname(require.resolve('electron/package.json'));
const { version } = require('electron/package.json');
const distDir = path.join(electronDir, 'dist');
const platformPath = {
  win32: 'electron.exe',
  darwin: 'Electron.app/Contents/MacOS/Electron',
  linux: 'electron',
}[process.platform];

if (!platformPath || fs.existsSync(path.join(distDir, platformPath))) {
  process.exit(0);
}

console.log(`[fix-electron] electron ${version} 未正确解压，重新解压中…`);

function unzip(zipPath) {
  fs.mkdirSync(distDir, { recursive: true });
  if (process.platform === 'linux') {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', distDir]);
    return;
  }
  // Windows 10+ 和 macOS 自带的 bsdtar 都能解 zip；
  // Windows 上写全路径，避免用到 Git Bash 里不支持 zip 的 GNU tar
  const tar =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot, 'System32', 'tar.exe')
      : 'tar';
  execFileSync(tar, ['-xf', zipPath, '-C', distDir]);
}

const { downloadArtifact } = require('@electron/get');

downloadArtifact({ version, artifactName: 'electron' })
  .then(zipPath => {
    unzip(zipPath);
    fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath);
    console.log('[fix-electron] 完成');
  })
  .catch(err => {
    console.error('[fix-electron] 失败：', err);
    process.exit(1);
  });
