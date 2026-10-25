// 发布前检查手机排版：在接着电脑的 Android 设备（平板也可以）上，把画面调成几种手机尺寸、
// 放大字体、中英文、深浅色，跑一遍主要页面和「打开以后」的样子（选单、面板、对话框），自动找出：
//   - 字被挤成两行、字被切掉（按钮、分页、标题这些短字）
//   - 东西跑出画面（页面可以左右滑、元素超出画面）、面板超出它的外框
//   - 底部多一截空白（导航列的空间垫了两次）
//   - 重要的按钮被盖住、碰不到、横屏时要卷才看得到
//   - 字看不清（字和底色太接近）、字被别的东西压住
// 每一页都截图（有问题的地方框红色），最后产生 out/report.html。规则抓不到的（好不好看），还是要人看截图。
//
// 用法：
//   npm run layout:check              设备上已经装了可以调试的版本
//   npm run layout:check -- --install 先打包一个可以调试的版本装上去（签名跟正式版一样，不用删 App、登录还在）
//   其他选项：--profiles phone-412,phone-360  --locales zh-CN,en  --themes light,dark  --pages home,room
// 需要：adb、设备上的 App 已登录成员账号。跑完会把设备的画面尺寸、方向、字体大小、导航列，
// App 的语言、主题、离线听歌清单改回原样（检查时会塞几首假的「存在手机」的歌，名字特别长）。
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
  return i > 0 ? process.argv[i + 1].split(',') : null;
};

/**
 * 手机尺寸：size / density 换算成 CSS 宽度（1080/2.625 ≈ 411、720/2 = 360）。
 * fontScale：系统字体放大（有的手机字比较宽，例如 OPPO，平板上放得下的字在那边会换行）
 */
const PROFILES = {
  'phone-412': { label: '手机 412 直屏', size: '1080x2400', density: 420, rotation: 0 },
  'phone-360': { label: '小手机 360 直屏', size: '720x1560', density: 320, rotation: 0 },
  'phone-360-big': { label: '小手机 360、字体放大', size: '720x1560', density: 320, rotation: 0, fontScale: 1.15 },
  'phone-land': { label: '手机横屏', size: '1080x2400', density: 420, rotation: 1 },
  'tablet-land': { label: '平板横屏（电脑版排版）', size: null, density: null, rotation: 1 },
};
/** 要跑哪几组（尺寸 × 语言 × 主题）：不是每一种都排列组合，挑最容易出问题的 */
const RUNS = [
  ['phone-412', 'zh-CN', 'light'],
  ['phone-412', 'zh-CN', 'dark'],
  ['phone-412', 'en', 'light'],
  ['phone-360', 'zh-CN', 'light'],
  ['phone-360', 'en', 'dark'],
  ['phone-360-big', 'zh-CN', 'light'],
  ['phone-360-big', 'en', 'light'],
  ['phone-land', 'zh-CN', 'dark'],
  ['phone-land', 'en', 'light'],
  ['tablet-land', 'zh-CN', 'light'],
  ['tablet-land', 'en', 'dark'],
];

// ---- 打开以后的样子（在页面里跑，不能用外面的变数）-----------------------------------------
const STORE = name => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(name);
const click = (selector, nth = 0) => {
  const list = [...document.querySelectorAll(selector)].filter(e => e.getBoundingClientRect().width > 0);
  list[nth]?.click();
  return Boolean(list[nth]);
};

/** 一起听的成员画面检查完：变回房主（测试房间是自己开的，离开时才会把房间删掉） */
const UNGUEST = () => {
  const room = STORE('room');
  if (!window.__lcHost) return;
  room.role = 'host';
  room.hostId = window.__lcHost;
  room.members = room.members.filter(m => m.id !== 'lc-host');
  window.__lcHost = null;
};

/** 交给页面的工具函式（箭头函式的 toString 没有名字，要包成 const 才叫得到） */
const HELPERS = `const STORE = ${STORE.toString()}; const click = ${click.toString()}; const UNGUEST = ${UNGUEST.toString()};`;

/** 把画面上的歌单名、前几首歌名和歌手、迷你播放条的歌名换成很长的中英混合文字（只改画面，不改资料） */
function LONG_TEXT() {
  const song = '这是一首名字非常非常长的歌 (Live at the Very Long Concert Hall · 2026 Remastered Edition)';
  const artist = '很长的歌手名字 Featuring Another Very Long Artist Name / 第三位歌手';
  document.querySelectorAll('.collection-header h1').forEach(el => (el.textContent = '一个名字很长很长很长的歌单 A Very Long Playlist Name'));
  [...document.querySelectorAll('.track:not(.head)')].slice(0, 4).forEach(row => {
    const name = row.querySelector('.name');
    if (name) name.textContent = song;
    // 只换歌手连结的字，留着旁边的「已存到手机」「其他音源」小标
    const link = row.querySelector('.artists a');
    if (link) link.textContent = artist;
  });
  const meta = document.querySelector('.mini .meta');
  if (meta?.children[0]) meta.children[0].textContent = song;
  if (meta?.children[1]) meta.children[1].textContent = artist;
}

