// 歌词舞台的共用数据：每种排版风格都从这里拿歌词、当前行、播放时间、封面颜色和设置，
// 自己只负责"怎么画"。
import {
  computed,
  inject,
  onBeforeUnmount,
  provide,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { findLineIndex, needsEnglish, withTranslation } from '@core/lyrics';
import { getPalette, FALLBACK_PALETTE } from './palette';
import { report, trackContext } from '../errorReporter';
import { locale } from '../i18n';

const STAGE_KEY = Symbol('lyric-stage');
const SETTINGS_KEY = 'lyristage:stage';

// 设置尽量少：歌词时间、字号都由系统自动处理，不让用户操心
// 翻译跟着 App 的语言：中文用网易云的中文翻译，English 用 LyriStage 服务器的英文翻译
const DEFAULT_SETTINGS = {
  style: 'kinetic',
  showTranslation: true,
  showRomaji: false,
};

// 全角标点在字体里只占半边，另外半边是空白（"）"的空白在右边），
// 大字居中时会看起来偏一边。显示时把全角括号换成半角，句尾标点去掉。
const BRACKETS = {
  '（': ' (',
  '）': ') ',
  '【': ' [',
  '】': '] ',
  '「': '“',
  '」': '”',
};
const TRAILING_PUNCTUATION = /[，。、；：,.;:\s]+$/;

/** 用于显示的文字：全角括号换成半角 */
export function displayText(text = '') {
  return text.replace(/[（）【】「」]/g, ch => BRACKETS[ch]);
}

/**
 * 整理一行的字用于大字显示：括号换成半角、句尾标点去掉、头尾空白去掉
 * @param {import('@core/lyrics').Word[]} words
 */
export function displayWords(words) {
  const result = words.map(w => ({ ...w, text: displayText(w.text) }));
  if (result.length) {
    const first = result[0];
    first.text = first.text.replace(/^\s+/, '');
    const last = result[result.length - 1];
    last.text = last.text.replace(TRAILING_PUNCTUATION, '');
  }
  return result.filter(w => w.text !== '');
}

// 分段的位置：空格和标点后面
const PHRASE_END = /[\s，。！？、,.!?;；：:…~～]$/;

/**
 * 把一行的字按空格和标点分成几段；每段的 start 是第一个字的开始时间
 * "一点一点控制不住 对你的" → ["一点一点控制不住 ", "对你的"]
 * @param {import('@core/lyrics').Word[]} words
 */
export function splitPhrases(words) {
  const phrases = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    if (PHRASE_END.test(word.text)) {
      phrases.push(current);
      current = [];
    }
  }
  if (current.length) phrases.push(current);
  return phrases.map(list => ({ words: list, start: list[0].start }));
}

/**
 * 换行提前多少毫秒：动画需要一点时间才完全显示，
 * 提前开始，字才会刚好在唱出来的时候清楚出现
 */
export const LINE_LEAD_MS = 200;

