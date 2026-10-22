// 分享卡片（歌词卡片、听歌报告共用）：画在 1080×1920 的 canvas 上（IG 限动的尺寸）
// 背景用封面取的颜色，字一律白色，底部是 LyriStage 的标志

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;
const SERIF = '"Noto Serif SC", "Songti SC", serif';
const SANS = '"Noto Sans SC", "Segoe UI", system-ui, sans-serif';
const ACCENT = '#ff3b5c';

const rgba = ([r, g, b], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

/** 等字体载入好（canvas 不会自己等，没载入就会用系统字体） */
export async function loadCardFonts() {
  try {
    await Promise.all([
      document.fonts.load(`900 72px ${SERIF}`),
      document.fonts.load(`700 40px ${SANS}`),
      document.fonts.load(`400 34px ${SANS}`),
    ]);
  } catch {
    // 载不到就用系统字体
  }
}

/** 封面图（要能画进 canvas：网易云的图片允许跨域） */
export function loadCover(picUrl, size = 720) {
  if (!picUrl) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${picUrl.replace(/^http:/, 'https:')}?param=${size}y${size}`;
  });
}

/**
 * 断行：中日韩文字可以在任何字之间断，英文按单词断
 * @returns {string[]}
 */
export function wrapText(ctx, text, maxWidth) {
  const tokens = text.match(/[　-鿿가-힯＀-￯]|[^\s　-鿿가-힯＀-￯]+\s*|\s+/g) ?? [];
  const lines = [];
  let line = '';
  for (const token of tokens) {
    const next = line + token;
    if (line && ctx.measureText(next.trimEnd()).width > maxWidth) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else {
      line = next;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** 背景：封面颜色由上到下渐层，再压一层暗色让白字看得清 */
export function paintBackground(ctx, palette) {
  const g = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  g.addColorStop(0, rgba(palette.vibrant));
  g.addColorStop(0.55, rgba(palette.dominant));
  g.addColorStop(1, rgba(palette.dark));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

/** 圆角封面，带阴影 */
export function paintCover(ctx, img, x, y, size, radius = 36) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fill();
  ctx.restore();
  if (!img) return;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

/** 底部的 LyriStage 标志 */
export function paintBrand(ctx) {
  const y = CARD_HEIGHT - 100;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `900 52px ${SERIF}`;
  const lyri = 'Lyri';
  const full = ctx.measureText('LyriStage').width;
  const x = (CARD_WIDTH - full) / 2;
  ctx.fillStyle = '#fff';
  ctx.fillText(lyri, x, y);
  ctx.fillStyle = ACCENT;
  ctx.fillText('Stage', x + ctx.measureText(lyri).width, y);
}

/**
 * 歌词卡片
 * @param {{ lines: { text: string, sub?: string }[], track: any, palette: any }} options
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderLyricCard({ lines, track, palette }) {
  await loadCardFonts();
  const cover = await loadCover(track?.al?.picUrl);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  paintBackground(ctx, palette);

  const coverSize = 520;
  paintCover(ctx, cover, (CARD_WIDTH - coverSize) / 2, 200, coverSize);

  // 歌词：从封面下面到歌名上面这块，字太多就缩小
  const left = 110;
  const width = CARD_WIDTH - left * 2;
  const top = 200 + coverSize + 110;
  const bottom = CARD_HEIGHT - 360;
  let size = 72;
  let layout;
  for (; size >= 44; size -= 4) {
    ctx.font = `900 ${size}px ${SERIF}`;
    const subSize = Math.round(size * 0.5);
    layout = [];
    let h = 0;
    for (const line of lines) {
      ctx.font = `900 ${size}px ${SERIF}`;
      const main = wrapText(ctx, line.text, width);
      ctx.font = `400 ${subSize}px ${SANS}`;
      const sub = line.sub ? wrapText(ctx, line.sub, width) : [];
      layout.push({ main, sub });
      h += main.length * size * 1.28 + sub.length * subSize * 1.5 + size * 0.45;
    }
    if (h <= bottom - top) break;
  }
  const subSize = Math.round(size * 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = top;
  for (const { main, sub } of layout) {
    ctx.font = `900 ${size}px ${SERIF}`;
    ctx.fillStyle = '#fff';
    for (const text of main) {
      ctx.fillText(text, left, y);
      y += size * 1.28;
    }
    ctx.font = `400 ${subSize}px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    for (const text of sub) {
      ctx.fillText(text, left, y);
      y += subSize * 1.5;
    }
    y += size * 0.45;
  }

  // 歌名、歌手
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 40px ${SANS}`;
  ctx.fillStyle = '#fff';
  const name = wrapText(ctx, `— ${track?.name ?? ''}`, width)[0] ?? '';
  ctx.fillText(name, left, CARD_HEIGHT - 290);
  ctx.font = `400 32px ${SANS}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  const artists = (track?.ar ?? []).map(a => a.name).join(' / ');
  ctx.fillText(wrapText(ctx, artists, width)[0] ?? '', left, CARD_HEIGHT - 242);

  paintBrand(ctx);
  return canvas;
}

