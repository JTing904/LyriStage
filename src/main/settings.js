// 电脑版自己的小设定（存在 userData/settings.json）：桌面歌词开关、位置、锁定，托盘提示看过没有
import { app } from 'electron';
import fs from 'node:fs';
import { join } from 'node:path';

const file = () => join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  desktopLyrics: { enabled: false, locked: false, bounds: null },
  trayHintShown: false,
};

let cache = null;

export function getSettings() {
  if (!cache) {
    try {
      const saved = JSON.parse(fs.readFileSync(file(), 'utf-8'));
      cache = {
        ...DEFAULTS,
        ...saved,
        desktopLyrics: { ...DEFAULTS.desktopLyrics, ...saved.desktopLyrics },
      };
    } catch {
      cache = structuredClone(DEFAULTS);
    }
  }
  return cache;
}

let timer = null;
/** 改设定（浅合并），稍等一下再写进文件，拖动窗口时不会一直写 */
export function updateSettings(patch) {
  const current = getSettings();
  cache = { ...current, ...patch };
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
    } catch (err) {
      console.error('[LyriStage] 设定保存失败', err);
    }
  }, 300);
  return cache;
}
