<script setup>
// 年度回顾（参考 Spotify Wrapped）：一页一页像限时动态，点右边下一页、左边上一页、按住暂停，
// 每页一个颜色，每页都能单独存成图片分享。
// LyriStage 自己的特色：「今年你最常听到的一句」——年度歌曲里重复最多次的那句歌词
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { listHistoryBetween, listMonthlyHistory } from '@core/data';
import { buildReport, minutesChange, mostRepeatedLine } from '@core/report';
import { getLyrics } from '../services';
import { getPalette, rgb } from '../lyric-stage/palette';
import { canShareImage, saveImage, shareImage } from '../platform';
import { canvasToBlob, renderStoryCard } from '../utils/shareCard';
import { useNoticeStore } from '../stores/notice';
import { t } from '../i18n';
import Icon from './Icon.vue';

const SLIDE_MS = 7000;
const notice = useNoticeStore();
const year = new Date().getFullYear();

const box = ref(null);
const loading = ref(false);
const error = ref('');
const report = ref(null);
const lastYearMinutes = ref(0);
const line = ref(null);
const palettes = ref({ artist: null, song: null });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [now, before, beforeMonthly] = await Promise.all([
      listHistoryBetween(new Date(year, 0, 1), new Date(year + 1, 0, 1)),
      listHistoryBetween(new Date(year - 1, 0, 1), new Date(year, 0, 1)),
      // 去年较早的月份可能已经整理成每月小结（compact_play_history）
      listMonthlyHistory(new Date(year - 1, 0, 1), new Date(year, 0, 1)),
    ]);
    report.value = buildReport(now);
    lastYearMinutes.value =
      buildReport(before).totalMinutes +
      Math.round(beforeMonthly.reduce((sum, m) => sum + Number(m.listened_seconds), 0) / 60);
    const top = report.value.topTracks[0]?.track;
    const [lyrics, songPalette, artistPalette] = await Promise.all([
      top ? getLyrics(top).catch(() => null) : null,
      getPalette(top?.al?.picUrl),
      getPalette(report.value.topArtists[0]?.cover),
    ]);
    line.value = lyrics ? mostRepeatedLine(lyrics.lines) : null;
    palettes.value = { song: songPalette, artist: artistPalette };
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

const artistsOf = track => (track?.ar ?? []).map(a => a.name).join(' / ');
/** 封面颜色做背景（深一点，白字才看得清） */
const fromPalette = (palette, fallback) =>
  palette ? [rgb(palette.vibrant), rgb(palette.dark)] : fallback;

