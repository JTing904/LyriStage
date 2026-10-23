// 中文 / English 切换。
// 代码里的文字直接写中文，显示时用 t('中文') 换成目前的语言：
// - 中文：原样显示
// - English：查 locales/en/*.js 里「中文 → English」的对照表，没有翻译的就显示中文
// 可以带参数：t('已选 {n} 首', { n: 3 })，对照表里写 '已选 {n} 首': '{n} selected'
// 单复数：'{n} 首': '{n} song | {n} songs'（参数 n 是 1 用前面的）
import { ref, watch } from 'vue';

const KEY = 'lyristage:locale';
export const LOCALES = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
];

function load() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LOCALES.some(l => l.value === saved)) return saved;
  } catch {
    // 读不到就用默认
  }
  // 第一次打开：跟着手机 / 电脑的语言（中文系统用中文，其他都用英文）
  const system = navigator.languages?.[0] ?? navigator.language ?? '';
  return !system || /^zh/i.test(system) ? 'zh-CN' : 'en';
}

/** 目前的语言（'zh-CN' | 'en'），模板里用到 t() 的地方会跟着更新 */
export const locale = ref(load());

const EN = Object.assign(
  {},
  ...Object.values(import.meta.glob('./locales/en/*.js', { eager: true })).map(m => m.default)
);

watch(
  locale,
  value => {
    document.documentElement.lang = value;
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // 不能保存就只在这次生效
    }
    // 电脑版：托盘、桌面歌词也换语言
    window.lyristage?.setLocale?.(value);
  },
  { immediate: true }
);

// 开发时改了这个文件：整页重新载入（不然新旧两份 locale 会同时存在，画面中英混在一起）
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

/**
 * @param {string} text 中文原文
 * @param {Record<string, string | number>} [params]
 */
export function t(text, params) {
  let out = locale.value === 'en' ? (EN[text] ?? text) : text;
  // 英文单复数：翻译写成 '{n} song | {n} songs'，n 是 1 用前面的
  if (out.includes(' | ')) {
    const [one, other] = out.split(' | ');
    out = Number(params?.n) === 1 ? one : other;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** 在模板里直接用 t（main.js 里注册成全局的 $t） */
export const i18nPlugin = {
  install(app) {
    app.config.globalProperties.$t = t;
  },
};