/** 好友：塞几个名字很长的好友、便签、正在听 */
function MOCK_FRIENDS() {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
  const f = pinia._s.get('friends');
  const me = pinia._s.get('auth').user?.id;
  const now = Date.now();
  const iso = ms => new Date(now - ms).toISOString();
  const song = (id, name, ar) => ({ id, name, ar: [{ id: 1, name: ar }], al: { id: 1, name: '', picUrl: 'https://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg' }, dt: 240000 });
  const long = song(1, '一首名字特别特别长的歌（Live 现场版 Remastered 2024）', '一个名字也很长的歌手 feat. 另一个歌手');
  f.friends = [
    { id: 'lc-a', name: '名字超级无敌长的朋友 Christopher', avatar: null },
    { id: 'lc-b', name: 'Ivy', avatar: null },
    { id: 'lc-c', name: 'Edward', avatar: null },
  ];
  f.listening = new Map([
    ['lc-a', { userId: 'lc-a', track: long, playing: true, updatedAt: iso(20000) }],
    ['lc-c', { userId: 'lc-c', track: long, playing: false, updatedAt: iso(3 * 3600000) }],
  ]);
  f.notes = new Map([
    [me, { userId: me, body: '今天只想听慢歌，谁都不要找我 🌧🌧🌧 真的', track: long, createdAt: iso(3600000), expiresAt: iso(-20 * 3600000) }],
    ['lc-b', { userId: 'lc-b', body: 'Exams are finally over!!! Listening all night long tonight', track: long, createdAt: iso(600000), expiresAt: iso(-23 * 3600000) }],
  ]);
  f.reactions = [{ id: -1, from: 'lc-a', emoji: '❤️‍🔥', target: 'note', context: '今天只想听慢歌，谁都不要找我 🌧🌧🌧 真的', seen: false, at: iso(60000) }];
  f.notesAvailable = true;
}

/** 一起听：塞几则很长的聊天、一张点歌卡片、一个敲门 */
function MOCK_ROOM() {
  const room = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('room');
  const now = new Date().toISOString();
  const long = { id: 1, name: '一首名字特别特别长的歌（Live 现场版 Remastered 2024）', ar: [{ id: 1, name: '一个名字也很长的歌手' }], al: { picUrl: '' }, dt: 240000 };
  room.messages = [
    { id: -1, userId: room.selfId, kind: 'chat', body: 'thisisaverylongwordwithoutanyspacesthatmightoverflowthechatbubble 还有中文', at: now },
    { id: -2, userId: 'lc-x', kind: 'request', body: '', track: long, at: now },
    { id: -3, userId: 'lc-x', kind: 'chat', body: '好', at: now },
  ];
  room.knocks = [{ id: -9, userId: 'lc-y', name: '名字超级无敌长的朋友 Christopher', avatar: '' }];
}

/** 一起听：假装自己是成员（房主是一个名字很长的朋友），播放键会变灰 */
function MOCK_GUEST() {
  const room = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('room');
  if (!window.__lcHost) window.__lcHost = room.hostId;
  room.hostId = 'lc-host';
  room.members = [...room.members.filter(m => m.id !== 'lc-host'), { id: 'lc-host', name: '名字超级无敌长的朋友 Christopher', avatar: '', role: 'host' }];
  room.role = 'guest';
}

/** 一起听：房间里多几个人（名字很长），看关闭房间、换房主的面板 */
function MOCK_MEMBERS() {
  const room = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('room');
  const fake = [
    { id: 'lc-m1', name: '名字超级无敌长的朋友 Christopher', avatar: '', role: 'guest' },
    { id: 'lc-m2', name: 'Ivy', avatar: '', role: 'guest' },
    { id: 'lc-m3', name: 'Edward Lee Jun Hao', avatar: '', role: 'guest' },
    { id: 'lc-m4', name: '小明', avatar: '', role: 'guest' },
  ];
  room.members = [...room.members.filter(m => !m.id.startsWith('lc-m')), ...fake];
}

/**
 * 要检查的页面
 * - hash：网址；stage：打开全屏歌词；room：先开一个测试房间
 * - mock：先塞假资料（上面的 MOCK_*）；open：打开以后的样子（在页面里跑）；close：检查完关掉
 * - reach：一定要按得到的东西（会卷过去，看有没有被盖住）
 * - seeLandscape：横屏时不用卷就要看得到的东西（例如一起听的聊天输入框）
 * - fits：[里面的东西, 外框]，里面的东西不能超出外框（外框写 viewport = 整个画面）
 * - offline：先把 App 的网络关掉（检查完打开）
 */
