// 发版前在平板上用测试账号走一遍主要流程，量每一步花多久；太慢或失败就报出来
// （排版检查只看画面，这个看用起来快不快：像「刚打开就按 FM 要 20 秒」「下一首要 11 秒」这种问题）
//
// 用法：npm run flow:check
//   平板要用 USB 接着、装可以调试的版本（先跑过 npm run layout:check -- --install），登录测试账号
//   --only fm,search  只跑这几步（看下面 STEPS 的 id）
//
// 只播放、搜索、打开歌单；离线那步会把一首还没存的歌存到手机、测完删掉（原本就存着的不动）。
// 不改歌单、喜欢，不按「不喜欢」。测完暂停、网络改回来。
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const path = require('path');

const ADB = path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const APP = 'com.jting904.lyristage';
const PORT = 9335;
const PLAYLIST = '3778678';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8' });
/** --name=值 或 --name 值 */
function arg(name) {
  const i = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  return process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1];
}

/** 系统的媒体通知：这个 App 现在是不是在播、播的是哪一首 */
function mediaState() {
  const dump = adb('shell', 'dumpsys', 'media_session');
  const block = dump.split(/\n\s*\n/).find(b => b.includes(`package=${APP}`)) ?? '';
  return {
    playing: /state=PlaybackState \{state=PLAYING/.test(block),
    title: block.match(/description=([^,\n]*)/)?.[1] ?? '',
  };
}
const pause = () => adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');

/** 等到 test() 成立，回传花了几毫秒；超过 timeout 回传 null */
async function waitFor(test, timeout, every = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await test()) return Date.now() - start;
    await sleep(every);
  }
  return null;
}

let browser;
let page;
let cdp;
/** 每个请求花多久：太慢时列出最慢的几个，方便查是卡在哪里 */
let requests = [];

async function connect() {
  let pid = '';
  await waitFor(() => {
    try {
      pid = adb('shell', 'pidof', APP).trim();
    } catch {
      pid = '';
    }
    return pid;
  }, 20000, 300);
  if (!pid) throw new Error('App 没有开起来');
  adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  let lastError;
  for (let i = 0; i < 20; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      page = browser.contexts().flatMap(c => c.pages())[0];
      if (page) break;
    } catch (err) {
      lastError = err;
    }
    await sleep(300);
  }
  if (!page) throw new Error(`连不上 App 的 WebView（要装可以调试的版本）：${lastError?.message ?? ''}`);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  page.on('request', r => requests.push({ url: r.url(), start: Date.now(), end: null }));
  const done = r => {
    const entry = requests.findLast(e => e.url === r.url() && e.end === null);
    if (entry) entry.end = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__, null, { timeout: 30000 });
  // 「确认你的名字」只跳一次：先关掉，不帮用户确认
  await page.evaluate(() => document.querySelector('dialog.name-sheet[open]')?.close()).catch(() => {});
}

/** 把 App 整个关掉重开（冷启动） */
async function relaunch() {
  await browser?.close().catch(() => {});
  adb('shell', 'am', 'force-stop', APP);
  await sleep(800);
  const start = Date.now();
  adb('shell', 'am', 'start', '-n', `${APP}/.MainActivity`);
  requests = [];
  await connect();
  return start;
}

const network = conditions => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, ...conditions });
const SLOW_3G = { latency: 400, downloadThroughput: 50_000, uploadThroughput: 25_000, connectionType: 'cellular3g' };

async function search(q) {
  await page.evaluate(h => (location.hash = h), `#/search?q=${encodeURIComponent(q)}`);
  return waitFor(() => page.evaluate(() => document.querySelectorAll('.track:not(.head)').length > 0), 30000);
}
/** 按列表里第 i 首，等到真的出声 */
async function playRow(i) {
  await page.evaluate(n => document.querySelectorAll('.track:not(.head) .name')[n]?.click(), i);
  return waitFor(() => mediaState().playing, 40000, 150);
}

// ---- 要走的流程（limit：超过就算太慢）----
const results = [];
/** 记一步的结果；ms 是 null 代表等太久都没好 */
function record(name, ms, limit, since) {
  const slowest = requests
    .filter(r => r.start >= since && /lyristage-api|supabase|music\.126|bilibili|bilivideo|akamaized|gdstudio/.test(r.url))
    .map(r => ({ path: r.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0], took: (r.end ?? Date.now()) - r.start }))
    .sort((a, b) => b.took - a.took)
    .slice(0, 4);
  const mark = ms === null ? '✗' : ms > limit ? '⚠' : '✓';
  results.push({ name, ms, limit, mark, slowest });
  const time = ms === null ? '没完成' : `${(ms / 1000).toFixed(1)} 秒`;
  console.log(`${mark}  ${name.padEnd(22, '　')} ${time.padStart(8)}   （上限 ${limit / 1000} 秒）`);
  if (mark !== '✓') for (const r of slowest) console.log(`      ${String(r.took).padStart(6)} ms  ${r.path}`);
}