const slides = computed(() => {
  const r = report.value;
  if (!r) return [];
  const list = [];
  list.push({
    id: 'intro',
    colors: ['#ff3b5c', '#5b21b6'],
    eyebrow: t('{year} 年度回顾', { year }),
    big: t('你的 {year}', { year }),
    sub: t('这一年你听了什么、爱上了谁，一页一页看。'),
  });
  const change = minutesChange(r.totalMinutes, lastYearMinutes.value);
  list.push({
    id: 'minutes',
    colors: ['#0ea5e9', '#1e3a8a'],
    // 先问再揭晓（Wrapped 的好奇钩子）
    teaser: t('你觉得今年听了多久？'),
    eyebrow: t('今年你听了'),
    big: r.totalMinutes.toLocaleString(),
    count: r.totalMinutes,
    unit: t('分钟'),
    sub:
      change === null
        ? t('相当于不停地听了 {d} 天', { d: (r.totalMinutes / 1440).toFixed(1) })
        : change >= 0
          ? t('比去年多了 {p}%', { p: change })
          : t('比去年少了 {p}%', { p: -change }),
  });
  const artist = r.topArtists[0];
  if (artist) {
    list.push({
      id: 'artist',
      colors: fromPalette(palettes.value.artist, ['#f59e0b', '#7c2d12']),
      cover: artist.cover,
      eyebrow: t('你今年最常听的歌手'),
      big: artist.name,
      sub: t('听了 {h} 小时', { h: Math.max(1, Math.round(artist.seconds / 3600)) }),
    });
  }
  const song = r.topTracks[0];
  if (song) {
    list.push({
      id: 'song',
      colors: fromPalette(palettes.value.song, ['#ec4899', '#831843']),
      cover: song.track?.al?.picUrl,
      eyebrow: t('你的年度歌曲'),
      big: song.track?.name ?? '',
      sub: t('{artists} · 听了 {n} 次', { artists: artistsOf(song.track), n: song.plays }),
    });
  }
  if (r.topTracks.length > 1) {
    list.push({
      id: 'top',
      colors: ['#10b981', '#064e3b'],
      eyebrow: t('你最常听的 {n} 首', { n: Math.min(5, r.topTracks.length) }),
      list: r.topTracks.slice(0, 5).map(x => ({
        title: x.track?.name ?? '',
        sub: t('{artists} · {n} 次', { artists: artistsOf(x.track), n: x.plays }),
        cover: x.track?.al?.picUrl,
      })),
    });
  }
  if (line.value && song) {
    list.push({
      id: 'lyric',
      colors: ['#1f2937', '#4c1d95'],
      eyebrow: t('今年你最常听到的一句'),
      quote: line.value.text,
      sub: line.value.translation
        ? `${line.value.translation}\n— ${song.track?.name}`
        : `— ${song.track?.name}`,
    });
  }
  if (r.peakHour !== null) {
    const h = r.peakHour;
    const kind = h < 5 ? t('夜猫子') : h < 11 ? t('早起的人') : h < 14 ? t('午间听歌的人') : h < 18 ? t('下午听歌的人') : t('晚上听歌的人');
    list.push({
      id: 'time',
      colors: ['#f97316', '#7c2d12'],
      eyebrow: t('你是'),
      big: kind,
      sub: [
        t('最常在 {h} 点听歌', { h }),
        r.busiestDay
          ? t('听最多的一天是 {m} 月 {d} 日，听了 {n} 分钟', {
              m: Number(r.busiestDay.day.split('-')[1]),
              d: Number(r.busiestDay.day.split('-')[2]),
              n: r.busiestDay.minutes,
            })
          : '',
      ].filter(Boolean).join('\n'),
    });
  }
  list.push({
    id: 'outro',
    colors: ['#ff3b5c', '#111827'],
    eyebrow: `LyriStage ${year}`,
    big: t('谢谢你一起听歌'),
    sub: t('{tracks} 首歌 · {artists} 位歌手 · {days} 天', {
      tracks: r.distinctTracks.toLocaleString(),
      artists: r.distinctArtists.toLocaleString(),
      days: r.activeDays,
    }),
  });
  return list;
});

// ---- 翻页：像限时动态 ----
const index = ref(0);
const paused = ref(false);
const progress = ref(0); // 这一页走了多少（0~1）
const revealed = ref(false); // 好奇钩子：问题之后才揭晓数字
const counted = ref(0); // 数字从 0 跑上去
let raf = 0;
let last = 0;

const slide = computed(() => slides.value[index.value]);

function go(i) {
  if (i < 0) i = 0;
  // 翻过最后一页就关掉（资料还在载入、一页都没有时不算）
  if (slides.value.length && i >= slides.value.length) {
    close();
    return;
  }
  index.value = i;
  progress.value = 0;
  revealed.value = !slide.value?.teaser;
  counted.value = 0;
}
function tick(now) {
  const dt = last ? now - last : 0;
  last = now;
  if (!paused.value && slide.value) {
    progress.value += dt / SLIDE_MS;
    if (slide.value.teaser && !revealed.value && progress.value > 0.22) revealed.value = true;
    if (slide.value.count && revealed.value) {
      // 揭晓后 1.2 秒内数到最后的数字（先快后慢）
      const start = slide.value.teaser ? 0.22 : 0;
      const k = Math.min(1, (progress.value - start) / (1200 / SLIDE_MS));
      counted.value = Math.round(slide.value.count * (1 - (1 - k) ** 3));
    }
    if (progress.value >= 1) go(index.value + 1);
  }
  raf = requestAnimationFrame(tick);
}