const PAGES = [
  { id: 'home', hash: '#/', reach: ['.search input'] },
  // 晴天：网易云只搜得到翻唱，原唱（周杰伦）要等服务器找回来补在最前面（几秒）
  { id: 'search', hash: '#/search?q=%E6%99%B4%E5%A4%A9', wait: 9000 },
  { id: 'friends', hash: '#/friends', mock: MOCK_FRIENDS, reach: ['.add-btn'] },
  {
    id: 'friends-note',
    hash: '#/friends',
    mock: MOCK_FRIENDS,
    open: () => click('.notes .note', 1),
    close: () => document.querySelector('dialog.sheet')?.close(),
    fits: [['dialog.sheet[open]', 'viewport']],
  },
  {
    id: 'friends-mine',
    hash: '#/friends',
    mock: MOCK_FRIENDS,
    open: () => click('.notes .note', 0),
    close: () => document.querySelector('dialog.sheet')?.close(),
    fits: [['dialog.sheet[open]', 'viewport']],
  },
  { id: 'library', hash: '#/library' },
  { id: 'offline', hash: '#/offline' },
  // 「全部删掉」的确认面板：只打开来看，关掉时等于按取消（不会真的删）
  {
    id: 'offline-confirm',
    hash: '#/offline',
    open: () => [...document.querySelectorAll('button')].find(b => /全部删掉|Delete all/.test(b.textContent))?.click(),
    close: () => document.querySelector('dialog.confirm-sheet')?.close(),
    fits: [['dialog.confirm-sheet[open]', 'viewport']],
  },
  { id: 'liked', hash: '#/liked' },
  // 很长的歌单名、歌名（测试账号的资料都很短，长的才会挤坏）
  { id: 'playlist-long', hash: '#/playlist/3778678', wait: 4000, open: LONG_TEXT },
  { id: 'my-playlist-long', hash: '#/my/TEMP_PLAYLIST', wait: 3500, open: LONG_TEXT },
  { id: 'home-long', hash: '#/', open: LONG_TEXT },
  // 自己的歌单（一排按钮最多：添加、存到手机、邀请、海报、⋯、随机、播放）：测试账号没有自己的歌单，
  // 先临时建一个「LS 测试」（TEMP_PLAYLIST 换成它的 id），全部测完一定删掉
  { id: 'my-playlist', hash: '#/my/TEMP_PLAYLIST', wait: 3500 },
  // 整张存到手机、存到一半：按钮外圈画进度（假装成存到一半的样子，不会真的去存）
  {
    id: 'my-playlist-saving',
    hash: '#/my/TEMP_PLAYLIST',
    wait: 3500,
    open: () => {
      const b = document.querySelector('.offline-btn');
      b?.classList.replace('idle', 'saving');
      b?.style.setProperty('--saved', '0.78');
    },
  },
  { id: 'playlist', hash: '#/playlist/3778678', wait: 4000 },
  {
    id: 'track-menu',
    hash: '#/playlist/3778678',
    wait: 4000,
    open: () => click('.track .act[aria-haspopup]'),
    close: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    fits: [['.track-menu', 'viewport']],
  },
  {
    id: 'add-to-playlist',
    hash: '#/playlist/3778678',
    wait: 4000,
    open: () => click('.track .act[aria-haspopup]') && setTimeout(() => click('.track-menu button', 4), 300),
    close: () => document.querySelector('dialog.add-dialog')?.close(),
    fits: [['dialog.add-dialog[open]', 'viewport']],
  },
  { id: 'artist', hash: '#/artist/6452', wait: 4000 },
  // 已经有账号的人第一次打开：确认名字（名字像邮箱前缀时有提醒）
  {
    id: 'name-sheet',
    hash: '#/',
    open: () => {
      const d = document.querySelector('dialog.name-sheet');
      d?.showModal();
      const input = d?.querySelector('input');
      if (input) {
        input.value = 'kengtingtan';
        input.dispatchEvent(new Event('input'));
      }
    },
    close: () => document.querySelector('dialog.name-sheet')?.close(),
    fits: [['dialog.name-sheet[open]', 'viewport']],
  },
  // 好友页：加好友的搜索框（打开「加好友」卡片）
  { id: 'friends-add', hash: '#/friends', mock: MOCK_FRIENDS, open: () => click('.add-btn') },
  // 断网胶囊 + 同时有提示：两个不能叠在一起，也不能盖住迷你播放条
  {
    id: 'offline-pill',
    hash: '#/',
    offline: true,
    open: () => STORE('notice').show('没有网络，没改成功', { action: { label: '重试', run: () => {} }, duration: 20000 }),
    close: () => STORE('notice').dismiss(),
  },
  // 断网时打开没看过的歌单：「连不上网络」的卡片
  { id: 'load-error', hash: '#/playlist/2829883282', wait: 4000, offline: true },
  { id: 'settings', hash: '#/settings' },
  { id: 'settings-account', hash: '#/settings?c=account' },
  { id: 'settings-appearance', hash: '#/settings?c=appearance' },
  { id: 'settings-playback', hash: '#/settings?c=playback' },
  {
    id: 'queue',
    hash: '#/',
    open: () => (STORE('ui').queueOpen = true),
    close: () => (STORE('ui').queueOpen = false),
    fits: [['dialog.queue-panel[open] .panel', 'viewport']],
  },
  { id: 'queue-wall', hash: '#/', open: () => (STORE('ui').wallOpen = true), close: () => (STORE('ui').wallOpen = false) },
  {
    id: 'room',
    hash: '#/room',
    room: true,
    mock: MOCK_ROOM,
    reach: ['.composer input', '.room-top .round-btn', '.voice-btn'],
    seeLandscape: ['.composer input'],
  },
  {
    id: 'room-styles',
    hash: '#/room',
    room: true,
    open: () => click('.stage .topbar .pill[aria-expanded]'),
    close: () => click('.stage .topbar .pill[aria-expanded="true"]'),
    fits: [['.stage-panel .picker', '.stage-panel']],
  },
  // 之前没截过的页面：每日推荐、专辑、听歌报告和年度回顾、搜索的各个分页、设置的歌词和关于、打不开的共享歌单码
  { id: 'daily', hash: '#/daily', wait: 5000 },
  { id: 'album', hash: '#/album/18903', wait: 4000 },
  { id: 'report', hash: '#/report', wait: 5000 },
  {
    id: 'report-wrapped',
    hash: '#/report',
    wait: 5000,
    open: () => click('.wrapped'),
    close: () => document.querySelector('dialog[open]')?.close(),
  },
  ...['song', 'lyric', 'artist', 'album', 'playlist'].map(tab => ({
    id: `search-${tab}`,
    hash: `#/search?q=${encodeURIComponent('晴天')}&tab=${tab}`,
    wait: 4000,
  })),
  { id: 'settings-lyrics', hash: '#/settings?c=lyrics' },
  { id: 'settings-about', hash: '#/settings?c=about' },
  { id: 'join-bad-code', hash: '#/join/ZZZZZZ', wait: 3500 },
  // 语音中：上面那条多一个「房间音量」按钮；按了是音量面板（假装在语音里，不真的开麦克风）
  {
    id: 'room-volume',
    hash: '#/room',
    room: true,
    mock: MOCK_MEMBERS,
    open: () => {
      STORE('voice').status = 'on';
      // 平板、电脑：上面那条的按钮；手机：收在「⋯」里
      setTimeout(() => {
        if (click('.volume-btn')) return;
        click('.more-wrap .round-btn');
        setTimeout(() => [...document.querySelectorAll('.more-wrap .menu button')].find(b => /房间音量|Room volume/.test(b.textContent))?.click(), 300);
      }, 400);
    },
    close: () => {
      document.querySelector('dialog.room-volume')?.close();
      STORE('voice').status = 'off';
    },
    fits: [['dialog.room-volume[open]', 'viewport']],
  },
  // 房间里人多：上面那条（房间码、语音、头像）不能挤扁或叠在一起
  { id: 'room-many', hash: '#/room', room: true, mock: MOCK_MEMBERS },
  // 房主按「关闭房间」：先确认；可以先交给别人当房主
  {
    id: 'room-close',
    hash: '#/room',
    room: true,
    mock: MOCK_MEMBERS,
    open: () => click('.more-wrap .round-btn') && setTimeout(() => click('.more-wrap .menu button'), 300),
    close: () => document.querySelector('dialog.host-sheet')?.close(),
    fits: [['dialog.host-sheet[open]', 'viewport']],
  },
  {
    id: 'room-handover',
    hash: '#/room',
    room: true,
    mock: MOCK_MEMBERS,
    open: () => click('.more-wrap .round-btn') && setTimeout(() => click('.more-wrap .menu button') && setTimeout(() => click('dialog.host-sheet .btn'), 300), 300),
    close: () => document.querySelector('dialog.host-sheet')?.close(),
    fits: [['dialog.host-sheet[open]', 'viewport']],
  },
  // 一起听的成员：播放键变灰、按了跳提示、在歌单点歌会问要点给房主还是离开房间
  { id: 'room-guest', hash: '#/', room: true, mock: MOCK_GUEST, close: () => UNGUEST() },
  {
    id: 'room-guest-toast',
    hash: '#/',
    room: true,
    mock: MOCK_GUEST,
    open: () => click('.mini .icon-btn.locked') || click('.transport.locked .play'),
    close: () => (STORE('notice').dismiss(), UNGUEST()),
  },
  {
    id: 'room-guest-sheet',
    hash: '#/playlist/3778678',
    wait: 4000,
    room: true,
    mock: MOCK_GUEST,
    open: () => click('.track:not(.head):not(.current)', 1),
    close: () => (document.querySelector('dialog.guest-sheet')?.close(), UNGUEST()),
    fits: [['dialog.guest-sheet[open]', 'viewport']],
  },
  { id: 'room-guest-stage', stage: true, room: true, mock: MOCK_GUEST, close: () => UNGUEST() },
  { id: 'lyrics', stage: true },
  {
    id: 'lyrics-styles',
    stage: true,
    open: () => click('.stage .topbar .pill[aria-expanded]'),
    close: () => click('.stage .topbar .pill[aria-expanded="true"]'),
    fits: [['.stage .picker', '.stage']],
  },
  {
    id: 'lyrics-share',
    stage: true,
    open: () => click('.stage .topbar .pill:not([aria-expanded])'),
    close: () => document.querySelector('dialog.share-dialog')?.close(),
    fits: [['dialog.share-dialog[open]', 'viewport']],
  },
  // 每一种歌词风格放在一起听的房间里（矮的框）：字不能叠在一起（例如歌词和下面的「《歌名》歌手」）
  // 只在框会很矮的尺寸检查；用的风格会改掉，检查完 KEYS 会把 lyristage:stage 改回来
  ...['kinetic', 'perspective', 'scroll', 'block', 'karaoke', 'vertical', 'mv', 'typewriter', 'vinyl'].map((id, i) => ({
    id: `room-style-${id}`,
    hash: '#/room',
    room: true,
    only: ['phone-land', 'phone-360-big', 'tablet-land'],
    styleIndex: i,
    textOverlap: true,
    wait: 1500,
  })),
  // 全屏歌词也一样：手机横屏的框也很矮（矮框的排版规则同样会生效）
  ...['kinetic', 'perspective', 'scroll', 'block', 'karaoke', 'vertical', 'mv', 'typewriter', 'vinyl'].map((id, i) => ({
    id: `lyrics-style-${id}`,
    stage: true,
    only: ['phone-land', 'phone-360'],
    styleIndex: i,
    textOverlap: true,
  })),
];