function loadSettings() {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 建立舞台数据并提供给子组件（LyricStage.vue 调用一次）
 * @param {object} deps
 * @param {{ track: object | null, playing: boolean }} deps.state 播放器的响应式状态
 * @param {{ currentTime: () => number, seek: (s: number) => void }} deps.player
 * @param {(track: object) => Promise<import('@core/lyrics').Lyrics>} deps.getLyrics
 * @param {(track: object) => Promise<string>} [deps.getTranslation] 英文翻译（LRC）
 */
export function provideStage({ state, player, getLyrics, getTranslation }) {
  const settings = reactive(loadSettings());
  watch(
    settings,
    value => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
      } catch {
        // localStorage 不能用时只是不记住设置
      }
    },
    { deep: true }
  );

  const track = computed(() => state.track);
  const coverUrl = computed(() =>
    state.track?.al?.picUrl?.replace(/^http:/, 'https:')
  );

  /** @type {import('vue').ShallowRef<import('@core/lyrics').Lyrics | null>} */
  const lyrics = shallowRef(null);
  const lyricsError = ref(null);
  const palette = shallowRef(FALLBACK_PALETTE);

  async function loadLyrics(id) {
    lyrics.value = null;
    lyricsError.value = null;
    if (!id) return;
    const current = state.track;
    const [lyricResult, colors] = await Promise.allSettled([
      getLyrics(current),
      getPalette(current.al?.picUrl),
    ]);
    if (state.track?.id !== id) return; // 已经切歌了
    if (lyricResult.status === 'fulfilled') lyrics.value = lyricResult.value;
    else {
      lyricsError.value = lyricResult.reason;
      report('lyrics', lyricResult.reason?.message ?? String(lyricResult.reason), {
        context: trackContext(current),
      });
    }
    if (colors.status === 'fulfilled') palette.value = colors.value;
    loadEnglish();
  }
  watch(() => state.track?.id, loadLyrics, { immediate: true });

  /** English 界面、开着翻译、歌词有中日韩文字：去拿英文翻译挂上去（拿不到就不显示翻译） */
  async function loadEnglish() {
    const current = lyrics.value;
    const song = state.track;
    if (!getTranslation || !current || !song || locale.value !== 'en' || !settings.showTranslation) return;
    if (current.lines.some(l => l.translationEn !== undefined) || !needsEnglish(current)) return;
    try {
      const lrc = await getTranslation(song);
      if (lyrics.value === current && state.track?.id === song.id) {
        lyrics.value = withTranslation(current, lrc, 'translationEn');
      }
    } catch {
      // 没有英文翻译就算了，不影响歌词
    }
  }
  watch([locale, () => settings.showTranslation], loadEnglish);

  /**
   * 一行下面的小字：罗马音一行、翻译一行（各自开关），用 \n 隔开；
   * 风格组件的 .sub 用 white-space: pre-line 显示
   * @param {import('@core/lyrics').LyricLine | null | undefined} line
   */
  function subText(line) {
    if (!line) return '';
    const parts = [];
    if (settings.showRomaji && line.romaji) parts.push(line.romaji);
    if (settings.showTranslation) {
      const translation = locale.value === 'en' ? line.translationEn : line.translation;
      if (translation) parts.push(translation);
    }
    return parts.join('\n');
  }

  // 每一帧读精确的播放时间（毫秒），逐字动画靠它
  const now = ref(0);
  let frame = 0;
  const tick = () => {
    now.value = player.currentTime() * 1000;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  onBeforeUnmount(() => cancelAnimationFrame(frame));

  const lines = computed(() => lyrics.value?.lines ?? []);
  const lineIndex = computed(() =>
    findLineIndex(lines.value, now.value + LINE_LEAD_MS)
  );
  const line = computed(() => lines.value[lineIndex.value] ?? null);
  const nextLine = computed(() => lines.value[lineIndex.value + 1] ?? null);
  const prevLine = computed(() => lines.value[lineIndex.value - 1] ?? null);
  /** 当前行唱到哪里（0~1）；行唱完到下一行之间是间奏 */
  const lineProgress = computed(() => {
    const l = line.value;
    if (!l) return 0;
    return Math.min(
      1,
      Math.max(0, (now.value - l.start) / (l.end - l.start || 1))
    );
  });
  const inInterlude = computed(
    () => line.value !== null && now.value > line.value.end + 800
  );

  const stage = {
    settings,
    track,
    coverUrl,
    lyrics,
    lyricsError,
    lines,
    palette,
    now,
    lineIndex,
    line,
    nextLine,
    prevLine,
    lineProgress,
    inInterlude,
    playing: computed(() => state.playing),
    subText,
    /** 歌词载入失败时再试一次（例如刚才断网） */
    retryLyrics: () => loadLyrics(state.track?.id),
    /** 点歌词跳到那一行 */
    seekToLine: index => {
      const target = lines.value[index];
      if (target) player.seek(target.start / 1000);
    },
  };
  provide(STAGE_KEY, stage);
  return stage;
}

/** 风格组件里取得舞台数据 */
export function useStage() {
  const stage = inject(STAGE_KEY);
  if (!stage) throw new Error('useStage() 只能在 LyricStage 里面使用');
  return stage;
}