/** 点左边三分之一上一页，其他地方下一页；按住暂停 */
let downAt = 0;
function onDown() {
  downAt = performance.now();
  paused.value = true;
}
function onUp(event) {
  paused.value = false;
  if (performance.now() - downAt > 350) return; // 是按住，不是点
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientX - rect.left < rect.width / 3) go(index.value - 1);
  else go(index.value + 1);
}
function onKey(event) {
  if (event.key === 'ArrowRight') go(index.value + 1);
  if (event.key === 'ArrowLeft') go(index.value - 1);
}

async function open() {
  box.value.showModal();
  go(0);
  last = 0;
  raf = requestAnimationFrame(tick);
  if (!report.value) await load();
  go(0);
}
function close() {
  cancelAnimationFrame(raf);
  if (box.value?.open) box.value.close();
}
onBeforeUnmount(() => cancelAnimationFrame(raf));
defineExpose({ open });

// 关掉对话框（Esc、Android 返回键）时停止动画
watch(box, el => el?.addEventListener('close', () => cancelAnimationFrame(raf)));

// ---- 分享这一页 ----
const sharing = ref(false);
const shareable = canShareImage();
async function shareSlide() {
  if (!slide.value || sharing.value) return;
  sharing.value = true;
  paused.value = true;
  try {
    const s = slide.value;
    const canvas = await renderStoryCard({
      ...s,
      sub: s.sub,
      big: s.big,
    });
    const blob = await canvasToBlob(canvas);
    const fileName = `LyriStage-${year}-${s.id}.png`;
    if (shareable) await shareImage(blob, fileName);
    else await saveImage(blob, fileName);
  } catch (err) {
    if (err?.name !== 'AbortError' && !/cancel/i.test(err?.message ?? '')) {
      notice.show(t('操作失败：{error}', { error: err.message || err }));
    }
  } finally {
    sharing.value = false;
    paused.value = false;
  }
}
</script>

<template>
  <dialog ref="box" class="year-review" @keydown="onKey">
    <div
      v-if="slide"
      class="story"
      :style="{ '--c1': slide.colors[0], '--c2': slide.colors[1] }"
    >
      <!-- 上面的进度条 -->
      <div class="bars" aria-hidden="true">
        <span v-for="(s, i) in slides" :key="s.id" class="bar">
          <span :style="{ width: i < index ? '100%' : i === index ? `${progress * 100}%` : '0%' }" />
        </span>
      </div>
      <button class="close" :aria-label="$t('关闭')" @click="close">
        <Icon name="x" :size="22" />
      </button>

      <!-- 点 / 按住的区域 -->
      <div
        class="tap"
        @pointerdown="onDown"
        @pointerup="onUp"
        @pointercancel="paused = false"
        @contextmenu.prevent
      >
        <Transition name="slide" mode="out-in">
          <div :key="slide.id + revealed" class="content">
            <p v-if="slide.teaser && !revealed" class="teaser display">{{ slide.teaser }}</p>
            <template v-else>
              <img v-if="slide.cover" class="cover" :src="`${slide.cover.replace(/^http:/, 'https:')}?param=600y600`" alt="" />
              <p v-if="slide.eyebrow" class="eyebrow">{{ slide.eyebrow }}</p>
              <p v-if="slide.big" class="big display" :class="{ long: slide.big.length > 8 }">
                {{ slide.count ? counted.toLocaleString() : slide.big }}
              </p>
              <p v-if="slide.unit" class="unit">{{ slide.unit }}</p>
              <p v-if="slide.quote" class="quote display">“{{ slide.quote }}”</p>
              <ol v-if="slide.list" class="list">
                <li v-for="(item, i) in slide.list" :key="i" :style="{ animationDelay: `${0.15 + i * 0.12}s` }">
                  <img v-if="item.cover" :src="`${item.cover.replace(/^http:/, 'https:')}?param=120y120`" alt="" />
                  <span>
                    <strong>{{ i + 1 }}. {{ item.title }}</strong>
                    <small>{{ item.sub }}</small>
                  </span>
                </li>
              </ol>
              <p v-if="slide.sub" class="sub">{{ slide.sub }}</p>
            </template>
          </div>
        </Transition>
      </div>

      <button class="share" :disabled="sharing" @click="shareSlide">
        <Icon name="share" :size="18" />{{ shareable ? $t('分享这一页') : $t('存成图片') }}
      </button>
    </div>
    <div v-else class="story waiting" style="--c1: #ff3b5c; --c2: #5b21b6">
      <button class="close" :aria-label="$t('关闭')" @click="close"><Icon name="x" :size="22" /></button>
      <p class="sub">{{ error ? $t('载入失败：{error}', { error }) : $t('正在整理你的一年…') }}</p>
    </div>
  </dialog>
