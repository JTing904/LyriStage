// 发布前检查手机排版：在接着电脑的 Android 设备（平板也可以）上，把画面调成几种手机尺寸，
// 中文、英文各跑一遍主要页面，自动找出：
//   - 字被挤成两行（按钮、分页、标题这些短字）
//   - 东西跑出画面（页面可以左右滑、元素超出画面）
//   - 底部多一截空白（导航列的空间垫了两次）
//   - 重要的按钮被盖住或碰不到（例如横屏时聊天输入框）
// 每一页都截图（有问题的地方框红色），最后产生 out/report.html。
//
// 用法：
//   npm run layout:check              设备上已经装了可以调试的版本
//   npm run layout:check -- --install 先打包一个可以调试的版本装上去（签名跟正式版一样，不用删 App、登录还在）
//   其他选项：--profiles phone-412,phone-360  --locales zh-CN,en  --pages home,room
// 需要：adb、设备上的 App 已登录成员账号；跑完会把设备的画面尺寸、方向、导航列改回原样。
// 注意：--install 装的版本开着 WebView 调试，发布时照 release-process 重新打包（cap copy 会把调试关掉）。
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out');
const APP = 'com.jting904.lyristage';
const PORT = 9333;
const ADB = process.env.ADB || path.join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk/platform-tools/adb.exe');
const adb = (...args) => execFileSync(ADB, args, { maxBuffer: 64 << 20 }).toString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};

/** 手机尺寸：size / density 换算成 CSS 宽度（1080/2.625 ≈ 411、720/2 = 360） */
const PROFILES = [
  { id: 'phone-412', label: '手机 412 直屏', size: '1080x2400', density: 420, rotation: 0 },
  { id: 'phone-360', label: '小手机 360 直屏', size: '720x1560', density: 320, rotation: 0 },
  { id: 'phone-land', label: '手机横屏', size: '1080x2400', density: 420, rotation: 1 },
  { id: 'tablet-land', label: '平板横屏（电脑版排版）', size: null, density: null, rotation: 1 },
];
const LOCALES = ['zh-CN', 'en'];

/**
 * 要检查的页面
 * - reach：一定要按得到的东西（会卷过去，看有没有被盖住）
 * - seeLandscape：横屏时不用卷就要看得到的东西（例如一起听的聊天输入框）
 */
const PAGES = [
  { id: 'home', hash: '#/', reach: ['.search input'] },
  { id: 'search', hash: '#/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6', wait: 4000 },
  { id: 'friends', hash: '#/friends', reach: ['.add-btn'] },
  { id: 'library', hash: '#/library' },
  { id: 'liked', hash: '#/liked' },
  { id: 'playlist', hash: '#/playlist/3778678', wait: 4000 },
  { id: 'artist', hash: '#/artist/6452', wait: 4000 },
  { id: 'settings', hash: '#/settings' },
  { id: 'settings-account', hash: '#/settings?c=account' },
  { id: 'settings-appearance', hash: '#/settings?c=appearance' },
  {
    id: 'room',
    hash: '#/room',
    room: true,
    reach: ['.composer input', '.room-top .round-btn', '.voice-btn'],
    seeLandscape: ['.composer input'],
  },
  { id: 'lyrics', stage: true },
];

// ---------------------------------------------------------------------------------------------
// 在页面里跑的检查（不能用外面的变数）

