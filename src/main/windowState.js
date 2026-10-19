// 记住窗口大小和位置（存在 userData/window-state.json）
import { app, screen } from 'electron';
import fs from 'node:fs';
import { join } from 'node:path';

const file = () => join(app.getPath('userData'), 'window-state.json');
const DEFAULT = { bounds: { width: 1280, height: 800 }, maximized: false };

export function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(file(), 'utf-8'));
    // 上次的位置如果在已经拔掉的显示器上，就不用那个位置
    const visible = screen.getAllDisplays().some(({ workArea: a }) => {
      const b = state.bounds;
      return (
        b.x >= a.x &&
        b.y >= a.y &&
        b.x + 100 <= a.x + a.width &&
        b.y + 100 <= a.y + a.height
      );
    });
    if (!visible) {
      delete state.bounds.x;
      delete state.bounds.y;
    }
    return { ...DEFAULT, ...state };
  } catch {
    return DEFAULT;
  }
}

export function trackWindowState(win) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const state = {
        bounds: win.getNormalBounds(),
        maximized: win.isMaximized(),
      };
      fs.writeFile(file(), JSON.stringify(state), () => {});
    }, 500);
  };
  win.on('resize', save);
  win.on('move', save);
  win.on('maximize', save);
  win.on('unmaximize', save);
}
