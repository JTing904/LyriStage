<script setup>
// 听歌报告：这个月 / 今年听了多久、最常听的歌和歌手、最常在什么时候听，可以做成图片分享
import { computed, ref, watch } from 'vue';
import { listHistoryBetween } from '@core/data';
import { buildReport, periodRange } from '@core/report';
import { getPalette } from '../lyric-stage/palette';
import { canCopyImage, canShareImage, copyImage, saveImage, shareImage } from '../platform';
import { canvasToBlob, renderReportCard } from '../utils/shareCard';
import { useNoticeStore } from '../stores/notice';
import { usePlayCollection } from '../composables/usePlayCollection';
import { t, locale } from '../i18n';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import YearReview from '../components/YearReview.vue';
import LoadError from '../components/LoadError.vue';
import { showError } from '../friendlyError';

// 年度回顾（像 Spotify Wrapped 的限动）
const yearReview = ref(null);
const thisYear = new Date().getFullYear();

const notice = useNoticeStore();
const { playAll } = usePlayCollection();

const period = ref('month');
const report = ref(null);
const loading = ref(true);
const error = ref('');

let loadToken = 0;
async function load() {
  const token = ++loadToken;
  loading.value = true;
  error.value = '';
  try {
    const { from, to } = periodRange(period.value);
    const rows = await listHistoryBetween(from, to);
    if (token === loadToken) report.value = buildReport(rows);
  } catch (err) {
    if (token === loadToken) error.value = err;
  } finally {
    if (token === loadToken) loading.value = false;
  }
}
watch(period, load, { immediate: true });

const now = new Date();
const title = computed(() => {
  if (locale.value === 'en') {
    return period.value === 'year'
      ? `My ${now.getFullYear()} in music`
      : `My ${now.toLocaleDateString('en-US', { month: 'long' })} in music`;
  }
  return period.value === 'year'
    ? `我的 ${now.getFullYear()} 年听歌报告`
    : `我的 ${now.getMonth() + 1} 月听歌报告`;
});

/** 最常听的时段：给它一个说法 */
const peakText = computed(() => {
  const h = report.value?.peakHour;
  if (h === null || h === undefined) return '';
  const name =
    h < 5 ? t('夜猫子') : h < 11 ? t('早起的人') : h < 14 ? t('午间时光') : h < 18 ? t('下午') : t('晚上');
  return t('你最常在 {hour} 点听歌（{name}）', { hour: h, name });
});
const busiestText = computed(() => {
  const d = report.value?.busiestDay;
  if (!d) return '';
  const [, m, day] = d.day.split('-').map(Number);
  return t('听最多的一天是 {m} 月 {d} 日，听了 {n} 分钟', { m, d: day, n: d.minutes });
});
const topTrackList = computed(() => report.value?.topTracks.map(x => x.track) ?? []);