function CHECK({ reach, see }) {
  const issues = [];
  const W = innerWidth;
  const H = innerHeight;
  document.querySelectorAll('[data-lc]').forEach(el => {
    el.removeAttribute('data-lc');
    el.style.outline = '';
  });
  const mark = el => {
    el.setAttribute('data-lc', '1');
    el.style.outline = '3px solid #ff0040';
    el.style.outlineOffset = '-1px';
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const describe = el => {
    const cls = [...el.classList].filter(c => !c.startsWith('v-')).slice(0, 2).join('.');
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}「${text}」`;
  };
  /**
   * 在可以左右滑的那种区块里（例如便签那一排）：超出画面是正常的。
   * 整页往下卷的内容区（main）不算：它的 overflow-x 也会变成 auto，但页面本来就不该左右滑
   */
  const MAIN = 'main, .area-main';
  const inScroller = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.matches(MAIN)) return false;
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  /** 被外框裁掉、看不到超出的部分（例如歌词背景那张放大的模糊封面） */
  const clippedInside = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.matches(MAIN)) return false;
      if (!/(hidden|clip)/.test(getComputedStyle(p).overflowX)) continue;
      const r = p.getBoundingClientRect();
      return r.left >= -2 && r.right <= W + 2;
    }
    return false;
  };

  // 1. 东西跑出画面
  const scrollWidth = document.scrollingElement.scrollWidth;
  if (scrollWidth > W + 1) issues.push({ kind: '跑出画面', text: `整页可以左右滑（内容宽 ${scrollWidth}，画面 ${W}）` });
  for (const main of document.querySelectorAll(MAIN)) {
    if (main.scrollWidth > main.clientWidth + 1) {
      issues.push({ kind: '跑出画面', text: `内容区可以左右滑（内容宽 ${main.scrollWidth}，可见 ${main.clientWidth}）` });
    }
  }
  const overflowing = [];
  for (const el of document.querySelectorAll('button, a, input, h1, h2, h3, p, img, li, label, [class*="chip"], [class*="card"]')) {
    if (!visible(el) || inScroller(el) || clippedInside(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= W + 2 && r.left >= -2) continue;
    if (overflowing.some(o => o.contains(el))) continue;
    overflowing.push(el);
    mark(el);
    issues.push({ kind: '跑出画面', text: `${describe(el)} 超出画面（左 ${Math.round(r.left)}、右 ${Math.round(r.right)}，画面宽 ${W}）` });
  }

  // 2. 短字被挤成两行：一段字（同一个文字节点）跨了两行以上
  const LABELS = 'button, a, [role="tab"], [role="menuitem"], label, h1, h2, h3, th, nav, [class*="chip"], [class*="badge"], [class*="tag"]';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const wrapped = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (!text || [...text].length > 18) continue;
    const owner = node.parentElement?.closest(LABELS);
    if (!owner || wrapped.has(owner) || !visible(owner) || inScroller(owner)) continue;
    // 本来就允许换行的（例如便签泡泡、歌名）跳过
    const ws = getComputedStyle(node.parentElement);
    if (ws.webkitLineClamp && ws.webkitLineClamp !== 'none') continue;
    // 被切掉、又没有「…」：例如底部分页的 Listen Togethe（有「…」的是歌名那种，本来就会切）
    const box = node.parentElement;
    const bs = getComputedStyle(box);
    if (box.scrollWidth > box.clientWidth + 1 && bs.textOverflow !== 'ellipsis' && /(hidden|clip)/.test(bs.overflowX)) {
      wrapped.add(owner);
      mark(owner);
      issues.push({ kind: '字被切掉', text: `${describe(owner)}：「${text}」放不下被切掉了` });
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top / 4)));
    // 英文标题在空格换行是正常的；按钮、分页上的字换行就不行，中文标题一个词被拆开也不行
    if (tops.size > 1 && !(owner.matches('h1, h2, h3') && /\s/.test(text))) {
      wrapped.add(owner);
      mark(owner);
      issues.push({ kind: '挤成两行', text: `${describe(owner)}：「${text}」被挤成 ${tops.size} 行` });
    }
  }

  // 3. 底部多一截空白：手机直屏时，外框和底部 Tab 都垫了导航列的高度
  const tabs = document.querySelector('.area-mobile .tabs');
  if (tabs && visible(tabs) && W < H) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)';
    document.body.append(probe);
    const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    const app = parseFloat(getComputedStyle(document.querySelector('#app')).paddingBottom) || 0;
    const tabsPad = parseFloat(getComputedStyle(tabs).paddingBottom) || 0;
    if (app + tabsPad > inset + 2) {
      mark(tabs);
      issues.push({ kind: '底部空白', text: `底部垫了 ${app + tabsPad}px，导航列只要 ${inset}px（多了 ${app + tabsPad - inset}px）` });
    }
  }

  // 4. 不用卷就要看得到（横屏时的聊天输入框这种）
  for (const selector of see) {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const hit = r.bottom <= H && r.top >= 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || (!el.contains(hit) && !hit.contains(el))) {
      mark(el);
      issues.push({ kind: '看不到', text: `${describe(el)} 要往下卷才看得到（上 ${Math.round(r.top)}、下 ${Math.round(r.bottom)}，画面高 ${H}）` });
    }
  }

  // 5. 重要的东西：卷过去以后看得到、没被别的东西盖住
  for (const selector of reach) {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (!el) continue;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.bottom > H + 1 || r.top < -1) {
      mark(el);
      issues.push({ kind: '碰不到', text: `${describe(el)} 卷不到画面里（上 ${Math.round(r.top)}、下 ${Math.round(r.bottom)}，画面高 ${H}）` });
      continue;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && !el.contains(hit) && !hit.contains(el)) {
      mark(el);
      issues.push({ kind: '被盖住', text: `${describe(el)} 被 ${describe(hit)} 盖住` });
    }
  }
  return { issues, width: W, height: H };
}

// ---------------------------------------------------------------------------------------------

function installDebuggable() {
  const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env } });
  console.log('打包可以调试的版本…');
  run('npx vite build --config vite.web.config.mjs --mode app');
  run('npx cap copy android');
  const config = path.join(ROOT, 'android/app/src/main/assets/capacitor.config.json');
  const json = JSON.parse(fs.readFileSync(config, 'utf8'));
  json.android = { ...json.android, webContentsDebuggingEnabled: true };
  fs.writeFileSync(config, JSON.stringify(json, null, 2));
  const javaHome = process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr';
  // 写完整路径：有的环境不会在目前的资料夹找执行档
  execSync(`"${path.join(ROOT, 'android', 'gradlew.bat')}" assembleRelease -q`, {
    cwd: path.join(ROOT, 'android'),
    stdio: 'inherit',
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      ANDROID_HOME: process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk'),
    },
  });
  console.log(adb('install', '-r', path.join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk')).trim());
}

/** 记下设备现在的画面设定，跑完改回来 */
function saveDisplay() {
  const navbar = adb('shell', 'cmd', 'overlay', 'list').split('\n').find(l => /\[x\].*systemui\.navbar\./.test(l));
  return {
    rotation: adb('shell', 'settings', 'get', 'system', 'user_rotation').trim(),
    auto: adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').trim(),
    navbar: navbar?.replace(/.*\]\s*/, '').trim() ?? null,
  };
}
function restoreDisplay(saved) {
  adb('shell', 'wm', 'size', 'reset');
  adb('shell', 'wm', 'density', 'reset');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', saved.rotation === 'null' ? '0' : saved.rotation);
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', saved.auto === 'null' ? '1' : saved.auto);
  if (saved.navbar) adb('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', saved.navbar);
}
function applyProfile(p) {
  if (p.size) adb('shell', 'wm', 'size', p.size);
  else adb('shell', 'wm', 'size', 'reset');
  if (p.density) adb('shell', 'wm', 'density', String(p.density));
  else adb('shell', 'wm', 'density', 'reset');
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', String(p.rotation));
  // 三个按钮的导航列（最高、最容易出问题）；有的平板会改用工作列，也一样有底部空间
  try {
    adb('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.threebutton');
  } catch {
    // 这台没有三个按钮的选项
  }
}

/** 连上 App 的 WebView（换尺寸后 App 会重新载入，要重新连） */
async function connect() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const pid = adb('shell', 'pidof', APP).trim();
      if (pid) {
        adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 5000 });
        const page = browser.contexts().flatMap(c => c.pages())[0];
        if (page) {
          await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__, null, { timeout: 15000 });
          return { browser, page };
        }
      }
    } catch {
      // 还没好，等一下再试
    }
    await sleep(2000);
  }
  throw new Error('连不上 App 的 WebView：设备上要装可以调试的版本（加 --install）');
}

const store = name => `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('${name}')`;

async function main() {
  try {
    adb('get-state');
  } catch {
    throw new Error('找不到 Android 设备：用 USB 接上并允许调试');
  }
  if (process.argv.includes('--install')) installDebuggable();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const profiles = arg('profiles') ? PROFILES.filter(p => arg('profiles').split(',').includes(p.id)) : PROFILES;
  const locales = arg('locales') ? arg('locales').split(',') : LOCALES;
  const pages = arg('pages') ? PAGES.filter(p => arg('pages').split(',').includes(p.id)) : PAGES;
  const saved = saveDisplay();
  adb('shell', 'am', 'start', '-n', `${APP}/.MainActivity`);
  await sleep(4000);
  let { browser, page } = await connect();
  const originalLocale = await page.evaluate(() => localStorage.getItem('lyristage:locale'));
  const results = [];
  let openedRoom = false;

  try {
    for (const profile of profiles) {
      applyProfile(profile);
      await sleep(5000);
      for (const locale of locales) {
        await browser.close().catch(() => {});
        ({ browser, page } = await connect());
        await page.evaluate(l => localStorage.setItem('lyristage:locale', l), locale);
        await page.evaluate(() => location.reload());
        await sleep(5000);
        ({ browser, page } = await connect());
        for (const p of pages) {
          const name = `${profile.id}-${locale}-${p.id}`;
          if (p.stage) {
            // 全屏歌词（设备上最好有一首正在播的歌，不然只看得到空的舞台）
            await page.evaluate(`${store('ui')}.stageOpen = true`);
          } else {
            if (p.room && !(await page.evaluate(`${store('room')}.inRoom`))) {
              await page.evaluate(`${store('room')}.createRoom()`);
              openedRoom = true;
            }
            await page.evaluate(h => (location.hash = h), p.hash);
          }
          await sleep(p.wait ?? 2500);
          const see = profile.rotation === 1 ? p.seeLandscape ?? [] : [];
          const { issues, width, height } = await page.evaluate(CHECK, { reach: p.reach ?? [], see });
          await page.evaluate(() => document.scrollingElement && (document.querySelector('.area-main') ?? document.scrollingElement).scrollTo(0, 0)).catch(() => {});
          fs.writeFileSync(path.join(OUT, `${name}.png`), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
          await page.evaluate(() => document.querySelectorAll('[data-lc]').forEach(el => ((el.style.outline = ''), el.removeAttribute('data-lc'))));
          if (p.stage) await page.evaluate(`${store('ui')}.stageOpen = false`);
          results.push({ name, profile: profile.label, locale, page: p.id, width, height, issues });
          const mark = issues.length ? `✗ ${issues.length}` : '✓';
          console.log(`${mark.padEnd(4)} ${profile.id.padEnd(12)} ${locale.padEnd(6)} ${p.id}`);
          for (const issue of issues) console.log(`       [${issue.kind}] ${issue.text}`);
        }
      }
    }
  } finally {
    // 改回原本的语言、关掉测试房间、画面设定改回来
    try {
      ({ browser, page } = await connect());
      if (openedRoom) await page.evaluate(`${store('room')}.leave()`).catch(() => {});
      await page.evaluate(l => (l ? localStorage.setItem('lyristage:locale', l) : localStorage.removeItem('lyristage:locale')), originalLocale);
      await page.evaluate(() => location.reload()).catch(() => {});
    } catch {
      // 连不上就算了
    }
    restoreDisplay(saved);
    await browser?.close().catch(() => {});
  }

  writeReport(results);
  const bad = results.filter(r => r.issues.length);
  console.log(`\n${results.length} 个画面，${bad.length} 个有问题。报告：${path.join(OUT, 'report.html')}`);
  process.exit(bad.length ? 1 : 0);
}

function writeReport(results) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cards = results
    .sort((a, b) => b.issues.length - a.issues.length)
    .map(
      r => `<figure class="${r.issues.length ? 'bad' : ''}">
  <a href="${r.name}.png"><img src="${r.name}.png" loading="lazy" alt=""></a>
  <figcaption><b>${esc(r.page)}</b> · ${esc(r.profile)} · ${esc(r.locale)} · ${r.width}×${r.height}
  ${r.issues.map(i => `<div class="issue">[${esc(i.kind)}] ${esc(i.text)}</div>`).join('')}</figcaption>
</figure>`
    )
    .join('\n');
  const bad = results.filter(r => r.issues.length).length;
  fs.writeFileSync(
    path.join(OUT, 'report.html'),
    `<!doctype html><meta charset="utf-8"><title>排版检查</title>
<style>
body{margin:0;padding:24px;font:14px system-ui,sans-serif;background:#111;color:#eee}
h1{margin:0 0 4px}p{color:#aaa;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
figure{margin:0;padding:8px;border-radius:12px;background:#1c1c1f}
figure.bad{outline:2px solid #ff3b5c}
img{width:100%;border-radius:6px;display:block}
figcaption{margin-top:8px;line-height:1.5}
.issue{color:#ff8098;font-size:12px}
</style>
<h1>排版检查</h1><p>${results.length} 个画面，${bad} 个有问题（有问题的排前面，红框是出问题的地方）</p>
<div class="grid">${cards}</div>`
  );
}

main().catch(err => {
  console.error('失败：', err.message);
  process.exit(2);
});