// ---- 检查（在页面里跑，不能用外面的变数）-------------------------------------------------------

function CHECK({ reach, see, fits, textOverlap }) {
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
      // 只能上下卷的（例如侧边栏的歌单）overflow-x 也会算成 auto：真的能左右卷才算
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX) && (cs.overflowY !== cs.overflowX || p.scrollWidth > p.clientWidth + 1)) return true;
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
  /** 开着对话框（选歌、便签…）时只检查对话框里面：后面的本来就被盖住 */
  const modal = [...document.querySelectorAll('dialog[open]')].find(d => d.matches(':modal'));
  const inScope = el => !modal || modal.contains(el);
  const textNodes = () => {
    const out = [];
    const walker = document.createTreeWalker(modal ?? document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.trim() && node.parentElement && !node.parentElement.closest('script, style, [aria-hidden="true"]')) out.push(node);
    }
    return out;
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
    if (!inScope(el) || !visible(el) || inScroller(el) || clippedInside(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= W + 2 && r.left >= -2) continue;
    if (overflowing.some(o => o.contains(el))) continue;
    overflowing.push(el);
    mark(el);
    issues.push({ kind: '跑出画面', text: `${describe(el)} 超出画面（左 ${Math.round(r.left)}、右 ${Math.round(r.right)}，画面宽 ${W}）` });
  }

  // 2. 短字被挤成两行、被切掉
  // tag 不能只看有没有这三个字：stage（歌词画面）也含 tag，整段歌词会被当成标签
  const LABELS = 'button, a, [role="tab"], [role="menuitem"], label, h1, h2, h3, h4, th, nav, [class*="chip"], [class*="badge"], [class~="tag"], [class*="-tag"], [class*="tag-"], [class*="label"]';
  const wrapped = new Set();
  for (const node of textNodes()) {
    const text = node.textContent.trim();
    if ([...text].length > 18) continue;
    const owner = node.parentElement.closest(LABELS);
    if (!owner || wrapped.has(owner) || !visible(owner) || inScroller(owner)) continue;
    // 本来就允许换行的（例如便签泡泡、歌名）跳过
    const ws = getComputedStyle(node.parentElement);
    if (ws.webkitLineClamp && ws.webkitLineClamp !== 'none') continue;
    // 设了 text-wrap: balance 的（例如首页问候语带名字）：本来就打算排成两行
    const os = getComputedStyle(owner);
    if ([os.textWrapStyle, os.textWrap].some(v => v && v.includes('balance'))) continue;
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
    if (tops.size > 1 && !(owner.matches('h1, h2, h3, h4') && /\s/.test(text))) {
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

  // 6. 歌词画面里的字不能叠在一起（只在歌词风格那几页检查：别的地方有故意叠着的装饰字）
  if (textOverlap) {
    const stage = document.querySelector('.stage-panel .stage') ?? document.querySelector('.stage');
    const opacityOf = el => {
      let o = 1;
      for (let p = el; p && p !== stage.parentElement; p = p.parentElement) o *= Number(getComputedStyle(p).opacity);
      return o;
    };
    const boxes = [];
    const seen = new Set();
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!node.textContent.trim() || seen.has(el)) continue;
      seen.add(el);
      if (el.closest('[aria-hidden="true"], .ghost, .topbar, .controls, .picker, .defs, svg')) continue;
      if (!visible(el) || opacityOf(el) < 0.3) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      boxes.push({ el, r, text: node.textContent.trim().slice(0, 16) });
    }
    const hit = new Set();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= 0 || h <= 0) continue;
        const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        if ((w * h) / smaller < 0.2 || hit.has(a.el) || hit.has(b.el)) continue;
        hit.add(a.el);
        hit.add(b.el);
        mark(a.el);
        mark(b.el);
        issues.push({ kind: '字叠在一起', text: `「${a.text}」和「${b.text}」叠在一起` });
      }
    }
  }

  // 5. 打开的面板不能左右滑（里面的东西被长名字撑宽，按钮被挤到面板外面）
  for (const d of document.querySelectorAll('dialog[open]')) {
    if (d.scrollWidth > d.clientWidth + 1) {
      mark(d);
      issues.push({ kind: '跑出画面', text: `${describe(d)} 里面的东西比面板宽（内容宽 ${d.scrollWidth}，面板 ${d.clientWidth}）` });
    }
  }

  // 4. 面板不能超出它的外框（例如歌词风格面板被歌词画面截掉、选单跑出画面）
  for (const [inner, outer] of fits) {
    const el = [...document.querySelectorAll(inner)].find(visible);
    if (!el) continue;
    const b = outer === 'viewport' ? { top: 0, left: 0, right: W, bottom: H } : el.parentElement?.closest(outer)?.getBoundingClientRect();
    if (!b) continue;
    const r = el.getBoundingClientRect();
    if (r.top < b.top - 2 || r.bottom > b.bottom + 2 || r.left < b.left - 2 || r.right > b.right + 2) {
      mark(el);
      issues.push({ kind: '超出框', text: `${describe(el)} 超出 ${outer}（面板 ${Math.round(r.left)},${Math.round(r.top)}~${Math.round(r.right)},${Math.round(r.bottom)}，外框 ${Math.round(b.left)},${Math.round(b.top)}~${Math.round(b.right)},${Math.round(b.bottom)}）` });
    }
  }

  // 5. 不用卷就要看得到（横屏时的聊天输入框这种）
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

  // 6. 字看不清：字的颜色和底色太接近（底下是图片、渐层的不算，量不准）
  const parse = c => {
    let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/.exec(c);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const over = (top, bottom) => [0, 1, 2].map(i => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
  const luminance = ([r, g, b]) =>
    [r, g, b].map(v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  /** 字后面的底色（一层一层往上找）；碰到图片、渐层、模糊就回传 null（量不准） */
  const backgroundOf = el => {
    const layers = [];
    for (let p = el; p; p = p.parentElement) {
      // 歌词画面的底是风格自己画的（在旁边那层 .style-layer，例如竖排诗词的米色纸），往上找会找到错的深色底
      if (p.matches('.stage') && p.querySelector('.style-layer')) return null;
      const cs = getComputedStyle(p);
      if (cs.backgroundImage !== 'none' || cs.backdropFilter !== 'none' || /^(IMG|VIDEO|CANVAS)$/.test(p.tagName)) return null;
      if (p.querySelector(':scope > img, :scope > canvas, :scope > video')) return null;
      const bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0) {
        layers.push(bg);
        if (bg[3] >= 0.99) break;
      }
      if (p === document.documentElement && !layers.length) return null;
    }
    if (!layers.length) return null;
    return layers.reduceRight((below, layer) => (below ? over(layer, below) : layer), null);
  };
  const faint = new Set();
  for (const node of textNodes()) {
    const el = node.parentElement;
    if (faint.has(el) || !visible(el) || el.closest(':disabled, [disabled]')) continue;
    // 歌词风格里没在唱的句子故意调淡（让正在唱的那句突出）：不算看不清
    if (el.closest('.style-layer')) continue;
    // 正在淡入、淡出的（例如刚消失的提示）：半透明是动画的一半，不是真的看不清
    if (el.closest('[class*="-enter-active"], [class*="-leave-active"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = backgroundOf(el);
    if (!fg || !bg) continue;
    let opacity = fg[3];
    for (let p = el; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
    const shown = over([fg[0], fg[1], fg[2], opacity], bg);
    const [l1, l2] = [luminance(shown), luminance(bg)].sort((a, b) => b - a);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    if (ratio < 2.5) {
      faint.add(el);
      mark(el);
      issues.push({ kind: '看不清', text: `${describe(el)} 字和底色太接近（对比 ${ratio.toFixed(1)}，至少要 2.5）` });
    }
  }

  // 7. 字被压住：字的位置上，最上面的是别的东西（例如按钮压在字上）。
  //    固定在画面上的（返回键、提示、底部播放条）、大面板（风格面板、选单）是故意盖在上面的，不算
  const floating = el => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed' || cs.position === 'sticky') return true;
      if (cs.position === 'absolute') {
        const r = p.getBoundingClientRect();
        if (r.width * r.height > W * H * 0.15) return true;
      }
    }
    return false;
  };
  /** 这个元素实际看得到的范围：被卷动区块、裁切的外框挡掉的部分不算 */
  const clipOf = el => {
    let box = { top: 0, left: 0, right: W, bottom: H };
    // 从自己开始算：收合起来的说明文字（只显示两行）后面几行的位置不算
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = p.getBoundingClientRect();
      box = { top: Math.max(box.top, r.top), left: Math.max(box.left, r.left), right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom) };
    }
    return box;
  };
  const covered = new Set();
  for (const node of textNodes()) {
    const el = node.parentElement;
    if (covered.has(el) || !visible(el)) continue;
    const clip = clipOf(el);
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 4 || r.top < clip.top || r.bottom > clip.bottom || r.left < clip.left || r.right > clip.right) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el) || floating(hit)) continue;
      // 同一个按钮、连结里面的（例如图示和字）不算
      const group = el.closest('button, a, label, li');
      if (group && group.contains(hit)) continue;
      covered.add(el);
      mark(el);
      issues.push({ kind: '字被压住', text: `${describe(el)} 被 ${describe(hit)} 压住` });
      break;
    }
  }

  // 8. 重要的东西：卷过去以后看得到、没被别的东西盖住（会卷动页面，放最后）
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
    fontScale: adb('shell', 'settings', 'get', 'system', 'font_scale').trim(),
    navbar: navbar?.replace(/.*\]\s*/, '').trim() ?? null,
  };
}
function restoreDisplay(saved) {
  adb('shell', 'wm', 'size', 'reset');
  adb('shell', 'wm', 'density', 'reset');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', saved.rotation === 'null' ? '0' : saved.rotation);
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', saved.auto === 'null' ? '1' : saved.auto);
  adb('shell', 'settings', 'put', 'system', 'font_scale', saved.fontScale === 'null' ? '1.0' : saved.fontScale);
  if (saved.navbar) adb('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', saved.navbar);
}
function applyProfile(p) {
  if (p.size) adb('shell', 'wm', 'size', p.size);
  else adb('shell', 'wm', 'size', 'reset');
  if (p.density) adb('shell', 'wm', 'density', String(p.density));
  else adb('shell', 'wm', 'density', 'reset');
  adb('shell', 'settings', 'put', 'system', 'font_scale', String(p.fontScale ?? 1.0));
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

/** 「存在手机」的假歌（名字特别长；档案不存在，只拿来看排版，检查完换回原本的清单） */
const MOCK_OFFLINE = JSON.stringify(
  Object.fromEntries(
    [1, 2, 3].map(i => [
      `90000000${i}`,
      {
        file: `offline/90000000${i}.mp3`,
        lyricsFile: null,
        size: 9_800_000,
        savedAt: Date.now(),
        lastPlayed: Date.now() - i,
        track: {
          id: 900000000 + i,
          name: i === 1 ? '一首名字特别特别长的歌（Live 现场版 Remastered 2024）' : `Offline song ${i}`,
          ar: [{ id: 1, name: '一个名字也很长的歌手 feat. 另一个歌手' }],
          al: { id: 1, name: '', picUrl: '' },
          dt: 240000,
        },
      },
    ])
  )
);
const KEYS = ['lyristage:locale', 'lyristage:theme', 'lyristage:offline', 'lyristage:stage'];

async function main() {
  try {
    adb('get-state');
  } catch {
    throw new Error('找不到 Android 设备：用 USB 接上并允许调试');
  }
  if (process.argv.includes('--install')) installDebuggable();
  // 清掉上次的截图：只删里面的档案（资料夹被 VS Code 之类开着的话，整个删会失败）
  fs.mkdirSync(OUT, { recursive: true });
  for (const file of fs.readdirSync(OUT)) {
    try {
      fs.rmSync(path.join(OUT, file), { recursive: true, force: true });
    } catch {
      // 开着的那个档案删不掉，等一下会被新的盖过去
    }
  }

  const runs = RUNS.filter(
    ([profile, locale, theme]) =>
      (!arg('profiles') || arg('profiles').includes(profile)) &&
      (!arg('locales') || arg('locales').includes(locale)) &&
      (!arg('themes') || arg('themes').includes(theme))
  );
  const pages = arg('pages') ? PAGES.filter(p => arg('pages').includes(p.id)) : PAGES;
  const saved = saveDisplay();
  adb('shell', 'am', 'start', '-n', `${APP}/.MainActivity`);
  await sleep(4000);
  let { browser, page } = await connect();
  const original = await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), KEYS);
  const results = [];
  let openedRoom = false;
  let currentProfile = null;
  let tempPlaylist = null;
  let playlistCount = null;

  try {
    if (pages.some(p => p.hash?.includes('TEMP_PLAYLIST'))) {
      // 临时歌单：拿网易云歌单的前 6 首当内容。记下原本有几个歌单，删掉后对一下
      ({ tempPlaylist, playlistCount } = await page.evaluate(`${HELPERS}; (async () => {
        const lib = STORE('library');
        await lib.refreshPlaylists();
        const playlistCount = lib.playlists.length;
        const res = await fetch('https://lyristage-api.vercel.app/playlist/track/all?id=3778678&limit=6');
        const { songs } = await res.json();
        const row = await lib.saveAsPlaylist('LS 测试', songs);
        return { tempPlaylist: row?.id ?? null, playlistCount };
      })()`));
      if (!tempPlaylist) throw new Error('临时歌单建不起来（测试账号要登录）');
      console.log(`临时歌单 LS 测试：${tempPlaylist}（原本 ${playlistCount} 个歌单）`);
    }
    for (const p of pages) if (p.hash?.includes('TEMP_PLAYLIST')) p.hash = p.hash.replace('TEMP_PLAYLIST', tempPlaylist);
    for (const [profileId, locale, theme] of runs) {
      const profile = PROFILES[profileId];
      if (currentProfile !== profileId) {
        applyProfile(profile);
        currentProfile = profileId;
        await sleep(5000);
      }
      await browser.close().catch(() => {});
      ({ browser, page } = await connect());
      await page.evaluate(([l, t, offline]) => {
        localStorage.setItem('lyristage:locale', l);
        localStorage.setItem('lyristage:theme', t);
        localStorage.setItem('lyristage:offline', offline);
      }, [locale, theme, MOCK_OFFLINE]);
      await page.evaluate(() => location.reload());
      await sleep(5000);
      ({ browser, page } = await connect());
      for (const p of pages) {
        if (p.only && !p.only.includes(profileId)) continue;
        const name = `${profileId}-${locale}-${theme}-${p.id}`;
        if (p.room && !(await page.evaluate(`${HELPERS}; STORE('room').inRoom`))) {
          await page.evaluate(`${HELPERS}; STORE('room').createRoom()`);
          openedRoom = true;
        }
        const cdp = p.offline ? await page.context().newCDPSession(page) : null;
        const setOffline = on => cdp?.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        if (cdp) {
          await cdp.send('Network.enable');
          await setOffline(true);
        }
        if (p.stage) {
          // 全屏歌词（设备上最好有一首正在播的歌，不然只看得到空的舞台）
          await page.evaluate(`${HELPERS}; STORE('ui').stageOpen = true`);
        } else {
          await page.evaluate(h => (location.hash = h), p.hash);
        }
        await sleep(p.wait ?? 2500);
        // 「确认你的名字」只跳一次、而且要用户自己确认：检查时先关掉（不帮用户确认）；name-sheet 那一页再打开来检查
        await page.evaluate(() => document.querySelector('dialog.name-sheet[open]')?.close()).catch(() => {});
        if (p.mock) await page.evaluate(p.mock);
        if (p.styleIndex !== undefined) {
          // 换歌词风格：打开歌词框（房间的或全屏的）的风格面板，按第几个（按了面板会自己关）
          const stage = p.room ? '.stage-panel .stage' : '.stage:not(.embedded)';
          await page.evaluate(`${HELPERS}; click('${stage} .topbar .pill[aria-expanded]')`);
          await sleep(500);
          await page.evaluate(([sel, i]) => [...document.querySelectorAll(`${sel} .picker .option`)][i]?.click(), [stage, p.styleIndex]);
          await sleep(2000);
        }
        if (p.open) {
          await page.evaluate(`${HELPERS}; (${p.open.toString()})()`);
          await sleep(1000);
        }
        const see = profile.rotation === 1 ? p.seeLandscape ?? [] : [];
        const { issues, width, height } = await page.evaluate(CHECK, { reach: p.reach ?? [], see, fits: p.fits ?? [], textOverlap: Boolean(p.textOverlap) });
        fs.writeFileSync(path.join(OUT, `${name}.png`), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
        await page.evaluate(() => document.querySelectorAll('[data-lc]').forEach(el => ((el.style.outline = ''), el.removeAttribute('data-lc'))));
        if (p.close) await page.evaluate(`${HELPERS}; (${p.close.toString()})()`).catch(() => {});
        if (p.stage) await page.evaluate(`${HELPERS}; STORE('ui').stageOpen = false`);
        if (cdp) {
          await setOffline(false);
          await cdp.detach().catch(() => {});
        }
        await page.evaluate(() => (document.querySelector('.area-main') ?? document.scrollingElement)?.scrollTo(0, 0)).catch(() => {});
        results.push({ name, profile: profile.label, locale, theme, page: p.id, width, height, issues });
        const markText = issues.length ? `✗ ${issues.length}` : '✓';
        console.log(`${markText.padEnd(4)} ${profileId.padEnd(14)} ${locale.padEnd(6)} ${theme.padEnd(6)} ${p.id}`);
        for (const issue of issues) console.log(`       [${issue.kind}] ${issue.text}`);
      }
    }
  } finally {
    // 改回原本的语言、主题、离线清单，关掉测试房间，画面设定改回来
    try {
      ({ browser, page } = await connect());
      if (openedRoom) await page.evaluate(`${HELPERS}; UNGUEST(); STORE('room').leave()`).catch(() => {});
      if (tempPlaylist) {
        try {
          const left = await page.evaluate(`${HELPERS}; (async () => {
            const lib = STORE('library');
            await lib.deletePlaylist(${JSON.stringify(tempPlaylist)});
            await lib.refreshPlaylists();
            return lib.playlists.length;
          })()`);
          console.log(`删掉临时歌单：现在 ${left} 个歌单${left === playlistCount ? '，跟原本一样' : `，原本 ${playlistCount} 个，请检查！`}`);
        } catch (err) {
          console.log(`！！临时歌单 ${tempPlaylist} 没删掉，要手动删：${err.message}`);
        }
      }
      await page.evaluate(
        ([keys, values]) => keys.forEach((k, i) => (values[i] === null ? localStorage.removeItem(k) : localStorage.setItem(k, values[i]))),
        [KEYS, original]
      );
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
  <figcaption><b>${esc(r.page)}</b> · ${esc(r.profile)} · ${esc(r.locale)} · ${esc(r.theme)} · ${r.width}×${r.height}
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