</template>

<style scoped>
.year-review {
  width: 100vw;
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: #000;
  color: #fff;
}
.year-review::backdrop {
  background: #000;
}
/* 手机全屏；电脑上像一支直立的手机（限动的比例） */
.story {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: calc(100dvh * 9 / 16);
  margin: 0 auto;
  padding: calc(env(safe-area-inset-top) + 20px) 24px calc(env(safe-area-inset-bottom) + 20px);
  overflow: hidden;
  background: linear-gradient(160deg, var(--c1), var(--c2));
  transition: background 0.6s;
}
.bars {
  display: flex;
  gap: 4px;
}
.bar {
  flex: 1;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: rgb(255 255 255 / 0.3);
}
.bar span {
  display: block;
  height: 100%;
  background: #fff;
}
.close {
  position: absolute;
  z-index: 2;
  top: calc(env(safe-area-inset-top) + 34px);
  right: 16px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.2);
  color: #fff;
  cursor: pointer;
}
.tap {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 0;
  touch-action: none;
  user-select: none;
  cursor: pointer;
}
.content {
  width: 100%;
}
.content > * {
  margin: 0;
  animation: rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.content > :nth-child(2) {
  animation-delay: 0.1s;
}
.content > :nth-child(3) {
  animation-delay: 0.2s;
}
.content > :nth-child(4) {
  animation-delay: 0.3s;
}
.content > :nth-child(5) {
  animation-delay: 0.4s;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
}
.teaser {
  font-size: clamp(36px, 9vw, 52px);
  line-height: 1.2;
}
.cover {
  display: block;
  width: min(62%, 300px);
  aspect-ratio: 1;
  margin: 0 auto 28px !important;
  border-radius: 18px;
  object-fit: cover;
  box-shadow: 0 24px 50px rgb(0 0 0 / 0.4);
}
.eyebrow {
  font-size: 18px;
  font-weight: 700;
  opacity: 0.85;
}
.big {
  margin-top: 8px !important;
  font-size: clamp(64px, 18vw, 110px);
  line-height: 1.05;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.big.long {
  font-size: clamp(40px, 11vw, 64px);
}
.unit {
  font-size: 24px;
  font-weight: 700;
}
.quote {
  margin-top: 12px !important;
  font-size: clamp(30px, 8vw, 44px);
  line-height: 1.3;
}
.sub {
  margin-top: 18px !important;
  font-size: 17px;
  line-height: 1.6;
  white-space: pre-line;
  opacity: 0.9;
}
.list {
  display: grid;
  gap: 14px;
  margin-top: 18px !important;
  padding: 0;
  list-style: none;
}
.list li {
  display: flex;
  align-items: center;
  gap: 14px;
  animation: rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.list img {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 8px;
}
.list span {
  display: grid;
  min-width: 0;
}
.list strong,
.list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list small {
  font-size: 13px;
  opacity: 0.8;
}
.share {
  display: inline-flex;
  align-self: center;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  background: #fff;
  color: #111;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.share:disabled {
  opacity: 0.6;
}
.waiting {
  justify-content: center;
  align-items: center;
}
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.25s;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .content > *,
  .list li {
    animation: none;
  }
}
</style>