// ---- 分享 ----
const busy = ref(false);
const shareable = canShareImage();
const copyable = canCopyImage();
async function share(action) {
  if (!report.value || busy.value) return;
  busy.value = true;
  try {
    const palette = await getPalette(report.value.topTracks[0]?.track?.al?.picUrl);
    const canvas = await renderReportCard({
      title: title.value,
      report: report.value,
      palette,
      labels: {
        minutes: t('分钟的音乐'),
        tracks: t('首歌'),
        artists: t('位歌手'),
        topSongs: t('最常听的歌'),
        topArtists: t('最常听的歌手'),
        plays: n => t('{n} 次', { n }),
        peak: peakText.value,
      },
    });
    const blob = await canvasToBlob(canvas);
    const fileName = `LyriStage-${period.value}-report.png`;
    if (action === 'share') await shareImage(blob, fileName);
    else if (action === 'copy') {
      await copyImage(blob);
      notice.show(t('已复制图片，可以直接贴上'));
    } else await saveImage(blob, fileName);
  } catch (err) {
    if (err?.name !== 'AbortError' && !/cancel/i.test(err?.message ?? '')) {
      showError(err, t('没分享出去'));
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <h1 class="display title">{{ title }}</h1>

    <button class="wrapped" @click="yearReview.open()">
      <span class="wrapped-year display">{{ thisYear }}</span>
      <span class="wrapped-text">
        <strong>{{ $t('看你的年度回顾') }}</strong>
        <small>{{ $t('你的年度歌曲、最常听到的一句歌词，一页一页看，每页都能分享') }}</small>
      </span>
      <Icon name="chevron-right" :size="22" />
    </button>
    <YearReview ref="yearReview" />

    <div class="tabs" role="tablist">
      <button role="tab" :aria-selected="period === 'month'" :class="{ on: period === 'month' }" @click="period = 'month'">
        {{ $t('这个月') }}
      </button>
      <button role="tab" :aria-selected="period === 'year'" :class="{ on: period === 'year' }" @click="period = 'year'">
        {{ $t('今年') }}
      </button>
    </div>

    <p v-if="loading" class="page-state">{{ $t('正在整理你的听歌记录…') }}</p>
    <LoadError v-else-if="error" :error="error" :what="$t('听歌报告')" @retry="load()" />
    <p v-else-if="!report?.plays" class="page-state">{{ $t('这段时间还没有听歌记录。多听几首再来看看！') }}</p>

    <template v-else>
      <div class="stats">
        <div class="stat big">
          <strong>{{ report.totalMinutes.toLocaleString() }}</strong>
          <span>{{ $t('分钟的音乐') }}</span>
        </div>
        <div class="stat">
          <strong>{{ report.distinctTracks.toLocaleString() }}</strong><span>{{ $t('首歌') }}</span>
        </div>
        <div class="stat">
          <strong>{{ report.distinctArtists.toLocaleString() }}</strong><span>{{ $t('位歌手') }}</span>
        </div>
        <div class="stat">
          <strong>{{ report.activeDays }}</strong><span>{{ $t('天有听歌') }}</span>
        </div>
      </div>

      <p class="facts">
        <span v-if="peakText">{{ peakText }}</span>
        <span v-if="busiestText">{{ busiestText }}</span>
      </p>

      <div class="columns">
        <section>
          <h2>
            {{ $t('最常听的歌') }}
            <button class="text-btn" @click="playAll(topTrackList, `report:${period}`)">
              <Icon name="play" :size="16" />{{ $t('播放') }}
            </button>
          </h2>
          <ol class="ranked">
            <li v-for="(item, i) in report.topTracks" :key="item.track.id">
              <span class="rank">{{ i + 1 }}</span>
              <Cover :url="item.track.al?.picUrl" :size="52" radius="8px" class="cover" />
              <span class="meta">
                <strong>{{ item.track.name }}</strong>
                <span>{{ (item.track.ar ?? []).map(a => a.name).join(' / ') }}</span>
              </span>
              <span class="count">{{ $t('{n} 次', { n: item.plays }) }}</span>
            </li>
          </ol>
        </section>
        <section>
          <h2>{{ $t('最常听的歌手') }}</h2>
          <ol class="ranked">
            <li v-for="(a, i) in report.topArtists" :key="a.id || a.name">
              <span class="rank">{{ i + 1 }}</span>
              <Cover :url="a.cover" :size="52" round class="cover" />
              <span class="meta">
                <RouterLink v-if="a.id" :to="`/artist/${a.id}`"><strong>{{ a.name }}</strong></RouterLink>
                <strong v-else>{{ a.name }}</strong>
                <span>{{ $t('{n} 分钟', { n: Math.round(a.seconds / 60) }) }}</span>
              </span>
            </li>
          </ol>
        </section>
      </div>

      <div class="share">
        <button v-if="shareable" class="primary" :disabled="busy" @click="share('share')">
          <Icon name="share" :size="18" />{{ $t('分享报告') }}
        </button>
        <button v-if="copyable" :class="{ primary: !shareable }" :disabled="busy" @click="share('copy')">
          {{ $t('复制图片') }}
        </button>
        <button :disabled="busy" @click="share('save')">{{ $t('存成图片') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.title {
  margin: 0 0 16px;
}
.tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  margin-bottom: 24px;
  border-radius: 999px;
  background: var(--surface);
}
.tabs button {
  min-height: 36px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.tabs button.on {
  background: var(--accent);
  color: var(--on-accent);
}
.stats {
  display: grid;
  grid-template-columns: 2fr repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 4px;
  padding: 18px 20px;
  border-radius: 16px;
  background: var(--surface);
}
.stat strong {
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 900;
  line-height: 1.1;
}
.stat.big {
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #4b1d6b));
  color: #fff;
}
.stat.big strong {
  font-size: 56px;
}
.stat span {
  font-size: 13px;
  color: inherit;
  opacity: 0.75;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0 0 28px;
  color: var(--text-dim);
  font-size: 14px;
}
.columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px;
}
h2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 10px;
  font-size: 18px;
}
.ranked {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ranked li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 12px;
}
.ranked li:hover {
  background: var(--surface-hover);
}
.rank {
  width: 22px;
  text-align: center;
  font-weight: 900;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.cover {
  flex: none;
  width: 52px;
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.meta strong,
.meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.meta a:hover strong {
  text-decoration: underline;
}
.count {
  font-size: 13px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.share {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 32px 0 8px;
}
.share button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 20px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.share button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.share button:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 760px) {
  .stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .stat.big {
    grid-column: 1 / -1;
  }
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 手机：顶部让出返回列，标题小一点 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .title {
    margin-top: 44px;
    font-size: 28px;
  }
}

/* 年度回顾的入口：一张亮色的卡片 */
.wrapped {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  margin-bottom: 20px;
  padding: 16px 18px;
  border: 0;
  border-radius: 18px;
  background: linear-gradient(120deg, #ff3b5c, #5b21b6);
  color: #fff;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wrapped-year {
  font-size: 34px;
  line-height: 1;
}
.wrapped-text {
  display: grid;
  flex: 1;
  gap: 2px;
}
.wrapped-text small {
  font-size: 13px;
  opacity: 0.85;
}
</style>