/**
 * 歌单海报：上面是封面（自己的封面，没有就用前 4 首拼），下面歌单名、谁的歌单、前几首歌
 * @param {{ name: string, owner: string, cover?: string | null, tracks: any[], palette: any,
 *   labels: { byline: string, more: (n: number) => string } }} options
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPlaylistCard({ name, owner, cover, tracks, palette, labels }) {
  await loadCardFonts();
  const LIST = 5;
  const songCovers = await Promise.all(tracks.slice(0, LIST).map(t => loadCover(t.al?.picUrl, 160)));
  const art = cover
    ? [await loadCover(cover, 720)]
    : await Promise.all(tracks.slice(0, 4).map(t => loadCover(t.al?.picUrl, 360)));
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  paintBackground(ctx, palette);

  // 封面：一张，或 2×2 拼起来（跟 App 里的歌单封面一样）
  const size = 560;
  const x0 = (CARD_WIDTH - size) / 2;
  const y0 = 150;
  if (art.length >= 4) {
    paintCover(ctx, null, x0, y0, size);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, y0, size, size, 36);
    ctx.clip();
    const half = size / 2;
    art.forEach((img, i) => {
      if (img) ctx.drawImage(img, x0 + (i % 2) * half, y0 + Math.floor(i / 2) * half, half, half);
    });
    ctx.restore();
  } else {
    paintCover(ctx, art[0], x0, y0, size);
  }

  // 歌单名、谁的歌单
  const left = 110;
  const width = CARD_WIDTH - left * 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let titleSize = 92;
  for (; titleSize > 56; titleSize -= 4) {
    ctx.font = `900 ${titleSize}px ${SERIF}`;
    if (ctx.measureText(name).width <= width) break;
  }
  ctx.fillStyle = '#fff';
  const title = wrapText(ctx, name, width).slice(0, 2);
  let y = y0 + size + 140;
  for (const line of title) {
    ctx.fillText(line, CARD_WIDTH / 2, y);
    y += titleSize * 1.15;
  }
  ctx.font = `400 34px ${SANS}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fillText(labels.byline, CARD_WIDTH / 2, y + 4);
  y += 90;

  // 前几首歌：小封面、歌名、歌手
  const rowH = 118;
  ctx.textAlign = 'left';
  tracks.slice(0, LIST).forEach((track, i) => {
    const top = y + i * rowH;
    ctx.font = `700 34px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), left, top + 44);
    paintCover(ctx, songCovers[i], left + 56, top, 88, 14);
    const textX = left + 56 + 88 + 30;
    const textW = CARD_WIDTH - left - textX;
    ctx.font = `700 38px ${SANS}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(wrapText(ctx, track.name ?? '', textW)[0] ?? '', textX, top + 26);
    ctx.font = `400 30px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    const artists = (track.ar ?? []).map(a => a.name).join(' / ');
    ctx.fillText(wrapText(ctx, artists, textW)[0] ?? '', textX, top + 70);
  });
  if (tracks.length > LIST) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `400 30px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(labels.more(tracks.length - LIST), CARD_WIDTH / 2, y + LIST * rowH + 40);
  }

  paintBrand(ctx);
  return canvas;
}

/**
 * 海报墙（播放队列）：一行 4 张封面，正在播的放大成 2×2、播过的稍暗；放正在播的前后十几首
 * 关灯：底色变黑，只有正在播的那张亮着、周围透出它的颜色
 * @param {{ tiles: { track: any, section: 'played' | 'current' | 'queued' | 'list' }[],
 *   palette: any, lightsOff?: boolean, labels: { title: string, subtitle: string, now: string } }} options
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderQueueWallCard({ tiles, palette, lightsOff = false, labels }) {
  await loadCardFonts();
  const COLS = 4;
  const ROWS = 6;
  const left = 70;
  const gap = 14;
  const cell = (CARD_WIDTH - left * 2 - gap * (COLS - 1)) / COLS;

  // 挑要放的：正在播的前面 3 首（播过的），后面接下来的，放满为止（正在播的占 4 格）
  const at = Math.max(0, tiles.findIndex(t => t.section === 'current'));
  const picked = tiles.slice(Math.max(0, at - 3), Math.max(0, at - 3) + COLS * ROWS - 3);

  // 像 CSS grid 的 dense 排法：每张放进第一个空位，2×2 的找第一个放得下的位置
  const used = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const placed = [];
  for (const tile of picked) {
    const span = tile.section === 'current' ? 2 : 1;
    let spot = null;
    for (let r = 0; r <= ROWS - span && !spot; r++) {
      for (let c = 0; c <= COLS - span && !spot; c++) {
        let free = true;
        for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) free &&= !used[r + dr][c + dc];
        if (free) spot = { r, c };
      }
    }
    if (!spot) continue;
    for (let dr = 0; dr < span; dr++) for (let dc = 0; dc < span; dc++) used[spot.r + dr][spot.c + dc] = true;
    placed.push({ ...tile, ...spot, span });
  }
  const images = await Promise.all(placed.map(p => loadCover(p.track.al?.picUrl, p.span === 2 ? 600 : 300)));

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  const top = 300;
  const current = placed.find(p => p.span === 2);
  if (lightsOff) {
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    if (current) {
      const cx = left + current.c * (cell + gap) + cell + gap / 2;
      const cy = top + current.r * (cell + gap) + cell + gap / 2;
      const glow = ctx.createRadialGradient(cx, cy, cell * 0.5, cx, cy, cell * 3.2);
      glow.addColorStop(0, rgba(palette.vibrant, 0.55));
      glow.addColorStop(1, rgba(palette.vibrant, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    }
  } else {
    paintBackground(ctx, palette);
  }

  // 标题
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 76px ${SERIF}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(labels.title, left, 190);
  ctx.font = `400 32px ${SANS}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fillText(wrapText(ctx, labels.subtitle, CARD_WIDTH - left * 2)[0] ?? '', left, 250);

  // 封面墙
  placed.forEach((p, i) => {
    const x = left + p.c * (cell + gap);
    const y = top + p.r * (cell + gap);
    const size = p.span * cell + (p.span - 1) * gap;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, p.span === 2 ? 22 : 12);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(x, y, size, size);
    if (lightsOff && p.span !== 2) ctx.filter = 'grayscale(0.6)';
    if (images[i]) ctx.drawImage(images[i], x, y, size, size);
    ctx.filter = 'none';
    // 播过的稍暗；关灯时除了正在播的都几乎看不见
    const shade = lightsOff ? (p.span === 2 ? 0 : 0.86) : p.section === 'played' ? 0.5 : 0;
    if (shade) {
      ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
      ctx.fillRect(x, y, size, size);
    }
    if (p.span === 2) {
      // 正在播：底部渐暗，放「正在播」和歌名
      const g = ctx.createLinearGradient(0, y + size * 0.45, 0, y + size);
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, size, size);
      ctx.font = `700 26px ${SANS}`;
      const tag = labels.now;
      const tagW = ctx.measureText(tag).width + 36;
      ctx.beginPath();
      ctx.roundRect(x + 24, y + size - 150, tagW, 46, 23);
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, x + 42, y + size - 127);
      ctx.textBaseline = 'alphabetic';
      ctx.font = `700 40px ${SANS}`;
      ctx.fillText(wrapText(ctx, p.track.name ?? '', size - 48)[0] ?? '', x + 24, y + size - 58);
      ctx.font = `400 28px ${SANS}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      const artists = (p.track.ar ?? []).map(a => a.name).join(' / ');
      ctx.fillText(wrapText(ctx, artists, size - 48)[0] ?? '', x + 24, y + size - 20);
    }
    ctx.restore();
    if (p.span === 2) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, 22);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();
    }
  });

  paintBrand(ctx);
  return canvas;
}

/** canvas → PNG */
export const canvasToBlob = canvas =>
  new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('图片产生失败'))), 'image/png')
  );