const STEPS = [
  {
    id: 'fm',
    async run() {
      // 刚打开 App 就按私人 FM（背景的「先挑好」还没开始）
      const launched = await relaunch();
      const home = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.fm-play'))), 30000);
      record('打开 App → 首页出来', home === null ? null : Date.now() - launched, 6000, launched);
      let since = Date.now();
      await page.click('.fm-play');
      record('一打开就按私人 FM → 出声', await waitFor(() => mediaState().playing, 40000, 150), 6000, since);
      pause();
      // 重开、等背景先挑好（登录好 8 秒后开始）再按
      await relaunch();
      await page.waitForSelector('.fm-play', { timeout: 30000 });
      await sleep(15000);
      since = Date.now();
      await page.click('.fm-play');
      record('等一下再按私人 FM → 出声', await waitFor(() => mediaState().playing, 40000, 150), 2000, since);
      pause();
    },
  },
  {
    id: 'search',
    async run() {
      let since = Date.now();
      record('搜索「晴天」→ 有结果', await search('晴天'), 5000, since);
      await sleep(3000); // 封面图载完，不跟音乐抢网路
      since = Date.now();
      record('按搜索结果的歌 → 出声', await playRow(0), 5000, since);
      // 下一首：用耳机 / 通知栏的按键，等到换了一首而且在播
      const before = mediaState().title;
      since = Date.now();
      adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_NEXT');
      record('下一首 → 出声', await waitFor(() => {
        const s = mediaState();
        return s.playing && s.title !== before;
      }, 40000, 150), 5000, since);
      pause();
    },
  },
  {
    id: 'playlist',
    async run() {
      const rows = () => page.evaluate(() => document.querySelectorAll('.track:not(.head)').length > 5);
      let since = Date.now();
      await page.evaluate(h => (location.hash = h), `#/playlist/${PLAYLIST}`);
      record('打开歌单 → 歌出来', await waitFor(rows, 30000), 5000, since);
      await page.evaluate(() => (location.hash = '#/'));
      await sleep(1500);
      since = Date.now();
      await page.evaluate(h => (location.hash = h), `#/playlist/${PLAYLIST}`);
      record('再打开同一个歌单', await waitFor(rows, 30000), 1500, since);
    },
  },
  {
    id: 'slow',
    async run() {
      await network(SLOW_3G);
      try {
        await search('稻香 周杰伦');
        await sleep(6000);
        const since = Date.now();
        record('网络很慢（3G）播一首', await playRow(0), 15000, since);
      } finally {
        await network({});
        pause();
      }
    },
  },
  {
    id: 'offline',
    async run() {
      // 歌单里找一首还没存的，存到手机；断网播放它；测完从手机删掉
      await page.evaluate(h => (location.hash = h), `#/playlist/${PLAYLIST}`);
      await waitFor(() => page.evaluate(() => document.querySelectorAll('.track:not(.head)').length > 5), 30000);
      const index = await page.evaluate(() =>
        [...document.querySelectorAll('.track:not(.head)')].findIndex(row => !row.querySelector('.saved-mark'))
      );
      if (index < 0) return record('离线播放存好的歌', null, 5000, Date.now());
      const openMenu = () => page.evaluate(i => document.querySelectorAll('.track:not(.head) .act[aria-haspopup]')[i]?.click(), index);
      const menuItem = re => page.evaluate(src => {
        const button = [...document.querySelectorAll('.track-menu button')].find(b => new RegExp(src).test(b.textContent));
        button?.click();
        return Boolean(button);
      }, re);
      await openMenu();
      await sleep(400);
      await menuItem('存到手机|Save to phone');
      const savedMark = () => page.evaluate(i => Boolean(document.querySelectorAll('.track:not(.head)')[i]?.querySelector('.saved-mark:not(.waiting)')), index);
      let since = Date.now();
      const savedIn = await waitFor(savedMark, 90000, 500);
      record('存一首到手机', savedIn, 30000, since);
      if (savedIn === null) return;
      try {
        await network({ offline: true });
        await sleep(1000);
        since = Date.now();
        record('断网播放存好的歌', await playRow(index), 3000, since);
      } finally {
        await network({});
        pause();
        await sleep(1500);
        await openMenu();
        await sleep(400);
        await menuItem('从手机删除|Remove from phone');
      }
    },
  },
];

(async () => {
  try {
    adb('get-state');
  } catch {
    console.error('找不到 Android 设备：用 USB 接上并允许调试');
    process.exit(1);
  }
  const only = arg('only')?.split(',');
  const steps = only ? STEPS.filter(s => only.includes(s.id)) : STEPS;
  // 不是从 fm 开始的话，用现在开着的 App（没开就打开）
  if (steps[0].id !== 'fm') {
    adb('shell', 'am', 'start', '-n', `${APP}/.MainActivity`);
    await connect();
  }
  try {
    for (const step of steps) {
      try {
        await step.run();
      } catch (err) {
        record(`${step.id} 出错：${err.message.split('\n')[0].slice(0, 60)}`, null, 0, Date.now());
      }
    }
  } finally {
    await network({}).catch(() => {});
    try {
      pause();
    } catch {
      // 平板断了就算了
    }
    await page?.evaluate(() => (location.hash = '#/')).catch(() => {});
    await browser?.close().catch(() => {});
  }
  const bad = results.filter(r => r.mark !== '✓');
  console.log(`\n${results.length} 步，${bad.length ? `${bad.length} 步太慢或失败` : '都在时间内'}`);
  process.exit(bad.length ? 1 : 0);
})();
