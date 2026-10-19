// 主题：深色 / 浅色 / 跟随系统
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { setNativeTheme } from '../platform';

const KEY = 'lyristage:theme';

export const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
];

function load() {
  try {
    const value = localStorage.getItem(KEY);
    return THEME_OPTIONS.some(o => o.value === value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** 把选择套用到页面：system 时不设 data-theme，由 CSS 的 prefers-color-scheme 决定 */
function apply(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  // 电脑版：让 Electron 也切换，系统按钮颜色、窗口底色跟着变
  setNativeTheme(mode);
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref(load());
  apply(mode.value);

  watch(mode, value => {
    apply(value);
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // 不能保存就只在这次生效
    }
  });

  return { mode };
});