/**
 * 听歌报告卡片
 * @param {{ title: string, report: ReturnType<typeof import('@core/report').buildReport>, palette: any, labels: { minutes: string, tracks: string, artists: string, topSongs: string, topArtists: string, plays: (n: number) => string, peak: string } }} options
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderReportCard({ title, report, palette, labels }) {
  await loadCardFonts();
  const covers = await Promise.all(report.topTracks.slice(0, 5).map(t => loadCover(t.track?.al?.picUrl, 160)));
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  paintBackground(ctx, palette);
  const left = 100;
  const width = CARD_WIDTH - left * 2;

  // 标题
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `900 76px ${SERIF}`;
  let y = 230;
  for (const line of wrapText(ctx, title, width)) {
    ctx.fillText(line, left, y);
    y += 92;
  }

  // 大数字：听了几分钟
  y += 70;
  ctx.font = `900 190px ${SERIF}`;
  ctx.fillStyle = '#fff';
  const minutes = report.totalMinutes.toLocaleString();
  ctx.fillText(minutes, left, y + 120);
  ctx.font = `700 44px ${SANS}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillText(labels.minutes, left, y + 190);

  // 两个小数字
  y += 290;
  ctx.font = `700 40px ${SANS}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(`${report.distinctTracks.toLocaleString()} ${labels.tracks}`, left, y);
  ctx.fillText(`${report.distinctArtists.toLocaleString()} ${labels.artists}`, left + width / 2, y);

  // 最常听的歌
  y += 110;
  ctx.font = `700 34px ${SANS}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText(labels.topSongs, left, y);
  y += 30;
  report.topTracks.slice(0, 5).forEach((t, i) => {
    const rowY = y + i * 136;
    paintCover(ctx, covers[i], left, rowY, 112, 16);
    ctx.textBaseline = 'middle';
    ctx.font = `900 40px ${SANS}`;
    ctx.fillStyle = '#fff';
    const textLeft = left + 112 + 28;
    const textWidth = width - 112 - 28;
    ctx.fillText(wrapText(ctx, `${i + 1}. ${t.track?.name ?? ''}`, textWidth)[0] ?? '', textLeft, rowY + 38);
    ctx.font = `400 30px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    const artists = (t.track?.ar ?? []).map(a => a.name).join(' / ');
    ctx.fillText(wrapText(ctx, `${artists} · ${labels.plays(t.plays)}`, textWidth)[0] ?? '', textLeft, rowY + 82);
    ctx.textBaseline = 'alphabetic';
  });

  // 最常听的歌手、时段
  y += Math.min(5, report.topTracks.length) * 136 + 70;
  if (report.topArtists[0]) {
    ctx.font = `700 34px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(labels.topArtists, left, y);
    ctx.font = `900 52px ${SERIF}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(wrapText(ctx, report.topArtists[0].name, width)[0] ?? '', left, y + 70);
    y += 130;
  }
  if (labels.peak) {
    ctx.font = `400 34px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const line of wrapText(ctx, labels.peak, width).slice(0, 2)) {
      ctx.fillText(line, left, y);
      y += 48;
    }
  }

  paintBrand(ctx);
  return canvas;
}

/**
 * 年度回顾的一页（每页都能单独分享，参考 Spotify Wrapped）
 * @param {object} slide
 * @param {[string, string]} slide.colors 背景由上到下的两个颜色（CSS 颜色）
 * @param {string} [slide.eyebrow] 上面的小字
 * @param {string} [slide.big] 大字（数字、名字）
 * @param {string} [slide.unit] 大字后面的单位（分钟）
 * @param {string} [slide.quote] 引言（歌词）
 * @param {string} [slide.sub] 下面的说明
 * @param {string} [slide.cover] 封面网址
 * @param {Array<{ title: string, sub: string, cover?: string }>} [slide.list] 排行
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderStoryCard(slide) {
  await loadCardFonts();
  const [cover, ...listCovers] = await Promise.all([
    loadCover(slide.cover, 720),
    ...(slide.list ?? []).map(item => loadCover(item.cover, 160)),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, CARD_WIDTH * 0.4, CARD_HEIGHT);
  g.addColorStop(0, slide.colors[0]);
  g.addColorStop(1, slide.colors[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const left = 100;
  const width = CARD_WIDTH - left * 2;
  let y = 260;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (cover) {
    paintCover(ctx, cover, (CARD_WIDTH - 600) / 2, y, 600, 40);
    y += 600 + 130;
  }
  if (slide.eyebrow) {
    ctx.font = `700 42px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (const line of wrapText(ctx, slide.eyebrow, width).slice(0, 2)) {
      ctx.fillText(line, left, y);
      y += 58;
    }
    y += 40;
  }
  if (slide.big) {
    const size = slide.big.length > 8 ? 110 : 180;
    ctx.font = `900 ${size}px ${SERIF}`;
    ctx.fillStyle = '#fff';
    for (const line of wrapText(ctx, slide.big, width).slice(0, 3)) {
      ctx.fillText(line, left, y + size * 0.8);
      y += size * 1.1;
    }
    if (slide.unit) {
      ctx.font = `700 52px ${SANS}`;
      ctx.fillText(slide.unit, left, y + 30);
      y += 90;
    }
    y += 30;
  }
  if (slide.quote) {
    ctx.font = `900 76px ${SERIF}`;
    ctx.fillStyle = '#fff';
    for (const line of wrapText(ctx, `“${slide.quote}”`, width).slice(0, 6)) {
      ctx.fillText(line, left, y + 60);
      y += 100;
    }
    y += 40;
  }
  (slide.list ?? []).slice(0, 5).forEach((item, i) => {
    paintCover(ctx, listCovers[i], left, y, 120, 16);
    ctx.textBaseline = 'middle';
    ctx.font = `900 44px ${SANS}`;
    ctx.fillStyle = '#fff';
    const textLeft = left + 150;
    ctx.fillText(wrapText(ctx, `${i + 1}  ${item.title}`, width - 150)[0] ?? '', textLeft, y + 40);
    ctx.font = `400 32px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(wrapText(ctx, item.sub, width - 150)[0] ?? '', textLeft, y + 88);
    ctx.textBaseline = 'alphabetic';
    y += 160;
  });
  if (slide.sub) {
    ctx.font = `400 40px ${SANS}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const line of wrapText(ctx, slide.sub, width).slice(0, 4)) {
      ctx.fillText(line, left, y + 20);
      y += 56;
    }
  }
  paintBrand(ctx);
  return canvas;
}
