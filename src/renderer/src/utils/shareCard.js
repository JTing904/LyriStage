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
  const y = CARD_HEIGHT - 120;
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
  ctx.textAlign = 'center';
  ctx.font = `400 26px ${SANS}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText('jting904.github.io/LyriStage', CARD_WIDTH / 2, y + 48);
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
